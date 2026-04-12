(function initAuthBundleShared(root) {
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function createPlatformAuthBundleReader({ chromeApi, platformConfigs, msg }) {
    const {
      getFirebaseRefreshToken,
      refresh33m2SessionInBrowser,
      validate33m2SessionInBrowser,
      read33m2AuthSessionInBrowser,
      findPreferred33m2Tab,
      getCookieStoreIdForTab,
      waitFor33m2SessionCookie,
    } = root.HostierExtensionShared;

    async function readFirebaseSessionCookie(config, sessionData, storeId) {
      return (
        sessionData?.firebaseToken
        || (await chromeApi.cookies.get({
          url: config.url,
          name: config.firebaseSessionName,
          ...(storeId ? { storeId } : {}),
        }))?.value
        || null
      );
    }

    async function readPlatformAuthBundle(platform, options = {}) {
      const config = platformConfigs[platform];
      if (!config) {
        return null;
      }

      const tab = platform === "THIRTY_THREE_M2"
        ? await findPreferred33m2Tab()
        : null;
      const storeId = Number.isInteger(tab?.id)
        ? await getCookieStoreIdForTab(tab.id)
        : null;
      let cookie = await chromeApi.cookies.get({
        url: config.url,
        name: config.name,
        ...(storeId ? { storeId } : {}),
      });

      if (!cookie?.value) {
        return {
          ok: false,
          error: msg(
            platform === "THIRTY_THREE_M2" ? "loginAndReturn33m2" : "loginAndReturn",
            [config.label],
          ),
          openUrl: config.loginUrl,
        };
      }

      let tokenExpiresAt = cookie.expirationDate
        ? new Date(cookie.expirationDate * 1000).toISOString()
        : new Date(Date.now() + config.ttlDays * 86400000).toISOString();

      if (platform !== "THIRTY_THREE_M2") {
        return {
          ok: true,
          token: cookie.value,
          tokenExpiresAt,
          refreshToken: null,
          firebaseSessionToken: null,
        };
      }

      if (!tab?.id) {
        return {
          ok: false,
          error: msg("missing33m2OpenTab"),
          openUrl: config.homeUrl || config.url,
        };
      }

      const refreshAttempt = await refresh33m2SessionInBrowser(tab.id);
      const refreshedCookie = await waitFor33m2SessionCookie(config, cookie.value, 2000, storeId);
      if (refreshedCookie?.value) {
        cookie = refreshedCookie;
        tokenExpiresAt = refreshedCookie.expirationDate
          ? new Date(refreshedCookie.expirationDate * 1000).toISOString()
          : new Date(Date.now() + config.ttlDays * 86400000).toISOString();
      }

      if (refreshAttempt?.status === 401 || refreshAttempt?.ok === false) {
        const browserSessionValidation = await validate33m2SessionInBrowser(tab.id);
        if (browserSessionValidation?.status === 401 || browserSessionValidation?.status === 403) {
          return {
            ok: false,
            error: msg("loginAndReturn33m2"),
            openUrl: config.loginUrl,
            clearSession: true,
          };
        }
      }

      const sessionData = await read33m2AuthSessionInBrowser(tab.id);
      const refreshToken =
        await getFirebaseRefreshToken(tab.id)
        || sessionData?.refreshToken
        || null;

      if (!refreshToken) {
        if (options.allowMissingRefreshToken) {
          return {
            ok: true,
            token: cookie.value,
            tokenExpiresAt,
            refreshToken: null,
            firebaseSessionToken: await readFirebaseSessionCookie(config, sessionData, storeId),
            tabId: tab.id,
          };
        }

        return {
          ok: false,
          error: msg("missing33m2RefreshToken"),
          openUrl: config.homeUrl || config.url,
        };
      }

      return {
        ok: true,
        token: cookie.value,
        tokenExpiresAt,
        refreshToken,
        firebaseSessionToken: await readFirebaseSessionCookie(config, sessionData, storeId),
        tabId: tab.id,
      };
    }

    async function readPlatformAuthBundleWithRetry(platform, options = {}) {
      let lastResult = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        lastResult = await readPlatformAuthBundle(platform, options);
        if (lastResult?.ok) {
          return lastResult;
        }

        if (lastResult?.openUrl) {
          return lastResult;
        }

        await delay(350 * (attempt + 1));
      }

      return lastResult;
    }

    return {
      readPlatformAuthBundle,
      readPlatformAuthBundleWithRetry,
    };
  }

  const api = { createPlatformAuthBundleReader };
  root.HostierAuthBundleShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
