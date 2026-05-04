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
  // Synchronous callback form (no await) to keep the activation window open.
  const COUPANG_HOST = "https://*.coupang.com/*";

  function startImportAfterPermission(eventData) {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    chrome.runtime.sendMessage({
      type: "HOSTIER_COUPANG_IMPORT_START",
      runId,
      from: eventData.from,
      to: eventData.to,
    }).catch?.(() => {});
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "HOSTIER_COUPANG_IMPORT_START") return;

    const data = event.data;
    // Diagnostic: visible in the page's DevTools console when something goes wrong.
    console.info("[hostier] coupang import start received, requesting permission");

    chrome.permissions.request({ origins: [COUPANG_HOST] }, (granted) => {
      if (chrome.runtime.lastError) {
        console.warn("[hostier] permissions.request error:", chrome.runtime.lastError.message);
      }
      console.info("[hostier] permission request result:", granted);

      if (!granted) {
        window.postMessage({
          type: "HOSTIER_COUPANG_IMPORT_ERROR",
          code: "PERMISSION_DENIED",
          message: chrome.runtime.lastError?.message,
        }, window.location.origin);
        return;
      }

      startImportAfterPermission(data);
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type.startsWith("HOSTIER_COUPANG_IMPORT_")) {
      window.postMessage(msg, window.location.origin);
    }
  });
}
