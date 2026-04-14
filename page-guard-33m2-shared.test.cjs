const test = require("node:test");
const assert = require("node:assert/strict");

const {
  matchesLogoutText,
  formatSafeLogoutButtonLabel,
} = require("./page-guard-33m2-shared.js");

test("matchesLogoutText recognizes korean and english logout labels", () => {
  assert.equal(matchesLogoutText("로그아웃"), true);
  assert.equal(matchesLogoutText("  로그아웃  "), true);
  assert.equal(matchesLogoutText("Log out"), true);
  assert.equal(matchesLogoutText("Sign Out"), true);
  assert.equal(matchesLogoutText("예약 설정"), false);
  assert.equal(
    matchesLogoutText("정산 계정 정보 자주 묻는 질문 고객 지원 공지사항 이벤트/제휴 삼삼엠투 단기임대 이야기 로그아웃"),
    false,
  );
});

test("formatSafeLogoutButtonLabel prefers the current browser account email", () => {
  assert.equal(
    formatSafeLogoutButtonLabel({ accountEmail: "host@example.com" }),
    "현재 계정(host@example.com) 안전 로그아웃",
  );
  assert.equal(
    formatSafeLogoutButtonLabel({ accountEmail: "" }),
    "현재 계정 안전 로그아웃",
  );
});
