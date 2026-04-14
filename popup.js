function getExtensionConfig() {
  const config = globalThis.HOSTIER_EXTENSION_CONFIG;
  if (!config?.hostierUrl) {
    throw new Error("HOSTIER_EXTENSION_CONFIG.hostierUrl is not configured");
  }
  return config;
}

function isDevTarget() {
  return getExtensionConfig().target === "dev";
}

const CONSENT_VERSION = "extension-consent-v1";
const EXTENSION_TOKEN_STORAGE_KEY = "hostierExtensionToken";
const CONNECTION_FLOW_STORAGE_KEY = "hostierConnectionFlowState";
const HOSTIER_ORIGIN_STORAGE_KEY = "hostierPreferredOrigin";
const DEFAULT_HOSTIER_URL = getExtensionConfig().hostierUrl.replace(/\/$/, "");
const HOSTIER_REQUEST_TIMEOUT_MS = 15000;
let localeMessages = null;
const connectionDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const connectionDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const {
  isReconnectRequired,
  normalizeBulkReconnectPendingConnections,
  validate33m2SessionInBrowser,
  localLogout33m2,
} = globalThis.HostierExtensionShared;
const hostierClient = globalThis.HostierClientShared.createHostierClient({
  chromeApi: chrome,
  defaultHostierUrl: DEFAULT_HOSTIER_URL,
  extensionTokenStorageKey: EXTENSION_TOKEN_STORAGE_KEY,
  connectionFlowStorageKey: CONNECTION_FLOW_STORAGE_KEY,
  hostierOriginStorageKey: HOSTIER_ORIGIN_STORAGE_KEY,
  requestTimeoutMs: HOSTIER_REQUEST_TIMEOUT_MS,
  logPrefix: "[hostier]",
});
const {
  buildBaseFlow,
  getBulkReconnectWaitingMessage,
  getBulkReconnectMismatchMessage,
  is33m2AddAccountFlow,
} = globalThis.HostierConnectionFlowShared;
const { createPlatformAuthBundleReader } = globalThis.HostierAuthBundleShared;
const { createConnectionFlowRunner } = globalThis.HostierConnectionRunnerShared;
const { createPopupRenderController } = globalThis.HostierPopupRenderShared;
const { createPopupGuardController } = globalThis.HostierPopupGuardShared;
const { createPopupFlowController } = globalThis.HostierPopupFlowShared;

const getHostierLoginUrl = hostierClient.getHostierLoginUrl;
const getPrivacyPolicyUrl = hostierClient.getPrivacyPolicyUrl;
const resolveHostierUrl = hostierClient.resolveHostierUrl;
const getStoredExtensionToken = hostierClient.getStoredExtensionToken;
const storeExtensionToken = hostierClient.storeExtensionToken;
const clearExtensionToken = hostierClient.clearExtensionToken;
const getExtensionToken = hostierClient.getExtensionToken;
const fetchHostier = hostierClient.fetchHostier;

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

const ui = {
  userEmail: document.getElementById("userEmail"),
  status: document.getElementById("status"),
  awaitingView: document.getElementById("awaitingView"),
  awaitingKicker: document.getElementById("awaitingKicker"),
  awaitingTitle: document.getElementById("awaitingTitle"),
  awaitingBody: document.getElementById("awaitingBody"),
  awaitingPrimary: document.getElementById("awaitingPrimary"),
  awaitingSecondary: document.getElementById("awaitingSecondary"),
  loadingView: document.getElementById("loadingView"),
  loadingText: document.getElementById("loadingText"),
  privacyLink: document.getElementById("privacyLink"),
  guard: document.getElementById("guard"),
  guardTitle: document.getElementById("guardTitle"),
  guardBody: document.getElementById("guardBody"),
  guardList: document.getElementById("guardList"),
  guardCheckWrap: document.getElementById("guardCheckWrap"),
  guardCheckbox: document.getElementById("guardCheckbox"),
  guardCheckboxLabel: document.getElementById("guardCheckboxLabel"),
  guardPrimary: document.getElementById("guardPrimary"),
  guardSecondary: document.getElementById("guardSecondary"),
  listView: document.getElementById("listView"),
  listTitle: document.getElementById("listTitle"),
  listIntro: document.getElementById("listIntro"),
  platformList: document.getElementById("platformList"),
  detailView: document.getElementById("detailView"),
  detailBack: document.getElementById("detailBack"),
  detailTitle: document.getElementById("detailTitle"),
  detailSummary: document.getElementById("detailSummary"),
  accountsList: document.getElementById("accountsList"),
  detailSafeLogout: document.getElementById("detailSafeLogout"),
  detailAddAccount: document.getElementById("detailAddAccount"),
};

let currentSession = null;
let currentPlatform = null;
let resumeInFlight = false;
let statusLoadState = "idle";
let activeAwaitingSourceFlow = null;
let blockingFlowMessage = null;
let awaitingSourcePollTimer = null;
let awaitingSourcePollInFlight = false;
let guardActive = false;
const connectionsByPlatform = new Map();

function openUrl(url) {
  chrome.tabs.create({ url });
}

function setHeaderState({ email = "" } = {}) {
  ui.userEmail.textContent = email;
  ui.userEmail.hidden = !email;
}

function showStatus(kind, message) {
  ui.status.hidden = false;
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function clearStatus() {
  ui.status.hidden = true;
  ui.status.className = "status";
  ui.status.textContent = "";
}

function clearAwaitingSourceView() {
  activeAwaitingSourceFlow = null;
  stopAwaitingSourcePoll();
  awaitingSourcePollInFlight = false;
  ui.awaitingView.hidden = true;
  ui.awaitingKicker.textContent = "";
  ui.awaitingTitle.textContent = "";
  ui.awaitingBody.textContent = "";
  ui.awaitingPrimary.onclick = null;
  ui.awaitingSecondary.onclick = null;
}

function showBlockingLoading(message) {
  blockingFlowMessage = message;
  clearStatus();
  renderViews();
}

function clearBlockingLoading() {
  if (!blockingFlowMessage) {
    return;
  }

  blockingFlowMessage = null;
  renderViews();
}

function stopAwaitingSourcePoll() {
  if (awaitingSourcePollTimer) {
    clearTimeout(awaitingSourcePollTimer);
    awaitingSourcePollTimer = null;
  }
}

function getConnections(platform) {
  return connectionsByPlatform.get(platform) ?? [];
}

function isStatusLoading() {
  return statusLoadState === "loading";
}

function showAwaitingSourcePrompt(flow) {
  clearBlockingLoading();
  activeAwaitingSourceFlow = flow;
  setHeaderState({
    email: currentSession?.user?.email || "",
    showWebsiteLink: false,
  });
  renderViews();
}

function scheduleAwaitingSourcePoll() {
  if (awaitingSourcePollTimer) {
    clearTimeout(awaitingSourcePollTimer);
  }

  awaitingSourcePollTimer = setTimeout(async () => {
    if (
      !activeAwaitingSourceFlow
      || awaitingSourcePollInFlight
      || resumeInFlight
      || blockingFlowMessage
      || guardActive
    ) {
      scheduleAwaitingSourcePoll();
      return;
    }

    awaitingSourcePollInFlight = true;
    try {
      const flow = activeAwaitingSourceFlow;
      const authBundle = await readPlatformAuthBundleWithRetry(flow.platform, {
        allowMissingRefreshToken: Boolean(flow.connectionId || flow.bulkReconnect),
      });
      if (authBundle?.ok) {
        await connectPlatform(flow.platform, {
          connectionId: flow.connectionId || undefined,
          accountKey: flow.targetAccountKey || undefined,
          showDetailView: flow.showDetailView !== false,
          bulkReconnect: flow.bulkReconnect === true,
          pendingConnections: flow.pendingConnections,
          displayLabel: flow.targetDisplayLabel,
          sourceAutoOpenedAt: flow.sourceAutoOpenedAt,
        });
        return;
      }
    } catch (error) {
      console.warn("[hostier] Awaiting-source poll failed:", error);
    } finally {
      awaitingSourcePollInFlight = false;
    }

    if (activeAwaitingSourceFlow) {
      scheduleAwaitingSourcePoll();
    }
  }, 1200);
}

async function enterAwaitingSourceState(flow, {
  sourceUrl = null,
  message,
  targetDisplayLabel = null,
} = {}) {
  const shouldAutoOpen = Boolean(sourceUrl) && !flow.sourceAutoOpenedAt;
  const nextFlow = {
    ...flow,
    step: "awaiting_source",
    openUrl: sourceUrl,
    message,
    targetDisplayLabel: targetDisplayLabel ?? flow.targetDisplayLabel ?? null,
    sourceAutoOpenedAt: shouldAutoOpen
      ? Date.now()
      : flow.sourceAutoOpenedAt ?? null,
  };

  await setConnectionFlowState(nextFlow);

  if (shouldAutoOpen && sourceUrl) {
    openUrl(sourceUrl);
  }

  return nextFlow;
}

async function getConnectionFlowState() {
  return hostierClient.getConnectionFlowState();
}

async function setConnectionFlowState(state) {
  await hostierClient.setConnectionFlowState(state);
}

async function clearConnectionFlowState() {
  await hostierClient.clearConnectionFlowState();
}

function formatConnectionError(platform, options = {}, errorBody = null) {
  const config = PLATFORM_CONFIGS[platform];
  const baseMessage = errorBody?.error || msg("connectionFailed", [config.label]);

  switch (errorBody?.code) {
    case "RECONNECT_ACCOUNT_MISMATCH":
      return `${baseMessage} ${msg("reconnectMismatchHint")}`;
    case "PREPARE_ACCOUNT_SWITCH_FAILED":
      return `${baseMessage} ${msg("prepareAccountSwitchFailedHint")}`;
    case "MATCHING_CONNECTION_NOT_FOUND":
      return options.bulkReconnect
        ? getBulkReconnectMismatchMessage(msg, options.pendingConnections)
        : baseMessage;
    case "ACCOUNT_CONNECTED_TO_ANOTHER_USER":
      return `${baseMessage} ${msg("accountConnectedElsewhereHint")}`;
    case "ALREADY_CONNECTED_ACCOUNT":
      return `${baseMessage} ${msg("alreadyConnectedHint")}`;
    default:
      return baseMessage;
  }
}

const popupDeps = {
  chrome,
  document,
  window,
  ui,
  msg,
  platformConfigs: PLATFORM_CONFIGS,
  connectionDateTimeFormatter,
  connectionDateFormatter,
  normalizeBulkReconnectPendingConnections,
  isReconnectRequired,
  is33m2AddAccountFlow,
  buildBaseFlow,
  getBulkReconnectWaitingMessage,
  getHostierLoginUrl,
  getExtensionToken,
  fetchHostier,
  validate33m2SessionInBrowser,
  localLogout33m2,
  openUrl,
  setHeaderState,
  clearStatus,
  showStatus,
  clearAwaitingSourceView,
  showAwaitingSourcePrompt,
  showBlockingLoading,
  clearBlockingLoading,
  getConnectionFlowState,
  setConnectionFlowState,
  clearConnectionFlowState,
  readPlatformAuthBundleWithRetry,
  enterAwaitingSourceState,
  formatConnectionError,
  getConnections,
  isStatusLoading,
  getCurrentSession: () => currentSession,
  setCurrentSession: (value) => { currentSession = value; },
  getCurrentPlatform: () => currentPlatform,
  setCurrentPlatform: (value) => {
    currentPlatform = value;
    popupDeps.renderViews();
  },
  getResumeInFlight: () => resumeInFlight,
  setResumeInFlight: (value) => { resumeInFlight = value; },
  getStatusLoadState: () => statusLoadState,
  setStatusLoadState: (value) => { statusLoadState = value; },
  getActiveAwaitingSourceFlow: () => activeAwaitingSourceFlow,
  getBlockingFlowMessage: () => blockingFlowMessage,
  getGuardActive: () => guardActive,
  setGuardActive: (value) => { guardActive = value; },
  scheduleAwaitingSourcePoll,
  stopAwaitingSourcePoll,
  confirm: (message) => window.confirm(message),
  resetConnectionsByPlatform: (platforms) => {
    connectionsByPlatform.clear();
    for (const platform of platforms) {
      connectionsByPlatform.set(platform, []);
    }
  },
  pushConnection: (platform, connection) => {
    const list = connectionsByPlatform.get(platform) ?? [];
    list.push(connection);
    connectionsByPlatform.set(platform, list);
  },
  describeError: (error, fallbackMessage) => {
    if (!isDevTarget()) {
      return fallbackMessage;
    }
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    return `${fallbackMessage} (${message})`;
  },
  onAuthBundleMissing: async (nextFlow) => {
    popupDeps.clearStatus();
    popupDeps.showAwaitingSourcePrompt(nextFlow);
  },
  onAwaiting: async (nextFlow, options = {}) => {
    if (options.clearStatus) {
      popupDeps.clearStatus();
    }
    if (options.clearBlocking) {
      popupDeps.clearBlockingLoading();
    }
    popupDeps.showAwaitingSourcePrompt(nextFlow);
  },
  beforeCycle: async () => {},
  onBlocking: async (message) => {
    popupDeps.showBlockingLoading(message);
  },
  onError: async (message, options = {}) => {
    if (options.clearBlocking) {
      popupDeps.clearBlockingLoading();
    }
    if (options.clearPrompt) {
      popupDeps.clearAwaitingSourceView();
    }
    popupDeps.showStatus("error", message);
  },
  afterSuccessfulSave: async () => {
    await popupDeps.loadStatus();
  },
  onSuccess: async (message, options = {}) => {
    if (options.clearBlocking) {
      popupDeps.clearBlockingLoading();
    }
    if (options.clearPrompt) {
      popupDeps.clearAwaitingSourceView();
    }
    popupDeps.showStatus("success", message);
    if (options.clearFlow) {
      await popupDeps.clearConnectionFlowState();
    }
  },
};

const popupConnectionFlowRunner = createConnectionFlowRunner({
  loadLocaleMessages,
  platformConfigs: PLATFORM_CONFIGS,
  msg,
  consentVersion: CONSENT_VERSION,
  log: (event, payload) => console.log(`[hostier] popup continuePendingConnectionFlow:${event}`, payload),
  readPlatformAuthBundleWithRetry,
  validate33m2SessionInBrowser,
  fetchHostier,
  localLogout33m2: logout33m2,
  enterAwaitingSourceState,
  setConnectionFlowState,
  pruneBulkReconnectPendingConnections: (...args) => popupDeps.pruneBulkReconnectPendingConnections(...args),
  formatConnectionError: (...args) => popupDeps.formatConnectionError(...args),
  onAuthBundleMissing: async (...args) => popupDeps.onAuthBundleMissing(...args),
  onAwaiting: async (...args) => popupDeps.onAwaiting(...args),
  beforeCycle: async (...args) => popupDeps.beforeCycle(...args),
  onBlocking: async (...args) => popupDeps.onBlocking(...args),
  onUnauthorized: async () => popupDeps.showLoginGate(),
  onError: async (...args) => popupDeps.onError(...args),
  afterSuccessfulSave: async (...args) => popupDeps.afterSuccessfulSave(...args),
  onSuccess: async (...args) => popupDeps.onSuccess(...args),
});
popupDeps.popupConnectionFlowRunner = popupConnectionFlowRunner;

const popupViewController = createPopupRenderController(popupDeps);
Object.assign(popupDeps, popupViewController);
const {
  hasExistingConnections,
  renderViews,
} = popupViewController;

const popupGuardController = createPopupGuardController(popupDeps);
Object.assign(popupDeps, popupGuardController);
const {
  clearGuardState,
  showLoginGate,
  showDisclosure,
} = popupGuardController;

const popupFlowController = createPopupFlowController(popupDeps);
Object.assign(popupDeps, popupFlowController);
const {
  refreshExtensionTokenSilently,
  pruneBulkReconnectPendingConnections,
  continuePendingConnectionFlowInPopup,
  disconnectConnection,
  safeLogout33m2,
  connectPlatform,
  resumeConnectionFlowIfNeeded,
  loadStatus,
  initializePopup,
} = popupFlowController;


ui.detailBack.addEventListener("click", () => {
  currentPlatform = null;
  renderViews();
});

ui.detailAddAccount.addEventListener("click", () => {
  if (!currentPlatform) return;
  showDisclosure(currentPlatform, { showDetailView: true });
});

ui.detailSafeLogout.addEventListener("click", () => {
  if (currentPlatform !== "THIRTY_THREE_M2") return;
  void safeLogout33m2();
});

async function bootstrapPopup() {
  await loadLocaleMessages();
  await resolveHostierUrl();
  await refreshExtensionTokenSilently();

  setHeaderState({
    email: "",
  });
  ui.privacyLink.textContent = msg("privacyPolicy");
  ui.privacyLink.href = getPrivacyPolicyUrl();
  ui.listTitle.textContent = msg("platformListTitle");
  ui.listIntro.textContent = msg("platformListIntro");

  statusLoadState = "loading";
  renderViews();
  await initializePopup();
}

bootstrapPopup().catch((error) => {
  console.error("[hostier] Failed to bootstrap popup:", error);
  showStatus("error", "확장 프로그램을 초기화하지 못했습니다.");
});
