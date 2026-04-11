importScripts("config.js");

const DEV_HELPER_PATH = "dev-helper.html";
const CONSENT_VERSION = "extension-consent-v1";
const EXTENSION_TOKEN_STORAGE_KEY = "hostierExtensionToken";
const CONNECTION_FLOW_STORAGE_KEY = "hostierConnectionFlowState";
const HOSTIER_ORIGIN_STORAGE_KEY = "hostierPreferredOrigin";
const DEFAULT_HOSTIER_URL = getExtensionConfig().hostierUrl.replace(/\/$/, "");
const backgroundResumesInFlight = new Set();
let localeMessages = null;

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
  ENKORSTAY: {
    url: "https://host.enko.kr/",
    origin: "https://host.enko.kr/*",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    ttlDays: 365,
    label: "EnkorStay",
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

function getExtensionConfig() {
  const config = self.HOSTIER_EXTENSION_CONFIG;
  if (!config?.hostierUrl) {
    throw new Error("HOSTIER_EXTENSION_CONFIG.hostierUrl is not configured");
  }
  return config;
}

function getInstallDetectionMatches() {
  const hostierMatch = `${getExtensionConfig().hostierUrl.replace(/\/$/, "")}/*`;
  return [hostierMatch, "http://localhost:5173/*"];
}

function isDevTarget() {
  return getExtensionConfig().target === "dev";
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAllowedHostierUrls() {
  return [...new Set([DEFAULT_HOSTIER_URL, "http://localhost:5173"])];
}

function isAllowedHostierUrl(value) {
  if (!value) return false;

  try {
    const origin = new URL(value).origin;
    return getAllowedHostierUrls().includes(origin);
  } catch {
    return false;
  }
}

async function getStoredHostierUrl() {
  const stored = await chrome.storage.local.get(HOSTIER_ORIGIN_STORAGE_KEY);
  const value = stored?.[HOSTIER_ORIGIN_STORAGE_KEY];
  return isAllowedHostierUrl(value) ? value : null;
}

async function resolveHostierUrl() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (activeTab?.url && isAllowedHostierUrl(activeTab.url)) {
    return new URL(activeTab.url).origin;
  }

  const stored = await getStoredHostierUrl();
  if (stored) {
    return stored;
  }

  return DEFAULT_HOSTIER_URL;
}

async function getStoredExtensionToken() {
  const stored = await chrome.storage.local.get(EXTENSION_TOKEN_STORAGE_KEY);
  const tokenState = stored?.[EXTENSION_TOKEN_STORAGE_KEY];
  if (!tokenState?.token || !tokenState?.expiresAt) {
    return null;
  }

  if (Date.now() >= tokenState.expiresAt) {
    await chrome.storage.local.remove(EXTENSION_TOKEN_STORAGE_KEY);
    return null;
  }

  return tokenState.token;
}

async function storeExtensionToken(token, expiresInSeconds) {
  await chrome.storage.local.set({
    [EXTENSION_TOKEN_STORAGE_KEY]: {
      token,
      expiresAt: Date.now() + Math.max(0, expiresInSeconds - 30) * 1000,
    },
  });
}

async function clearExtensionToken() {
  await chrome.storage.local.remove(EXTENSION_TOKEN_STORAGE_KEY);
}

async function findPreferredHostierTab(url) {
  const normalizedUrl = new URL(url).origin;
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (activeTab?.url && activeTab.id && new URL(activeTab.url).origin === normalizedUrl) {
    return activeTab;
  }

  const matchingTabs = await chrome.tabs.query({
    url: `${normalizedUrl}/*`,
  });

  return matchingTabs.find((tab) => Number.isInteger(tab.id)) ?? null;
}

async function exchangeExtensionTokenFromTab(hostierUrl) {
  const tab = await findPreferredHostierTab(hostierUrl);
  if (!tab?.id) {
    return null;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [hostierUrl],
      func: async (baseUrl) => {
        try {
          const response = await fetch(`${baseUrl}/api/auth/extension/exchange`, {
            method: "POST",
            credentials: "include",
          });
          if (!response.ok) {
            return { ok: false, status: response.status };
          }

          const body = await response.json().catch(() => null);
          return { ok: true, body };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });

    if (!result?.result?.ok) {
      return null;
    }

    return result.result.body ?? null;
  } catch (error) {
    console.error("[hostier] Failed to exchange extension token via tab:", error);
    return null;
  }
}

async function exchangeExtensionToken() {
  const hostierUrl = await resolveHostierUrl();
  const tabBody = await exchangeExtensionTokenFromTab(hostierUrl);
  if (tabBody?.token && typeof tabBody.expiresInSeconds === "number") {
    await storeExtensionToken(tabBody.token, tabBody.expiresInSeconds);
    return tabBody.token;
  }

  const response = await fetch(`${hostierUrl}/api/auth/extension/exchange`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    await clearExtensionToken();
    return null;
  }

  const body = await response.json().catch(() => null);
  if (!body?.token || typeof body.expiresInSeconds !== "number") {
    await clearExtensionToken();
    return null;
  }

  await storeExtensionToken(body.token, body.expiresInSeconds);
  return body.token;
}

async function getExtensionToken({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await getStoredExtensionToken();
    if (cached) {
      return cached;
    }
  }

  return exchangeExtensionToken();
}

async function fetchHostier(path, options = {}) {
  const hostierUrl = await resolveHostierUrl();
  let token = await getExtensionToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response = await fetch(`${hostierUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status !== 401) {
    return response;
  }

  await clearExtensionToken();
  token = await getExtensionToken({ forceRefresh: true });
  if (!token) {
    return response;
  }

  headers.set("Authorization", `Bearer ${token}`);
  response = await fetch(`${hostierUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  return response;
}

async function getConnectionFlowState() {
  const stored = await chrome.storage.local.get(CONNECTION_FLOW_STORAGE_KEY);
  return stored?.[CONNECTION_FLOW_STORAGE_KEY] || null;
}

async function setConnectionFlowState(state) {
  await chrome.storage.local.set({
    [CONNECTION_FLOW_STORAGE_KEY]: {
      ...state,
      updatedAt: Date.now(),
    },
  });
}

async function getFirebaseRefreshToken(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve) => {
          const req = indexedDB.open("firebaseLocalStorageDb");
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("firebaseLocalStorage", "readonly");
            const store = tx.objectStore("firebaseLocalStorage");
            const getAll = store.getAll();
            getAll.onsuccess = () => {
              const extractRefreshToken = (entry) => {
                const candidates = [
                  entry?.value?.stsTokenManager?.refreshToken,
                  entry?.value?.user?.stsTokenManager?.refreshToken,
                  entry?.value?.spipiRefreshToken,
                  entry?.value?.refreshToken,
                  entry?.stsTokenManager?.refreshToken,
                ];

                return (
                  candidates.find(
                    (candidate) =>
                      typeof candidate === "string"
                      && candidate.length > 0
                      && candidate.split(".").length !== 3,
                  ) || null
                );
              };

              const token = getAll.result.map(extractRefreshToken).find(Boolean);
              resolve(token || null);
            };
            getAll.onerror = () => resolve(null);
          };
          req.onerror = () => resolve(null);
        });
      },
    });

    return result?.result || null;
  } catch (error) {
    console.log("[hostier] Failed to read Firebase refresh token:", error);
    return null;
  }
}

async function readPlatformAuthBundle(platform) {
  const config = PLATFORM_CONFIGS[platform];
  if (!config) {
    return null;
  }

  const cookie = await chrome.cookies.get({
    url: config.url,
    name: config.name,
  });

  if (!cookie?.value) {
    return {
      ok: false,
      error: msg(
        platform === "THIRTY_THREE_M2" ? "loginAndReturn33m2" : "loginAndReturn",
        [config.label],
      ),
      openUrl: config.loginUrl,
    };
  }

  const tokenExpiresAt = cookie.expirationDate
    ? new Date(cookie.expirationDate * 1000).toISOString()
    : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

  if (platform !== "THIRTY_THREE_M2") {
    return {
      ok: true,
      token: cookie.value,
      tokenExpiresAt,
      refreshToken: null,
      firebaseSessionToken: null,
    };
  }

  const [tab] = await chrome.tabs.query({ url: "https://web.33m2.co.kr/*" });
  if (!tab?.id) {
    return {
      ok: false,
      error: msg("missing33m2OpenTab"),
      openUrl: config.homeUrl || config.url,
    };
  }

  const refreshToken = await getFirebaseRefreshToken(tab.id);
  if (!refreshToken) {
    return {
      ok: false,
      error: msg("missing33m2RefreshToken"),
      openUrl: config.homeUrl || config.url,
    };
  }

  const firebaseSessionCookie = await chrome.cookies.get({
    url: config.url,
    name: config.firebaseSessionName,
  });

  return {
    ok: true,
    token: cookie.value,
    tokenExpiresAt,
    refreshToken,
    firebaseSessionToken: firebaseSessionCookie?.value || null,
  };
}

async function readPlatformAuthBundleWithRetry(platform) {
  let lastResult = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastResult = await readPlatformAuthBundle(platform);
    if (lastResult?.ok) {
      return lastResult;
    }

    if (lastResult?.openUrl) {
      return lastResult;
    }

    await delay(350 * (attempt + 1));
  }

  return lastResult;
}

async function continuePendingConnectionFlow(flow) {
  await loadLocaleMessages();
  const config = PLATFORM_CONFIGS[flow.platform];
  if (!config) {
    return;
  }

  const baseFlow = {
    platform: flow.platform,
    connectionId: flow.connectionId ?? null,
    showDetailView: flow.showDetailView !== false,
  };

  try {
    const authBundle = await readPlatformAuthBundleWithRetry(flow.platform);
    if (!authBundle?.ok) {
      if (authBundle?.openUrl) {
        await chrome.tabs.create({ url: authBundle.openUrl });
      }

      const message = authBundle?.error || msg("connectionFailed", [config.label]);
      await setConnectionFlowState({
        ...baseFlow,
        step: "awaiting_source",
        openUrl: authBundle?.openUrl || null,
        message,
      });
      return;
    }

    const connectingMessage = msg("connectingStatus", [config.label]);
    await setConnectionFlowState({
      ...baseFlow,
      step: "saving_connection",
      message: connectingMessage,
    });

    const response = await fetchHostier("/api/platform-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: flow.connectionId ?? undefined,
        platform: flow.platform,
        token: authBundle.token,
        refreshToken: authBundle.refreshToken,
        firebaseSessionToken: authBundle.firebaseSessionToken,
        tokenExpiresAt: authBundle.tokenExpiresAt,
        autoMaintainEnabled: config.autoMaintainEnabled,
        consentVersion: CONSENT_VERSION,
        consentedAt: new Date().toISOString(),
      }),
    });

    if (response.status === 401) {
      await setConnectionFlowState({
        ...baseFlow,
        step: "error",
        message: msg("pleaseLogin"),
      });
      return;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const message = formatConnectionError(flow.platform, flow, errorBody);
      await setConnectionFlowState({ ...baseFlow, step: "error", message });
      return;
    }

    await setConnectionFlowState({
      ...baseFlow,
      step: "success",
      message: msg("connectionComplete", [config.label]),
    });
  } catch (error) {
    console.error("[hostier] Failed to continue pending connection flow:", error);
    await setConnectionFlowState({
      ...baseFlow,
      step: "error",
      message: msg("connectionFailed", [config.label]),
    });
  }
}

function formatConnectionError(platform, flow, errorBody) {
  const config = PLATFORM_CONFIGS[platform];
  const baseMessage = errorBody?.error || msg("connectionFailed", [config.label]);

  switch (errorBody?.code) {
    case "RECONNECT_ACCOUNT_MISMATCH":
      return `${baseMessage} ${msg("reconnectMismatchHint")}`;
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

async function notifyOpenHostierTabs() {
  const tabs = await chrome.tabs.query({
    url: getInstallDetectionMatches(),
  });

  await Promise.all(tabs.map((tab) => injectInstallDetector(tab.id)));
}

chrome.runtime.onInstalled.addListener(() => {
  void notifyOpenHostierTabs();
  void ensureDevHelperTab();
});

chrome.runtime.onStartup?.addListener(() => {
  void ensureDevHelperTab();
});

chrome.permissions.onAdded.addListener(() => {
  void maybeContinuePendingConnectionFlow();
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed || !changeInfo.cookie) {
    return;
  }

  void maybeContinueAwaitingSourceFlow(changeInfo.cookie);
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
});

if (isDevTarget()) {
  void ensureDevHelperTab();
}
