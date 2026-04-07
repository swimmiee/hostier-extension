const HOSTIER_EXTENSION_PING_EVENT = "hostier-extension:ping";
const HOSTIER_EXTENSION_INSTALLED_EVENT = "hostier-extension:installed";
const INSTALL_DETECTOR_FLAG = "__HOSTIER_INSTALL_DETECTOR_ACTIVE__";

function markExtensionInstalled() {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  root.dataset.hostierExtensionInstalled = "true";
  root.dataset.hostierExtensionLastSeenAt = String(Date.now());
  root.dispatchEvent(new Event(HOSTIER_EXTENSION_INSTALLED_EVENT));
}

if (!globalThis[INSTALL_DETECTOR_FLAG]) {
  globalThis[INSTALL_DETECTOR_FLAG] = true;

  document.documentElement?.addEventListener(
    HOSTIER_EXTENSION_PING_EVENT,
    markExtensionInstalled,
  );
  markExtensionInstalled();
}
