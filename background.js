importScripts("config.js", "flow-shared.js", "hostier-client-shared.js", "auth-bundle-shared.js", "connection-flow-shared.js", "connection-runner-shared.js", "background-33m2-shared.js");

const DEV_HELPER_PATH = "dev-helper.html";
const CONSENT_VERSION = "extension-consent-v1";
const EXTENSION_TOKEN_STORAGE_KEY = "hostierExtensionToken";
const CONNECTION_FLOW_STORAGE_KEY = "hostierConnectionFlowState";
const HOSTIER_ORIGIN_STORAGE_KEY = "hostierPreferredOrigin";
const DEFAULT_HOSTIER_URL = getExtensionConfig().hostierUrl.replace(/\/$/, "");
const HOSTIER_REQUEST_TIMEOUT_MS = 15000;
const backgroundResumesInFlight = new Set();
let localeMessages = null;

function getExtensionConfig() {
  const config = self.HOSTIER_EXTENSION_CONFIG;
  if (!config?.hostierUrl) {
    throw new Error("HOSTIER_EXTENSION_CONFIG.hostierUrl is not configured");
  }
  return config;
}

function isDevTarget() {
  return getExtensionConfig().target === "dev";
}

const {
  isReconnectRequired,
  normalizeBulkReconnectPendingConnections,
  validate33m2SessionInBrowser,
  localLogout33m2,
  findPreferred33m2Tab,
  getCookieStoreIdForTab,
} = globalThis.HostierExtensionShared;
const hostierClient = globalThis.HostierClientShared.createHostierClient({
  chromeApi: chrome,
  defaultHostierUrl: DEFAULT_HOSTIER_URL,
  allowLocalhost: isDevTarget(),
  extensionTokenStorageKey: EXTENSION_TOKEN_STORAGE_KEY,
  connectionFlowStorageKey: CONNECTION_FLOW_STORAGE_KEY,
  hostierOriginStorageKey: HOSTIER_ORIGIN_STORAGE_KEY,
  requestTimeoutMs: HOSTIER_REQUEST_TIMEOUT_MS,
  logPrefix: "[hostier]",
});
const resolveHostierUrl = hostierClient.resolveHostierUrl;
const getExtensionToken = hostierClient.getExtensionToken;
const fetchHostier = hostierClient.fetchHostier;
const {
  getBulkReconnectMismatchMessage,
  get33m2AccountKeyFromToken,
} = globalThis.HostierConnectionFlowShared;
const { createPlatformAuthBundleReader } = globalThis.HostierAuthBundleShared;
const { create33m2BackgroundCoordinator } = globalThis.HostierBackground33M2Shared;

const PLATFORM_CONFIGS = {
  THIRTY_THREE_M2: {
    url: "https://web.33m2.co.kr/",
    origin: "https://web.33m2.co.kr/*",
    name: "__Secure-session-token",
    firebaseSessionName: "__firebase_session",
    loginUrl: "https://web.33m2.co.kr/sign-in",
    homeUrl: "https://web.33m2.co.kr/host/main",
    ttlDays: 30,
    label: "33m2",
    autoMaintainEnabled: true,
  },
  ENKOSTAY: {
    url: "https://host.enko.kr/",
    origin: "https://host.enko.kr/*",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    ttlDays: 365,
    label: "Enkostay",
    autoMaintainEnabled: false,
  },
  LIVEANYWHERE: {
    url: "https://console.liveanywhere.me/",
    origin: "https://*.liveanywhere.me/*",
    name: "rtoken",
    loginUrl:
      "https://account.liveanywhere.me/?returnUrl=https://console.liveanywhere.me",
    homeUrl: "https://console.liveanywhere.me/host",
    ttlDays: 30,
    label: "LiveAnywhere",
    autoMaintainEnabled: false,
  },
};

const { readPlatformAuthBundleWithRetry } = createPlatformAuthBundleReader({
  chromeApi: chrome,
  platformConfigs: PLATFORM_CONFIGS,
  msg,
});
const logout33m2 = (options = {}) => localLogout33m2(PLATFORM_CONFIGS.THIRTY_THREE_M2, options);
const THIRTY_THREE_M2_BRIDGE_MESSAGE_TYPES = {
  GET_BROWSER_SESSION: "HOSTIER_GET_33M2_BROWSER_SESSION",
  SAFE_LOGOUT: "HOSTIER_SAFE_LOGOUT_33M2",
};
const HOSTIER_33M2_SILENT_SYNC_SAVED = "HOSTIER_33M2_SILENT_SYNC_SAVED";
const backgroundConnectionFlowRunner = globalThis.HostierConnectionRunnerShared.createConnectionFlowRunner({
  loadLocaleMessages,
  platformConfigs: PLATFORM_CONFIGS,
  msg,
  consentVersion: CONSENT_VERSION,
  log: (event, payload) => console.log(`[hostier] bg continuePendingConnectionFlow:${event}`, payload),
  readPlatformAuthBundleWithRetry,
  validate33m2SessionInBrowser,
  fetchHostier,
  localLogout33m2: logout33m2,
  enterAwaitingSourceState,
  setConnectionFlowState,
  pruneBulkReconnectPendingConnections,
  formatConnectionError,
  preserveExtras: () => ({ prepareForAccountSwitch: true }),
  onAuthBundleMissing: async () => {},
  onAwaiting: async () => {},
  beforeCycle: async () => {},
  onBlocking: async () => {},
  onUnauthorized: async (baseFlow) => {
    await setConnectionFlowState({
      ...baseFlow,
      step: "error",
      message: msg("pleaseLogin"),
    });
  },
  onError: async (message, { baseFlow }) => {
    await setConnectionFlowState({ ...baseFlow, step: "error", message });
  },
  afterSuccessfulSave: async () => {},
  onSuccess: async (message, { baseFlow }) => {
    await setConnectionFlowState({
      ...baseFlow,
      step: "success",
      message,
    });
  },
});
const background33m2Coordinator = create33m2BackgroundCoordinator({
  platformConfig: PLATFORM_CONFIGS.THIRTY_THREE_M2,
  consentVersion: CONSENT_VERSION,
  debounceMs: 1200,
  cooldownMs: 8000,
  log: (event, payload) => {
    console.log(`[hostier] ${event}`, payload);
    if (event === "33m2SilentSyncSaved") {
      chrome.runtime.sendMessage({
        type: HOSTIER_33M2_SILENT_SYNC_SAVED,
        payload,
      }).catch?.(() => {});
    }
  },
  hasPermission: (origin) =>
    new Promise((resolve) => {
      chrome.permissions.contains({ origins: [origin] }, (granted) => {
        resolve(Boolean(granted));
      });
    }),
  getConnectionFlowState,
  readPlatformAuthBundleWithRetry: (platform, options) =>
    readPlatformAuthBundleWithRetry(platform, options),
  get33m2AccountKeyFromToken,
  findPreferred33m2Tab,
  fetchHostier,
  localLogout33m2: logout33m2,
});

function getInstallDetectionMatches() {
  if (!isDevTarget()) {
    return [];
  }
  const hostierMatch = `${getExtensionConfig().hostierUrl.replace(/\/$/, "")}/*`;
  return [...new Set([hostierMatch, "http://localhost:5173/*"])];
}

function isHostierInstallDetectionUrl(rawUrl) {
  if (!isDevTarget()) {
    return false;
  }
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return false;
  }

  const configuredHostierOrigin = new URL(getExtensionConfig().hostierUrl).origin;

  try {
    const parsed = new URL(rawUrl);
    return parsed.origin === configuredHostierOrigin || parsed.origin === "http://localhost:5173";
  } catch {
    return false;
  }
}

function interpolateMessage(template, placeholders = {}, substitutions = []) {
  let rendered = template;

  substitutions.forEach((value, index) => {
    rendered = rendered.replaceAll(`$${index + 1}`, String(value));
  });

  for (const [name, placeholder] of Object.entries(placeholders)) {
    const substitutionIndex = Number.parseInt(
      String(placeholder.content ?? "").replace("$", ""),
      10,
    );
    const value =
      Number.isInteger(substitutionIndex) && substitutionIndex > 0
        ? substitutions[substitutionIndex - 1]
        : "";
    rendered = rendered.replaceAll(`$${name}$`, String(value ?? ""));
  }

  return rendered;
}

async function loadLocaleMessages() {
  if (localeMessages) {
    return localeMessages;
  }

  const response = await fetch(chrome.runtime.getURL("_locales/ko/messages.json"));
  if (!response.ok) {
    throw new Error(`Failed to load ko locale messages: ${response.status}`);
  }

  localeMessages = await response.json();
  return localeMessages;
}

function msg(key, substitutions = []) {
  const entry = localeMessages?.[key];
  if (entry?.message) {
    return interpolateMessage(
      entry.message,
      entry.placeholders ?? {},
      Array.isArray(substitutions) ? substitutions : [substitutions],
    );
  }

  return chrome.i18n.getMessage(key, substitutions) || key;
}

async function enterAwaitingSourceState(flow, {
  sourceUrl = null,
  message,
  targetDisplayLabel = null,
} = {}) {
  const nextFlow = {
    ...flow,
    step: "awaiting_source",
    openUrl: sourceUrl,
    message,
    targetDisplayLabel: targetDisplayLabel ?? flow.targetDisplayLabel ?? null,
    sourceAutoOpenedAt: flow.sourceAutoOpenedAt ?? null,
  };

  await setConnectionFlowState(nextFlow);

  return nextFlow;
}

async function pruneBulkReconnectPendingConnections(platform, pendingConnections) {
  const normalizedPendingConnections =
    normalizeBulkReconnectPendingConnections(pendingConnections);
  if (normalizedPendingConnections.length === 0) {
    return [];
  }

  const response = await fetchHostier("/api/platform-connections");
  if (!response.ok) {
    return normalizedPendingConnections;
  }

  const body = await response.json().catch(() => null);
  const expiredIds = new Set(
    Array.isArray(body?.connections)
      ? body.connections
        .filter(
          (connection) =>
            connection?.platform === platform && isReconnectRequired(connection),
        )
        .map((connection) => connection.id)
      : [],
  );

  return normalizedPendingConnections.filter((item) => expiredIds.has(item.id));
}

async function getConnectionFlowState() {
  return hostierClient.getConnectionFlowState();
}

async function setConnectionFlowState(state) {
  await hostierClient.setConnectionFlowState(state);
}

async function continuePendingConnectionFlow(flow) {
  await backgroundConnectionFlowRunner(flow);
}

function formatConnectionError(platform, flow, errorBody) {
  const config = PLATFORM_CONFIGS[platform];
  const baseMessage = errorBody?.error || msg("connectionFailed", [config.label]);

  switch (errorBody?.code) {
    case "RECONNECT_ACCOUNT_MISMATCH":
      return `${baseMessage} ${msg("reconnectMismatchHint")}`;
    case "PREPARE_ACCOUNT_SWITCH_FAILED":
      return `${baseMessage} ${msg("prepareAccountSwitchFailedHint")}`;
    case "MATCHING_CONNECTION_NOT_FOUND":
      return flow.bulkReconnect
        ? getBulkReconnectMismatchMessage(msg, flow.pendingConnections)
        : baseMessage;
    case "ACCOUNT_CONNECTED_TO_ANOTHER_USER":
      return `${baseMessage} ${msg("accountConnectedElsewhereHint")}`;
    case "ALREADY_CONNECTED_ACCOUNT":
      return `${baseMessage} ${msg("alreadyConnectedHint")}`;
    default:
      return baseMessage;
  }
}

async function maybeContinuePendingConnectionFlow() {
  return maybeContinueConnectionFlowForSteps([
    "permission_requested",
    "permission_granted",
    "background_resuming",
    "saving_connection",
  ]);
}

function cookieMatchesFlowPlatform(cookie, platform) {
  const config = PLATFORM_CONFIGS[platform];
  if (!config || cookie?.name !== config.name) {
    return false;
  }

  try {
    const targetHost = new URL(config.url).hostname;
    const normalizedDomain = String(cookie.domain || "").replace(/^\./, "");
    return targetHost === normalizedDomain || targetHost.endsWith(`.${normalizedDomain}`);
  } catch {
    return false;
  }
}

async function maybeContinueAwaitingSourceFlow(cookie) {
  const flow = await getConnectionFlowState();
  if (!flow?.platform) {
    return false;
  }

  if (flow.step !== "awaiting_source" || !cookieMatchesFlowPlatform(cookie, flow.platform)) {
    return false;
  }

  return maybeContinueConnectionFlowForSteps(["awaiting_source"]);
}

async function maybeContinueConnectionFlowForSteps(allowedSteps) {
  await loadLocaleMessages();
  const flow = await getConnectionFlowState();
  if (!flow?.platform) {
    return false;
  }

  if (!allowedSteps.includes(flow.step)) {
    return false;
  }

  const lockKey = `${flow.platform}:${flow.connectionId ?? "new"}`;
  if (backgroundResumesInFlight.has(lockKey)) {
    return false;
  }

  backgroundResumesInFlight.add(lockKey);

  try {
    await setConnectionFlowState({
      ...flow,
      step: "background_resuming",
      message: msg("connectingStatus", [PLATFORM_CONFIGS[flow.platform].label]),
    });
    await continuePendingConnectionFlow(flow);
    return true;
  } finally {
    backgroundResumesInFlight.delete(lockKey);
  }
}

async function maybeInject33m2PageGuard(tabId, url) {
  if (!Number.isInteger(tabId) || !background33m2Coordinator.shouldInjectIntoUrl(url)) {
    return false;
  }

  const granted = await new Promise((resolve) => {
    chrome.permissions.contains(
      { origins: [PLATFORM_CONFIGS.THIRTY_THREE_M2.origin] },
      (hasPermission) => resolve(Boolean(hasPermission)),
    );
  });

  if (!granted) {
    return false;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["page-guard-33m2-shared.js", "page-guard-33m2.js"],
    });
    return true;
  } catch (error) {
    console.warn("[hostier] Failed to inject 33m2 page guard:", error);
    return false;
  }
}

async function maybeReconcile33m2SessionFromTab(tabId, url) {
  if (!Number.isInteger(tabId) || !background33m2Coordinator.shouldInjectIntoUrl(url)) {
    return false;
  }

  const storeId = await getCookieStoreIdForTab(tabId);
  await background33m2Coordinator.performSilentSync({
    storeId: storeId || "default",
    changedCookieName: "page_load",
  });
  return true;
}

async function maybeInjectOpen33m2PageGuards() {
  const tabs = await chrome.tabs.query({
    url: PLATFORM_CONFIGS.THIRTY_THREE_M2.origin,
  }).catch(() => []);

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab?.id))
      .map((tab) => maybeInject33m2PageGuard(tab.id, tab.url)),
  );
}

async function ensureDevHelperTab() {
  if (!isDevTarget()) {
    return;
  }

  const helperUrl = chrome.runtime.getURL(DEV_HELPER_PATH);
  const existingTabs = await chrome.tabs.query({ url: helperUrl });
  if (existingTabs.some((tab) => Number.isInteger(tab.id))) {
    return;
  }

  await chrome.tabs.create({
    url: helperUrl,
    active: false,
  });
}

async function injectInstallDetector(tabId) {
  if (!isDevTarget()) {
    return;
  }
  if (!Number.isInteger(tabId)) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["install-detector.js"],
    });
  } catch (error) {
    console.warn("[hostier] Failed to inject install detector:", error);
  }
}

async function maybeInjectInstallDetector(tabId, url) {
  if (!isHostierInstallDetectionUrl(url)) {
    return;
  }

  await injectInstallDetector(tabId);
}

async function notifyOpenHostierTabs() {
  if (!isDevTarget()) {
    return;
  }
  const tabs = await chrome.tabs.query({
    url: getInstallDetectionMatches(),
  });

  await Promise.all(tabs.map((tab) => injectInstallDetector(tab.id)));
}

async function maybeInjectInstallDetectorIntoActiveTab(windowId) {
  if (!isDevTarget()) {
    return;
  }
  if (!Number.isInteger(windowId) || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    windowId,
  });

  if (!tab) {
    return;
  }

  await maybeInjectInstallDetector(tab.id, tab.url);
}

chrome.runtime.onInstalled.addListener(() => {
  void notifyOpenHostierTabs();
  void ensureDevHelperTab();
  void maybeInjectOpen33m2PageGuards();
});

chrome.runtime.onStartup?.addListener(() => {
  void ensureDevHelperTab();
  void maybeInjectOpen33m2PageGuards();
});

chrome.permissions.onAdded.addListener((permissions) => {
  void maybeContinuePendingConnectionFlow();
  if (Array.isArray(permissions?.origins) && permissions.origins.includes(PLATFORM_CONFIGS.THIRTY_THREE_M2.origin)) {
    void maybeInjectOpen33m2PageGuards();
  }
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!changeInfo.cookie) {
    return;
  }

  if (!changeInfo.removed) {
    void maybeContinueAwaitingSourceFlow(changeInfo.cookie);
  }
  void background33m2Coordinator.maybeHandleCookieChange(changeInfo);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  const nextUrl = changeInfo.url || tab?.url;
  void maybeInjectInstallDetector(tabId, nextUrl);
  void maybeInject33m2PageGuard(tabId, nextUrl);
  if (changeInfo.status === "complete") {
    void maybeReconcile33m2SessionFromTab(tabId, nextUrl);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void chrome.tabs.get(activeInfo.tabId)
    .then((tab) => maybeInjectInstallDetector(tab.id, tab.url))
    .catch(() => {});
});

chrome.windows.onFocusChanged?.addListener((windowId) => {
  void maybeInjectInstallDetectorIntoActiveTab(windowId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "HOSTIER_DEV_RELOAD" && isDevTarget()) {
    chrome.runtime.reload();
    return;
  }

  if (message?.type === "HOSTIER_CONTINUE_CONNECTION_FLOW") {
    void maybeContinuePendingConnectionFlow()
      .then((started) => sendResponse({ ok: true, started }))
      .catch((error) => {
        console.error("[hostier] Failed to continue connection flow from message:", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message?.type === THIRTY_THREE_M2_BRIDGE_MESSAGE_TYPES.GET_BROWSER_SESSION) {
    void background33m2Coordinator.getBrowserSessionSummary()
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => {
        console.error("[hostier] Failed to read 33m2 browser session:", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }

  if (message?.type === THIRTY_THREE_M2_BRIDGE_MESSAGE_TYPES.SAFE_LOGOUT) {
    void background33m2Coordinator.runSafeLogout()
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error("[hostier] Failed to run 33m2 safe logout:", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }
});

if (isDevTarget()) {
  void ensureDevHelperTab();
}
