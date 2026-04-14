(function initPopupGuardShared(root) {
  function createPopupGuardController(deps) {
    function setGuardState({
      title,
      body,
      items = [],
      checkboxLabel,
      primaryLabel,
      primaryAction,
      primaryDisabled = false,
      secondaryLabel,
      secondaryAction,
    }) {
      const { ui } = deps;
      deps.setGuardActive(true);
      deps.document.body.classList.add("guard-active");
      ui.guard.hidden = false;
      ui.guardTitle.textContent = title;
      ui.guardBody.textContent = body;

      ui.guardList.hidden = items.length === 0;
      ui.guardList.textContent = "";
      for (const item of items) {
        const li = deps.document.createElement("li");
        li.textContent = item;
        ui.guardList.append(li);
      }

      const showCheckbox = Boolean(checkboxLabel);
      ui.guardCheckWrap.hidden = !showCheckbox;
      ui.guardCheckbox.checked = false;
      ui.guardCheckboxLabel.textContent = checkboxLabel || "";

      ui.guardPrimary.textContent = primaryLabel;
      ui.guardPrimary.disabled = primaryDisabled;
      ui.guardPrimary.onclick = primaryAction;

      if (secondaryLabel) {
        ui.guardSecondary.hidden = false;
        ui.guardSecondary.textContent = secondaryLabel;
        ui.guardSecondary.onclick = secondaryAction;
      } else {
        ui.guardSecondary.hidden = true;
        ui.guardSecondary.onclick = null;
      }
    }

    function clearGuardState() {
      const { ui } = deps;
      deps.setGuardActive(false);
      deps.document.body.classList.remove("guard-active");
      ui.guard.hidden = true;
      ui.guardList.hidden = true;
      ui.guardList.textContent = "";
      ui.guardCheckbox.checked = false;
      ui.guardCheckbox.onchange = null;
    }

    function showLoginGate() {
      deps.setStatusLoadState("idle");
      deps.clearBlockingLoading();
      deps.clearStatus();
      deps.clearAwaitingSourceView();
      deps.setHeaderState({
        email: "",
        showWebsiteLink: false,
      });
      setGuardState({
        title: deps.msg("loginGateTitle"),
        body: deps.msg("loginGateBody"),
        primaryLabel: deps.msg("loginGatePrimary"),
        primaryAction: () => deps.openUrl(deps.getHostierLoginUrl()),
        secondaryLabel: deps.msg("refreshStatus"),
        secondaryAction: () => {
          void deps.initializePopup();
        },
      });
    }

    async function showDisclosure(platform, options = {}) {
      const config = deps.platformConfigs[platform];
      const accountLabel = typeof options.displayLabel === "string" ? options.displayLabel : "";
      const pendingConnections = deps.normalizeBulkReconnectPendingConnections(
        options.pendingConnections,
      );
      const permissionAlreadyGranted = config?.origin
        ? await new Promise((resolve) => {
          deps.chrome.permissions.contains({ origins: [config.origin] }, (granted) => {
            resolve(Boolean(granted));
          });
        })
        : false;

      if (permissionAlreadyGranted) {
        await deps.connectPlatform(platform, {
          ...options,
          pendingConnections,
        });
        return;
      }

      deps.clearStatus();
      deps.setHeaderState({
        email: deps.getCurrentSession()?.user?.email || "",
        showWebsiteLink: false,
      });
      setGuardState({
        title: deps.msg("connectDisclosureTitle", [config.label]),
        body: options.bulkReconnect
          ? deps.msg("connectDisclosureBulkReconnectBody", [config.label])
          : options.connectionId
            ? deps.msg("connectDisclosureReconnectBody", [accountLabel, config.label])
            : deps.hasExistingConnections(platform)
              ? platform === "THIRTY_THREE_M2"
                ? deps.msg("connectDisclosure33m2AddAccountBody")
                : deps.msg("connectDisclosureAddAccountBody", [config.label])
              : deps.msg("connectDisclosureBody", [config.label]),
        items: [
          deps.msg("disclosureReadsAuth", [config.label]),
          deps.msg("disclosureTransfersToHostier"),
          deps.msg("disclosureEncryptedStorage"),
          config.autoMaintainEnabled
            ? deps.msg("disclosure33m2AutoMaintain")
            : deps.msg("disclosureManualReconnect"),
          config.autoMaintainEnabled
            ? deps.msg("disclosure33m2OpenTab")
            : deps.msg("disclosureDisconnectDeletes"),
        ],
        checkboxLabel: deps.msg("connectDisclosureCheckbox"),
        primaryLabel:
          options.bulkReconnect
            ? deps.msg("bulkReconnect", [String(pendingConnections.length)])
            : deps.is33m2AddAccountFlow({
              platform,
              connectionId: options.connectionId ?? null,
              bulkReconnect: options.bulkReconnect === true,
            })
              ? deps.msg("continueAction")
              : options.connectionId
                ? deps.msg("reconnect")
                : deps.msg("connectDisclosurePrimary"),
        primaryAction: () => {
          void deps.connectPlatform(platform, {
            ...options,
            pendingConnections,
          });
        },
        primaryDisabled: true,
        secondaryLabel: deps.msg("back"),
        secondaryAction: async () => {
          clearGuardState();
          await deps.loadStatus();
        },
      });

      deps.ui.guardCheckbox.onchange = () => {
        deps.ui.guardPrimary.disabled = !deps.ui.guardCheckbox.checked;
      };
    }

    return {
      setGuardState,
      clearGuardState,
      showLoginGate,
      showDisclosure,
    };
  }

  const api = { createPopupGuardController };
  root.HostierPopupGuardShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
