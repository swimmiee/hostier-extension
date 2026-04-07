importScripts("config.js");

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
});
