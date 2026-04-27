(function initConnectionRunnerShared(root) {
  const {
    buildBaseFlow,
    getBulkReconnectWaitingMessage,
    getBulkReconnectMismatchMessage,
    is33m2AddAccountFlow,
    analyzeCurrentAccountState,
    buildPreserveRequestBody,
    buildConnectRequestBody,
  } = root.HostierConnectionFlowShared;

  function createConnectionFlowRunner(deps) {
    const noop = async () => {};
    async function runWithStepTimeout(label, operation, timeoutMs = 15000) {
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

    return async function run(flow) {
      await deps.loadLocaleMessages();
      const config = deps.platformConfigs[flow.platform];
      if (!config) {
        return;
      }

      const baseFlow = buildBaseFlow(flow);
      deps.log?.("start", { flow: baseFlow });

      const authBundle = await deps.readPlatformAuthBundleWithRetry(flow.platform, {
        allowMissingRefreshToken: Boolean(flow.connectionId || flow.bulkReconnect),
      });
      deps.log?.("authBundle", {
        platform: flow.platform,
        hasAuthBundle: Boolean(authBundle?.ok),
        openUrl: authBundle?.openUrl || null,
      });

      if (!authBundle?.ok) {
        if (flow.platform === "THIRTY_THREE_M2" && authBundle?.clearSession) {
          await deps.localLogout33m2();
        }
        const message = baseFlow.bulkReconnect
          ? getBulkReconnectWaitingMessage(deps.msg, baseFlow.pendingConnections)
          : authBundle?.error || deps.msg("connectionFailed", [config.label]);
        const nextFlow = await deps.enterAwaitingSourceState(baseFlow, {
          sourceUrl: authBundle?.openUrl || null,
          message,
        });
        await deps.onAuthBundleMissing(nextFlow, { baseFlow, config });
        return;
      }

      const browserSessionValidation = flow.platform === "THIRTY_THREE_M2" && authBundle.tabId
        ? await deps.validate33m2SessionInBrowser(authBundle.tabId)
        : null;
      const analysis = analyzeCurrentAccountState({
        baseFlow,
        authBundle,
        browserSessionValidation,
      });

      deps.log?.("currentAccount", {
        platform: flow.platform,
        currentAccountKey: analysis.currentAccountKey,
        targetAccountKey: baseFlow.targetAccountKey,
        isReconnect: Boolean(baseFlow.connectionId),
        isBulkReconnect: baseFlow.bulkReconnect,
        matchedPendingConnectionId: analysis.matchedPendingConnection?.id ?? null,
        reconnectNeedsDifferentAccount: analysis.reconnectNeedsDifferentAccount,
        browserSessionValidation,
      });

      if (analysis.shouldForceLogin) {
        await deps.localLogout33m2();
        const nextFlow = await deps.enterAwaitingSourceState(baseFlow, {
          sourceUrl: config.loginUrl,
          message: baseFlow.connectionId
            ? deps.msg("awaitingSourceHint", [config.label])
            : baseFlow.bulkReconnect
              ? getBulkReconnectWaitingMessage(deps.msg, baseFlow.pendingConnections)
              : deps.msg("loginNext33m2Account"),
        });
        await deps.onAwaiting(nextFlow, { baseFlow, config });
        return;
      }

      if (analysis.shouldCycleCurrentSession) {
        await deps.beforeCycle(baseFlow, { config });
        const preparingMessage = deps.msg("preparingAccountSwitchStatus");
        await deps.setConnectionFlowState({
          ...baseFlow,
          step: "saving_connection",
          message: preparingMessage,
        });
        await deps.onBlocking(preparingMessage, { baseFlow, config });

        deps.log?.("preserveStart", { platform: flow.platform });
        const preserveResponse = await runWithStepTimeout(
          "prepareAccountSwitch",
          () => deps.fetchHostier("/api/platform-connections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...buildPreserveRequestBody({
                platform: flow.platform,
                authBundle,
                config,
                consentVersion: deps.consentVersion,
              }),
              ...(deps.preserveExtras?.() || {}),
            }),
          }),
          20000,
        );
        deps.log?.("preserveResponse", { status: preserveResponse.status });

        if (preserveResponse.status === 401) {
          await deps.onUnauthorized(baseFlow);
          return;
        }

        let shouldSkipAccountCycle = false;
        if (!preserveResponse.ok) {
          const errorBody = await preserveResponse.json().catch(() => null);
          if (errorBody?.code === "MATCHING_CONNECTION_NOT_FOUND") {
            shouldSkipAccountCycle = true;
            deps.log?.("cycleSkipped", {
              platform: flow.platform,
              reason: "no_matching_connection",
            });
          } else {
            const message = deps.formatConnectionError(flow.platform, baseFlow, errorBody);
            await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
            await deps.onError(message, { baseFlow, clearBlocking: true, clearPrompt: true });
            return;
          }
        }

        if (!shouldSkipAccountCycle) {
          deps.log?.("logoutStart", { platform: flow.platform });
          const logoutResult = await runWithStepTimeout(
            "localLogout33m2",
            () => deps.localLogout33m2(),
            10000,
          );
          deps.log?.("awaitingSourceAfterLogout", { logoutResult });

          const nextFlow = await deps.enterAwaitingSourceState({
            ...baseFlow,
            sourceAutoOpenedAt: logoutResult?.navigatedToLogin ? Date.now() : baseFlow.sourceAutoOpenedAt,
          }, {
            sourceUrl: config.loginUrl,
            message: baseFlow.connectionId
              ? deps.msg("awaitingSourceHint", [config.label])
              : deps.msg("loginNext33m2Account"),
          });

          await deps.onAwaiting(nextFlow, { baseFlow, config, loadStatus: true, clearStatus: true });
          return;
        }
      }

      if (baseFlow.bulkReconnect && !analysis.matchedPendingConnection) {
        const nextFlow = await deps.enterAwaitingSourceState(baseFlow, {
          sourceUrl: config.homeUrl || config.url,
          message: getBulkReconnectMismatchMessage(deps.msg, baseFlow.pendingConnections),
          targetDisplayLabel: baseFlow.pendingConnections[0]?.displayLabel ?? null,
        });
        await deps.onAwaiting(nextFlow, { baseFlow, config, clearStatus: true });
        return;
      }

      const connectingMessage = deps.msg("connectingStatus", [config.label]);
      await deps.setConnectionFlowState({
        ...baseFlow,
        step: "saving_connection",
        message: connectingMessage,
      });
      await deps.onBlocking(connectingMessage, { baseFlow, config });

      deps.log?.("connectStart", {
        platform: flow.platform,
        hasRefreshToken: Boolean(authBundle.refreshToken),
        hasFirebaseSessionToken: Boolean(authBundle.firebaseSessionToken),
      });
      console.log("[HOSTIER-TRACE] runner.saveStart", {
        platform: flow.platform,
        hasRefreshToken: Boolean(authBundle.refreshToken),
        hasFirebaseSessionToken: Boolean(authBundle.firebaseSessionToken),
      });
      const response = await runWithStepTimeout(
        "savePlatformConnection",
        () => deps.fetchHostier("/api/platform-connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildConnectRequestBody({
            baseFlow,
            flow,
            authBundle,
            config,
            consentVersion: deps.consentVersion,
          })),
        }),
        20000,
      );

      if (response.status === 401) {
        console.log("[HOSTIER-TRACE] runner.saveResponse=401 -> onUnauthorized");
        await deps.onUnauthorized(baseFlow);
        return;
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        console.log("[HOSTIER-TRACE] runner.saveErrorBody", {
          status: response.status,
          errorBodyCode: errorBody?.code ?? null,
          errorBodyError: errorBody?.error ?? null,
          errorBody,
        });
        const message = deps.formatConnectionError(flow.platform, baseFlow, errorBody);
        await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
        await deps.onError(message, { baseFlow, clearBlocking: true, clearPrompt: true });
        return;
      }

      console.log("[HOSTIER-TRACE] runner.saveResponse=ok", { status: response.status });

      const saveBody = await response.json().catch(() => null);
      const saveWarning =
        saveBody && typeof saveBody.warning === "string" ? saveBody.warning : null;

      await deps.afterSuccessfulSave(baseFlow, { config });

      if (baseFlow.bulkReconnect) {
        const remainingPendingConnections = await deps.pruneBulkReconnectPendingConnections(
          flow.platform,
          baseFlow.pendingConnections,
        );

        if (remainingPendingConnections.length > 0) {
          const nextFlow = await deps.enterAwaitingSourceState({
            ...baseFlow,
            pendingConnections: remainingPendingConnections,
            targetDisplayLabel: remainingPendingConnections[0]?.displayLabel ?? null,
          }, {
            sourceUrl: config.homeUrl || config.url,
            message: getBulkReconnectWaitingMessage(deps.msg, remainingPendingConnections),
            targetDisplayLabel: remainingPendingConnections[0]?.displayLabel ?? null,
          });
          await deps.onAwaiting(nextFlow, { baseFlow, config, clearStatus: true });
          return;
        }

        const successMessage = deps.msg("bulkReconnectComplete", [config.label]);
        await deps.setConnectionFlowState({
          ...baseFlow,
          step: "success",
          pendingConnections: [],
          message: successMessage,
        });
        await deps.onSuccess(successMessage, { baseFlow, clearBlocking: true, clearPrompt: true, clearFlow: true });
        return;
      }

      const successMessage = saveWarning === "NO_ROOMS_YET"
        ? deps.msg("connectionCompleteNoRoomsYet", [config.label])
        : deps.msg("connectionComplete", [config.label]);
      await deps.setConnectionFlowState({
        ...baseFlow,
        step: "success",
        message: successMessage,
      });
      await deps.onSuccess(successMessage, { baseFlow, clearBlocking: true, clearPrompt: true, clearFlow: true });
    };
  }

  const api = { createConnectionFlowRunner };
  root.HostierConnectionRunnerShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
