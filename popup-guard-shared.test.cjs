const test = require("node:test");
const assert = require("node:assert/strict");

const { createPopupGuardController } = require("./popup-guard-shared.js");

class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = "";
    this.onclick = null;
    this.checked = false;
    this.children = [];
    this.className = "";
  }

  append(child) {
    this.children.push(child);
  }
}

function createUi() {
  return {
    guard: new FakeElement(),
    guardTitle: new FakeElement(),
    guardBody: new FakeElement(),
    guardList: new FakeElement(),
    guardCheckWrap: new FakeElement(),
    guardCheckbox: new FakeElement(),
    guardCheckboxLabel: new FakeElement(),
    guardPrimary: new FakeElement(),
    guardSecondary: new FakeElement(),
  };
}

test("showDisclosure skips the guard and connects immediately when permission is already granted", async () => {
  const calls = [];
  const ui = createUi();
  const controller = createPopupGuardController({
    chrome: {
      permissions: {
        contains(_query, cb) {
          cb(true);
        },
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
        origin: "https://web.33m2.co.kr/*",
      },
    },
    normalizeBulkReconnectPendingConnections: (connections) => connections ?? [],
    clearStatus: () => calls.push("clearStatus"),
    setHeaderState: () => calls.push("setHeaderState"),
    setGuardActive: () => calls.push("setGuardActive"),
    document: {
      body: {
        classList: {
          add() {},
          remove() {},
        },
      },
      createElement() {
        return new FakeElement();
      },
    },
    ui,
    msg: (key) => key,
    hasExistingConnections: () => true,
    is33m2AddAccountFlow: () => false,
    isReconnectRequired: () => false,
    getCurrentSession: () => ({ user: { email: "hostier@example.com" } }),
    loadStatus: async () => {},
    connectPlatform: async (...args) => calls.push(["connectPlatform", ...args]),
  });

  await controller.showDisclosure("THIRTY_THREE_M2", {
    connectionId: "conn-1",
    displayLabel: "host@example.com",
    showDetailView: true,
  });

  assert.deepEqual(calls, [
    [
      "connectPlatform",
      "THIRTY_THREE_M2",
      {
        connectionId: "conn-1",
        displayLabel: "host@example.com",
        showDetailView: true,
        pendingConnections: [],
      },
    ],
  ]);
  assert.equal(ui.guard.hidden, true);
  assert.equal(ui.guardTitle.textContent, "");
});

test("showDisclosure still renders the guard when permission has not been granted yet", async () => {
  const ui = createUi();
  const controller = createPopupGuardController({
    chrome: {
      permissions: {
        contains(_query, cb) {
          cb(false);
        },
      },
    },
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
        origin: "https://web.33m2.co.kr/*",
        autoMaintainEnabled: true,
      },
    },
    normalizeBulkReconnectPendingConnections: (connections) => connections ?? [],
    clearStatus: () => {},
    setHeaderState: () => {},
    setGuardActive: () => {},
    document: {
      body: {
        classList: {
          add() {},
          remove() {},
        },
      },
      createElement() {
        return new FakeElement();
      },
    },
    ui,
    msg: (key, subs) => `${key}${subs?.length ? `:${subs.join(",")}` : ""}`,
    hasExistingConnections: () => true,
    is33m2AddAccountFlow: () => false,
    isReconnectRequired: () => false,
    getCurrentSession: () => ({ user: { email: "hostier@example.com" } }),
    loadStatus: async () => {},
    connectPlatform: async () => {
      throw new Error("should not connect immediately");
    },
  });

  await controller.showDisclosure("THIRTY_THREE_M2", {
    connectionId: "conn-1",
    displayLabel: "host@example.com",
    showDetailView: true,
  });

  assert.equal(ui.guard.hidden, false);
  assert.equal(ui.guardTitle.textContent, "connectDisclosureTitle:33m2");
  assert.equal(ui.guardPrimary.disabled, true);
});

test("showLoginGate rerenders immediately and explains the popup features", () => {
  const calls = [];
  const ui = createUi();
  const controller = createPopupGuardController({
    clearBlockingLoading: () => calls.push("clearBlockingLoading"),
    clearStatus: () => calls.push("clearStatus"),
    clearAwaitingSourceView: () => calls.push("clearAwaitingSourceView"),
    setHeaderState: () => calls.push("setHeaderState"),
    setStatusLoadState: (value) => calls.push(["setStatusLoadState", value]),
    setGuardActive: (value) => calls.push(["setGuardActive", value]),
    renderViews: () => calls.push("renderViews"),
    openUrl: () => {},
    getHostierLoginUrl: () => "https://hostier.ai/login",
    initializePopup: async () => {},
    document: {
      body: {
        classList: {
          add() {},
          remove() {},
        },
      },
      createElement() {
        return new FakeElement();
      },
    },
    ui,
    msg: (key) => key,
  });

  controller.showLoginGate();

  assert.equal(ui.guard.hidden, false);
  assert.equal(ui.guardTitle.textContent, "loginGateTitle");
  assert.equal(ui.guardBody.textContent, "loginGateBody");
  assert.equal(ui.guardList.hidden, false);
  assert.deepEqual(ui.guardList.children.map((child) => child.textContent), [
    "loginGateFeatureStatus",
    "loginGateFeaturePermission",
    "loginGateFeatureReconnect",
  ]);
  assert.equal(ui.guardPrimary.textContent, "loginGatePrimary");
  assert.equal(ui.guardSecondary.textContent, "refreshStatus");
  assert.deepEqual(calls, [
    ["setStatusLoadState", "idle"],
    "clearBlockingLoading",
    "clearStatus",
    "clearAwaitingSourceView",
    "setHeaderState",
    ["setGuardActive", true],
    "renderViews",
  ]);
});
