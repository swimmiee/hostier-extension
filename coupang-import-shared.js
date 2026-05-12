(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CoupangImport = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const COUPANG_HOST = "https://*.coupang.com/*";

  function createState() {
    return { runs: new Map(), pendingGrant: null };
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

  async function beginImportFlow({ runId, from, to }, deps, state) {
    markRunning(state, runId);

    // Set the timeout FIRST. Content scripts can post RESULT/ERROR before the
    // setup awaits below resolve, in which case handleResult/handleError will
    // delete state.runs[runId] mid-flow — any later `state.runs.get(runId).x = …`
    // would crash with "Cannot set properties of undefined".
    const timeoutId = deps.setTimer(() => {
      if (!state.runs.has(runId)) return;
      const r = state.runs.get(runId);
      const tabId = r?.tabId;
      state.runs.delete(runId);
      deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code: "TIMEOUT" });
      if (tabId) deps.tabsRemove(tabId).catch(() => {});
    }, 90_000);
    const startRun = state.runs.get(runId);
    if (startRun) startRun.timeoutId = timeoutId;

    const url = buildStartUrl({ from, to });
    const tab = await deps.tabsCreate({ url, active: false });
    // The run may have already been resolved/cleared while the tab was
    // opening — bail if so.
    if (!state.runs.has(runId)) {
      deps.tabsRemove(tab.id).catch(() => {});
      return;
    }
    const tabRun = state.runs.get(runId);
    if (tabRun) tabRun.tabId = tab.id;

    // Wait for the hidden tab to finish loading before injecting. Without
    // this, chrome.scripting.executeScript races an empty/loading frame
    // and can fail outright — especially right after the host permission
    // was just granted, when the scripting layer hasn't yet picked up the
    // new origin. The previous silent-catch pattern hid those failures
    // and left the run to time out at 90s with the run-id seed missing,
    // which surfaced as a "NO_RUN_ID" error toast immediately followed
    // by a TIMEOUT toast 90s later.
    if (deps.waitForTabComplete) {
      await deps.waitForTabComplete(tab.id).catch(() => {});
    }
    if (!state.runs.has(runId)) return;

    // Seed the run id + range into the tab so the content script can pick
    // them up. Both injections must target ISOLATED (the default).
    try {
      await deps.executeScript({
        target: { tabId: tab.id },
        func: function (runId, range) {
          window.__HOSTIER_COUPANG_RUN_ID = runId;
          window.__HOSTIER_COUPANG_RANGE = range;
        },
        args: [runId, { from, to }],
      });

      if (!state.runs.has(runId)) return;

      await deps.executeScript({
        target: { tabId: tab.id },
        files: ["coupang-extract-shared.js", "coupang-content.js"],
      });
    } catch (err) {
      // Inject failed — surface a real error to the web tab rather than
      // letting the run hang to the 90s TIMEOUT, and clean up state so the
      // tab doesn't leak.
      if (state.runs.has(runId)) {
        const failed = state.runs.get(runId);
        if (failed?.timeoutId) deps.clearTimer(failed.timeoutId);
        state.runs.delete(runId);
      }
      deps.sendToWebTab({
        type: "HOSTIER_COUPANG_IMPORT_ERROR",
        code: "UNKNOWN",
        message: (err && err.message) || "scripting.executeScript failed",
      });
      deps.tabsRemove(tab.id).catch(() => {});
    }
  }

  function clearStaleRuns(deps, state) {
    // A previous attempt may have left state.runs non-empty (tab closed
    // mid-flight, content script never reported). Force-clean before starting
    // a new import — the user clicking 가져오기 again should always work.
    for (const [, run] of state.runs) {
      if (run.timeoutId) deps.clearTimer(run.timeoutId);
      if (run.tabId) deps.tabsRemove(run.tabId).catch(() => {});
    }
    state.runs.clear();
    state.pendingGrant = null;
  }

  async function startImport({ runId, from, to }, deps, state) {
    clearStaleRuns(deps, state);
    const granted = await deps.permissionsContains({ origins: [COUPANG_HOST] });
    if (!granted) {
      state.pendingGrant = { runId, from, to };
      await deps.openGrantWindow();
      return;
    }
    await beginImportFlow({ runId, from, to }, deps, state);
  }

  async function handlePermissionGranted(deps, state) {
    const pending = state.pendingGrant;
    state.pendingGrant = null;
    if (!pending) return;
    await beginImportFlow(pending, deps, state);
  }

  async function handlePermissionDeclined(deps, state) {
    state.pendingGrant = null;
    deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code: "PERMISSION_DENIED" });
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
    // Delete BEFORE tabsRemove. Otherwise chrome.tabs.onRemoved fires while
    // the runId is still in state.runs and our onRemoved listener mistakes
    // the planned close for a user abort, blasting an ABORTED error toast.
    const tabId = run.tabId;
    state.runs.delete(runId);
    if (tabId) await deps.tabsRemove(tabId).catch(() => {});
  }

  async function handleError({ runId, code, message }, deps, state) {
    const run = state.runs.get(runId);
    deps.clearTimer(run?.timeoutId);
    deps.sendToWebTab({ type: "HOSTIER_COUPANG_IMPORT_ERROR", code, message });
    const tabId = run?.tabId;
    state.runs.delete(runId);
    if (tabId) await deps.tabsRemove(tabId).catch(() => {});
  }

  return {
    createState, markRunning, buildStartUrl,
    startImport, beginImportFlow,
    handlePermissionGranted, handlePermissionDeclined,
    handleProgress, handleResult, handleError,
  };
});
