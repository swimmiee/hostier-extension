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
    const firstPage = initial.data;

    if (!E.isLoggedIn(firstPage)) {
      chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "LOGIN_REQUIRED", runId: RUN_ID });
      return;
    }

    const firstHealth = E.checkDataHealth(firstPage);
    if (!firstHealth.healthy) {
      chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_ERROR", code: "PARSE_FAILED", message: firstHealth.reason, runId: RUN_ID });
      return;
    }

    allRows.push(...E.flattenOrders(firstPage, range));

    // Flip the UI off "주문 목록 페이지를 여는 중…" as soon as page 0 has been
    // read from the SSR'd tab, even when this is a single-page import. The
    // progress modal otherwise sits in its empty state until either RESULT
    // arrives (1-page case) or the first paginated PROGRESS fires.
    chrome.runtime.sendMessage({
      type: "HOSTIER_COUPANG_PROGRESS",
      runId: RUN_ID,
      current: 0,
      total: 1,
    });

    const firstPagination = E.getPagination(firstPage);
    const firstEarlyStop = E.isPageBeforeRange(firstPage, range);
    if (!firstPagination || !firstPagination.hasNext || firstEarlyStop) {
      chrome.runtime.sendMessage({ type: "HOSTIER_COUPANG_RESULT", runId: RUN_ID, rows: allRows });
      return;
    }

    // Walk pagination in parallel waves. Coupang only exposes hasNext /
    // nextPageIndex (no totalPages), so we speculate ahead by CONCURRENCY
    // pages per wave and stop as soon as a page reports no further data.
    // This cuts wall-time for multi-page imports from N × per-page-latency
    // to ⌈N / CONCURRENCY⌉ × per-page-latency.
    const CONCURRENCY = 4;
    let cursor = firstPagination.nextPageIndex;
    let totalEstimate = cursor + 1;
    // Highest pageIndex previously confirmed to exist via a hasNext signal.
    // Errors at or below this index are real failures; errors above it are
    // speculative over-fetches past the actual last page and must not be
    // treated as fatal.
    let confirmedExistsUpTo = cursor;
    let stopped = false;

    while (!stopped) {
      const wave = [];
      for (let i = 0; i < CONCURRENCY; i++) wave.push(cursor + i);

      const settled = await Promise.all(wave.map(async (idx) => {
        try {
          const url = E.buildOrderListUrl({ from: range.from, to: range.to, pageIndex: idx });
          const data = await fetchPageJSON(url);
          return { idx, data, ok: true };
        } catch (e) {
          return { idx, error: e, ok: false };
        }
      }));

      // Process in wave order so confirmedExistsUpTo advances monotonically
      // before we decide whether a later-index error is real or speculative.
      for (const r of settled) {
        if (stopped) continue;
        if (!r.ok) {
          if (r.idx <= confirmedExistsUpTo) {
            chrome.runtime.sendMessage({
              type: "HOSTIER_COUPANG_ERROR",
              code: "UNKNOWN",
              message: (r.error && r.error.message) || "fetch failed",
              runId: RUN_ID,
            });
            return;
          }
          stopped = true;
          continue;
        }
        const health = E.checkDataHealth(r.data);
        if (!health.healthy) {
          if (r.idx <= confirmedExistsUpTo) {
            chrome.runtime.sendMessage({
              type: "HOSTIER_COUPANG_ERROR",
              code: "PARSE_FAILED",
              message: health.reason,
              runId: RUN_ID,
            });
            return;
          }
          stopped = true;
          continue;
        }
        allRows.push(...E.flattenOrders(r.data, range));
        totalEstimate = Math.max(totalEstimate, r.idx + 1);
        chrome.runtime.sendMessage({
          type: "HOSTIER_COUPANG_PROGRESS",
          runId: RUN_ID,
          current: r.idx,
          total: totalEstimate,
        });
        const pag = E.getPagination(r.data);
        const eStop = E.isPageBeforeRange(r.data, range);
        if (pag && pag.hasNext && !eStop) {
          confirmedExistsUpTo = Math.max(confirmedExistsUpTo, r.idx + 1);
        } else {
          stopped = true;
        }
      }

      if (!stopped) cursor += CONCURRENCY;
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
