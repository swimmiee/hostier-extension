(function initHostierExtensionShared(root) {
  function withTimeout(promise, ms, fallbackValue = null) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
    ]);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isReconnectRequired(connection) {
    return (
      connection?.status === "EXPIRED"
      || connection?.status === "ERROR"
      || connection?.requiresReauth
    );
  }

  function normalizeBulkReconnectPendingConnections(pendingConnections) {
    if (!Array.isArray(pendingConnections)) {
      return [];
    }

    return pendingConnections
      .filter((item) =>
        item
        && typeof item.id === "string"
        && item.id.length > 0
        && typeof item.accountKey === "string"
        && item.accountKey.length > 0,
      )
      .map((item) => ({
        id: item.id,
        accountKey: item.accountKey,
        displayLabel:
          typeof item.displayLabel === "string" && item.displayLabel.length > 0
            ? item.displayLabel
            : item.accountKey,
      }));
  }

  function decodeBase64Url(value) {
    const normalized = String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function parseJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) {
        return null;
      }

      return JSON.parse(decodeBase64Url(parts[1]));
    } catch {
      return null;
    }
  }

  function normalize33m2Aid(value) {
    if (typeof value !== "string" && typeof value !== "number") {
      return undefined;
    }

    const raw = String(value).trim();
    const digits = raw.match(/(\d+)$/)?.[1];
    if (!digits) {
      return raw || undefined;
    }

    return digits.replace(/^0+/, "") || "0";
  }

  function get33m2AccountKeyFromToken(token) {
    const payload = parseJwtPayload(token);
    // 33m2가 세션 JWT의 `aid` 클레임을 `uid`로 개명(2026-09-08, 값·포맷 동일).
    // 현재 클레임(uid) 우선, 살아 있는 옛 토큰을 위해 aid 폴백.
    const aid = normalize33m2Aid(payload?.uid ?? payload?.aid);
    return aid ? `33m2:${aid}` : undefined;
  }

  function findBulkReconnectMatch(pendingConnections, token) {
    const accountKey = get33m2AccountKeyFromToken(token);
    if (!accountKey) {
      return null;
    }

    return (
      normalizeBulkReconnectPendingConnections(pendingConnections)
        .find((item) => item.accountKey === accountKey) || null
    );
  }

  async function executeScript(tabId, func) {
    const resultSet = await root.chrome.scripting.executeScript({
      target: { tabId },
      func,
    });
    const [result] = Array.isArray(resultSet) ? resultSet : [];
    return result?.result || null;
  }

  /**
   * 33m2 탭 안에서 실행되는 함수. `chrome.scripting.executeScript` 가 toString 해서
   * 주입하므로 바깥 스코프를 참조하면 안 된다(자기완결이어야 한다).
   *
   * 2026-08-14 실유저 재현: 여기서 연 indexedDB 커넥션을 닫지 않아 33m2 Firebase 의
   * 업그레이드·삭제가 blocked 되고, 그 deleteDatabase 요청이 origin 에 pending 으로
   * 남는다. IndexedDB 스펙상 이후 모든 open() 이 그 뒤에 줄을 서므로 새 탭의 Firebase
   * 초기화가 영영 안 끝나고 "로그인 중" 스피너가 멈추지 않는다. 오염된 탭을 닫거나
   * 크롬을 다시 켜야 풀려서 증상이 간헐적으로 보였다.
   * 그래서 어느 경로로 끝나든 close 하고, 다른 쪽이 업그레이드를 요청하면 즉시 비켜 준다.
   */
  function readFirebaseRefreshTokenInPage() {
    return new Promise((resolve) => {
      let db = null;
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        try {
          if (db) db.close();
        } catch (_) {
          // 닫기 실패는 이미 읽은 값에 영향을 주지 않는다.
        }
        resolve(value);
      };

      let req;
      try {
        req = indexedDB.open("firebaseLocalStorageDb");
      } catch (_) {
        resolve(null);
        return;
      }

      req.onerror = () => done(null);
      // 다른 커넥션이 쥐고 있어 열리지 않으면 기다리지 않고 비켜 준다.
      req.onblocked = () => done(null);
      req.onsuccess = () => {
        db = req.result;
        try {
          // 33m2 Firebase 가 업그레이드·삭제를 요청하는 순간 우리가 길을 비킨다.
          db.onversionchange = () => {
            try {
              db.close();
            } catch (_) {
              // 무시
            }
          };
        } catch (_) {
          // onversionchange 를 못 달아도 아래 done 에서 닫는다.
        }

        let store;
        try {
          const tx = db.transaction("firebaseLocalStorage", "readonly");
          store = tx.objectStore("firebaseLocalStorage");
        } catch (_) {
          // 아직 로그인 전이라 스토어가 없다. 커넥션만 닫고 끝낸다.
          done(null);
          return;
        }

        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const extractRefreshToken = (entry) => {
            const candidates = [
              entry?.value?.stsTokenManager?.refreshToken,
              entry?.value?.user?.stsTokenManager?.refreshToken,
              entry?.value?.spipiRefreshToken,
              entry?.value?.refreshToken,
              entry?.stsTokenManager?.refreshToken,
            ];

            return (
              candidates.find(
                (candidate) =>
                  typeof candidate === "string"
                  && candidate.length > 0
                  && candidate.split(".").length !== 3,
              ) || null
            );
          };

          const token = (getAll.result || []).map(extractRefreshToken).find(Boolean);
          done(token || null);
        };
        getAll.onerror = () => done(null);
      };
    });
  }

  async function getFirebaseRefreshToken(tabId, options = {}) {
    const { timeoutMs = 3000, logPrefix = "[hostier]" } = options;
    try {
      const execution = root.chrome.scripting.executeScript({
        target: { tabId },
        func: readFirebaseRefreshTokenInPage,
      });
      const result = await withTimeout(execution, timeoutMs, []);
      const [entry] = Array.isArray(result) ? result : [];
      return entry?.result || null;
    } catch (error) {
      console.log(`${logPrefix} Failed to read Firebase refresh token:`, error);
      return null;
    }
  }

  async function refresh33m2SessionInBrowser(tabId, options = {}) {
    const { timeoutMs = 5000, logPrefix = "[hostier]" } = options;
    try {
      const execution = root.chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const response = await fetch("/api/auth/refresh", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: "{}",
            });
            const body = await response.text().catch(() => "");
            return {
              ok: response.ok,
              status: response.status,
              body: body.slice(0, 160),
            };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
      const result = await withTimeout(execution, timeoutMs, []);
      const [entry] = Array.isArray(result) ? result : [];
      const summary = entry?.result || null;
      console.log(`${logPrefix} refresh33m2SessionInBrowser`, summary);
      return summary;
    } catch (error) {
      console.warn(`${logPrefix} Failed to refresh 33m2 session in browser:`, error);
      return null;
    }
  }

  async function validate33m2SessionInBrowser(tabId, options = {}) {
    const { timeoutMs = 5000, logPrefix = "[hostier]" } = options;
    try {
      const execution = root.chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const response = await fetch("/v1/use-auth/host/rooms?size=1", {
              credentials: "include",
            });
            const body = await response.text().catch(() => "");
            return {
              ok: response.ok,
              status: response.status,
              body: body.slice(0, 160),
            };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
      const result = await withTimeout(execution, timeoutMs, []);
      const [entry] = Array.isArray(result) ? result : [];
      const summary = entry?.result || null;
      console.log(`${logPrefix} validate33m2SessionInBrowser`, summary);
      return summary;
    } catch (error) {
      console.warn(`${logPrefix} Failed to validate 33m2 session in browser:`, error);
      return null;
    }
  }

  async function read33m2AuthSessionInBrowser(tabId, options = {}) {
    const { timeoutMs = 5000, logPrefix = "[hostier]" } = options;
    try {
      const execution = root.chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const response = await fetch("/api/auth/session", {
              credentials: "include",
            });
            const body = await response.json().catch(() => null);
            return {
              ok: response.ok,
              status: response.status,
              firebaseToken:
                typeof body?.firebaseToken === "string" && body.firebaseToken.length > 0
                  ? body.firebaseToken
                  : null,
              refreshToken:
                typeof body?.refreshToken === "string" && body.refreshToken.length > 0
                  ? body.refreshToken
                  : null,
              accessToken:
                typeof body?.accessToken === "string" && body.accessToken.length > 0
                  ? body.accessToken
                  : null,
            };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
      const result = await withTimeout(execution, timeoutMs, []);
      const [entry] = Array.isArray(result) ? result : [];
      const summary = entry?.result || null;
      console.log(`${logPrefix} read33m2AuthSessionInBrowser`, summary);
      return summary;
    } catch (error) {
      console.warn(`${logPrefix} Failed to read 33m2 auth session in browser:`, error);
      return null;
    }
  }

  async function findPreferred33m2Tab(options = {}) {
    const { preferredStoreId = null } = options;
    const [activeTab] = await root.chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const matchingTabs = await root.chrome.tabs.query({ url: "https://web.33m2.co.kr/*" });

    if (preferredStoreId) {
      if (
        activeTab?.id
        && typeof activeTab.url === "string"
        && activeTab.url.startsWith("https://web.33m2.co.kr/")
      ) {
        const activeStoreId = await getCookieStoreIdForTab(activeTab.id);
        if (activeStoreId === preferredStoreId) {
          return activeTab;
        }
      }

      for (const tab of matchingTabs) {
        if (!Number.isInteger(tab?.id)) {
          continue;
        }

        const storeId = await getCookieStoreIdForTab(tab.id);
        if (storeId === preferredStoreId) {
          return tab;
        }
      }
    }

    if (
      activeTab?.id
      && typeof activeTab.url === "string"
      && activeTab.url.startsWith("https://web.33m2.co.kr/")
    ) {
      return activeTab;
    }

    if (Number.isInteger(activeTab?.windowId)) {
      const sameWindow = matchingTabs.find(
        (tab) => tab.windowId === activeTab.windowId && Number.isInteger(tab.id),
      );
      if (sameWindow) {
        return sameWindow;
      }
    }

    return matchingTabs.find((tab) => Number.isInteger(tab.id)) || null;
  }

  async function getCookieStoreIdForTab(tabId) {
    try {
      const stores = await root.chrome.cookies.getAllCookieStores();
      return stores.find((store) => store.tabIds.includes(tabId))?.id || null;
    } catch {
      return null;
    }
  }

  async function waitFor33m2SessionCookie(config, previousValue, options = {}) {
    const {
      timeoutMs = 2000,
      storeId = null,
      pollMs = 100,
    } = options;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const currentCookie = await root.chrome.cookies.get({
        url: config.url,
        name: config.name,
        ...(storeId ? { storeId } : {}),
      });
      if (currentCookie?.value && currentCookie.value !== previousValue) {
        return currentCookie;
      }
      await sleep(pollMs);
    }

    return root.chrome.cookies.get({
      url: config.url,
      name: config.name,
      ...(storeId ? { storeId } : {}),
    });
  }

  async function clearFirebaseLocalState(tabId, options = {}) {
    const { logPrefix = "[hostier]" } = options;
    try {
      await root.chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const clearIndexedDb = await new Promise((resolve) => {
              const request = indexedDB.deleteDatabase("firebaseLocalStorageDb");
              request.onsuccess = () => resolve(true);
              request.onerror = () => resolve(false);
              request.onblocked = () => resolve(false);
            });
            try {
              localStorage.clear();
            } catch {}
            try {
              sessionStorage.clear();
            } catch {}
            return clearIndexedDb;
          } catch {
            return false;
          }
        },
      });
    } catch (error) {
      console.warn(`${logPrefix} Failed to clear Firebase local state:`, error);
    }
  }

  async function localLogout33m2(config, options = {}) {
    const {
      logPrefix = "[hostier]",
      clearStateTimeoutMs = 1500,
      reloadTabs = false,
      reloadTimeoutMs = 1500,
    } = options;
    const origin = new URL(config.url).origin;
    const cookiesToRemove = [config.name, config.firebaseSessionName];

    if (root.chrome.browsingData?.remove) {
      await withTimeout(
        root.chrome.browsingData.remove(
          { origins: [origin] },
          {
            cookies: true,
            cacheStorage: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true,
          },
        ).catch((error) => {
          console.warn(`${logPrefix} Failed to clear browsingData for 33m2:`, error);
          return null;
        }),
        5000,
        null,
      );
    }

    const cookieSets = await Promise.all([
      root.chrome.cookies.getAll({ url: config.url }).catch(() => []),
      root.chrome.cookies.getAll({ url: config.homeUrl }).catch(() => []),
      root.chrome.cookies.getAll({ url: config.loginUrl }).catch(() => []),
      root.chrome.cookies.getAll({ domain: "33m2.co.kr" }).catch(() => []),
      root.chrome.cookies.getAll({ domain: "web.33m2.co.kr" }).catch(() => []),
    ]);
    const cookies = [...new Map(
      cookieSets
        .flat()
        .map((cookie) => [`${cookie.storeId}:${cookie.domain}:${cookie.path}:${cookie.name}`, cookie]),
    ).values()];

    for (const name of cookiesToRemove) {
      await root.chrome.cookies.remove({ url: config.url, name }).catch(() => null);
      await root.chrome.cookies.remove({ url: config.homeUrl, name }).catch(() => null);
      await root.chrome.cookies.remove({ url: config.loginUrl, name }).catch(() => null);
    }

    for (const cookie of cookies) {
      if (!cookiesToRemove.includes(cookie.name)) {
        continue;
      }

      const domain = String(cookie.domain || "").replace(/^\./, "");
      const url = `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`;
      await root.chrome.cookies.remove({
        url,
        name: cookie.name,
        storeId: cookie.storeId,
      }).catch(() => null);
    }

    const allTabs = await root.chrome.tabs.query({}).catch(() => []);
    const tabs = allTabs.filter((tab) => {
      if (!Number.isInteger(tab?.id) || typeof tab?.url !== "string") {
        return false;
      }

      try {
        return new URL(tab.url).origin === new URL(config.url).origin;
      } catch {
        return false;
      }
    });
    await Promise.allSettled(
      tabs
        .filter((tab) => Number.isInteger(tab.id))
        .map((tab) =>
          withTimeout(
            clearFirebaseLocalState(tab.id, { logPrefix }),
            clearStateTimeoutMs,
            false,
          ),
        ),
    );

    let refreshedTabs = 0;
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      if (reloadTabs) {
        const reloaded = await withTimeout(
          root.chrome.tabs.reload(tab.id).then(() => true).catch(() => false),
          reloadTimeoutMs,
          false,
        );
        if (reloaded) {
          refreshedTabs += 1;
        }
      }
    }

    const result = {
      navigatedToLogin: false,
      refreshedTabCount: refreshedTabs,
      clearedCookieCount: cookies.length,
      tabCount: tabs.length,
    };
    console.log(`${logPrefix} localLogout33m2`, result);
    return result;
  }

  const api = {
    withTimeout,
    isReconnectRequired,
    normalizeBulkReconnectPendingConnections,
    parseJwtPayload,
    get33m2AccountKeyFromToken,
    findBulkReconnectMatch,
    getFirebaseRefreshToken,
    readFirebaseRefreshTokenInPage,
    refresh33m2SessionInBrowser,
    validate33m2SessionInBrowser,
    read33m2AuthSessionInBrowser,
    findPreferred33m2Tab,
    getCookieStoreIdForTab,
    waitFor33m2SessionCookie,
    clearFirebaseLocalState,
    localLogout33m2,
  };

  root.HostierExtensionShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
