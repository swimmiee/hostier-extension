importScripts("config.js");

const DEV_HELPER_PATH = "dev-helper.html";

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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "HOSTIER_DEV_RELOAD" && isDevTarget()) {
    chrome.runtime.reload();
  }
});

if (isDevTarget()) {
  void ensureDevHelperTab();
}
