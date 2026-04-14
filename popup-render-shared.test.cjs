const test = require("node:test");
const assert = require("node:assert/strict");

const { createPopupRenderController } = require("./popup-render-shared.js");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.hidden = false;
    this.className = "";
    this.disabled = false;
    this.type = "";
    this.onclick = null;
    this._textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value == null ? "" : String(value);
    this.children = [];
  }
}

test("renderDetailView omits bulk reconnect CTA but still renders expired 33m2 detail actions", () => {
  const messages = {
    addAnotherAccount: "다른 계정 추가",
    connect: "연결하기",
    detailReconnectHint: "다시 연결은 선택한 계정만 갱신합니다. 현재 로그인된 계정으로 새 연결을 만들려면 다른 계정 추가를 사용하세요.",
    expired: "만료",
    reconnect: "다시 연결",
    safeLogout: "현재 로그인 된 계정 로그아웃",
  };
  const ui = {
    listView: new FakeElement(),
    detailView: new FakeElement(),
    detailTitle: new FakeElement(),
    detailSummary: new FakeElement(),
    accountsList: new FakeElement(),
    detailSafeLogout: new FakeElement("button"),
    detailAddAccount: new FakeElement("button"),
  };
  const controller = createPopupRenderController({
    document: {
      createElement: (tagName) => new FakeElement(tagName),
    },
    ui,
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
      },
    },
    connectionDateTimeFormatter: {
      format: () => "2026. 4. 14. 오전 11:48",
    },
    connectionDateFormatter: {
      format: () => "2026. 4. 20.",
    },
    msg: (key) => messages[key] ?? key,
    getCurrentPlatform: () => "THIRTY_THREE_M2",
    getConnections: () => [{
      id: "conn-1",
      displayLabel: "hostier@example.com",
      status: "EXPIRED",
      tokenExpiresAt: "2026-04-20T00:00:00.000Z",
      accountKey: "hostier@example.com",
      autoMaintainEnabled: true,
    }],
    getPlatformPermissionState: () => true,
    requestPlatformPermission: () => {},
    isStatusLoading: () => false,
    isReconnectRequired: (connection) => connection.status === "EXPIRED",
    normalizeBulkReconnectPendingConnections: (connections) => connections ?? [],
  });

  controller.renderDetailView();

  assert.equal(ui.listView.hidden, true);
  assert.equal(ui.detailView.hidden, false);
  assert.equal(ui.detailTitle.textContent, "33m2");
  assert.equal(ui.detailSummary.hidden, false);
  assert.equal(ui.detailSummary.textContent, messages.detailReconnectHint);
  assert.equal(ui.detailSafeLogout.hidden, false);
  assert.equal(ui.detailSafeLogout.textContent, messages.safeLogout);
  assert.equal(ui.detailAddAccount.textContent, messages.addAnotherAccount);
  assert.equal(ui.accountsList.hidden, false);
  assert.equal(ui.accountsList.children.length, 1);

  const [accountRow] = ui.accountsList.children;
  const actions = accountRow.children[1];
  assert.equal(actions.children.length, 2);
  assert.equal(actions.children[0].textContent, messages.reconnect);
});

test("renderPlatformList shows grantPermission when the platform permission is missing", () => {
  const requested = [];
  const ui = {
    platformList: new FakeElement(),
  };
  const controller = createPopupRenderController({
    document: {
      createElement: (tagName) => new FakeElement(tagName),
    },
    ui,
    platformConfigs: {
      THIRTY_THREE_M2: {
        label: "33m2",
      },
    },
    msg: (key, substitutions) => {
      if (key === "grantPermission") return "권한 허용";
      if (key === "permissionRequiredSummary") return "연결과 자동 갱신을 위해 권한이 필요합니다.";
      if (key === "loadingShort") return "불러오는 중";
      if (key === "connect") return "연결하기";
      return key;
    },
    getConnections: () => [],
    getPlatformPermissionState: () => false,
    requestPlatformPermission: (platform) => requested.push(platform),
    setCurrentPlatform: () => {
      throw new Error("should not open detail when permission is missing");
    },
    showDisclosure: () => {
      throw new Error("should not show disclosure when permission is missing");
    },
    isStatusLoading: () => false,
    isReconnectRequired: () => false,
    normalizeBulkReconnectPendingConnections: (connections) => connections ?? [],
  });

  controller.renderPlatformList();

  assert.equal(ui.platformList.children.length, 1);
  const [row] = ui.platformList.children;
  assert.equal(row.children[1].children[1].textContent, "연결과 자동 갱신을 위해 권한이 필요합니다.");
  assert.equal(row.children[2].textContent, "권한 허용");
  assert.equal(row.children[2].className, "platform-action platform-action-cta");
  row.onclick();
  assert.deepEqual(requested, ["THIRTY_THREE_M2"]);
});
