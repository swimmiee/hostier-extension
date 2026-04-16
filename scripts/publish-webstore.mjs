import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createChromeWebStoreClient,
  fetchServiceAccountAccessToken,
  parseRequiredChromeWebStoreConfig,
  waitForUploadToFinish,
} from "./chrome-web-store-client.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const zipPath = resolve(rootDir, "dist", "hostier-extension.zip");

function getListingUrl(extensionId) {
  return `https://chromewebstore.google.com/detail/${extensionId}`;
}

const { serviceAccount, publisherId, extensionId } = parseRequiredChromeWebStoreConfig();
const zipBuffer = readFileSync(zipPath);

console.log(`Publishing ${zipPath} to Chrome Web Store item ${extensionId}...`);

const accessToken = await fetchServiceAccountAccessToken({
  serviceAccount,
});
const client = createChromeWebStoreClient({
  accessToken,
  publisherId,
  extensionId,
});

const uploadResult = await client.uploadPackage({ zipBuffer });
console.log(
  `Chrome Web Store upload started with state ${uploadResult.uploadState ?? "UPLOAD_STATE_UNSPECIFIED"}`
  + (uploadResult.crxVersion ? ` for version ${uploadResult.crxVersion}` : "."),
);

const statusPayload = await waitForUploadToFinish({
  client,
});

if (statusPayload?.warned) {
  console.warn("Chrome Web Store reports the item is currently warned in the developer dashboard.");
}

if (statusPayload?.takenDown) {
  console.warn("Chrome Web Store reports the item is currently taken down in the developer dashboard.");
}

const publishResult = await client.publishDefault();
console.log(
  `Chrome Web Store submission accepted with state ${publishResult.state ?? "UNKNOWN"}.`,
);
console.log(`Chrome Web Store listing: ${getListingUrl(extensionId)}`);
