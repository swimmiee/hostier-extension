const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("./coupang-import-shared.js");

function deps(overrides) {
  const calls = { tabsCreate: [], tabsRemove: [], execScripts: [], postMessages: [], grantWindowOpens: 0 };
  return {
    calls,
    tabsCreate: async (opts) => { calls.tabsCreate.push(opts); return { id: 999, url: opts.url }; },
    tabsRemove: async (id) => { calls.tabsRemove.push(id); },
    executeScript: async (opts) => { calls.execScripts.push(opts); },
    sendToWebTab: (msg) => { calls.postMessages.push(msg); },
    onTabRemoved: (cb) => () => {},
    setTimer: (fn, ms) => { calls.timer = ms; return 1; },
    clearTimer: () => {},
    permissionsContains: async () => true,
    waitForTabComplete: async () => {},
    openGrantWindow: async () => { calls.grantWindowOpens += 1; },
    ...overrides,
  };
}

test("startImport clears stale runs from previous attempts", async () => {
  const state = shared.createState();
  shared.markRunning(state, "run-1");
  state.runs.get("run-1").tabId = 555;
  state.runs.get("run-1").timeoutId = 99;
  const d = deps();
  await shared.startImport({ runId: "run-2", from: "2026-04-01", to: "2026-04-30" }, d, state);
  // Stale run was cleaned up; new run is the only entry.
  assert.equal(state.runs.size, 1);
  assert.ok(state.runs.has("run-2"));
  assert.equal(d.calls.tabsRemove[0], 555); // stale tab closed
});

test("startImport opens grant window when permission missing", async () => {
  const state = shared.createState();
  const d = deps({ permissionsContains: async () => false });
  await shared.startImport({ runId: "r", from: "2026-04-01", to: "2026-04-30" }, d, state);
  assert.equal(d.calls.grantWindowOpens, 1);
  assert.equal(d.calls.tabsCreate.length, 0);
  assert.deepEqual(state.pendingGrant, { runId: "r", from: "2026-04-01", to: "2026-04-30" });
});

test("startImport opens hidden tab and injects extractor + content scripts", async () => {
  const state = shared.createState();
  const d = deps();
  await shared.startImport({ runId: "r", from: "2026-04-01", to: "2026-04-30" }, d, state).catch(() => {});
  assert.equal(d.calls.tabsCreate.length, 1);
  assert.equal(d.calls.tabsCreate[0].active, false);
  assert.match(d.calls.tabsCreate[0].url, /mc\.coupang\.com/);
  assert.match(d.calls.tabsCreate[0].url, /startSearchDate=2026-04-01/);
  // Two executeScript calls: one for the run-id seeding, one for the parser+content.
  assert.equal(d.calls.execScripts.length, 2);
  const filesInjection = d.calls.execScripts.find((s) => Array.isArray(s.files));
  assert.ok(filesInjection);
  assert.deepEqual(filesInjection.files, [
    "coupang-extract-shared.js",
    "coupang-content.js",
  ]);
});

test("handlePermissionGranted resumes import using pending range", async () => {
  const state = shared.createState();
  state.pendingGrant = { runId: "r2", from: "2026-04-01", to: "2026-04-30" };
  const d = deps();
  await shared.handlePermissionGranted(d, state);
  assert.equal(d.calls.tabsCreate.length, 1);
  assert.match(d.calls.tabsCreate[0].url, /startSearchDate=2026-04-01/);
  assert.equal(state.pendingGrant, null);
});

test("handlePermissionDeclined posts PERMISSION_DENIED and clears pending", async () => {
  const state = shared.createState();
  state.pendingGrant = { runId: "r3", from: "2026-04-01", to: "2026-04-30" };
  const d = deps();
  await shared.handlePermissionDeclined(d, state);
  assert.equal(d.calls.postMessages[0].type, "HOSTIER_COUPANG_IMPORT_ERROR");
  assert.equal(d.calls.postMessages[0].code, "PERMISSION_DENIED");
  assert.equal(state.pendingGrant, null);
});

test("handleResult forwards rows to web tab and closes hidden tab", async () => {
  const state = shared.createState();
  shared.markRunning(state, "r");
  state.runs.get("r").tabId = 999;
  const d = deps();
  await shared.handleResult({ runId: "r", rows: [{ sourceKey: "x:1" }] }, d, state);
  assert.equal(d.calls.tabsRemove[0], 999);
  assert.equal(d.calls.postMessages[0].type, "HOSTIER_COUPANG_IMPORT_RESULT");
  assert.deepEqual(d.calls.postMessages[0].rows, [{ sourceKey: "x:1" }]);
  assert.equal(state.runs.has("r"), false);
});

test("handleError forwards error code and clears run", async () => {
  const state = shared.createState();
  shared.markRunning(state, "r");
  state.runs.get("r").tabId = 999;
  const d = deps();
  await shared.handleError({ runId: "r", code: "LOGIN_REQUIRED" }, d, state);
  assert.equal(d.calls.postMessages[0].type, "HOSTIER_COUPANG_IMPORT_ERROR");
  assert.equal(d.calls.postMessages[0].code, "LOGIN_REQUIRED");
  assert.equal(state.runs.has("r"), false);
});

test("handleProgress forwards progress events to web tab", async () => {
  const state = shared.createState();
  shared.markRunning(state, "r");
  const d = deps();
  await shared.handleProgress({ runId: "r", current: 2, total: 5 }, d, state);
  assert.equal(d.calls.postMessages[0].type, "HOSTIER_COUPANG_IMPORT_PROGRESS");
  assert.equal(d.calls.postMessages[0].current, 2);
  assert.equal(d.calls.postMessages[0].total, 5);
});
