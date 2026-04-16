import { createSign } from "node:crypto";

export const CHROME_WEB_STORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
export const CHROME_WEB_STORE_API_ORIGIN = "https://chromewebstore.googleapis.com";
const GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token";

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function getErrorDetail(payload, fallback = "Unknown error") {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  if (payload.error && typeof payload.error === "object") {
    if (typeof payload.error.message === "string" && payload.error.message.trim()) {
      return payload.error.message.trim();
    }
    if (typeof payload.error.status === "string" && payload.error.status.trim()) {
      return payload.error.status.trim();
    }
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  return fallback;
}

async function parseJsonResponse(response, actionLabel) {
  const text = await response.text();
  let payload = {};

  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(
          `${actionLabel} failed (${response.status} ${response.statusText}): ${text.trim()}`,
        );
      }

      throw new Error(`${actionLabel} returned invalid JSON.`);
    }
  }

  if (!response.ok) {
    throw new Error(
      `${actionLabel} failed (${response.status} ${response.statusText}): ${getErrorDetail(payload, text.trim() || response.statusText)}`,
    );
  }

  return payload;
}

function createAuthorizedHeaders(accessToken, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  };
}

function buildItemName(publisherId, extensionId) {
  return `publishers/${publisherId}/items/${extensionId}`;
}

export function parseServiceAccountJson(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `CWS_SERVICE_ACCOUNT_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const clientEmail = String(parsed.client_email ?? "").trim();
  const privateKey = String(parsed.private_key ?? "").trim();
  const tokenUri = String(parsed.token_uri ?? GOOGLE_OAUTH_TOKEN_URI).trim();

  if (!clientEmail) {
    throw new Error("CWS_SERVICE_ACCOUNT_JSON is missing client_email.");
  }

  if (!privateKey) {
    throw new Error("CWS_SERVICE_ACCOUNT_JSON is missing private_key.");
  }

  if (!tokenUri) {
    throw new Error("CWS_SERVICE_ACCOUNT_JSON is missing token_uri.");
  }

  return {
    clientEmail,
    privateKey,
    tokenUri,
  };
}

export function buildServiceAccountJwt({
  serviceAccount,
  scope = CHROME_WEB_STORE_SCOPE,
  issuedAtMs = Date.now(),
  expiresInSeconds = 3600,
}) {
  const issuedAt = Math.floor(issuedAtMs / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const claims = {
    iss: serviceAccount.clientEmail,
    sub: serviceAccount.clientEmail,
    aud: serviceAccount.tokenUri,
    scope,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  };
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedClaims = encodeBase64Url(JSON.stringify(claims));
  const unsignedToken = `${encodedHeader}.${encodedClaims}`;
  const signer = createSign("RSA-SHA256");

  signer.update(unsignedToken);
  signer.end();

  const signature = signer.sign(serviceAccount.privateKey).toString("base64url");
  return `${unsignedToken}.${signature}`;
}

export function parseRequiredChromeWebStoreConfig(env = process.env) {
  const rawServiceAccount = String(env.CWS_SERVICE_ACCOUNT_JSON ?? "").trim();
  const publisherId = String(env.CWS_PUBLISHER_ID ?? "").trim();
  const extensionId = String(env.CWS_EXTENSION_ID ?? "").trim();

  if (!rawServiceAccount) {
    throw new Error("Missing CWS_SERVICE_ACCOUNT_JSON.");
  }

  if (!publisherId) {
    throw new Error("Missing CWS_PUBLISHER_ID.");
  }

  if (!extensionId) {
    throw new Error("Missing CWS_EXTENSION_ID.");
  }

  return {
    serviceAccount: parseServiceAccountJson(rawServiceAccount),
    publisherId,
    extensionId,
  };
}

export async function fetchServiceAccountAccessToken({
  serviceAccount,
  fetchImpl = fetch,
  scope = CHROME_WEB_STORE_SCOPE,
  issuedAtMs = Date.now(),
}) {
  const assertion = buildServiceAccountJwt({
    serviceAccount,
    scope,
    issuedAtMs,
  });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetchImpl(serviceAccount.tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await parseJsonResponse(response, "Google OAuth token exchange");
  const accessToken = String(payload.access_token ?? "").trim();

  if (!accessToken) {
    throw new Error("Google OAuth token exchange succeeded but returned no access_token.");
  }

  return accessToken;
}

export function createChromeWebStoreClient({
  accessToken,
  publisherId,
  extensionId,
  fetchImpl = fetch,
}) {
  const itemName = buildItemName(publisherId, extensionId);
  const encodedItemName = encodeURIComponent(itemName);

  return {
    async uploadPackage({ zipBuffer }) {
      const response = await fetchImpl(
        `${CHROME_WEB_STORE_API_ORIGIN}/upload/v2/${encodedItemName}:upload`,
        {
          method: "POST",
          headers: createAuthorizedHeaders(accessToken, {
            "Content-Type": "application/zip",
          }),
          body: zipBuffer,
        },
      );

      return parseJsonResponse(response, "Chrome Web Store upload");
    },

    async fetchStatus() {
      const response = await fetchImpl(
        `${CHROME_WEB_STORE_API_ORIGIN}/v2/${encodedItemName}:fetchStatus`,
        {
          method: "GET",
          headers: createAuthorizedHeaders(accessToken),
        },
      );

      return parseJsonResponse(response, "Chrome Web Store status fetch");
    },

    async publishDefault() {
      const response = await fetchImpl(
        `${CHROME_WEB_STORE_API_ORIGIN}/v2/${encodedItemName}:publish`,
        {
          method: "POST",
          headers: createAuthorizedHeaders(accessToken, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            publishType: "DEFAULT_PUBLISH",
          }),
        },
      );

      return parseJsonResponse(response, "Chrome Web Store publish");
    },
  };
}

function getResolvedUploadState(statusPayload, fallbackState = null) {
  const state = String(statusPayload?.lastAsyncUploadState ?? fallbackState ?? "").trim();
  return state || "UPLOAD_STATE_UNSPECIFIED";
}

function formatUploadFailure(state, statusPayload) {
  const submittedState = String(statusPayload?.submittedItemRevisionStatus?.state ?? "").trim();
  const itemState = submittedState ? ` submitted revision state ${submittedState}` : " no submitted revision state";
  return `Chrome Web Store upload did not complete successfully. Last async upload state: ${state};${itemState}.`;
}

export async function waitForUploadToFinish({
  client,
  initialUploadState,
  maxAttempts = 12,
  pollIntervalMs = 5000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  let currentState = getResolvedUploadState(null, initialUploadState);
  let lastStatus = null;

  if (currentState === "SUCCEEDED") {
    return lastStatus;
  }

  if (currentState === "FAILED") {
    throw new Error(formatUploadFailure(currentState, lastStatus));
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 || currentState === "IN_PROGRESS" || currentState === "UPLOAD_STATE_UNSPECIFIED") {
      await sleep(pollIntervalMs);
    }

    lastStatus = await client.fetchStatus();
    currentState = getResolvedUploadState(lastStatus, currentState);

    if (currentState === "SUCCEEDED") {
      return lastStatus;
    }

    if (currentState === "FAILED") {
      throw new Error(formatUploadFailure(currentState, lastStatus));
    }
  }

  throw new Error(
    `Chrome Web Store upload did not finish after ${maxAttempts} status checks. Last async upload state: ${currentState}.`,
  );
}
