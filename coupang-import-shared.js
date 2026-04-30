(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CoupangImport = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const COUPANG_HOST = "https://*.coupang.com/*";

  function createState() {
    return { runs: new Map() };
  }

  function markRunning(state, runId) {
    state.runs.set(runId, { tabId: null, startedAt: Date.now() });
  }

  function buildStartUrl(range) {
    const u = new URL("https://mc.coupang.com/ssr/desktop/order/list");
    u.searchParams.set("searchType", "DATE");
    u.searchParams.set("startSearchDate", range.from);
    u.searchParams.set("endSearchDate", range.to);
    u.searchParams.set("pageIndex", "0");
    return u.toString();
  }

  async function startImport({ runId, from, to }, deps, state) {
    if (state.runs.size > 0) {
      throw new Error("import already running");
    }
    const granted = await deps.permissionsContains({ origins: [COUPANG_HOST] });
    if (!granted) {
      const ok = await deps.permissionsRequest({ origins: [COUPANG_HOST] });
      if (!ok) {
        deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code: "PERMISSION_DENIED" });
        return;
      }
    }
    markRunning(state, runId);
    const url = buildStartUrl({ from, to });
    const tab = await deps.tabsCreate({ url, active: false });
    state.runs.get(runId).tabId = tab.id;

    // Seed the run id + range into the tab so the content script can pick them up.
    await deps.executeScript({
      target: { tabId: tab.id },
      func: function (runId, range) {
        window.__HOSTIER_COUPANG_RUN_ID = runId;
        window.__HOSTIER_COUPANG_RANGE = range;
      },
      args: [runId, { from, to }],
      world: "MAIN",
    }).catch(() => {});

    await deps.executeScript({
      target: { tabId: tab.id },
      files: ["coupang-extract-shared.js", "coupang-content.js"],
    });

    state.runs.get(runId).timeoutId = deps.setTimer(() => {
      deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code: "TIMEOUT" });
      const r = state.runs.get(runId);
      if (r?.tabId) deps.tabsRemove(r.tabId).catch(() => {});
      state.runs.delete(runId);
    }, 90_000);
  }

  async function handleProgress({ runId, current, total }, deps, state) {
    if (!state.runs.has(runId)) return;
    deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_PROGRESS", current, total });
  }

  async function handleResult({ runId, rows }, deps, state) {
    const run = state.runs.get(runId);
    if (!run) return;
    deps.clearTimer(run.timeoutId);
    deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_RESULT", rows });
    if (run.tabId) await deps.tabsRemove(run.tabId).catch(() => {});
    state.runs.delete(runId);
  }

  async function handleError({ runId, code, message }, deps, state) {
    const run = state.runs.get(runId);
    deps.clearTimer(run?.timeoutId);
    deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code, message });
    if (run?.tabId) await deps.tabsRemove(run.tabId).catch(() => {});
    state.runs.delete(runId);
  }

  return {
    createState, markRunning, buildStartUrl,
    startImport, handleProgress, handleResult, handleError,
  };
});
