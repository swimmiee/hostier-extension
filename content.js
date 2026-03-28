// Inject marker so the web app can detect the extension is installed
document.documentElement.setAttribute("data-hostay-extension", "true");

// Relay messages from web page to background service worker
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data?.type) return;
  if (event.data.type === "HOSTAY_OPEN_POPUP") {
    chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
  }
});
