const test = require("node:test");
const assert = require("node:assert/strict");

global.atob = (value) => Buffer.from(value, "base64").toString("binary");
global.TextDecoder = global.TextDecoder || require("node:util").TextDecoder;

const shared = require("./flow-shared.js");

function createJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

test("normalizeBulkReconnectPendingConnections keeps only valid reconnect items", () => {
  const result = shared.normalizeBulkReconnectPendingConnections([
    null,
    { id: "ok-1", accountKey: "33m2:1", displayLabel: "first" },
    { id: "", accountKey: "33m2:2" },
    { id: "ok-2", accountKey: "33m2:2" },
  ]);

  assert.deepEqual(result, [
    { id: "ok-1", accountKey: "33m2:1", displayLabel: "first" },
    { id: "ok-2", accountKey: "33m2:2", displayLabel: "33m2:2" },
  ]);
});

test("get33m2AccountKeyFromToken normalizes numeric aid from JWT payload", () => {
  const token = createJwt({ aid: "member-000123" });
  assert.equal(shared.get33m2AccountKeyFromToken(token), "33m2:123");
});

test("findBulkReconnectMatch matches reconnect items by normalized account key", () => {
  const token = createJwt({ aid: 58959 });
  const match = shared.findBulkReconnectMatch([
    { id: "conn-a", accountKey: "33m2:122218", displayLabel: "soosoo" },
    { id: "conn-b", accountKey: "33m2:58959", displayLabel: "lsmpower" },
  ], token);

  assert.deepEqual(match, {
    id: "conn-b",
    accountKey: "33m2:58959",
    displayLabel: "lsmpower",
  });
});

test("localLogout33m2 returns even when firebase local-state cleanup stalls", async () => {
  const originalChrome = global.chrome;
  global.chrome = {
    browsingData: {
      async remove() {
        return undefined;
      },
    },
    cookies: {
      async getAll() {
        return [
          {
            name: "__Secure-session-token",
            domain: "web.33m2.co.kr",
            path: "/",
            secure: true,
            storeId: "0",
          },
        ];
      },
      async remove() {
        return null;
      },
    },
    tabs: {
      async query() {
        return [{ id: 123, url: "https://web.33m2.co.kr/host/main" }];
      },
      async update() {
        return { id: 123 };
      },
      async reload() {
        return undefined;
      },
    },
    scripting: {
      async executeScript() {
        return new Promise(() => {});
      },
    },
  };

  try {
    const startedAt = Date.now();
    const result = await shared.localLogout33m2(
      {
        name: "__Secure-session-token",
        firebaseSessionName: "__firebase_session",
        url: "https://web.33m2.co.kr/",
        homeUrl: "https://web.33m2.co.kr/host/main",
        loginUrl: "https://web.33m2.co.kr/sign-in",
      },
      {
        clearStateTimeoutMs: 20,
        reloadTabs: true,
        reloadTimeoutMs: 20,
      },
    );

    assert.equal(result.refreshedTabCount, 1);
    assert.ok(Date.now() - startedAt < 500);
  } finally {
    global.chrome = originalChrome;
  }
});
