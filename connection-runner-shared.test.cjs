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
