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
}
