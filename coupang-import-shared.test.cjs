const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("./coupang-import-shared.js");

function deps(overrides) {
  const calls = { tabsCreate: [], tabsRemove: [], execScripts: [], postMessages: [] };
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
    permissionsRequest: async () => true,
    ...overrides,
  };
}

test("startImport rejects when an import is already running", async () => {
  const state = shared.createState();
  shared.markRunning(state, "run-1");
  await assert.rejects(
    () => shared.startImport({ runId: "run-2", from: "2026-04-01", to: "2026-04-30" }, deps(), state),
    /already running/i,
  );
});

test("startImport requests permission if not granted", async () => {
  const state = shared.createState();
  let requested = false;
  const d = deps({
    permissionsContains: async () => false,
    permissionsRequest: async () => { requested = true; return true; },
  });
  await shared.startImport({ runId: "r", from: "2026-04-01", to: "2026-04-30" }, d, state).catch(() => {});
  assert.equal(requested, true);
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
