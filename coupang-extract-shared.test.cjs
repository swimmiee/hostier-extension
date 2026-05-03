const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const shared = require("./coupang-extract-shared.js");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/coupang-next-data.json"), "utf8"));

test("flattenOrders dedupes by (orderId, vendorItemId)", () => {
  const rows = shared.flattenOrders(fixture);
  // Order 1 has 샴푸 in two shipment boxes (same vendorItemId=100). Should appear once.
  const sham = rows.filter((r) => r.vendorItemId === 100);
  assert.equal(sham.length, 1);
});

test("flattenOrders excludes refunded products", () => {
  const rows = shared.flattenOrders(fixture);
  const refund = rows.find((r) => r.vendorItemId === 300);
  assert.equal(refund, undefined);
});

test("flattenOrders converts orderedAt to YYYY-MM-DD KST", () => {
  const rows = shared.flattenOrders(fixture);
  const sham = rows.find((r) => r.vendorItemId === 100);
  assert.match(sham.occurredAt, /^\d{4}-\d{2}-\d{2}$/);
});

test("flattenOrders sourceKey format", () => {
  const rows = shared.flattenOrders(fixture);
  const sham = rows.find((r) => r.vendorItemId === 100);
  assert.equal(sham.sourceKey, "coupang:order:19100000000001:vendorItem:100");
});

test("flattenOrders amountKrw = combinedUnitPrice × quantity", () => {
  const rows = shared.flattenOrders(fixture);
  const towel = rows.find((r) => r.vendorItemId === 200);
  assert.equal(towel.amountKrw, 12900); // 12900 × 1
});

test("parseNextDataFromHTML extracts the JSON", () => {
  const html = `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script></body></html>`;
  const parsed = shared.parseNextDataFromHTML(html);
  assert.equal(parsed.props.pageProps.domains.desktopOrder.orderList.length, 3);
});

test("getPagination returns hasNext/nextPageIndex", () => {
  const p = shared.getPagination(fixture);
  assert.deepEqual(p, { hasPrev: false, prevYear: 0, prevPageIndex: 0, hasNext: true, nextYear: 0, nextPageIndex: 1 });
});

test("isLoggedIn", () => {
  assert.equal(shared.isLoggedIn(fixture), true);
  const out = JSON.parse(JSON.stringify(fixture));
  out.props.pageProps.context.isLogin = false;
  assert.equal(shared.isLoggedIn(out), false);
});

test("buildOrderListUrl with date range and pageIndex", () => {
  const url = shared.buildOrderListUrl({ from: "2026-04-01", to: "2026-04-30", pageIndex: 2 });
  assert.equal(url, "https://mc.coupang.com/ssr/desktop/order/list?searchType=DATE&startSearchDate=2026-04-01&endSearchDate=2026-04-30&pageIndex=2");
});

test("flattenOrders excludes orders outside dateRange", () => {
  const rows = shared.flattenOrders(fixture, { from: "2026-04-01", to: "2026-04-30" });
  assert.equal(rows.find((r) => r.vendorItemId === 999), undefined);
  assert.ok(rows.length > 0);
});

test("isPageBeforeRange detects when oldest order is before from", () => {
  const synth = { props: { pageProps: { domains: { desktopOrder: { orderList: [
    { orderId: 1, orderedAt: 1769000000000, allCanceled: false, deliveryGroupList: [] }
  ] } } } } };
  assert.equal(shared.isPageBeforeRange(synth, { from: "2026-04-01" }), true);
});

test("isPageBeforeRange returns false when newest order is in range", () => {
  const synth = { props: { pageProps: { domains: { desktopOrder: { orderList: [
    { orderId: 1, orderedAt: 1777520000000, allCanceled: false, deliveryGroupList: [] }
  ] } } } } };
  assert.equal(shared.isPageBeforeRange(synth, { from: "2026-04-01" }), false);
});

test("isPageBeforeRange returns false when no from is provided", () => {
  const synth = { props: { pageProps: { domains: { desktopOrder: { orderList: [
    { orderId: 1, orderedAt: 1769000000000, allCanceled: false, deliveryGroupList: [] }
  ] } } } } };
  assert.equal(shared.isPageBeforeRange(synth, {}), false);
});

test("isPageBeforeRange returns false on empty page", () => {
  const synth = { props: { pageProps: { domains: { desktopOrder: { orderList: [] } } } } };
  assert.equal(shared.isPageBeforeRange(synth, { from: "2026-04-01" }), false);
});
