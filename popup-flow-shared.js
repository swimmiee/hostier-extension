(function initPopupFlowShared(root) {
  function createPopupFlowController(deps) {
    function hasPlatformPermission(config) {
      return new Promise((resolve) => {
        deps.chrome.permissions.contains({ origins: [config.origin] }, (granted) => {
          resolve(Boolean(granted));
        });
      });
    }

    async function ensurePlatformPermission(config) {
      if (await hasPlatformPermission(config)) {
        return true;
      }

      return new Promise((resolve) => {
        deps.chrome.permissions.request({ origins: [config.origin] }, async (granted) => {
          resolve(Boolean(granted) && await hasPlatformPermission(config));
        });
      });
    }

    async function refreshExtensionTokenSilently() {
      try {
        await deps.getExtensionToken({ forceRefresh: true });
      } catch (error) {
        console.warn("[hostier] Failed to refresh extension token silently:", error);
      }
    }

    async function pruneBulkReconnectPendingConnections(platform, pendingConnections) {
      const expiredIds = new Set(
        deps.getConnections(platform)
          .filter((connection) => deps.isReconnectRequired(connection))
          .map((connection) => connection.id),
      );

      return deps.normalizeBulkReconnectPendingConnections(pendingConnections)
        .filter((item) => expiredIds.has(item.id));
    }

    async function continuePendingConnectionFlowInPopup(flow) {
      const baseFlow = deps.buildBaseFlow(flow);
      const config = deps.platformConfigs[baseFlow.platform];
      if (!config) {
        return;
      }

      try {
        await deps.popupConnectionFlowRunner(baseFlow);
      } catch (error) {
        console.error("[hostier] popup continuePendingConnectionFlow failed:", error);
        deps.clearBlockingLoading();
        deps.clearAwaitingSourceView();
        const fallbackMessage =
          error?.name === "AbortError"
            ? "Hostier 요청이 오래 걸려 중단되었습니다. 다시 시도해주세요."
            : baseFlow.bulkReconnect
              ? deps.getBulkReconnectWaitingMessage(deps.msg, baseFlow.pendingConnections)
              : deps.msg("connectionFailed", [config.label]);
        const message = deps.describeError
          ? deps.describeError(error, fallbackMessage)
          : fallbackMessage;
        await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
        deps.showStatus("error", message);
      } finally {
        const persistedFlow = await deps.getConnectionFlowState().catch(() => null);
        if (persistedFlow?.platform === baseFlow.platform && persistedFlow.step === "awaiting_source") {
          deps.clearStatus();
          deps.showAwaitingSourcePrompt(persistedFlow);
        } else {
          deps.renderViews();
        }
      }
    }

    async function disconnectConnection(platform, connection) {
      if (!deps.confirm(`"${connection.displayLabel}" 연결을 해제할까요?`)) {
        return;
      }

      try {
        const response = await deps.fetchHostier(
          `/api/platform-connections/${encodeURIComponent(connection.id)}`,
          { method: "DELETE" },
        );

        if (response.status === 401) {
          deps.showLoginGate();
          return;
        }

        if (!response.ok) {
          throw new Error("disconnect failed");
        }

        await loadStatus();
        deps.showStatus("success", `${deps.platformConfigs[platform].label} 계정 연결을 해제했습니다.`);
      } catch (error) {
        console.error("[hostier] disconnect failed:", error);
        deps.showStatus("error", "연결 해제에 실패했습니다.");
      }
    }

    async function safeLogout33m2() {
      deps.clearBlockingLoading();
      deps.clearStatus();
      deps.clearAwaitingSourceView();
      await deps.clearConnectionFlowState().catch(() => {});
      deps.showBlockingLoading(deps.msg("safeLogoutStatus"));

      try {
        const result = await deps.localLogout33m2({ reloadTabs: true });
        deps.clearBlockingLoading();
        deps.showStatus(
          "success",
          result?.refreshedTabCount > 0
            ? deps.msg("safeLogoutComplete")
            : deps.msg("safeLogoutCompleteNoTab"),
        );
        deps.renderViews();
      } catch (error) {
        console.error("[hostier] safeLogout33m2 failed:", error);
        deps.clearBlockingLoading();
        const fallbackMessage = deps.msg("safeLogoutFailed");
        const message = deps.describeError
          ? deps.describeError(error, fallbackMessage)
          : fallbackMessage;
        deps.showStatus("error", message);
        deps.renderViews();
      }
    }

    async function connectPlatform(platform, options = {}) {
      const config = deps.platformConfigs[platform];
      const pendingConnections = options.bulkReconnect
        ? deps.normalizeBulkReconnectPendingConnections(
          options.pendingConnections?.length
            ? options.pendingConnections
            : deps.getBulkReconnectCandidates(platform),
        )
        : [];
      deps.clearGuardState();
      deps.setHeaderState({
        email: deps.getCurrentSession()?.user?.email || "",
        showWebsiteLink: true,
      });
      const showDetailView = options.showDetailView !== false;
      if (showDetailView) {
        deps.setCurrentPlatform(platform);
      }

      const baseFlow = {
        platform,
        connectionId: options.bulkReconnect ? null : options.connectionId ?? null,
        showDetailView,
        bulkReconnect: options.bulkReconnect === true,
        pendingConnections,
        targetAccountKey:
          typeof options.accountKey === "string" && options.accountKey.length > 0
            ? options.accountKey
            : null,
        targetDisplayLabel:
          typeof options.displayLabel === "string" && options.displayLabel.length > 0
            ? options.displayLabel
            : pendingConnections[0]?.displayLabel ?? null,
        sourceAutoOpenedAt: options.sourceAutoOpenedAt ?? null,
      };

      console.log("[hostier] connectPlatform:start", {
        platform,
        options,
        baseFlow,
      });

      if (baseFlow.bulkReconnect && pendingConnections.length === 0) {
        const message = deps.msg("detailReconnectHint");
        await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
        deps.showStatus("error", message);
        return;
      }

      try {
        const alreadyGranted = await hasPlatformPermission(config);
        if (!alreadyGranted) {
          await deps.setConnectionFlowState({
            ...baseFlow,
            step: "permission_requested",
            message: `${config.label} 권한을 확인하고 있습니다.`,
          });
          deps.showStatus("info", `${config.label} 권한을 확인하고 있습니다.`);

          const granted = await ensurePlatformPermission(config);
          if (!granted) {
            const message = deps.msg("permissionDenied", [config.label]);
            await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
            deps.showStatus("error", message);
            deps.clearAwaitingSourceView();
            return;
          }

          const message = deps.msg("connectingStatus", [config.label]);
          await deps.setConnectionFlowState({
            ...baseFlow,
            step: "permission_granted",
            message,
          });
          deps.showBlockingLoading(message);
          deps.clearAwaitingSourceView();
          await continuePendingConnectionFlowInPopup(baseFlow);
          return;
        }

        await deps.setConnectionFlowState({
          ...baseFlow,
          step: "permission_granted",
          message: deps.msg("connectingStatus", [config.label]),
        });
        deps.showBlockingLoading(deps.msg("connectingStatus", [config.label]));
        await continuePendingConnectionFlowInPopup(baseFlow);
        return;
      } catch (e) {
        console.error("[hostier] Platform connection failed:", e);
        deps.clearBlockingLoading();
        const fallbackMessage = baseFlow.bulkReconnect
          ? deps.getBulkReconnectWaitingMessage(deps.msg, baseFlow.pendingConnections)
          : deps.msg("connectionFailed", [config.label]);
        const message = deps.describeError
          ? deps.describeError(e, fallbackMessage)
          : fallbackMessage;
        const persistedFlow = await deps.getConnectionFlowState();
        if (persistedFlow?.platform === baseFlow.platform && persistedFlow.step === "awaiting_source") {
          deps.clearStatus();
          deps.showAwaitingSourcePrompt(persistedFlow);
        } else {
          await deps.setConnectionFlowState({ ...baseFlow, step: "error", message });
          if (baseFlow.bulkReconnect) {
            deps.clearStatus();
          } else {
            deps.showStatus("error", message);
          }
          if (baseFlow.bulkReconnect) {
            deps.showAwaitingSourcePrompt(baseFlow);
          } else {
            deps.clearAwaitingSourceView();
          }
        }
      } finally {
        const persistedFlow = await deps.getConnectionFlowState().catch(() => null);
        if (persistedFlow?.platform === baseFlow.platform && persistedFlow.step === "awaiting_source") {
          deps.clearStatus();
          deps.showAwaitingSourcePrompt(persistedFlow);
        } else {
          deps.renderViews();
        }
      }
    }

    async function resumeConnectionFlowIfNeeded() {
      if (deps.getResumeInFlight()) {
        return;
      }

      if (deps.getGuardActive()) {
        return;
      }

      const flow = await deps.getConnectionFlowState();
      if (!flow?.platform) {
        deps.clearAwaitingSourceView();
        return;
      }

      if (Date.now() - Number(flow.updatedAt || 0) > 10 * 60 * 1000) {
        await deps.clearConnectionFlowState();
        return;
      }

      if (flow.showDetailView !== false) {
        deps.setCurrentPlatform(flow.platform);
      }

      if (flow.step === "success") {
        deps.clearBlockingLoading();
        deps.showStatus("success", flow.message || "연결이 완료되었습니다.");
        deps.clearAwaitingSourceView();
        await deps.clearConnectionFlowState();
        return;
      }

      if (flow.step === "error") {
        deps.clearBlockingLoading();
        deps.showStatus("error", flow.message || "연결에 실패했습니다.");
        deps.clearAwaitingSourceView();
        return;
      }

      if (
        flow.step === "permission_requested"
        || flow.step === "permission_granted"
        || flow.step === "background_resuming"
        || flow.step === "saving_connection"
      ) {
        deps.showBlockingLoading(flow.message || "연결을 진행하고 있습니다.");
        await continuePendingConnectionFlowInPopup(flow);
        return;
      }

      if (flow.step === "awaiting_source") {
        deps.clearBlockingLoading();
        deps.clearStatus();
        deps.showAwaitingSourcePrompt(flow);
        return;
      }

      deps.setResumeInFlight(true);
      try {
        await connectPlatform(flow.platform, {
          connectionId: flow.connectionId || undefined,
          accountKey: flow.targetAccountKey || undefined,
          showDetailView: flow.showDetailView !== false,
          bulkReconnect: flow.bulkReconnect === true,
          pendingConnections: flow.pendingConnections,
          displayLabel: flow.targetDisplayLabel,
          sourceAutoOpenedAt: flow.sourceAutoOpenedAt,
        });
      } finally {
        deps.setResumeInFlight(false);
      }
    }

    async function loadStatus() {
      try {
        deps.setStatusLoadState("loading");
        deps.renderViews();
        const res = await deps.fetchHostier("/api/platform-connections");

        if (!res.ok) {
          if (res.status === 401) {
            deps.setStatusLoadState("idle");
            deps.showLoginGate();
            return;
          }
          deps.setStatusLoadState("error");
          return;
        }

        const data = await res.json();
        deps.setCurrentSession({
          user: {
            email: data.userEmail || null,
          },
        });
        deps.setHeaderState({
          email: data.userEmail || "",
          showWebsiteLink: true,
        });

        deps.resetConnectionsByPlatform(Object.keys(deps.platformConfigs));
        for (const connection of data.connections ?? []) {
          deps.pushConnection(connection.platform, connection);
        }

        deps.setStatusLoadState("ready");
        deps.clearGuardState();
        deps.renderViews();
      } catch (e) {
        deps.setStatusLoadState("error");
        console.error("[hostier] Failed to load status:", e);
        deps.showStatus("error", deps.msg("statusLoadFailed"));
      }
    }

    async function initializePopup() {
      deps.setStatusLoadState("loading");
      const token = await deps.getExtensionToken();
      if (!token) {
        deps.showLoginGate();
        return;
      }

      deps.setCurrentSession({ user: { email: null } });
      deps.setHeaderState({
        email: "",
        showWebsiteLink: true,
      });
      await loadStatus();
      await resumeConnectionFlowIfNeeded();
    }

    return {
      refreshExtensionTokenSilently,
      pruneBulkReconnectPendingConnections,
      continuePendingConnectionFlowInPopup,
      disconnectConnection,
      safeLogout33m2,
      connectPlatform,
      resumeConnectionFlowIfNeeded,
      loadStatus,
      initializePopup,
    };
  }

  const api = { createPopupFlowController };
  root.HostierPopupFlowShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
