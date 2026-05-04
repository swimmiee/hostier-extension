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

  function isLoginPage() {
    return location.host === "login.coupang.com" || location.pathname.startsWith("/login");
  }

  // Content script may run while the page is still mid-load (programmatic
  // executeScript fires once the document is parseable, but Coupang's
  // SSR + Akamai challenge sometimes takes a beat to settle). Poll for the
  // hydration script for up to ~12s before giving up.
  // Returns { kind: "data", data } | { kind: "login" } so callers can branch.
  async function readCurrentPageJSON() {
    for (let i = 0; i < 24; i++) {
      if (isLoginPage()) return { kind: "login" };
      const el = document.getElementById("__NEXT_DATA__");
      if (el && el.textContent) {
        try {
          return { kind: "data", data: JSON.parse(el.textContent) };
        } catch {
          // Tag exists but isn't valid JSON yet — keep waiting.
        }
      }
      if (!location.host.endsWith("coupang.com")) {
        throw new Error(`unexpected host: ${location.host}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (isLoginPage()) return { kind: "login" };
    throw new Error("__NEXT_DATA__ not in DOM");
  }

  async function fetchPageJSON(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const html = await res.text();
    return E.parseNextDataFromHTML(html);
  }

  try {
    const allRows = [];
    const initial = await readCurrentPageJSON();
    if (initial.kind === "login") {
      chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "LOGIN_REQUIRED", runId: RUN_ID });
      return;
    }
    let pageData = initial.data;

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
