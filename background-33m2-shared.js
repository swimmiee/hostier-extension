(function initBackground33m2Shared(root) {
  const BLOCKING_FLOW_STEPS = new Set([
    "awaiting_source",
    "saving_connection",
    "background_resuming",
  ]);

  function is33m2CookieDomainMatch(config, cookie) {
    if (!cookie?.domain) {
      return false;
    }

    try {
      const targetHost = new URL(config.url).hostname;
      const normalizedDomain = String(cookie.domain || "").replace(/^\./, "");
      return targetHost === normalizedDomain || targetHost.endsWith(`.${normalizedDomain}`);
    } catch {
      return false;
    }
  }

  function isWatched33m2Cookie(config, cookie) {
    if (!cookie?.name) {
      return false;
    }

    if (!is33m2CookieDomainMatch(config, cookie)) {
      return false;
    }

    return cookie.name === config.name || cookie.name === config.firebaseSessionName;
  }

  function build33m2SilentSyncKey(storeId, accountKey) {
    return `${storeId || "default"}:${accountKey || "unknown"}`;
  }

  function findMatching33m2Connection(connections, accountKey) {
    if (!Array.isArray(connections) || !accountKey) {
      return null;
    }

    return connections.find(
      (connection) =>
        connection?.platform === "THIRTY_THREE_M2"
        && connection?.accountKey === accountKey,
    ) || null;
  }

  function build33m2BrowserSessionSummary(params) {
    const {
      permissionGranted,
      hasOpenTab,
      authBundle,
      accountKey,
      accountEmail,
      errorCode,
    } = params;

    return {
      installed: true,
      permissionGranted,
      hasOpenTab,
      sessionPresent: Boolean(authBundle?.ok),
      accountKey: accountKey || undefined,
      accountEmail: accountEmail || undefined,
      canSafeLogout: Boolean(permissionGranted && hasOpenTab),
      errorCode: errorCode || undefined,
    };
  }

  function create33m2BackgroundCoordinator(deps) {
    const pendingSilentSyncTimers = new Map();
    const recentSilentSyncs = new Map();
    const platformConfig = deps.platformConfig;

    function log(event, payload) {
      deps.log?.(event, payload);
    }

    async function isPermissionGranted() {
      return deps.hasPermission(platformConfig.origin);
    }

    async function getCurrentFlow() {
      return deps.getConnectionFlowState().catch(() => null);
    }

    async function shouldPauseSilentSync() {
      const flow = await getCurrentFlow();
      return (
        flow?.platform === "THIRTY_THREE_M2"
        && BLOCKING_FLOW_STEPS.has(flow.step)
      );
    }

    async function readAuthBundle(options = {}) {
      return deps.readPlatformAuthBundleWithRetry("THIRTY_THREE_M2", options);
    }

    async function fetchConnections() {
      const response = await deps.fetchHostier("/api/platform-connections");
      if (response.status === 401) {
        return { ok: false, errorCode: "unauthorized", connections: [] };
      }

      if (!response.ok) {
        return { ok: false, errorCode: "connections_fetch_failed", connections: [] };
      }

      const body = await response.json().catch(() => null);
      return {
        ok: true,
        connections: Array.isArray(body?.connections) ? body.connections : [],
      };
    }

    async function getBrowserSessionSummary() {
      const permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        return build33m2BrowserSessionSummary({
          permissionGranted: false,
          hasOpenTab: false,
          authBundle: null,
          errorCode: "permission_not_granted",
        });
      }

      const tab = await deps.findPreferred33m2Tab();
      if (!tab?.id) {
        return build33m2BrowserSessionSummary({
          permissionGranted: true,
          hasOpenTab: false,
          authBundle: null,
          errorCode: "no_open_tab",
        });
      }

      const authBundle = await readAuthBundle({
        allowMissingRefreshToken: true,
        preferredStoreId: storeId,
      });

      if (!authBundle?.ok) {
        return build33m2BrowserSessionSummary({
          permissionGranted: true,
          hasOpenTab: true,
          authBundle,
          errorCode:
            authBundle?.clearSession
              ? "session_invalid"
              : "session_missing",
        });
      }

      const accountKey = deps.get33m2AccountKeyFromToken(authBundle.token);
      let accountEmail;
      if (accountKey) {
        const connectionsResult = await fetchConnections();
        const matchedConnection = connectionsResult.ok
          ? findMatching33m2Connection(connectionsResult.connections, accountKey)
          : null;
        accountEmail =
          typeof matchedConnection?.accountEmail === "string" && matchedConnection.accountEmail.length > 0
            ? matchedConnection.accountEmail
            : undefined;
      }

      return build33m2BrowserSessionSummary({
        permissionGranted: true,
        hasOpenTab: true,
        authBundle,
        accountKey,
        accountEmail,
        errorCode: accountKey ? undefined : "unidentified_account",
      });
    }

    async function runSafeLogout() {
      const result = await deps.localLogout33m2({ reloadTabs: true });
      return {
        ok: true,
        result,
      };
    }

    async function performSilentSync(params) {
      const { storeId, changedCookieName } = params;

      if (!(await isPermissionGranted())) {
        log("33m2SilentSyncSkipped", {
          reason: "permission_not_granted",
          changedCookieName,
          skipped: true,
        });
        return;
      }

      if (await shouldPauseSilentSync()) {
        log("33m2SilentSyncSkipped", {
          reason: "flow_in_progress",
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const authBundle = await readAuthBundle({
        allowMissingRefreshToken: true,
      });

      if (!authBundle?.ok) {
        log("33m2SilentSyncSkipped", {
          reason: authBundle?.clearSession ? "session_invalid" : "session_missing",
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const accountKey = deps.get33m2AccountKeyFromToken(authBundle.token);
      if (!accountKey) {
        log("33m2SilentSyncSkipped", {
          reason: "unidentified_account",
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const syncKey = build33m2SilentSyncKey(storeId, accountKey);
      const lastSyncedAt = recentSilentSyncs.get(syncKey);
      if (lastSyncedAt && Date.now() - lastSyncedAt < deps.cooldownMs) {
        log("33m2SilentSyncSkipped", {
          reason: "cooldown",
          accountKey,
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const connectionsResult = await fetchConnections();
      if (!connectionsResult.ok) {
        log("33m2SilentSyncSkipped", {
          reason: connectionsResult.errorCode,
          accountKey,
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const matchedConnection = findMatching33m2Connection(
        connectionsResult.connections,
        accountKey,
      );

      if (!matchedConnection?.id) {
        log("33m2SilentSyncSkipped", {
          reason: "no_matching_connection",
          accountKey,
          changedCookieName,
          skipped: true,
        });
        return;
      }

      const saveResponse = await deps.fetchHostier("/api/platform-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: matchedConnection.id,
          matchExistingConnectionOnly: true,
          platform: "THIRTY_THREE_M2",
          token: authBundle.token,
          refreshToken: authBundle.refreshToken,
          firebaseSessionToken: authBundle.firebaseSessionToken,
          tokenExpiresAt: authBundle.tokenExpiresAt,
          autoMaintainEnabled: true,
          consentVersion: deps.consentVersion,
          consentedAt: new Date().toISOString(),
        }),
      });

      if (saveResponse.status === 401) {
        log("33m2SilentSyncSkipped", {
          reason: "unauthorized",
          accountKey,
          changedCookieName,
          skipped: true,
        });
        return;
      }

      if (!saveResponse.ok) {
        const errorBody = await saveResponse.json().catch(() => null);
        log("33m2SilentSyncSkipped", {
          reason:
            errorBody?.code === "RECONNECT_ACCOUNT_MISMATCH"
              ? "account_mismatch"
              : errorBody?.code === "MATCHING_CONNECTION_NOT_FOUND"
                ? "no_matching_connection"
                : "save_failed",
          accountKey,
          changedCookieName,
          mismatch: errorBody?.code === "RECONNECT_ACCOUNT_MISMATCH",
          skipped: true,
        });
        return;
      }

      recentSilentSyncs.set(syncKey, Date.now());
      log("33m2SilentSyncSaved", {
        reason: "matched_existing_connection_only",
        accountKey,
        changedCookieName,
        saved: true,
      });
    }

    function scheduleSilentSync(cookie) {
      const storeId = cookie?.storeId || "default";
      const existingTimer = pendingSilentSyncTimers.get(storeId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timeoutId = setTimeout(() => {
        pendingSilentSyncTimers.delete(storeId);
        void performSilentSync({
          storeId,
          changedCookieName: cookie?.name || null,
        });
      }, deps.debounceMs);

      pendingSilentSyncTimers.set(storeId, timeoutId);
    }

    async function maybeHandleCookieChange(changeInfo) {
      const cookie = changeInfo?.cookie;
      if (!cookie || !isWatched33m2Cookie(platformConfig, cookie)) {
        return false;
      }

      if (changeInfo.removed) {
        log("33m2CookieRemoved", {
          changedCookieName: cookie.name,
          reason: "cookie_removed",
          skipped: true,
        });
        return true;
      }

      scheduleSilentSync(cookie);
      return true;
    }

    function shouldInjectIntoUrl(url) {
      return typeof url === "string" && url.startsWith(`${platformConfig.url}host/`);
    }

    return {
      getBrowserSessionSummary,
      runSafeLogout,
      maybeHandleCookieChange,
      shouldInjectIntoUrl,
      performSilentSync,
      findMatching33m2Connection,
      build33m2BrowserSessionSummary,
      build33m2SilentSyncKey,
      isWatched33m2Cookie: (cookie) => isWatched33m2Cookie(platformConfig, cookie),
    };
  }

  const api = {
    BLOCKING_FLOW_STEPS,
    is33m2CookieDomainMatch,
    isWatched33m2Cookie,
    build33m2SilentSyncKey,
    findMatching33m2Connection,
    build33m2BrowserSessionSummary,
    create33m2BackgroundCoordinator,
  };

  root.HostierBackground33M2Shared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
