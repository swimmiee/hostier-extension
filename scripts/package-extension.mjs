import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? "prod";
if (!["dev", "prod"].includes(target)) {
  throw new Error("Usage: node scripts/package-extension.mjs [dev|prod]");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const configureScriptPath = resolve(scriptDir, "configure-extension.mjs");
const extensionDir = rootDir;
const outputDir = resolve(rootDir, "dist");
const outputZipPath = resolve(outputDir, "hostier-extension.zip");
const packageEntries = [
  "_locales",
  "auth-bundle-shared.js",
  "background-33m2-shared.js",
  "background.js",
  "config.js",
  "connection-flow-shared.js",
  "connection-runner-shared.js",
  "dev-helper.html",
  "dev-helper.js",
  "dev-reload.json",
  "flow-shared.js",
  "hostier-client-shared.js",
  "icon128.png",
  "icon16.png",
  "icon48.png",
  "install-detector.js",
  "logo-mark.svg",
  "logo-wordmark.svg",
  "manifest.json",
  "page-guard-33m2-shared.js",
  "page-guard-33m2.js",
  "popup-flow-shared.js",
  "popup-guard-shared.js",
  "popup-render-shared.js",
  "popup.css",
  "popup.html",
  "popup.js",
].filter((entry) => existsSync(resolve(extensionDir, entry)));

execFileSync(process.execPath, [configureScriptPath, target], {
  cwd: rootDir,
  stdio: "inherit",
});

if (existsSync(outputZipPath)) {
  rmSync(outputZipPath);
}

mkdirSync(outputDir, { recursive: true });

try {
  execFileSync("zip", ["-qr", outputZipPath, ...packageEntries], {
    cwd: extensionDir,
    stdio: "inherit",
  });
} catch (error) {
  if (error instanceof Error) {
    error.message =
      `Failed to create ${outputZipPath}. Ensure the 'zip' CLI is installed.\n${error.message}`;
  }
  throw error;
}

console.log(`Packaged extension for ${target}: ${outputZipPath}`);
