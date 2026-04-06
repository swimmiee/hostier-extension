function getExtensionConfig() {
  const config = globalThis.HOSTIER_EXTENSION_CONFIG;
  if (!config?.hostierUrl) {
    throw new Error("HOSTIER_EXTENSION_CONFIG.hostierUrl is not configured");
  }
  return config;
}

const HOSTIER_URL = getExtensionConfig().hostierUrl.replace(/\/$/, "");
const HOSTIER_LOGIN_URL = `${HOSTIER_URL}/login`;
const PRIVACY_POLICY_URL = `${HOSTIER_URL}/privacy`;
const CONSENT_VERSION = "2026-04-06";
const msg = chrome.i18n.getMessage.bind(chrome.i18n);

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
    indicatorId: "indicator-33m2",
    btnId: "btn-33m2",
    metaId: "meta-33m2",
    autoMaintainEnabled: true,
  },
  ENKORSTAY: {
    url: "https://host.enko.kr/",
    origin: "https://host.enko.kr/*",
    name: "host.access.token",
    loginUrl: "https://host.enko.kr/signin",
    ttlDays: 365,
    label: "EnkorStay",
    indicatorId: "indicator-enkorstay",
    btnId: "btn-enkorstay",
    metaId: "meta-enkorstay",
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
    indicatorId: "indicator-liveanywhere",
    btnId: "btn-liveanywhere",
    metaId: "meta-liveanywhere",
    autoMaintainEnabled: false,
  },
};

const ui = {
  userEmail: document.getElementById("userEmail"),
  status: document.getElementById("status"),
  openWebsite: document.getElementById("openWebsite"),
  privacyLink: document.getElementById("privacyLink"),
  guard: document.getElementById("guard"),
  guardEyebrow: document.getElementById("guardEyebrow"),
  guardTitle: document.getElementById("guardTitle"),
  guardBody: document.getElementById("guardBody"),
  guardList: document.getElementById("guardList"),
  guardCheckWrap: document.getElementById("guardCheckWrap"),
  guardCheckbox: document.getElementById("guardCheckbox"),
  guardCheckboxLabel: document.getElementById("guardCheckboxLabel"),
  guardPrimary: document.getElementById("guardPrimary"),
  guardSecondary: document.getElementById("guardSecondary"),
};

let currentSession = null;
const connectionMap = new Map();

function openUrl(url) {
  chrome.tabs.create({ url });
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
  eyebrow,
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
  ui.guardEyebrow.textContent = eyebrow;
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

function setButtonsDisabled(disabled) {
  for (const config of Object.values(PLATFORM_CONFIGS)) {
    const btn = document.getElementById(config.btnId);
    if (!btn.classList.contains("connected") && !btn.classList.contains("loading")) {
      btn.disabled = disabled;
    }
  }
}

function setPlatformLoading(platform, loading) {
  const config = PLATFORM_CONFIGS[platform];
  const btn = document.getElementById(config.btnId);
  const indicator = document.getElementById(config.indicatorId);

  if (loading) {
    btn.classList.add("loading");
    btn.classList.remove("connected", "reconnect");
    btn.disabled = true;
    btn.textContent = msg("connecting");
    indicator.classList.add("loading");
  } else {
    btn.classList.remove("loading");
    indicator.classList.remove("loading");
  }
}

function getDefaultMeta(platform) {
  return PLATFORM_CONFIGS[platform].autoMaintainEnabled
    ? msg("autoMaintainAvailable")
    : msg("manualReconnectOnly");
}

function setPlatformState(platform, connection) {
  const config = PLATFORM_CONFIGS[platform];
  const indicator = document.getElementById(config.indicatorId);
  const btn = document.getElementById(config.btnId);
  const meta = document.getElementById(config.metaId);
  const isActive = connection?.status === "ACTIVE";
  const isExpired = connection?.status === "EXPIRED";

  btn.classList.remove("loading", "connected", "reconnect");
  indicator.classList.remove("loading", "connected", "expired");

  if (isActive) {
    indicator.classList.add("connected");
    indicator.textContent = "●";
    btn.classList.add("connected");
    btn.textContent = msg("connected");
    btn.disabled = true;
    meta.textContent = connection?.autoMaintainEnabled
      ? msg("autoMaintainActive")
      : msg("manualReconnectOnly");
    return;
  }

  if (isExpired) {
    indicator.classList.add("expired");
    indicator.textContent = "●";
    btn.classList.add("reconnect");
    btn.textContent = msg("reconnect");
    btn.disabled = false;
    meta.textContent = connection?.autoMaintainEnabled
      ? msg("autoMaintainInterrupted")
      : msg("manualReconnectRequired");
    return;
  }

  indicator.textContent = "○";
  btn.textContent = msg("connect");
  btn.disabled = false;
  meta.textContent = getDefaultMeta(platform);
}

function renderPlatformStates() {
  for (const platform of Object.keys(PLATFORM_CONFIGS)) {
    setPlatformState(platform, connectionMap.get(platform) ?? null);
  }
}

async function fetchHostierSession() {
  try {
    const res = await fetch(`${HOSTIER_URL}/api/auth/session`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const session = await res.json();
    if (!session?.user) return null;
    return session;
  } catch (e) {
    console.error("[hostier] Failed to load Hostier session:", e);
    return null;
  }
}

function showLoginGate() {
  clearStatus();
  ui.userEmail.textContent = msg("loginRequired");
  setButtonsDisabled(true);
  setGuardState({
    eyebrow: msg("loginGateEyebrow"),
    title: msg("loginGateTitle"),
    body: msg("loginGateBody"),
    primaryLabel: msg("loginGatePrimary"),
    primaryAction: () => openUrl(HOSTIER_LOGIN_URL),
    secondaryLabel: msg("refreshStatus"),
    secondaryAction: () => {
      void initializePopup();
    },
  });
}

function showDisclosure(platform) {
  const config = PLATFORM_CONFIGS[platform];
  clearStatus();
  ui.userEmail.textContent = currentSession?.user?.email || msg("loginRequired");
  setButtonsDisabled(true);
  setGuardState({
    eyebrow: msg("consentEyebrow"),
    title: msg("connectDisclosureTitle", [config.label]),
    body: msg("connectDisclosureBody", [config.label]),
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
    primaryLabel: msg("connectDisclosurePrimary"),
    primaryAction: () => {
      void connectPlatform(platform);
    },
    primaryDisabled: true,
    secondaryLabel: msg("back"),
    secondaryAction: async () => {
      clearGuardState();
      setButtonsDisabled(false);
      await loadStatus();
    },
  });

  ui.guardCheckbox.onchange = () => {
    ui.guardPrimary.disabled = !ui.guardCheckbox.checked;
  };
}

async function ensurePlatformPermission(config) {
  const origins = [config.origin];
  const alreadyGranted = await chrome.permissions.contains({ origins });
  if (alreadyGranted) return true;
  return chrome.permissions.request({ origins });
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
                      typeof candidate === "string" &&
                      candidate.length > 0 &&
                      candidate.split(".").length !== 3,
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

async function loadStatus() {
  try {
    const res = await fetch(`${HOSTIER_URL}/api/platform-connections`, {
      credentials: "include",
    });

    if (!res.ok) {
      if (res.status === 401) {
        showLoginGate();
      }
      return;
    }

    const data = await res.json();
    connectionMap.clear();
    for (const connection of data.connections ?? []) {
      connectionMap.set(connection.platform, connection);
    }

    clearGuardState();
    setButtonsDisabled(false);
    renderPlatformStates();
  } catch (e) {
    console.error("[hostier] Failed to load status:", e);
    showStatus("error", msg("statusLoadFailed"));
  }
}

async function connectPlatform(platform) {
  const config = PLATFORM_CONFIGS[platform];
  setPlatformLoading(platform, true);
  showStatus("info", msg("connectingStatus", [config.label]));

  try {
    const granted = await ensurePlatformPermission(config);
    if (!granted) {
      showStatus("error", msg("permissionDenied", [config.label]));
      return;
    }

    const authBundle = await readPlatformAuthBundle(platform);
    if (!authBundle.ok) {
      if (authBundle.openUrl) {
        await chrome.tabs.create({ url: authBundle.openUrl });
      }
      clearGuardState();
      setButtonsDisabled(false);
      showStatus("error", authBundle.error);
      renderPlatformStates();
      return;
    }

    const response = await fetch(`${HOSTIER_URL}/api/platform-connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
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
      showStatus(
        "error",
        errorBody?.error || msg("connectionFailed", [config.label]),
      );
      return;
    }

    await loadStatus();
    showStatus("success", msg("connectionComplete", [config.label]));
  } catch (e) {
    console.error("[hostier] Platform connection failed:", e);
    showStatus("error", msg("connectionFailed", [config.label]));
  } finally {
    setPlatformLoading(platform, false);
    renderPlatformStates();
  }
}

async function initializePopup() {
  currentSession = await fetchHostierSession();
  if (!currentSession) {
    showLoginGate();
    return;
  }

  ui.userEmail.textContent = currentSession.user.email || msg("loginRequired");
  await loadStatus();
}

document.getElementById("btn-33m2").addEventListener("click", () => {
  showDisclosure("THIRTY_THREE_M2");
});

document.getElementById("btn-enkorstay").addEventListener("click", () => {
  showDisclosure("ENKORSTAY");
});

document.getElementById("btn-liveanywhere").addEventListener("click", () => {
  showDisclosure("LIVEANYWHERE");
});

document.getElementById("openWebsite").addEventListener("click", (event) => {
  event.preventDefault();
  openUrl(HOSTIER_URL);
});

ui.userEmail.textContent = msg("loginRequired");
ui.openWebsite.textContent = msg("openWebsite");
ui.privacyLink.textContent = msg("privacyPolicy");
ui.privacyLink.href = PRIVACY_POLICY_URL;

for (const platform of Object.keys(PLATFORM_CONFIGS)) {
  setPlatformLoading(platform, true);
  const meta = document.getElementById(PLATFORM_CONFIGS[platform].metaId);
  meta.textContent = getDefaultMeta(platform);
}

initializePopup();
