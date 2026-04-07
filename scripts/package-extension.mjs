import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? "prod";
if (!["dev", "prod"].includes(target)) {
  throw new Error("Usage: node scripts/package-extension.mjs [dev|prod]");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const configureScriptPath = resolve(scriptDir, "configure-extension.mjs");
const extensionDir = resolve(rootDir, "extension");
const outputZipPath = resolve(rootDir, "web/public/hostier-extension.zip");

execFileSync(process.execPath, [configureScriptPath, target], {
  cwd: rootDir,
  stdio: "inherit",
});

if (existsSync(outputZipPath)) {
  rmSync(outputZipPath);
}

try {
  execFileSync("zip", ["-qr", outputZipPath, ".", "-x", "*.DS_Store"], {
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
