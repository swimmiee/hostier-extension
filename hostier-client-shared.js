(function initHostierClientShared(root) {
  function createHostierClient(options) {
    const {
      chromeApi,
      defaultHostierUrl,
      extensionTokenStorageKey,
      connectionFlowStorageKey,
      hostierOriginStorageKey,
      requestTimeoutMs,
      logPrefix = "[hostier]",
    } = options;

    let currentHostierUrl = defaultHostierUrl;

    async function withOperationTimeout(label, operation, timeoutMs = requestTimeoutMs) {
      let timeoutId = null;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`${label} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    function getAllowedHostierUrls() {
      return [...new Set([defaultHostierUrl, "http://localhost:5173"])];
    }

    function isAllowedHostierUrl(value) {
      if (!value) return false;

      try {
        const origin = new URL(value).origin;
        return getAllowedHostierUrls().includes(origin);
      } catch {
        return false;
      }
    }

    async function getStoredHostierUrl() {
      const stored = await chromeApi.storage.local.get(hostierOriginStorageKey);
      const value = stored?.[hostierOriginStorageKey];
      return isAllowedHostierUrl(value) ? value : null;
    }

    async function storeHostierUrl(url) {
      if (!isAllowedHostierUrl(url)) {
        return;
      }

      await chromeApi.storage.local.set({
        [hostierOriginStorageKey]: new URL(url).origin,
      });
    }

    async function findPreferredHostierTab(url) {
      const normalizedUrl = new URL(url).origin;
      const [activeTab] = await chromeApi.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      if (activeTab?.url && activeTab.id && new URL(activeTab.url).origin === normalizedUrl) {
        return activeTab;
      }

      const matchingTabs = await chromeApi.tabs.query({
        url: `${normalizedUrl}/*`,
      });

      return matchingTabs.find((tab) => Number.isInteger(tab.id)) ?? null;
    }

    async function resolveHostierUrl() {
      const [activeTab] = await chromeApi.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      if (activeTab?.url && isAllowedHostierUrl(activeTab.url)) {
        currentHostierUrl = new URL(activeTab.url).origin;
        await storeHostierUrl(currentHostierUrl);
        return currentHostierUrl;
      }

      const stored = await getStoredHostierUrl();
      if (stored) {
        currentHostierUrl = stored;
        return currentHostierUrl;
      }

      currentHostierUrl = defaultHostierUrl;
      return currentHostierUrl;
    }

    function getHostierUrl() {
      return currentHostierUrl;
    }

    function getHostierLoginUrl() {
      return `${currentHostierUrl}/login`;
    }

    function getPrivacyPolicyUrl() {
      return `${currentHostierUrl}/privacy`;
    }

    async function getStoredExtensionToken() {
      const stored = await chromeApi.storage.local.get(extensionTokenStorageKey);
      const tokenState = stored?.[extensionTokenStorageKey];
      if (!tokenState?.token || !tokenState?.expiresAt) {
        return null;
      }

      if (Date.now() >= tokenState.expiresAt) {
        await chromeApi.storage.local.remove(extensionTokenStorageKey);
        return null;
      }

      return tokenState.token;
    }

    async function storeExtensionToken(token, expiresInSeconds) {
      await chromeApi.storage.local.set({
        [extensionTokenStorageKey]: {
          token,
          expiresAt: Date.now() + Math.max(0, expiresInSeconds - 30) * 1000,
        },
      });
    }

    async function clearExtensionToken() {
      await chromeApi.storage.local.remove(extensionTokenStorageKey);
    }

    async function exchangeExtensionTokenFromTab(hostierUrl) {
      const tab = await findPreferredHostierTab(hostierUrl);
      if (!tab?.id) {
        return null;
      }

      try {
        const [result] = await withOperationTimeout(
          "exchangeExtensionTokenFromTab",
          () => chromeApi.scripting.executeScript({
            target: { tabId: tab.id },
            args: [hostierUrl],
            func: async (baseUrl) => {
              try {
                const response = await fetch(`${baseUrl}/api/auth/extension/exchange`, {
                  method: "POST",
                  credentials: "include",
                });
                if (!response.ok) {
                  return { ok: false, status: response.status };
                }

                const body = await response.json().catch(() => null);
                return { ok: true, body };
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            },
          }),
          requestTimeoutMs,
        );

        if (!result?.result?.ok) {
          return null;
        }

        return result.result.body ?? null;
      } catch (error) {
        console.error(`${logPrefix} Failed to exchange extension token via tab:`, error);
        return null;
      }
    }

    async function exchangeExtensionToken() {
      const hostierUrl = await withOperationTimeout(
        "resolveHostierUrl",
        () => resolveHostierUrl(),
        requestTimeoutMs,
      );
      const tabBody = await exchangeExtensionTokenFromTab(hostierUrl);
      if (tabBody?.token && typeof tabBody.expiresInSeconds === "number") {
        await storeExtensionToken(tabBody.token, tabBody.expiresInSeconds);
        return tabBody.token;
      }

      const response = await withOperationTimeout(
        "exchangeExtensionToken",
        () => fetch(`${hostierUrl}/api/auth/extension/exchange`, {
          method: "POST",
          credentials: "include",
        }),
        requestTimeoutMs,
      );

      if (!response.ok) {
        await clearExtensionToken();
        return null;
      }

      const body = await response.json().catch(() => null);
      if (!body?.token || typeof body.expiresInSeconds !== "number") {
        await clearExtensionToken();
        return null;
      }

      await storeExtensionToken(body.token, body.expiresInSeconds);
      return body.token;
    }

    async function getExtensionToken({ forceRefresh = false } = {}) {
      if (!forceRefresh) {
        const cached = await getStoredExtensionToken();
        if (cached) {
          return cached;
        }
      }

      return exchangeExtensionToken();
    }

    async function fetchHostier(path, options = {}) {
      return withOperationTimeout(
        `fetchHostier ${path}`,
        async () => {
          const hostierUrl = await resolveHostierUrl();
          let token = await getExtensionToken();
          const headers = new Headers(options.headers || {});
          if (token) {
            headers.set("Authorization", `Bearer ${token}`);
          }

          const fetchWithTimeout = async (url, init) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
            try {
              return await fetch(url, {
                ...init,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timeoutId);
            }
          };

          let response = await fetchWithTimeout(`${hostierUrl}${path}`, {
            ...options,
            headers,
            credentials: "include",
          });

          if (response.status !== 401) {
            return response;
          }

          await clearExtensionToken();
          token = await getExtensionToken({ forceRefresh: true });
          if (!token) {
            return response;
          }

          headers.set("Authorization", `Bearer ${token}`);
          response = await fetchWithTimeout(`${hostierUrl}${path}`, {
            ...options,
            headers,
            credentials: "include",
          });

          return response;
        },
        requestTimeoutMs * 2 + 2000,
      );
    }

    async function getConnectionFlowState() {
      const stored = await chromeApi.storage.local.get(connectionFlowStorageKey);
      return stored?.[connectionFlowStorageKey] || null;
    }

    async function setConnectionFlowState(state) {
      await chromeApi.storage.local.set({
        [connectionFlowStorageKey]: {
          ...state,
          updatedAt: Date.now(),
        },
      });
    }

    async function clearConnectionFlowState() {
      await chromeApi.storage.local.remove(connectionFlowStorageKey);
    }

    return {
      getAllowedHostierUrls,
      isAllowedHostierUrl,
      getStoredHostierUrl,
      storeHostierUrl,
      findPreferredHostierTab,
      resolveHostierUrl,
      getHostierUrl,
      getHostierLoginUrl,
      getPrivacyPolicyUrl,
      getStoredExtensionToken,
      storeExtensionToken,
      clearExtensionToken,
      exchangeExtensionTokenFromTab,
      exchangeExtensionToken,
      getExtensionToken,
      fetchHostier,
      getConnectionFlowState,
      setConnectionFlowState,
      clearConnectionFlowState,
    };
  }

  const api = { createHostierClient };
  root.HostierClientShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
