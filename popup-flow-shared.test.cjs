const test = require("node:test");
const assert = require("node:assert/strict");

const { createPopupFlowController } = require("./popup-flow-shared.js");

test("resumeConnectionFlowIfNeeded restores awaiting_source without restarting connect flow", async () => {
  let connectCalls = 0;
  const shownFlows = [];

  const controller = createPopupFlowController({
    chrome: {
      permissions: {
        contains: (_options, cb) => cb(true),
        request: (_options, cb) => cb(true),
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
        origin: "https://web.33m2.co.kr/*",
      },
    },
    msg: (key) => key,
    normalizeBulkReconnectPendingConnections: (items) => items ?? [],
    isReconnectRequired: () => false,
    buildBaseFlow: (flow) => flow,
    getBulkReconnectWaitingMessage: () => "waiting",
    clearGuardState: () => {},
    setHeaderState: () => {},
    getCurrentSession: () => ({ user: { email: "test@example.com" } }),
    setCurrentPlatform: () => {},
    setConnectionFlowState: async () => {},
    clearAwaitingSourceView: () => {},
    clearBlockingLoading: () => {},
    clearStatus: () => {},
    showStatus: () => {},
    showBlockingLoading: () => {},
    getConnectionFlowState: async () => ({
      platform: "THIRTY_THREE_M2",
      step: "awaiting_source",
      showDetailView: true,
      targetDisplayLabel: "lsmpower75@naver.com",
      sourceAutoOpenedAt: Date.now(),
      updatedAt: Date.now(),
    }),
    clearConnectionFlowState: async () => {},
    getResumeInFlight: () => false,
    setResumeInFlight: () => {},
    getGuardActive: () => false,
    showAwaitingSourcePrompt: (flow) => shownFlows.push(flow),
    renderViews: () => {},
    fetchHostier: async () => ({ ok: true }),
    confirm: () => true,
    getConnections: () => [],
    getBulkReconnectCandidates: () => [],
    popupConnectionFlowRunner: async () => {},
    getStatusLoadState: () => "ready",
    setStatusLoadState: () => {},
    setCurrentSession: () => {},
    resetConnectionsByPlatform: () => {},
    pushConnection: () => {},
    getExtensionToken: async () => "token",
    showLoginGate: () => {},
    openUrl: () => {},
    getHostierLoginUrl: () => "http://localhost:5173/login",
    readPlatformAuthBundleWithRetry: async () => ({ ok: true }),
    enterAwaitingSourceState: async (flow) => flow,
    formatConnectionError: () => "error",
    describeError: (_error, fallback) => fallback,
    onAuthBundleMissing: async () => {},
    onAwaiting: async () => {},
    beforeCycle: async () => {},
    onBlocking: async () => {},
    onError: async () => {},
    afterSuccessfulSave: async () => {},
    onSuccess: async () => {},
  });

  const originalConnectPlatform = controller.connectPlatform;
  controller.connectPlatform = async (...args) => {
    connectCalls += 1;
    return originalConnectPlatform(...args);
  };

  await controller.resumeConnectionFlowIfNeeded();

  assert.equal(connectCalls, 0);
  assert.equal(shownFlows.length, 1);
  assert.equal(shownFlows[0].step, "awaiting_source");
});
