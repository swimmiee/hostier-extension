// Injected into the hidden mc.coupang.com tab. Reads __NEXT_DATA__ from the
// already-rendered page, then paginates via same-origin fetch. Posts results
// to background via chrome.runtime.sendMessage.

(async function main() {
  const RUN_ID = window.__HOSTIER_COUPANG_RUN_ID;
  if (!RUN_ID) {
    chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "NO_RUN_ID" });
    return;
  }
  const range = window.__HOSTIER_COUPANG_RANGE;
  if (!range || !range.from || !range.to) {
    chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "NO_RANGE", runId: RUN_ID });
    return;
  }

  const E = window.CoupangExtract;
  if (!E) {
    chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "NO_EXTRACTOR", runId: RUN_ID });
    return;
  }

  function readCurrentPageJSON() {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) throw new Error("__NEXT_DATA__ not in DOM");
    return JSON.parse(el.textContent || "");
  }

  async function fetchPageJSON(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const html = await res.text();
    return E.parseNextDataFromHTML(html);
  }

  try {
    const allRows = [];
    let pageData = readCurrentPageJSON();

    if (!E.isLoggedIn(pageData)) {
      chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "LOGIN_REQUIRED", runId: RUN_ID });
      return;
    }

    let pageIndex = 0;
    let totalEstimate = 1;

    while (true) {
      const health = E.checkDataHealth(pageData);
      if (!health.healthy) {
        chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "PARSE_FAILED", message: health.reason, runId: RUN_ID });
        return;
      }
      const rows = E.flattenOrders(pageData, range);
      allRows.push(...rows);

      const pagination = E.getPagination(pageData);
      const earlyStop = E.isPageBeforeRange(pageData, range);
      if (!pagination || !pagination.hasNext || earlyStop) break;

      pageIndex = pagination.nextPageIndex;
      const url = E.buildOrderListUrl({ from: range.from, to: range.to, pageIndex });
      totalEstimate = Math.max(totalEstimate, pageIndex + 1);
      chrome.runtime.sendMessage({
        type: "HOSTIER_COUPANG_PROGRESS",
        runId: RUN_ID,
        current: pageIndex,
        total: totalEstimate,
      });
      pageData = await fetchPageJSON(url);
    }

    chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_RESULT", runId: RUN_ID, rows: allRows });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "HOSTIER_COUPANG_ERROR",
      code: "UNKNOWN",
      message: err && err.message,
      runId: RUN_ID,
    });
  }
})();
