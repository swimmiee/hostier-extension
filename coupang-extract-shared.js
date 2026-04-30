// Parsers / data shaping for Coupang's order-list __NEXT_DATA__ JSON.
// Pure functions only. No DOM/chrome APIs here so it can run under Node tests.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.CoupangExtract = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  function ymdInKst(unixMs) {
    // KST = UTC+9. Pure offset (no DST in Korea).
    const d = new Date(unixMs + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  function isRefunded(product) {
    if (!product) return true;
    if (product.allCanceled) return true;
    if (product.partialCanceled) return true;
    if (typeof product.cancelQuantity === "number" && typeof product.quantity === "number" && product.cancelQuantity >= product.quantity) return true;
    if (product.cancelReturnStatus !== null && product.cancelReturnStatus !== undefined) return true;
    if (product.returnReceipted) return true;
    return false;
  }

  function flattenOrders(nextData) {
    const orders = nextData?.props?.pageProps?.domains?.desktopOrder?.orderList ?? [];
    const rows = [];
    for (const order of orders) {
      if (order.allCanceled) continue;
      const occurredAt = ymdInKst(order.orderedAt);
      const seen = new Set();
      const groups = order.deliveryGroupList ?? [];
      for (const g of groups) {
        for (const p of (g.productList ?? [])) {
          const key = `${order.orderId}:${p.vendorItemId}`;
          if (seen.has(key)) continue;
          if (isRefunded(p)) continue;
          seen.add(key);
          rows.push({
            sourceKey: `coupang:order:${order.orderId}:vendorItem:${p.vendorItemId}`,
            productName: p.productName,
            amountKrw: (p.combinedUnitPrice ?? p.discountedUnitPrice ?? p.unitPrice) * (p.quantity ?? 1),
            occurredAt,
            orderId: order.orderId,
            vendorItemId: p.vendorItemId,
          });
        }
      }
    }
    return rows;
  }

  function getPagination(nextData) {
    return nextData?.props?.pageProps?.domains?.desktopOrder?.orderPagination ?? null;
  }

  function isLoggedIn(nextData) {
    return Boolean(nextData?.props?.pageProps?.context?.isLogin);
  }

  function parseNextDataFromHTML(html) {
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error("__NEXT_DATA__ not found");
    return JSON.parse(m[1]);
  }

  function buildOrderListUrl({ from, to, pageIndex }) {
    const u = new URL("https://mc.coupang.com/ssr/desktop/order/list");
    u.searchParams.set("searchType", "DATE");
    u.searchParams.set("startSearchDate", from);
    u.searchParams.set("endSearchDate", to);
    u.searchParams.set("pageIndex", String(pageIndex));
    return u.toString();
  }

  function checkDataHealth(nextData) {
    // If the page returned non-zero orders but most have null vendorItemId, structure changed.
    const orders = nextData?.props?.pageProps?.domains?.desktopOrder?.orderList ?? [];
    if (orders.length === 0) return { healthy: true };
    let total = 0; let withVid = 0;
    for (const o of orders) {
      for (const g of (o.deliveryGroupList ?? [])) {
        for (const p of (g.productList ?? [])) {
          total += 1;
          if (p && p.vendorItemId) withVid += 1;
        }
      }
    }
    if (total === 0) return { healthy: true };
    if (withVid / total < 0.5) return { healthy: false, reason: "vendorItemId missing on >50% of products" };
    return { healthy: true };
  }

  return {
    ymdInKst,
    isRefunded,
    flattenOrders,
    getPagination,
    isLoggedIn,
    parseNextDataFromHTML,
    buildOrderListUrl,
    checkDataHealth,
  };
});
