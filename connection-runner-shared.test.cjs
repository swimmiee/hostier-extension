const test = require("node:test");
const assert = require("node:assert/strict");

global.atob = (value) => Buffer.from(value, "base64").toString("binary");
global.TextDecoder = global.TextDecoder || require("node:util").TextDecoder;
global.HostierExtensionShared = require("./flow-shared.js");
global.HostierConnectionFlowShared = require("./connection-flow-shared.js");

const { createConnectionFlowRunner } = require("./connection-runner-shared.js");

test("runner sends no-login reconnect directly to awaiting state", async () => {
  const calls = [];
  const runner = createConnectionFlowRunner({
    loadLocaleMessages: async () => {},
    platformConfigs: {
      THIRTY_THREE_M2: { label: "33m2", loginUrl: "https://web.33m2.co.kr/sign-in", autoMaintainEnabled: true },
    },
    msg: (key) => key,
    consentVersion: "v1",
    log: () => {},
    readPlatformAuthBundleWithRetry: async () => ({ ok: true, token: "a.b.c", refreshToken: null, firebaseSessionToken: null, tokenExpiresAt: "x", tabId: 1 }),
    validate33m2SessionInBrowser: async () => ({ ok: false, status: 401 }),
    fetchHostier: async () => { throw new Error("should not fetch"); },
    localLogout33m2: async () => {
      calls.push("logout");
      return { navigatedToLogin: true };
    },
    enterAwaitingSourceState: async (_flow, params) => ({ step: "awaiting_source", ...params }),
    setConnectionFlowState: async () => {},
    pruneBulkReconnectPendingConnections: async () => [],
    formatConnectionError: () => "error",
    onAuthBundleMissing: async () => {},
    onAwaiting: async (flow) => calls.push({ awaiting: flow }),
    beforeCycle: async () => {},
    onBlocking: async () => {},
    onUnauthorized: async () => {},
    onError: async () => {},
    afterSuccessfulSave: async () => {},
    onSuccess: async () => {},
  });

  await runner({ platform: "THIRTY_THREE_M2", connectionId: "conn-1", showDetailView: true });

  assert.equal(calls[0], "logout");
  assert.equal(calls[1].awaiting.step, "awaiting_source");
  assert.equal(calls[1].awaiting.sourceUrl, "https://web.33m2.co.kr/sign-in");
});

test("runner skips session logout on first add when no matching connection exists", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ aid: "525191" })).toString("base64url");
  const jwt = `${header}.${payload}.signature`;

  const fetchCalls = [];
  const logoutCalls = [];
  const awaitingCalls = [];
  const successCalls = [];

  const runner = createConnectionFlowRunner({
    loadLocaleMessages: async () => {},
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
        loginUrl: "https://web.33m2.co.kr/sign-in",
        url: "https://web.33m2.co.kr/",
        autoMaintainEnabled: true,
      },
    },
    msg: (key) => key,
    consentVersion: "v1",
    log: () => {},
    readPlatformAuthBundleWithRetry: async () => ({
      ok: true,
      token: jwt,
      refreshToken: null,
      firebaseSessionToken: "firebase-session-cookie",
      tokenExpiresAt: "2026-05-14T00:00:00.000Z",
      tabId: 9,
    }),
    validate33m2SessionInBrowser: async () => ({ ok: true, status: 200 }),
    fetchHostier: async (path, init) => {
      fetchCalls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
      const body = init?.body ? JSON.parse(init.body) : null;
      if (body?.matchExistingConnectionOnly) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ code: "MATCHING_CONNECTION_NOT_FOUND" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    },
    localLogout33m2: async () => {
      logoutCalls.push("logout");
      return { navigatedToLogin: true };
    },
    enterAwaitingSourceState: async (_flow, params) => ({ step: "awaiting_source", ...params }),
    setConnectionFlowState: async () => {},
    pruneBulkReconnectPendingConnections: async () => [],
    formatConnectionError: () => "error",
    onAuthBundleMissing: async () => {},
    onAwaiting: async (flow) => awaitingCalls.push(flow),
    beforeCycle: async () => {},
    onBlocking: async () => {},
    onUnauthorized: async () => {},
    onError: async () => {},
    afterSuccessfulSave: async () => {},
    onSuccess: async (message) => successCalls.push(message),
  });

  await runner({ platform: "THIRTY_THREE_M2", showDetailView: true });

  assert.equal(logoutCalls.length, 0, "localLogout33m2 must not run when no existing connection matches");
  assert.equal(awaitingCalls.length, 0, "runner must not reopen awaiting-source when nothing to cycle from");
  assert.equal(fetchCalls.length, 2, "runner should call preserve then save");
  assert.equal(fetchCalls[0].body.matchExistingConnectionOnly, true);
  assert.equal(fetchCalls[1].body.matchExistingConnectionOnly, undefined);
  assert.equal(successCalls.length, 1);
});
