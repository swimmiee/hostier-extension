const COUPANG_HOST = "https://*.coupang.com/*";

const grantBtn = document.getElementById("grantBtn");
const cancelBtn = document.getElementById("cancelBtn");
const status = document.getElementById("status");

grantBtn.addEventListener("click", () => {
  status.textContent = "";
  chrome.permissions.request({ origins: [COUPANG_HOST] }, (granted) => {
    if (chrome.runtime.lastError) {
      status.textContent = `오류: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!granted) {
      status.textContent = "권한이 거부됐어요. 다시 시도해주세요.";
      return;
    }
    chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_PERMISSION_GRANTED" }).finally(() => {
      window.close();
    });
  });
});

cancelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_PERMISSION_DECLINED" }).finally(() => {
    window.close();
  });
});
