(function initConnectionFlowShared(root) {
  function buildBaseFlow(flow) {
    const pendingConnections = flow.bulkReconnect
      ? normalizeBulkReconnectPendingConnections(flow.pendingConnections)
      : [];

    return {
      platform: flow.platform,
      connectionId: flow.bulkReconnect ? null : flow.connectionId ?? null,
      showDetailView: flow.showDetailView !== false,
      bulkReconnect: flow.bulkReconnect === true,
      pendingConnections,
      targetAccountKey:
        typeof flow.targetAccountKey === "string" && flow.targetAccountKey.length > 0
          ? flow.targetAccountKey
          : null,
      targetDisplayLabel:
        typeof flow.targetDisplayLabel === "string" && flow.targetDisplayLabel.length > 0
          ? flow.targetDisplayLabel
          : pendingConnections[0]?.displayLabel ?? null,
      sourceAutoOpenedAt: flow.sourceAutoOpenedAt ?? null,
    };
  }

  function getBulkReconnectWaitingMessage(msg, pendingConnections) {
    return msg("bulkReconnectWaiting", [
      String(normalizeBulkReconnectPendingConnections(pendingConnections).length),
    ]);
  }

  function getBulkReconnectMismatchMessage(msg, pendingConnections) {
    return `${msg("bulkReconnectMismatch")} ${getBulkReconnectWaitingMessage(msg, pendingConnections)}`;
  }

  function is33m2AddAccountFlow(flow) {
    return (
      flow?.platform === "THIRTY_THREE_M2"
      && !flow?.connectionId
      && flow?.bulkReconnect !== true
    );
  }

  function analyzeCurrentAccountState({
    baseFlow,
    authBundle,
    browserSessionValidation,
  }) {
    const currentAccountKey = baseFlow.platform === "THIRTY_THREE_M2"
      ? get33m2AccountKeyFromToken(authBundle.token)
      : undefined;
    const matchedPendingConnection = baseFlow.bulkReconnect
      ? findBulkReconnectMatch(baseFlow.pendingConnections, authBundle.token)
      : null;
    const hasActiveBrowserSession = baseFlow.platform !== "THIRTY_THREE_M2"
      || browserSessionValidation?.ok === true
      || browserSessionValidation?.status === 200;
    const reconnectNeedsDifferentAccount =
      Boolean(baseFlow.connectionId)
      && Boolean(baseFlow.targetAccountKey)
      && Boolean(currentAccountKey)
      && currentAccountKey !== baseFlow.targetAccountKey;
    const shouldCycleCurrentSession =
      baseFlow.platform === "THIRTY_THREE_M2"
      && Boolean(currentAccountKey)
      && (
        is33m2AddAccountFlow(baseFlow)
        || reconnectNeedsDifferentAccount
        || (baseFlow.bulkReconnect && !matchedPendingConnection)
      );
    const shouldForceLogin =
      baseFlow.platform === "THIRTY_THREE_M2"
      && !hasActiveBrowserSession
      && (
        Boolean(baseFlow.connectionId)
        || baseFlow.bulkReconnect
        || is33m2AddAccountFlow(baseFlow)
      );

    return {
      currentAccountKey,
      matchedPendingConnection,
      hasActiveBrowserSession,
      reconnectNeedsDifferentAccount,
      shouldCycleCurrentSession,
      shouldForceLogin,
    };
  }

  function buildPreserveRequestBody({ platform, authBundle, config, consentVersion }) {
    return {
      platform,
      token: authBundle.token,
      refreshToken: authBundle.refreshToken,
      firebaseSessionToken: authBundle.firebaseSessionToken,
      tokenExpiresAt: authBundle.tokenExpiresAt,
      matchExistingConnectionOnly: true,
      autoMaintainEnabled: config.autoMaintainEnabled,
      consentVersion,
      consentedAt: new Date().toISOString(),
    };
  }

  function buildConnectRequestBody({ baseFlow, flow, authBundle, config, consentVersion }) {
    return {
      connectionId: baseFlow.bulkReconnect ? undefined : flow.connectionId ?? undefined,
      matchExistingConnectionOnly: baseFlow.bulkReconnect || undefined,
      platform: flow.platform,
      token: authBundle.token,
      refreshToken: authBundle.refreshToken,
      firebaseSessionToken: authBundle.firebaseSessionToken,
      tokenExpiresAt: authBundle.tokenExpiresAt,
      autoMaintainEnabled: config.autoMaintainEnabled,
      consentVersion,
      consentedAt: new Date().toISOString(),
    };
  }

  const { normalizeBulkReconnectPendingConnections, get33m2AccountKeyFromToken, findBulkReconnectMatch } =
    root.HostierExtensionShared;

  const api = {
    buildBaseFlow,
    getBulkReconnectWaitingMessage,
    getBulkReconnectMismatchMessage,
    is33m2AddAccountFlow,
    analyzeCurrentAccountState,
    buildPreserveRequestBody,
    buildConnectRequestBody,
  };

  root.HostierConnectionFlowShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
