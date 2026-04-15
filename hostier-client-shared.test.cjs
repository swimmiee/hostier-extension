const test = require("node:test");
const assert = require("node:assert/strict");

const { createHostierClient } = require("./hostier-client-shared.js");

function createChromeStub() {
  const storage = {};
  return {
    storage: {
      local: {
        async get(key) {
          return { [key]: storage[key] };
        },
        async set(value) {
          Object.assign(storage, value);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
    tabs: {
      async query() {
        return [];
      },
    },
    scripting: {
      async executeScript() {
        return [];
      },
    },
  };
}

test("hostier client accepts localhost only when explicitly enabled", () => {
  const client = createHostierClient({
    chromeApi: createChromeStub(),
    defaultHostierUrl: "http://127.0.0.1:3000",
    allowLocalhost: true,
    extensionTokenStorageKey: "token",
    connectionFlowStorageKey: "flow",
    hostierOriginStorageKey: "origin",
    requestTimeoutMs: 1000,
  });

  assert.equal(client.isAllowedHostierUrl("http://127.0.0.1:3000/path"), true);
  assert.equal(client.isAllowedHostierUrl("http://localhost:5173/anything"), true);
  assert.equal(client.isAllowedHostierUrl("https://example.com"), false);
});

test("hostier client rejects localhost in production mode", () => {
  const client = createHostierClient({
    chromeApi: createChromeStub(),
    defaultHostierUrl: "https://hostier.ai",
    extensionTokenStorageKey: "token",
    connectionFlowStorageKey: "flow",
    hostierOriginStorageKey: "origin",
    requestTimeoutMs: 1000,
  });

  assert.equal(client.isAllowedHostierUrl("https://hostier.ai/login"), true);
  assert.equal(client.isAllowedHostierUrl("http://localhost:5173/anything"), false);
});

test("connection flow state is written and cleared through shared client", async () => {
  const client = createHostierClient({
    chromeApi: createChromeStub(),
    defaultHostierUrl: "http://127.0.0.1:3000",
    extensionTokenStorageKey: "token",
    connectionFlowStorageKey: "flow",
    hostierOriginStorageKey: "origin",
    requestTimeoutMs: 1000,
  });

  await client.setConnectionFlowState({ platform: "THIRTY_THREE_M2", step: "awaiting_source" });
  const stored = await client.getConnectionFlowState();
  assert.equal(stored.platform, "THIRTY_THREE_M2");
  assert.equal(stored.step, "awaiting_source");
  assert.equal(typeof stored.updatedAt, "number");

  await client.clearConnectionFlowState();
  assert.equal(await client.getConnectionFlowState(), null);
});
