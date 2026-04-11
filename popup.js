function getExtensionConfig() {
  const config = globalThis.HOSTIER_EXTENSION_CONFIG;
  if (!config?.hostierUrl) {
    throw new Error("HOSTIER_EXTENSION_CONFIG.hostierUrl is not configured");
  }
  return config;
}

const CONSENT_VERSION = "extension-consent-v1";
const EXTENSION_TOKEN_STORAGE_KEY = "hostierExtensionToken";
const CONNECTION_FLOW_STORAGE_KEY = "hostierConnectionFlowState";
const HOSTIER_ORIGIN_STORAGE_KEY = "hostierPreferredOrigin";
const DEFAULT_HOSTIER_URL = getExtensionConfig().hostierUrl.replace(/\/$/, "");
let localeMessages = null;
let currentHostierUrl = DEFAULT_HOSTIER_URL;
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

function getHostierUrl() {
  return currentHostierUrl;
}

function getHostierLoginUrl() {
  return `${getHostierUrl()}/login`;
}

function getPrivacyPolicyUrl() {
  return `${getHostierUrl()}/privacy`;
}

async function getStoredHostierUrl() {
  const stored = await chrome.storage.local.get(HOSTIER_ORIGIN_STORAGE_KEY);
  const value = stored?.[HOSTIER_ORIGIN_STORAGE_KEY];
  return isAllowedHostierUrl(value) ? value : null;
}

async function storeHostierUrl(url) {
  if (!isAllowedHostierUrl(url)) {
    return;
  }

  await chrome.storage.local.set({
    [HOSTIER_ORIGIN_STORAGE_KEY]: new URL(url).origin,
  });
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

async function resolveHostierUrl() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (activeTab?.url && isAllowedHostierUrl(activeTab.url)) {
    currentHostierUrl = new URL(activeTab.url).origin;
    await storeHostierUrl(currentHostierUrl);
    return currentHostierUrl;
  }

  const stored = await getStoredHostierUrl();
  if (stored) {
    currentHostierUrl = stored;
    return currentHostierUrl;
  }

  currentHostierUrl = DEFAULT_HOSTIER_URL;
  return currentHostierUrl;
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

const ui = {
  userEmail: document.getElementById("userEmail"),
  status: document.getElementById("status"),
  openWebsite: document.getElementById("openWebsite"),
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
  detailAddAccount: document.getElementById("detailAddAccount"),
};

let currentSession = null;
let currentPlatform = null;
let resumeInFlight = false;
let statusLoadState = "idle";
const connectionsByPlatform = new Map();

function openUrl(url) {
  chrome.tabs.create({ url });
}

async function requestBackgroundConnectionContinuation() {
  try {
    await chrome.runtime.sendMessage({ type: "HOSTIER_CONTINUE_CONNECTION_FLOW" });
  } catch (error) {
    console.warn("[hostier] Failed to request background connection continuation:", error);
  }
}

function setHeaderState({ email = "", showWebsiteLink = true } = {}) {
  ui.userEmail.textContent = email;
  ui.userEmail.hidden = !email;
  ui.openWebsite.hidden = !showWebsiteLink;
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

function setGuardState({
  title,
  body,
  items = [],
  checkboxLabel,
  primaryLabel,
  primaryAction,
  primaryDisabled = false,
  secondaryLabel,
  secondaryAction,
}) {
  document.body.classList.add("guard-active");
  ui.guard.hidden = false;
  ui.guardTitle.textContent = title;
  ui.guardBody.textContent = body;

  ui.guardList.hidden = items.length === 0;
  ui.guardList.textContent = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ui.guardList.append(li);
  }

  const showCheckbox = Boolean(checkboxLabel);
  ui.guardCheckWrap.hidden = !showCheckbox;
  ui.guardCheckbox.checked = false;
  ui.guardCheckboxLabel.textContent = checkboxLabel || "";

  ui.guardPrimary.textContent = primaryLabel;
  ui.guardPrimary.disabled = primaryDisabled;
  ui.guardPrimary.onclick = primaryAction;

  if (secondaryLabel) {
    ui.guardSecondary.hidden = false;
    ui.guardSecondary.textContent = secondaryLabel;
    ui.guardSecondary.onclick = secondaryAction;
  } else {
    ui.guardSecondary.hidden = true;
    ui.guardSecondary.onclick = null;
  }
}

function clearGuardState() {
  document.body.classList.remove("guard-active");
  ui.guard.hidden = true;
  ui.guardList.hidden = true;
  ui.guardList.textContent = "";
  ui.guardCheckbox.checked = false;
  ui.guardCheckbox.onchange = null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConnections(platform) {
  return connectionsByPlatform.get(platform) ?? [];
}

function isStatusLoading() {
  return statusLoadState === "loading";
}

function isReconnectRequired(connection) {
  return (
    connection.status === "EXPIRED"
    || connection.status === "ERROR"
    || connection.requiresReauth
  );
}

function formatConnectionDateTime(value) {
  return connectionDateTimeFormatter.format(new Date(value));
}

function formatConnectionDate(value) {
  return connectionDateFormatter.format(new Date(value));
}

function getConnectionMeta(connection) {
  const parts = [];
  if (connection.lastSyncedAt) {
    parts.push(`업데이트 ${formatConnectionDateTime(connection.lastSyncedAt)}`);
  }
  if (connection.tokenExpiresAt) {
    parts.push(`만료 ${formatConnectionDate(connection.tokenExpiresAt)}`);
  }
  if (!isReconnectRequired(connection)) {
    if (connection.autoMaintainEnabled) {
      parts.push("자동 유지");
    } else {
      parts.push(msg("manualReconnectOnly"));
    }
  }
  return parts.join(" · ");
}

function getListSummary(platform) {
  if (isStatusLoading()) {
    return msg("loadingConnections");
  }

  const connections = getConnections(platform);
  if (connections.length === 0) {
    return "연결된 계정이 없습니다.";
  }

  if (connections.length === 1) {
    const connection = connections[0];
    return isReconnectRequired(connection)
      ? `${connection.displayLabel} · ${msg("expired")}`
      : connection.displayLabel;
  }

  const activeCount = connections.filter((connection) => connection.status === "ACTIVE").length;
  const expiredCount = connections.filter((connection) => isReconnectRequired(connection)).length;
  const parts = [`연결된 계정 ${connections.length}개`];
  if (activeCount > 0) {
    parts.push(`활성 ${activeCount}`);
  }
  if (expiredCount > 0) {
    parts.push(`만료 ${expiredCount}`);
  }
  return parts.join(" · ");
}

function getListStateClass(platform) {
  if (isStatusLoading()) {
    return "loading";
  }

  const connections = getConnections(platform);
  if (connections.some((connection) => connection.status === "ACTIVE")) {
    return "connected";
  }
  if (connections.some((connection) => isReconnectRequired(connection))) {
    return "expired";
  }
  return "idle";
}

function hasExistingConnections(platform) {
  return getConnections(platform).length > 0;
}

function setCurrentPlatform(platform) {
  currentPlatform = platform;
  renderViews();
}

function renderPlatformList() {
  ui.platformList.textContent = "";

  for (const [platform, config] of Object.entries(PLATFORM_CONFIGS)) {
    const hasConnections = hasExistingConnections(platform);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "platform-row";
    row.disabled = isStatusLoading();
    row.onclick = () => {
      if (hasConnections) {
        setCurrentPlatform(platform);
        return;
      }

      showDisclosure(platform, { showDetailView: false });
    };

    const state = document.createElement("span");
    state.className = `state-dot ${getListStateClass(platform)}`;
    row.append(state);

    const body = document.createElement("div");
    body.className = "platform-body";

    const name = document.createElement("div");
    name.className = "platform-name";
    name.textContent = config.label;
    body.append(name);

    const summary = document.createElement("div");
    summary.className = "platform-summary";
    summary.textContent = getListSummary(platform);
    body.append(summary);

    row.append(body);

    const action = document.createElement("span");
    action.className = "platform-action";
    action.textContent = isStatusLoading()
      ? msg("loadingShort")
      : hasConnections
        ? "관리"
        : msg("connect");
    row.append(action);

    ui.platformList.append(row);
  }
}

function renderDetailView() {
  if (!currentPlatform) {
    ui.detailView.hidden = true;
    ui.listView.hidden = false;
    return;
  }

  const config = PLATFORM_CONFIGS[currentPlatform];
  const connections = getConnections(currentPlatform);
  ui.listView.hidden = true;
  ui.detailView.hidden = false;
  ui.detailTitle.textContent = config.label;
  ui.detailSummary.hidden = currentPlatform !== "THIRTY_THREE_M2" || connections.length === 0;
  ui.detailSummary.textContent =
    currentPlatform === "THIRTY_THREE_M2" && connections.length > 0
      ? msg("detailReconnectHint")
      : "";
  ui.detailAddAccount.textContent =
    connections.length > 0 ? msg("addAnotherAccount") : msg("connect");

  ui.accountsList.textContent = "";
  ui.accountsList.hidden = connections.length === 0;

  if (connections.length === 0) {
    return;
  }

  for (const connection of connections) {
    const row = document.createElement("div");
    row.className = "account-row";

    const body = document.createElement("div");
    body.className = "account-body";

    const head = document.createElement("div");
    head.className = "account-head";

    const label = document.createElement("div");
    label.className = "account-label";
    label.textContent = connection.displayLabel;
    head.append(label);

    const state = document.createElement("div");
    state.className = `account-state ${connection.status === "ACTIVE" ? "connected" : isReconnectRequired(connection) ? "expired" : "idle"}`;
    state.textContent =
      connection.status === "ACTIVE"
        ? msg("connected")
        : isReconnectRequired(connection)
          ? msg("expired")
          : "연결 안됨";
    head.append(state);

    body.append(head);

    const meta = document.createElement("div");
    meta.className = "account-meta";
    meta.textContent = getConnectionMeta(connection);
    body.append(meta);
    row.append(body);

    const actions = document.createElement("div");
    actions.className = "account-actions";

    if (isReconnectRequired(connection)) {
      const reconnectButton = document.createElement("button");
      reconnectButton.type = "button";
      reconnectButton.className = "text-action primary";
      reconnectButton.textContent = msg("reconnect");
      reconnectButton.onclick = () => {
        showDisclosure(currentPlatform, {
          connectionId: connection.id,
          displayLabel: connection.displayLabel,
          showDetailView: true,
        });
      };
      actions.append(reconnectButton);
    }

    const disconnectButton = document.createElement("button");
    disconnectButton.type = "button";
    disconnectButton.className = "text-action";
    disconnectButton.textContent = "해제";
    disconnectButton.onclick = () => {
      void disconnectConnection(currentPlatform, connection);
    };
    actions.append(disconnectButton);
    row.append(actions);

    ui.accountsList.append(row);
  }
}

function renderViews() {
  renderPlatformList();
  renderDetailView();
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

async function clearConnectionFlowState() {
  await chrome.storage.local.remove(CONNECTION_FLOW_STORAGE_KEY);
}

function showLoginGate() {
  statusLoadState = "idle";
  clearStatus();
  setHeaderState({
    email: "",
    showWebsiteLink: false,
  });
  setGuardState({
    title: msg("loginGateTitle"),
    body: msg("loginGateBody"),
    primaryLabel: msg("loginGatePrimary"),
    primaryAction: () => openUrl(getHostierLoginUrl()),
    secondaryLabel: msg("refreshStatus"),
    secondaryAction: () => {
      void initializePopup();
    },
  });
}

function showDisclosure(platform, options = {}) {
  const config = PLATFORM_CONFIGS[platform];
  const accountLabel = typeof options.displayLabel === "string" ? options.displayLabel : "";
  clearStatus();
  setHeaderState({
    email: currentSession?.user?.email || "",
    showWebsiteLink: false,
  });
  setGuardState({
    title: msg("connectDisclosureTitle", [config.label]),
    body: options.connectionId
      ? msg("connectDisclosureReconnectBody", [accountLabel, config.label])
      : hasExistingConnections(platform)
        ? msg("connectDisclosureAddAccountBody", [config.label])
        : msg("connectDisclosureBody", [config.label]),
    items: [
      msg("disclosureReadsAuth", [config.label]),
      msg("disclosureTransfersToHostier"),
      msg("disclosureEncryptedStorage"),
      config.autoMaintainEnabled
        ? msg("disclosure33m2AutoMaintain")
        : msg("disclosureManualReconnect"),
      config.autoMaintainEnabled
        ? msg("disclosure33m2OpenTab")
        : msg("disclosureDisconnectDeletes"),
    ],
    checkboxLabel: msg("connectDisclosureCheckbox"),
    primaryLabel:
      options.connectionId ? msg("reconnect") : msg("connectDisclosurePrimary"),
    primaryAction: () => {
      void connectPlatform(platform, options);
    },
    primaryDisabled: true,
    secondaryLabel: msg("back"),
    secondaryAction: async () => {
      clearGuardState();
      await loadStatus();
    },
  });

  ui.guardCheckbox.onchange = () => {
    ui.guardPrimary.disabled = !ui.guardCheckbox.checked;
  };
}

function formatConnectionError(platform, options = {}, errorBody = null) {
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

function hasPlatformPermission(config) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [config.origin] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
}

async function ensurePlatformPermission(config) {
  if (await hasPlatformPermission(config)) {
    return true;
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [config.origin] }, async (granted) => {
      resolve(Boolean(granted) && await hasPlatformPermission(config));
    });
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
  } catch (e) {
    console.log("[hostier] Failed to read Firebase refresh token:", e);
    return null;
  }
}

async function readPlatformAuthBundle(platform) {
  const config = PLATFORM_CONFIGS[platform];
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
  for (let attempt = 0; attempt < 3; attempt++) {
    lastResult = await readPlatformAuthBundle(platform);
    if (lastResult.ok) {
      return lastResult;
    }

    if (lastResult.openUrl) {
      return lastResult;
    }

    await delay(350 * (attempt + 1));
  }
  return lastResult;
}

async function disconnectConnection(platform, connection) {
  if (!window.confirm(`"${connection.displayLabel}" 연결을 해제할까요?`)) {
    return;
  }

  try {
    const response = await fetchHostier(
      `/api/platform-connections/${encodeURIComponent(connection.id)}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      showLoginGate();
      return;
    }

    if (!response.ok) {
      throw new Error("disconnect failed");
    }

    await loadStatus();
    showStatus("success", `${PLATFORM_CONFIGS[platform].label} 계정 연결을 해제했습니다.`);
  } catch (error) {
    console.error("[hostier] disconnect failed:", error);
    showStatus("error", "연결 해제에 실패했습니다.");
  }
}

async function connectPlatform(platform, options = {}) {
  const config = PLATFORM_CONFIGS[platform];
  clearGuardState();
  setHeaderState({
    email: currentSession?.user?.email || "",
    showWebsiteLink: true,
  });
  const showDetailView = options.showDetailView !== false;
  if (showDetailView) {
    setCurrentPlatform(platform);
  }

  const baseFlow = {
    platform,
    connectionId: options.connectionId ?? null,
    showDetailView,
  };

  try {
    const alreadyGranted = await hasPlatformPermission(config);
    if (!alreadyGranted) {
      await setConnectionFlowState({
        ...baseFlow,
        step: "permission_requested",
        message: `${config.label} 권한을 확인하고 있습니다.`,
      });
      showStatus("info", `${config.label} 권한을 확인하고 있습니다.`);

      const granted = await ensurePlatformPermission(config);
      if (!granted) {
        const message = msg("permissionDenied", [config.label]);
        await setConnectionFlowState({ ...baseFlow, step: "error", message });
        showStatus("error", message);
        return;
      }

      const message = msg("connectingStatus", [config.label]);
      await setConnectionFlowState({
        ...baseFlow,
        step: "permission_granted",
        message,
      });
      showStatus("info", message);
      await requestBackgroundConnectionContinuation();
      return;
    }

    await setConnectionFlowState({
      ...baseFlow,
      step: "permission_granted",
      message: `${config.label} 권한이 확인되었습니다.`,
    });

    const authBundle = await readPlatformAuthBundleWithRetry(platform);
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
      showStatus("error", message);
      await loadStatus();
      return;
    }

    await setConnectionFlowState({
      ...baseFlow,
      step: "saving_connection",
      message: msg("connectingStatus", [config.label]),
    });
    showStatus("info", msg("connectingStatus", [config.label]));

    const response = await fetchHostier("/api/platform-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: options.connectionId ?? undefined,
        platform,
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
      showLoginGate();
      return;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const message = formatConnectionError(platform, options, errorBody);
      await setConnectionFlowState({ ...baseFlow, step: "error", message });
      showStatus("error", message);
      return;
    }

    await loadStatus();
    const successMessage = msg("connectionComplete", [config.label]);
    await setConnectionFlowState({
      ...baseFlow,
      step: "success",
      message: successMessage,
    });
    showStatus("success", successMessage);
    await clearConnectionFlowState();
  } catch (e) {
    console.error("[hostier] Platform connection failed:", e);
    const message = msg("connectionFailed", [config.label]);
    await setConnectionFlowState({ ...baseFlow, step: "error", message });
    showStatus("error", message);
  } finally {
    renderViews();
  }
}

async function resumeConnectionFlowIfNeeded() {
  if (resumeInFlight) {
    return;
  }

  const flow = await getConnectionFlowState();
  if (!flow?.platform) {
    return;
  }

  if (Date.now() - Number(flow.updatedAt || 0) > 10 * 60 * 1000) {
    await clearConnectionFlowState();
    return;
  }

  if (flow.showDetailView !== false) {
    setCurrentPlatform(flow.platform);
  }

  if (flow.step === "success") {
    showStatus("success", flow.message || "연결이 완료되었습니다.");
    await clearConnectionFlowState();
    return;
  }

  if (flow.step === "error") {
    showStatus("error", flow.message || "연결에 실패했습니다.");
    return;
  }

  if (
    flow.step === "permission_requested"
    || flow.step === "permission_granted"
    || flow.step === "background_resuming"
    || flow.step === "saving_connection"
  ) {
    showStatus("info", flow.message || "연결을 진행하고 있습니다.");
    await requestBackgroundConnectionContinuation();
    return;
  }

  resumeInFlight = true;
  try {
    await connectPlatform(flow.platform, {
      connectionId: flow.connectionId || undefined,
      showDetailView: flow.showDetailView !== false,
    });
  } finally {
    resumeInFlight = false;
  }
}

async function loadStatus() {
  try {
    statusLoadState = "loading";
    renderViews();
    const res = await fetchHostier("/api/platform-connections");

    if (!res.ok) {
      if (res.status === 401) {
        statusLoadState = "idle";
        showLoginGate();
        return;
      }
      statusLoadState = "error";
      return;
    }

    const data = await res.json();
    currentSession = {
      user: {
        email: data.userEmail || null,
      },
    };
    setHeaderState({
      email: data.userEmail || "",
      showWebsiteLink: true,
    });

    connectionsByPlatform.clear();
    for (const platform of Object.keys(PLATFORM_CONFIGS)) {
      connectionsByPlatform.set(platform, []);
    }

    for (const connection of data.connections ?? []) {
      const list = connectionsByPlatform.get(connection.platform) ?? [];
      list.push(connection);
      connectionsByPlatform.set(connection.platform, list);
    }

    statusLoadState = "ready";
    clearGuardState();
    renderViews();
  } catch (e) {
    statusLoadState = "error";
    console.error("[hostier] Failed to load status:", e);
    showStatus("error", msg("statusLoadFailed"));
  }
}

async function initializePopup() {
  statusLoadState = "loading";
  const token = await getExtensionToken();
  if (!token) {
    showLoginGate();
    return;
  }

  currentSession = { user: { email: null } };
  setHeaderState({
    email: "",
    showWebsiteLink: true,
  });
  await loadStatus();
  await resumeConnectionFlowIfNeeded();
}

ui.detailBack.addEventListener("click", () => {
  currentPlatform = null;
  renderViews();
});

ui.detailAddAccount.addEventListener("click", () => {
  if (!currentPlatform) return;
  showDisclosure(currentPlatform, { showDetailView: true });
});

ui.openWebsite.addEventListener("click", (event) => {
  event.preventDefault();
  openUrl(getHostierUrl());
});

async function bootstrapPopup() {
  await loadLocaleMessages();
  await resolveHostierUrl();

  setHeaderState({
    email: "",
    showWebsiteLink: true,
  });
  ui.openWebsite.textContent = msg("openWebsite");
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
