const HOSTIER_EXTENSION_PING_EVENT = "hostier-extension:ping";
const HOSTIER_EXTENSION_INSTALLED_EVENT = "hostier-extension:installed";
const INSTALL_DETECTOR_FLAG = "__HOSTIER_INSTALL_DETECTOR_ACTIVE__";

function getInstalledVersion() {
  try {
    return globalThis.chrome?.runtime?.getManifest?.().version ?? null;
  } catch {
    return null;
  }
}

function markExtensionInstalled() {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  const version = getInstalledVersion();

  root.dataset.hostierExtensionInstalled = "true";
  root.dataset.hostierExtensionLastSeenAt = String(Date.now());
  if (version) {
    root.dataset.hostierExtensionVersion = version;
  } else {
    delete root.dataset.hostierExtensionVersion;
  }

  root.dispatchEvent(
    new CustomEvent(HOSTIER_EXTENSION_INSTALLED_EVENT, {
      detail: { version },
    }),
  );
}

const HOSTIER_WEB_REQUEST_OPEN_POPUP = "hostier-extension:request-open-popup";

if (!globalThis[INSTALL_DETECTOR_FLAG]) {
  globalThis[INSTALL_DETECTOR_FLAG] = true;

  document.documentElement?.addEventListener(
    HOSTIER_EXTENSION_PING_EVENT,
    markExtensionInstalled,
  );
  markExtensionInstalled();

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const type = event.data?.type;
    if (type === HOSTIER_WEB_REQUEST_OPEN_POPUP) {
      chrome.runtime.sendMessage({ type: "HOSTIER_REQUEST_OPEN_POPUP" }).catch?.(() => {});
    }
  });

  // Coupang permission must be requested while a user gesture is alive.
  // Web posts a same-origin message synchronously inside the click handler;
  // calling chrome.permissions.request from THIS handler preserves the gesture.
  // If we forwarded to the background first, the gesture would be lost and
  // chrome would silently deny without showing the permission prompt.
  const COUPANG_HOST = "https://*.coupang.com/*";

  function requestCoupangPermission() {
    return new Promise((resolve) => {
      try {
        chrome.permissions.request({ origins: [COUPANG_HOST] }, (granted) => resolve(Boolean(granted)));
      } catch {
        resolve(false);
      }
    });
  }

  function hasCoupangPermission() {
    return new Promise((resolve) => {
      try {
        chrome.permissions.contains({ origins: [COUPANG_HOST] }, (granted) => resolve(Boolean(granted)));
      } catch {
        resolve(false);
      }
    });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const t = event.data?.type;
    if (t !== "HOSTIER_COUPANG_IMPORT_START") return;

    let granted = await hasCoupangPermission();
    if (!granted) {
      granted = await requestCoupangPermission();
    }
    if (!granted) {
      window.postMessage({
        type: "HOSTIER_COUPANG_IMPORT_ERROR",
        code: "PERMISSION_DENIED",
      }, window.location.origin);
      return;
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    chrome.runtime.sendMessage({
      type: "HOSTIER_COUPANG_IMPORT_START",
      runId,
      from: event.data.from,
      to: event.data.to,
    }).catch?.(() => {});
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type.startsWith("HOSTIER_COUPANG_IMPORT_")) {
      window.postMessage(msg, window.location.origin);
    }
  });
}
