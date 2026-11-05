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

test("get33m2AccountKeyFromToken reads the renamed uid claim", () => {
  // 33m2가 세션 JWT의 계정 id 클레임을 `aid` -> `uid`로 개명(2026-09-08).
  const token = createJwt({ uid: 525191, firebaseToken: "ft", isHost: true });
  assert.equal(shared.get33m2AccountKeyFromToken(token), "33m2:525191");
});

test("get33m2AccountKeyFromToken prefers the current uid claim when both are present", () => {
  const token = createJwt({ uid: 525191, aid: "member-000999" });
  assert.equal(shared.get33m2AccountKeyFromToken(token), "33m2:525191");
});

test("get33m2AccountKeyFromToken returns undefined when neither aid nor uid is present", () => {
  assert.equal(shared.get33m2AccountKeyFromToken(createJwt({ firebaseToken: "ft" })), undefined);
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

// 2026-08-14 실유저 재현: 33m2 탭에서 연 indexedDB 커넥션을 닫지 않아 Firebase 의
// 업그레이드·삭제가 blocked 되고, pending 으로 남은 deleteDatabase 뒤로 이후 모든
// open() 이 줄을 서서 "로그인 중" 스피너가 멈추지 않았다. 한 번 고쳤다가 되돌린
// 적이 있으므로 여기서 묶는다.
function installFakeIndexedDb({ entries = null, throwOnOpen = false, missingStore = false, blocked = false }) {
  const calls = { closed: 0, versionChangeHandlerSet: false };
  const db = {
    close() {
      calls.closed += 1;
    },
    transaction() {
      if (missingStore) {
        throw new DOMException("NotFoundError");
      }
      return {
        objectStore: () => ({
          getAll() {
            const req = {};
            queueMicrotask(() => {
              req.result = entries || [];
              req.onsuccess && req.onsuccess();
            });
            return req;
          },
        }),
      };
    },
  };
  Object.defineProperty(db, "onversionchange", {
    set(fn) {
      calls.versionChangeHandlerSet = typeof fn === "function";
      calls.versionChangeHandler = fn;
    },
    get() {
      return calls.versionChangeHandler;
    },
    configurable: true,
  });

  global.DOMException = global.DOMException || class DOMException extends Error {};
  global.indexedDB = {
    open() {
      if (throwOnOpen) throw new Error("blocked by policy");
      const req = {};
      queueMicrotask(() => {
        if (blocked) {
          req.onblocked && req.onblocked();
          return;
        }
        req.result = db;
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  return calls;
}

test("readFirebaseRefreshTokenInPage 는 토큰을 읽은 뒤 커넥션을 닫는다", async () => {
  const calls = installFakeIndexedDb({
    entries: [{ value: { stsTokenManager: { refreshToken: "refresh-abc" } } }],
  });

  const token = await shared.readFirebaseRefreshTokenInPage();

  assert.equal(token, "refresh-abc");
  assert.equal(calls.closed, 1, "읽고 나서 db.close() 를 불러야 한다");
  assert.equal(calls.versionChangeHandlerSet, true, "onversionchange 를 달아야 한다");
});

test("readFirebaseRefreshTokenInPage 는 스토어가 없어도 멈추지 않고 커넥션을 닫는다", async () => {
  const calls = installFakeIndexedDb({ missingStore: true });

  const token = await shared.readFirebaseRefreshTokenInPage();

  assert.equal(token, null);
  assert.equal(calls.closed, 1, "스토어가 없을 때도 닫아야 한다");
});

test("readFirebaseRefreshTokenInPage 는 blocked 면 기다리지 않고 비켜 준다", async () => {
  installFakeIndexedDb({ blocked: true });

  const token = await shared.readFirebaseRefreshTokenInPage();

  assert.equal(token, null);
});

test("readFirebaseRefreshTokenInPage 의 onversionchange 는 커넥션을 닫는다", async () => {
  const calls = installFakeIndexedDb({
    entries: [{ value: { stsTokenManager: { refreshToken: "refresh-abc" } } }],
  });

  await shared.readFirebaseRefreshTokenInPage();
  const before = calls.closed;
  calls.versionChangeHandler();

  assert.equal(calls.closed, before + 1, "Firebase 가 업그레이드를 요청하면 즉시 닫아야 한다");
});

test("readFirebaseRefreshTokenInPage 는 JWT 모양(점 두 개)은 refresh token 으로 보지 않는다", async () => {
  installFakeIndexedDb({
    entries: [
      { value: { stsTokenManager: { refreshToken: "aaa.bbb.ccc" } } },
      { value: { refreshToken: "real-refresh" } },
    ],
  });

  assert.equal(await shared.readFirebaseRefreshTokenInPage(), "real-refresh");
});

test("readFirebaseRefreshTokenInPage 는 indexedDB.open 이 던져도 null 을 돌려준다", async () => {
  installFakeIndexedDb({ throwOnOpen: true });

  assert.equal(await shared.readFirebaseRefreshTokenInPage(), null);
});
