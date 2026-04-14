(function initPopupRenderShared(root) {
  function createPopupRenderController(deps) {
    function formatConnectionDateTime(value) {
      return deps.connectionDateTimeFormatter.format(new Date(value));
    }

    function formatConnectionDate(value) {
      return deps.connectionDateFormatter.format(new Date(value));
    }

    function getConnectionMeta(connection) {
      const parts = [];
      if (connection.lastSyncedAt) {
        parts.push(`업데이트 ${formatConnectionDateTime(connection.lastSyncedAt)}`);
      }
      if (connection.tokenExpiresAt) {
        parts.push(`만료 ${formatConnectionDate(connection.tokenExpiresAt)}`);
      }
      if (!deps.isReconnectRequired(connection)) {
        if (connection.autoMaintainEnabled) {
          parts.push("자동 유지");
        } else {
          parts.push(deps.msg("manualReconnectOnly"));
        }
      }
      return parts.join(" · ");
    }

    function getListSummary(platform) {
      if (deps.isStatusLoading()) {
        return deps.msg("loadingConnections");
      }

      if (!deps.getPlatformPermissionState(platform)) {
        return deps.msg("permissionRequiredSummary", [deps.platformConfigs[platform].label]);
      }

      const connections = deps.getConnections(platform);
      if (connections.length === 0) {
        return "연결된 계정이 없습니다.";
      }

      if (connections.length === 1) {
        const connection = connections[0];
        return deps.isReconnectRequired(connection)
          ? `${connection.displayLabel} · ${deps.msg("expired")}`
          : connection.displayLabel;
      }

      const activeCount = connections.filter((connection) => connection.status === "ACTIVE").length;
      const expiredCount = connections.filter((connection) => deps.isReconnectRequired(connection)).length;
      const parts = [`연결된 계정 ${connections.length}개`];
      if (activeCount > 0) {
        parts.push(`활성 ${activeCount}`);
      }
      if (expiredCount > 0) {
        parts.push(`만료 ${expiredCount}`);
      }
      return parts.join(" · ");
    }

    function getListStateClass(platform) {
      if (deps.isStatusLoading()) {
        return "loading";
      }

      const connections = deps.getConnections(platform);
      if (connections.some((connection) => connection.status === "ACTIVE")) {
        return "connected";
      }
      if (connections.some((connection) => deps.isReconnectRequired(connection))) {
        return "expired";
      }
      return "idle";
    }

    function hasExistingConnections(platform) {
      return deps.getConnections(platform).length > 0;
    }

    function getBulkReconnectCandidates(platform) {
      if (platform !== "THIRTY_THREE_M2") {
        return [];
      }

      return deps.normalizeBulkReconnectPendingConnections(
        deps.getConnections(platform)
          .filter((connection) => deps.isReconnectRequired(connection))
          .map((connection) => ({
            id: connection.id,
            accountKey: connection.accountKey,
            displayLabel: connection.displayLabel,
          })),
      );
    }

    function getAwaitingSourceTargetDisplayLabel(flow) {
      if (typeof flow?.targetDisplayLabel === "string" && flow.targetDisplayLabel.length > 0) {
        return flow.targetDisplayLabel;
      }

      if (flow?.bulkReconnect) {
        return deps.normalizeBulkReconnectPendingConnections(flow.pendingConnections)[0]?.displayLabel || null;
      }

      return null;
    }

    function getAwaitingSourceBody(flow) {
      if (typeof flow?.message === "string" && flow.message.length > 0) {
        return flow.message;
      }

      if (getAwaitingSourceTargetDisplayLabel(flow)) {
        return deps.msg("awaitingSourceHint");
      }

      return deps.msg("awaitingSourceHint");
    }

    function renderPlatformList() {
      const { ui } = deps;
      ui.platformList.textContent = "";

      for (const [platform, config] of Object.entries(deps.platformConfigs)) {
        const hasConnections = hasExistingConnections(platform);
        const hasPermission = deps.getPlatformPermissionState(platform);
        const row = deps.document.createElement("button");
        row.type = "button";
        row.className = "platform-row";
        row.disabled = deps.isStatusLoading();
        row.onclick = () => {
          if (!hasPermission) {
            void deps.requestPlatformPermission(platform, { showDetailView: false });
            return;
          }

          if (hasConnections) {
            deps.setCurrentPlatform(platform);
            return;
          }

          deps.showDisclosure(platform, { showDetailView: false });
        };

        const state = deps.document.createElement("span");
        state.className = `state-dot ${getListStateClass(platform)}`;
        row.append(state);

        const body = deps.document.createElement("div");
        body.className = "platform-body";

        const name = deps.document.createElement("div");
        name.className = "platform-name";
        name.textContent = config.label;
        body.append(name);

        const summary = deps.document.createElement("div");
        summary.className = "platform-summary";
        summary.textContent = getListSummary(platform);
        body.append(summary);

        row.append(body);

        const action = deps.document.createElement("span");
        action.className = !hasPermission
          ? "platform-action platform-action-cta"
          : "platform-action";
        action.textContent = deps.isStatusLoading()
          ? deps.msg("loadingShort")
          : !hasPermission
            ? deps.msg("grantPermission")
          : hasConnections
            ? "관리"
            : deps.msg("connect");
        row.append(action);

        ui.platformList.append(row);
      }
    }

    function renderDetailView() {
      const { ui } = deps;
      const currentPlatform = deps.getCurrentPlatform();
      if (!currentPlatform) {
        ui.detailView.hidden = true;
        ui.listView.hidden = false;
        return;
      }

      const config = deps.platformConfigs[currentPlatform];
      const connections = deps.getConnections(currentPlatform);
      ui.listView.hidden = true;
      ui.detailView.hidden = false;
      ui.detailTitle.textContent = config.label;
      ui.detailSummary.hidden = currentPlatform !== "THIRTY_THREE_M2" || connections.length === 0;
      ui.detailSummary.textContent =
        currentPlatform === "THIRTY_THREE_M2" && connections.length > 0
          ? deps.msg("detailReconnectHint")
          : "";
      ui.detailSafeLogout.hidden = currentPlatform !== "THIRTY_THREE_M2";
      ui.detailSafeLogout.textContent = deps.msg("safeLogout");
      ui.detailAddAccount.textContent =
        connections.length > 0 ? deps.msg("addAnotherAccount") : deps.msg("connect");

      ui.accountsList.textContent = "";
      ui.accountsList.hidden = connections.length === 0;

      if (connections.length === 0) {
        return;
      }

      for (const connection of connections) {
        const row = deps.document.createElement("div");
        row.className = "account-row";

        const body = deps.document.createElement("div");
        body.className = "account-body";

        const head = deps.document.createElement("div");
        head.className = "account-head";

        const label = deps.document.createElement("div");
        label.className = "account-label";
        label.textContent = connection.displayLabel;
        head.append(label);

        const state = deps.document.createElement("div");
        state.className = `account-state ${connection.status === "ACTIVE" ? "connected" : deps.isReconnectRequired(connection) ? "expired" : "idle"}`;
        state.textContent =
          connection.status === "ACTIVE"
            ? deps.msg("connected")
            : deps.isReconnectRequired(connection)
              ? deps.msg("expired")
              : "연결 안됨";
        head.append(state);

        body.append(head);

        const meta = deps.document.createElement("div");
        meta.className = "account-meta";
        meta.textContent = getConnectionMeta(connection);
        body.append(meta);
        row.append(body);

        const actions = deps.document.createElement("div");
        actions.className = "account-actions";

        if (deps.isReconnectRequired(connection)) {
          const reconnectButton = deps.document.createElement("button");
          reconnectButton.type = "button";
          reconnectButton.className = "text-action primary";
          reconnectButton.textContent = deps.msg("reconnect");
          reconnectButton.onclick = () => {
            if (!deps.getPlatformPermissionState(currentPlatform)) {
              void deps.requestPlatformPermission(currentPlatform, { showDetailView: true });
              return;
            }
            deps.showDisclosure(currentPlatform, {
              connectionId: connection.id,
              accountKey: connection.accountKey || undefined,
              displayLabel: connection.displayLabel,
              showDetailView: true,
            });
          };
          actions.append(reconnectButton);
        }

        const disconnectButton = deps.document.createElement("button");
        disconnectButton.type = "button";
        disconnectButton.className = "text-action";
        disconnectButton.textContent = "해제";
        disconnectButton.onclick = () => {
          void deps.disconnectConnection(currentPlatform, connection);
        };
        actions.append(disconnectButton);
        row.append(actions);

        ui.accountsList.append(row);
      }
    }

    function renderAwaitingSourceView() {
      const { ui } = deps;
      const flow = deps.getActiveAwaitingSourceFlow();
      if (!flow) {
        ui.awaitingView.hidden = true;
        deps.stopAwaitingSourcePoll();
        return false;
      }

      const targetDisplayLabel =
        getAwaitingSourceTargetDisplayLabel(flow)
        || deps.msg("awaitingSourceGenericTitle");
      ui.awaitingView.hidden = false;
      ui.listView.hidden = true;
      ui.detailView.hidden = true;
      ui.awaitingKicker.textContent = "";
      ui.awaitingTitle.textContent = targetDisplayLabel;
      ui.awaitingBody.textContent = getAwaitingSourceBody(flow);
      ui.awaitingPrimary.textContent = deps.msg("loginNow");
      ui.awaitingPrimary.onclick = () => {
        const sourceUrl =
          flow?.openUrl
          || deps.platformConfigs[flow.platform]?.loginUrl
          || null;
        if (sourceUrl) {
          deps.openUrl(sourceUrl);
        }
      };
      ui.awaitingSecondary.textContent = deps.msg("cancel");
      ui.awaitingSecondary.onclick = async () => {
        await deps.clearConnectionFlowState();
        deps.clearStatus();
        deps.clearAwaitingSourceView();
        await deps.loadStatus();
      };

      if (flow.step === "awaiting_source") {
        deps.scheduleAwaitingSourcePoll();
      } else {
        deps.stopAwaitingSourcePoll();
      }
      return true;
    }

    function renderViews() {
      const { ui } = deps;
      if (deps.getStatusLoadState() === "loading") {
        ui.awaitingView.hidden = true;
        ui.listView.hidden = true;
        ui.detailView.hidden = true;
        ui.loadingView.hidden = false;
        ui.loadingView.classList.remove("overlay");
        ui.loadingText.textContent = deps.msg("loadingPopup");
        return;
      }

      ui.loadingView.hidden = true;
      ui.loadingView.classList.remove("overlay");

      if (!renderAwaitingSourceView()) {
        ui.awaitingView.hidden = true;
        renderPlatformList();
        renderDetailView();
      }

      if (deps.getBlockingFlowMessage()) {
        ui.loadingView.hidden = false;
        ui.loadingView.classList.add("overlay");
        ui.loadingText.textContent = deps.getBlockingFlowMessage();
      }
    }

    return {
      getBulkReconnectCandidates,
      hasExistingConnections,
      renderPlatformList,
      renderDetailView,
      renderAwaitingSourceView,
      renderViews,
    };
  }

  const api = { createPopupRenderController };
  root.HostierPopupRenderShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
