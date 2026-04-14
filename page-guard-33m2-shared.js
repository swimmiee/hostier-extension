(function initPageGuard33m2Shared(root) {
  function normalizeElementText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function matchesLogoutText(value) {
    const normalized = normalizeElementText(value);
    if (!normalized) {
      return false;
    }

    return (
      normalized === "로그아웃"
      || normalized === "logout"
      || normalized === "log out"
      || normalized === "sign out"
      || normalized === "signout"
    );
  }

  function formatSafeLogoutButtonLabel(summary) {
    const accountEmail =
      typeof summary?.accountEmail === "string" && summary.accountEmail.length > 0
        ? summary.accountEmail
        : null;

    return accountEmail
      ? `현재 계정(${accountEmail}) 안전 로그아웃`
      : "현재 계정 안전 로그아웃";
  }

  const api = {
    normalizeElementText,
    matchesLogoutText,
    formatSafeLogoutButtonLabel,
  };

  root.HostierPageGuard33M2Shared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
