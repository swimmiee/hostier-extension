import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServiceAccountJwt,
  createChromeWebStoreClient,
  fetchServiceAccountAccessToken,
  parseRequiredChromeWebStoreConfig,
  waitForUploadToFinish,
} from "./scripts/chrome-web-store-client.mjs";

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDjsvHH8Xl6inYJ
pcV5Y+8yHGQbYQ59QvL4cYGH3EMJ5EJLS4rUop0WlKYtlwLEQq3aY3nrOta0l8De
u5AG+PQF7FcYG0bi0o0Mfo70sQZwrtrzDdRhl0tf9UTPhv8iagW/Ger8jJcd/lW+
T+f8RQErxg6VQY4pGxoOstN/j4kK8W5NiA9e1k5svh5d+kTl5w4UcJ6wP5NhE8GY
fX4C2mLEAwOFkPhn3Rc4x3n4ri+T9Q6r3m5nyLeQ0X4Er9AHJ2hLm8WfMEbb9QO2
JebM5Gm1jWhSlrYJ5ueNqD8yN8dmEjY1aBExoPj6TFByoDyMaq1YRK0ihJZ8xCxx
qj3s7UMlAgMBAAECggEABw37JxrPy+JZOD1aAGPnDh8+9eyfWa3q+SrzznG0dN7m
y0oxlH6wqF3Ed6qUfQUeLbwGAr4B9XqEaqD5UQY4lAlhiZ7vCtK/8Qf7BjHjcCxM
Q1Xc/RwZ+9lsZTeQ2VmV9D7jlKfjV1H4vU7L8ZahT+4OKeV+dYqNBuLPIu+7v4i6
up3PXmy0Hk4+7zSaSbmuUE7ruxTLtYL0u3l3n2n7TfHtF0QmN2yE76G7b+lkEDxO
1OcUgeL6syN6yy9G+6ERWuvG9reQQp0k0M4p0jL8Yf2m9AUv2sVxPOM7ntSxHv+2
cpNggc7tVTo59KSvV4T4hNc6WWL9azvjlwm4Us/2VQKBgQD+7+Igd8mnMLw91NCb
SxuUdgVByvJOC5KK+KOEm7IbGdQQQha4IGfA29hYtHWV7K4h0SE8SzFQO6v7wNn7
7M2fbErWt6f+AlQm5Bf3J6KSVFswZb3Y7TnKTw91nL07ew6NnigIpWQ7ZTzzPjGE
7kMJsgFLbiq/07fMNV8bFhv0bwKBgQDklqX7mNVuRkV9cJWMsM1E+7Sa4cQJ3FGI
FhFeToI7ddjsmPQ4aefM0LhvBG+0arwOV6Z0+i36smVpgwz8mEJpvb68R3f9kM3e
FtNdzF4+On1hBpa1Dd14VwLY6vvHJrPb8NGP+cBD+sqe8xp8l8d0VqdwkW5nQeSe
U6stch1b6QKBgElvAxrB2l30pLwcI4YjH9uQH8a3L71+lqAF2d5YhNhHTb8jpCkV
Si0mMUNY3iAd6s6jvkdmBfT7ZRLgoeOCPQy6l9ye7pywPzPeNjN5z+o92fGUO43L
LA1PuxY8gq0ezdr3SBvbhz5QYZ9ITN8LlzvLwHYTAWHWzbG6WOlzP8DZAoGBAKZP
mfE0SK4PuXrY2oMp02Ih7LUxqGJlBpiTG1dWoT/ZAsMRm5v3u0vbC7r8rGR4l0Yg
AZoflfRf0ICv4xJxFmKTJE2yk+YKdQ32Grk+ePwFv9uBY7GTE+9DwCxN8wjeK7gI
eQalY0aTUMW2b+M/hcVYeZqYnjwEqshKv6IqsFFhAoGAV3Wnql8jBwqvM9+5FM6s
uo0Vp7JfXfP5j6MeDeiK4EIehITpBVDw9VB2J8JvskdnRt16uUZzY2V1fCuUNB7x
HbIpUOaqxzP8UEMMUkdiS6nqEobXdrXotZcOrvK9LuT70jWgYwtA3iwmzTKHdN+i
8SWgTKF8+Ez3w1B6s9vjgwY=
-----END PRIVATE KEY-----`;

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("buildServiceAccountJwt encodes the expected header and claims", () => {
  const token = buildServiceAccountJwt({
    serviceAccount: {
      clientEmail: "hostier@example.iam.gserviceaccount.com",
      privateKey: TEST_PRIVATE_KEY,
      tokenUri: "https://oauth2.googleapis.com/token",
    },
    issuedAtMs: 1_700_000_000_000,
  });

  const [encodedHeader, encodedClaims, signature] = token.split(".");

  assert.deepEqual(decodeSegment(encodedHeader), {
    alg: "RS256",
    typ: "JWT",
  });
  assert.deepEqual(decodeSegment(encodedClaims), {
    iss: "hostier@example.iam.gserviceaccount.com",
    sub: "hostier@example.iam.gserviceaccount.com",
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/chromewebstore",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  assert.ok(signature.length > 0);
});

test("fetchServiceAccountAccessToken posts the JWT bearer exchange request", async () => {
  const calls = [];
  const accessToken = await fetchServiceAccountAccessToken({
    serviceAccount: {
      clientEmail: "hostier@example.iam.gserviceaccount.com",
      privateKey: TEST_PRIVATE_KEY,
      tokenUri: "https://oauth2.googleapis.com/token",
    },
    issuedAtMs: 1_700_000_000_000,
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body.toString(),
      });
      return new Response(JSON.stringify({ access_token: "token-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(accessToken, "token-123");
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].method, "POST");
  assert.equal(
    calls[0].headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.match(calls[0].body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  assert.match(calls[0].body, /assertion=/);
});

test("parseRequiredChromeWebStoreConfig validates required environment variables", () => {
  assert.throws(
    () => parseRequiredChromeWebStoreConfig({}),
    /Missing CWS_SERVICE_ACCOUNT_JSON/,
  );

  assert.deepEqual(
    parseRequiredChromeWebStoreConfig({
      CWS_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "hostier@example.iam.gserviceaccount.com",
        private_key: TEST_PRIVATE_KEY,
      }),
      CWS_PUBLISHER_ID: "publisher-123",
      CWS_EXTENSION_ID: "extension-123",
    }),
    {
      serviceAccount: {
        clientEmail: "hostier@example.iam.gserviceaccount.com",
        privateKey: TEST_PRIVATE_KEY,
        tokenUri: "https://oauth2.googleapis.com/token",
      },
      publisherId: "publisher-123",
      extensionId: "extension-123",
    },
  );
});

test("createChromeWebStoreClient uploads and publishes against the expected endpoints", async () => {
  const calls = [];
  const client = createChromeWebStoreClient({
    accessToken: "token-123",
    publisherId: "publisher-123",
    extensionId: "emhkbkmobghklncoghdlfoamknnkhhih",
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      const responsePayload =
        calls.length === 1
          ? { uploadState: "SUCCEEDED", crxVersion: "2.1.1" }
          : { itemId: "emhkbkmobghklncoghdlfoamknnkhhih", state: "IN_REVIEW" };

      return new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const zipBuffer = Buffer.from("zip-content");
  const uploadPayload = await client.uploadPackage({ zipBuffer });
  const publishPayload = await client.publishDefault();

  assert.equal(uploadPayload.uploadState, "SUCCEEDED");
  assert.equal(publishPayload.state, "IN_REVIEW");
  assert.equal(
    calls[0].url,
    "https://chromewebstore.googleapis.com/upload/v2/publishers%2Fpublisher-123%2Fitems%2Femhkbkmobghklncoghdlfoamknnkhhih:upload",
  );
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer token-123");
  assert.equal(calls[0].headers["Content-Type"], "application/zip");
  assert.deepEqual(Buffer.from(calls[0].body), zipBuffer);
  assert.equal(
    calls[1].url,
    "https://chromewebstore.googleapis.com/v2/publishers%2Fpublisher-123%2Fitems%2Femhkbkmobghklncoghdlfoamknnkhhih:publish",
  );
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body), {
    publishType: "DEFAULT_PUBLISH",
  });
});

test("waitForUploadToFinish resolves once the async upload succeeds", async () => {
  const states = [
    { lastAsyncUploadState: "IN_PROGRESS" },
    { lastAsyncUploadState: "SUCCEEDED" },
  ];
  const sleeps = [];
  const status = await waitForUploadToFinish({
    client: {
      async fetchStatus() {
        return states.shift();
      },
    },
    initialUploadState: "IN_PROGRESS",
    maxAttempts: 3,
    pollIntervalMs: 2500,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });

  assert.deepEqual(status, { lastAsyncUploadState: "SUCCEEDED" });
  assert.deepEqual(sleeps, [2500, 2500]);
});

test("waitForUploadToFinish surfaces failed async uploads", async () => {
  await assert.rejects(
    () =>
      waitForUploadToFinish({
        client: {
          async fetchStatus() {
            return {
              lastAsyncUploadState: "FAILED",
              submittedItemRevisionStatus: {
                state: "DRAFT",
              },
            };
          },
        },
        initialUploadState: "IN_PROGRESS",
        maxAttempts: 1,
        sleep: async () => {},
      }),
    /Last async upload state: FAILED; submitted revision state DRAFT/,
  );
});
