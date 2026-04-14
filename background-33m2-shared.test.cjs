const test = require("node:test");
const assert = require("node:assert/strict");

const {
  create33m2BackgroundCoordinator,
  isWatched33m2Cookie,
  build33m2SilentSyncKey,
} = require("./background-33m2-shared.js");

test("isWatched33m2Cookie only matches the 33m2 auth cookies on the 33m2 host", () => {
  const config = {
    url: "https://web.33m2.co.kr/",
    name: "__Secure-session-token",
    firebaseSessionName: "__firebase_session",
  };

  assert.equal(
    isWatched33m2Cookie(config, {
      name: "__Secure-session-token",
      domain: "web.33m2.co.kr",
    }),
    true,
  );
  assert.equal(
    isWatched33m2Cookie(config, {
      name: "__firebase_session",
      domain: ".web.33m2.co.kr",
    }),
    true,
  );
  assert.equal(
    isWatched33m2Cookie(config, {
      name: "_ga",
      domain: "web.33m2.co.kr",
    }),
    false,
  );
  assert.equal(
    isWatched33m2Cookie(config, {
      name: "__Secure-session-token",
      domain: "example.com",
    }),
    false,
  );
});

test("background coordinator skips removed cookies without trying to save", async () => {
  const logs = [];
  const coordinator = create33m2BackgroundCoordinator({
    platformConfig: {
      origin: "https://web.33m2.co.kr/*",
      url: "https://web.33m2.co.kr/",
      name: "__Secure-session-token",
      firebaseSessionName: "__firebase_session",
    },
    consentVersion: "extension-consent-v1",
    debounceMs: 5,
    cooldownMs: 1000,
    log: (event, payload) => logs.push({ event, payload }),
    hasPermission: async () => true,
    getConnectionFlowState: async () => null,
    readPlatformAuthBundleWithRetry: async () => {
      throw new Error("should not read auth bundle on removed cookie");
    },
    get33m2AccountKeyFromToken: () => "33m2:123",
    findPreferred33m2Tab: async () => ({ id: 1 }),
    fetchHostier: async () => {
      throw new Error("should not call hostier on removed cookie");
    },
    localLogout33m2: async () => ({ refreshedTabCount: 1 }),
  });

  const handled = await coordinator.maybeHandleCookieChange({
    removed: true,
    cookie: {
      name: "__Secure-session-token",
      domain: "web.33m2.co.kr",
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(logs, [
    {
      event: "33m2CookieRemoved",
      payload: {
        changedCookieName: "__Secure-session-token",
        reason: "cookie_removed",
        skipped: true,
      },
    },
  ]);
});

test("background coordinator silently refreshes the matching existing 33m2 connection after cookie drift", async () => {
  const fetchCalls = [];
  const logs = [];
  const coordinator = create33m2BackgroundCoordinator({
    platformConfig: {
      origin: "https://web.33m2.co.kr/*",
      url: "https://web.33m2.co.kr/",
      name: "__Secure-session-token",
      firebaseSessionName: "__firebase_session",
    },
    consentVersion: "extension-consent-v1",
    debounceMs: 5,
    cooldownMs: 1000,
    log: (event, payload) => logs.push({ event, payload }),
    hasPermission: async () => true,
    getConnectionFlowState: async () => null,
    readPlatformAuthBundleWithRetry: async () => ({
      ok: true,
      token: "token-for-33m2:123",
      refreshToken: "refresh-token",
      firebaseSessionToken: "firebase-session-token",
      tokenExpiresAt: "2026-05-14T00:00:00.000Z",
    }),
    get33m2AccountKeyFromToken: () => "33m2:123",
    findPreferred33m2Tab: async () => ({ id: 1 }),
    fetchHostier: async (path, init) => {
      fetchCalls.push({ path, init });
      if (!init) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connections: [
              {
                id: "conn-1",
                platform: "THIRTY_THREE_M2",
                accountKey: "33m2:123",
                accountEmail: "host@example.com",
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    },
    localLogout33m2: async () => ({ refreshedTabCount: 1 }),
  });

  await coordinator.maybeHandleCookieChange({
    removed: false,
    cookie: {
      name: "__Secure-session-token",
      domain: "web.33m2.co.kr",
      storeId: "store-1",
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].path, "/api/platform-connections");
  assert.equal(fetchCalls[1].path, "/api/platform-connections");
  assert.equal(fetchCalls[1].init.method, "POST");
  const body = JSON.parse(fetchCalls[1].init.body);
  assert.deepEqual(body, {
    connectionId: "conn-1",
    matchExistingConnectionOnly: true,
    platform: "THIRTY_THREE_M2",
    token: "token-for-33m2:123",
    refreshToken: "refresh-token",
    firebaseSessionToken: "firebase-session-token",
    tokenExpiresAt: "2026-05-14T00:00:00.000Z",
    autoMaintainEnabled: true,
    consentVersion: "extension-consent-v1",
    consentedAt: body.consentedAt,
  });
  assert.equal(typeof body.consentedAt, "string");
  assert.deepEqual(logs, [
    {
      event: "33m2SilentSyncSaved",
      payload: {
        reason: "matched_existing_connection_only",
        accountKey: "33m2:123",
        changedCookieName: "__Secure-session-token",
        saved: true,
      },
    },
  ]);
});

test("background coordinator skips cookie drift when no matching existing connection is found", async () => {
  const logs = [];
  const coordinator = create33m2BackgroundCoordinator({
    platformConfig: {
      origin: "https://web.33m2.co.kr/*",
      url: "https://web.33m2.co.kr/",
      name: "__Secure-session-token",
      firebaseSessionName: "__firebase_session",
    },
    consentVersion: "extension-consent-v1",
    debounceMs: 5,
    cooldownMs: 1000,
    log: (event, payload) => logs.push({ event, payload }),
    hasPermission: async () => true,
    getConnectionFlowState: async () => null,
    readPlatformAuthBundleWithRetry: async () => ({
      ok: true,
      token: "token-for-33m2:999",
      refreshToken: "refresh-token",
      firebaseSessionToken: "firebase-session-token",
      tokenExpiresAt: "2026-05-14T00:00:00.000Z",
    }),
    get33m2AccountKeyFromToken: () => "33m2:999",
    findPreferred33m2Tab: async () => ({ id: 1 }),
    fetchHostier: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        connections: [
          {
            id: "conn-1",
            platform: "THIRTY_THREE_M2",
            accountKey: "33m2:123",
          },
        ],
      }),
    }),
    localLogout33m2: async () => ({ refreshedTabCount: 1 }),
  });

  await coordinator.maybeHandleCookieChange({
    removed: false,
    cookie: {
      name: "__firebase_session",
      domain: "web.33m2.co.kr",
      storeId: "store-1",
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(logs, [
    {
      event: "33m2SilentSyncSkipped",
      payload: {
        reason: "no_matching_connection",
        accountKey: "33m2:999",
        changedCookieName: "__firebase_session",
        skipped: true,
      },
    },
  ]);
});

test("build33m2SilentSyncKey uses both storeId and accountKey", () => {
  assert.equal(
    build33m2SilentSyncKey("store-1", "33m2:123"),
    "store-1:33m2:123",
  );
});
