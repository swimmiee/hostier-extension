(function initPopupRenderShared(root) {
  function createPopupRenderController(deps) {
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

    function getAwaitingSourcePlatformLabel(flow) {
      return deps.platformConfigs[flow?.platform]?.label || "";
    }

    function getAwaitingSourceBody(flow) {
      if (typeof flow?.message === "string" && flow.message.length > 0) {
        return flow.message;
      }

      return deps.msg("awaitingSourceHint", [getAwaitingSourcePlatformLabel(flow)]);
    }

    function renderPlatformList() {
      const { ui } = deps;
      ui.platformList.textContent = "";

      for (const [platform, config] of Object.entries(deps.platformConfigs)) {
        const hasConnections = hasExistingConnections(platform);
        const hasPermission = deps.getPlatformPermissionState(platform);
        const listStateClass = getListStateClass(platform);
        const needsReconnect = hasPermission && listStateClass === "expired";
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
        state.className = `state-dot ${listStateClass}`;
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
        // Pill states:
        //   no permission → beige "권한허용"
        //   has permission + only expired connections → accent green "다시 연결"
        //   has permission + already managed (has active) → beige "관리"
        //   has permission + nothing connected → accent green "연결하기"
        // Loading stays plain gray text.
        const loading = deps.isStatusLoading();
        const useSecondaryPill = !loading && (!hasPermission || (hasConnections && !needsReconnect));
        const usePrimaryPill = !loading && hasPermission && (!hasConnections || needsReconnect);
        action.className = [
          "platform-action",
          usePrimaryPill || useSecondaryPill ? "platform-action-cta" : "",
          useSecondaryPill ? "platform-action-cta-secondary" : "",
        ]
          .filter(Boolean)
          .join(" ");
        action.textContent = loading
          ? deps.msg("loadingShort")
          : !hasPermission
            ? deps.msg("grantPermission")
          : needsReconnect
            ? deps.msg("reconnect")
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

      const hasConnections = connections.length > 0;
      // "다른 계정 추가" is a low-emphasis affordance tucked into the header, and only
      // appears once at least one account exists. The loud bottom CTA is reserved for the
      // genuine first-connect case so it never competes with per-account reconnect.
      ui.detailAddAccount.textContent = deps.msg("addAnotherAccount");
      ui.detailAddAccount.hidden = !hasConnections;
      if (ui.detailConnect) {
        ui.detailConnect.textContent = deps.msg("connect");
      }
      if (ui.detailActions) {
        ui.detailActions.hidden = hasConnections;
      }

      ui.accountsList.textContent = "";
      ui.accountsList.hidden = connections.length === 0;

      if (connections.length === 0) {
        return;
      }

      for (const connection of connections) {
        const expired = deps.isReconnectRequired(connection);
        const row = deps.document.createElement("div");
        row.className = "account-row";

        // Line 1: identity on the left, status pinned to the right.
        const head = deps.document.createElement("div");
        head.className = "account-head";

        const label = deps.document.createElement("div");
        label.className = "account-label";
        label.textContent = connection.displayLabel;
        head.append(label);

        const state = deps.document.createElement("div");
        state.className = `account-state ${connection.status === "ACTIVE" ? "connected" : expired ? "expired" : "idle"}`;
        state.textContent =
          connection.status === "ACTIVE"
            ? deps.msg("connected")
            : expired
              ? deps.msg("expired")
              : "연결 안됨";
        head.append(state);
        row.append(head);

        // Line 2: actions right-aligned, with the quiet 해제 link before the
        // primary reconnect button so the green CTA sits at the row's edge.
        const actions = deps.document.createElement("div");
        actions.className = "account-actions";

        const disconnectButton = deps.document.createElement("button");
        disconnectButton.type = "button";
        disconnectButton.className = "text-action";
        disconnectButton.textContent = "해제";
        disconnectButton.onclick = () => {
          void deps.disconnectConnection(currentPlatform, connection);
        };
        actions.append(disconnectButton);

        if (expired) {
          const reconnectButton = deps.document.createElement("button");
          reconnectButton.type = "button";
          reconnectButton.className = "row-reconnect";
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
        || deps.msg("awaitingSourceGenericTitle", [getAwaitingSourcePlatformLabel(flow)]);
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
