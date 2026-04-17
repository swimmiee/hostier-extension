const test = require("node:test");
const assert = require("node:assert/strict");

global.HostierExtensionShared = {
  getFirebaseRefreshToken: async () => null,
  refresh33m2SessionInBrowser: async () => ({ ok: true, status: 200 }),
  validate33m2SessionInBrowser: async () => ({ ok: true, status: 200 }),
  read33m2AuthSessionInBrowser: async () => null,
  findPreferred33m2Tab: async () => ({ id: 1 }),
  getCookieStoreIdForTab: async () => null,
  waitFor33m2SessionCookie: async () => null,
};

const { createPlatformAuthBundleReader } = require("./auth-bundle-shared.js");

test("auth bundle reader returns non-33m2 cookie auth without refresh metadata", async () => {
  const reader = createPlatformAuthBundleReader({
    chromeApi: {
      cookies: {
        async get() {
          return {
            value: "host-token",
            expirationDate: 1_800_000_000,
          };
        },
      },
    },
    platformConfigs: {
      ENKOSTAY: {
        url: "https://host.enko.kr/",
        name: "host.access.token",
        loginUrl: "https://host.enko.kr/signin",
        ttlDays: 365,
        label: "Enkostay",
      },
    },
    msg: (key) => key,
  });

  const result = await reader.readPlatformAuthBundle("ENKOSTAY");

  assert.deepEqual(result, {
    ok: true,
    token: "host-token",
    tokenExpiresAt: "2027-01-15T08:00:00.000Z",
    refreshToken: null,
    firebaseSessionToken: null,
  });
});

test("auth bundle reader returns login guidance when cookie is missing", async () => {
  const reader = createPlatformAuthBundleReader({
    chromeApi: {
      cookies: {
        async get() {
          return null;
        },
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        url: "https://web.33m2.co.kr/",
        name: "__Secure-session-token",
        loginUrl: "https://web.33m2.co.kr/sign-in",
        ttlDays: 30,
        label: "33m2",
      },
    },
    msg: (key) => key,
  });

  const result = await reader.readPlatformAuthBundle("THIRTY_THREE_M2");

  assert.deepEqual(result, {
    ok: false,
    error: "loginAndReturn33m2",
    openUrl: "https://web.33m2.co.kr/sign-in",
  });
});

test("auth bundle reader forwards preferredStoreId when selecting the 33m2 tab", async () => {
  const findPreferred33m2TabCalls = [];
  global.HostierExtensionShared.findPreferred33m2Tab = async (options) => {
    findPreferred33m2TabCalls.push(options);
    return { id: 7 };
  };

  const reader = createPlatformAuthBundleReader({
    chromeApi: {
      cookies: {
        async get() {
          return {
            value: "session-token",
            expirationDate: 1_800_000_000,
          };
        },
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        url: "https://web.33m2.co.kr/",
        name: "__Secure-session-token",
        firebaseSessionName: "__firebase_session",
        loginUrl: "https://web.33m2.co.kr/sign-in",
        ttlDays: 30,
        label: "33m2",
      },
    },
    msg: (key) => key,
  });

  await reader.readPlatformAuthBundle("THIRTY_THREE_M2", {
    allowMissingRefreshToken: true,
    preferredStoreId: "store-2",
  });

  assert.deepEqual(findPreferred33m2TabCalls, [
    { preferredStoreId: "store-2" },
  ]);
});

test("auth bundle reader passes storeId to waitFor33m2SessionCookie as options", async () => {
  const waitCalls = [];
  global.HostierExtensionShared.getCookieStoreIdForTab = async () => "store-9";
  global.HostierExtensionShared.findPreferred33m2Tab = async () => ({ id: 42 });
  global.HostierExtensionShared.waitFor33m2SessionCookie = async (
    config,
    previousValue,
    options,
  ) => {
    waitCalls.push({ config: config.name, previousValue, options });
    return null;
  };

  const reader = createPlatformAuthBundleReader({
    chromeApi: {
      cookies: {
        async get() {
          return {
            value: "session-token",
            expirationDate: 1_800_000_000,
          };
        },
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        url: "https://web.33m2.co.kr/",
        name: "__Secure-session-token",
        firebaseSessionName: "__firebase_session",
        loginUrl: "https://web.33m2.co.kr/sign-in",
        ttlDays: 30,
        label: "33m2",
      },
    },
    msg: (key) => key,
  });

  await reader.readPlatformAuthBundle("THIRTY_THREE_M2", {
    allowMissingRefreshToken: true,
  });

  assert.equal(waitCalls.length, 1);
  assert.equal(waitCalls[0].previousValue, "session-token");
  assert.deepEqual(waitCalls[0].options, {
    timeoutMs: 2000,
    storeId: "store-9",
  });
});
