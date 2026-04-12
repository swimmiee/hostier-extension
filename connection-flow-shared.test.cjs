const test = require("node:test");
const assert = require("node:assert/strict");

global.atob = (value) => Buffer.from(value, "base64").toString("binary");
global.TextDecoder = global.TextDecoder || require("node:util").TextDecoder;
global.HostierExtensionShared = require("./flow-shared.js");

const shared = require("./connection-flow-shared.js");

function createJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

test("buildBaseFlow normalizes reconnect metadata", () => {
  const result = shared.buildBaseFlow({
    platform: "THIRTY_THREE_M2",
    connectionId: "conn-1",
    showDetailView: true,
    bulkReconnect: false,
    targetAccountKey: "33m2:1",
    targetDisplayLabel: "account@example.com",
    sourceAutoOpenedAt: 123,
  });

  assert.deepEqual(result, {
    platform: "THIRTY_THREE_M2",
    connectionId: "conn-1",
    showDetailView: true,
    bulkReconnect: false,
    pendingConnections: [],
    targetAccountKey: "33m2:1",
    targetDisplayLabel: "account@example.com",
    sourceAutoOpenedAt: 123,
  });
});

test("analyzeCurrentAccountState detects cross-account cycle vs same-account reconnect", () => {
  const token = createJwt({ aid: 58959 });
  const baseFlow = shared.buildBaseFlow({
    platform: "THIRTY_THREE_M2",
    connectionId: "conn-2",
    targetAccountKey: "33m2:122218",
    showDetailView: true,
  });
  const result = shared.analyzeCurrentAccountState({
    baseFlow,
    authBundle: { token },
    browserSessionValidation: { ok: true, status: 200 },
  });

  assert.equal(result.currentAccountKey, "33m2:58959");
  assert.equal(result.reconnectNeedsDifferentAccount, true);
  assert.equal(result.shouldCycleCurrentSession, true);
  assert.equal(result.shouldForceLogin, false);
});

test("buildConnectRequestBody keeps reconnect and bulk reconnect bodies distinct", () => {
  const reconnectBody = shared.buildConnectRequestBody({
    baseFlow: { bulkReconnect: false, connectionId: "conn-1" },
    flow: { platform: "THIRTY_THREE_M2", connectionId: "conn-1" },
    authBundle: { token: "session", refreshToken: "refresh", firebaseSessionToken: "firebase", tokenExpiresAt: "2026-01-01T00:00:00.000Z" },
    config: { autoMaintainEnabled: true },
    consentVersion: "v1",
  });

  assert.equal(reconnectBody.connectionId, "conn-1");
  assert.equal(reconnectBody.matchExistingConnectionOnly, undefined);
  assert.equal(reconnectBody.platform, "THIRTY_THREE_M2");
});
