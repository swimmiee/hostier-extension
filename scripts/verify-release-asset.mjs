import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const zipPath = resolve(rootDir, "dist", "hostier-extension.zip");
const packageJsonPath = resolve(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function unzip(args) {
  return execFileSync("unzip", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const manifest = JSON.parse(unzip(["-p", zipPath, "manifest.json"]));
if (manifest.version !== packageJson.version) {
  throw new Error(
    `Release asset manifest version ${manifest.version} does not match package.json ${packageJson.version}`,
  );
}

const entries = unzip(["-Z1", zipPath]).split("\n").filter(Boolean);
if (entries.some((entry) => entry.startsWith(".git/"))) {
  throw new Error("Release asset unexpectedly contains .git metadata");
}

const legacyLabelPattern = /Enkorstay|EnkorStay/;
for (const file of ["background.js", "popup.js", "_locales/ko/messages.json"]) {
  const content = unzip(["-p", zipPath, file]);
  if (legacyLabelPattern.test(content)) {
    throw new Error(`Release asset still contains legacy Enkorstay label in ${file}`);
  }
}

console.log(
  `Verified release asset ${zipPath} at version ${packageJson.version} with no legacy labels.`,
);
