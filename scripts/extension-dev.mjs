import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const extensionDir = rootDir;
const markerPath = resolve(extensionDir, "dev-reload.json");
const configureScriptPath = resolve(scriptDir, "configure-extension.mjs");

const IGNORED_SUFFIXES = new Set([
  "dev-reload.json",
  "manifest.json",
  "config.js",
  ".DS_Store",
]);

function runConfigure() {
  execFileSync(process.execPath, [configureScriptPath, "dev"], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

function writeReloadMarker(reason = "manual") {
  mkdirSync(extensionDir, { recursive: true });
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        version: Date.now(),
        reason,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function shouldIgnore(filename = "") {
  return [...IGNORED_SUFFIXES].some((suffix) => filename.endsWith(suffix));
}

function collectWatchDirs(root) {
  const queue = [root];
  const dirs = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    dirs.push(current);

    for (const entry of readdirSync(current)) {
      const next = resolve(current, entry);
      try {
        if (statSync(next).isDirectory()) {
          queue.push(next);
        }
      } catch {
        // Ignore transient filesystem races while editing files.
      }
    }
  }

  return dirs;
}

let debounceTimer = null;
let changeQueue = [];
let running = false;

function scheduleReload(reason) {
  if (shouldIgnore(reason)) {
    return;
  }

  changeQueue.push(reason);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    if (running) {
      return;
    }

    running = true;
    const reasons = [...new Set(changeQueue)];
    changeQueue = [];

    try {
      console.log(`[extension:dev] change detected: ${reasons.join(", ")}`);
      runConfigure();
      writeReloadMarker(reasons[0] ?? "change");
      console.log("[extension:dev] updated extension manifest/config and nudged dev reload");
    } catch (error) {
      console.error("[extension:dev] failed to refresh extension dev assets");
      console.error(error);
    } finally {
      running = false;
    }
  }, 120);
}

runConfigure();
writeReloadMarker("startup");

console.log("");
console.log("[extension:dev] Dev mode ready.");
console.log("[extension:dev] 1. Load this repo root as the unpacked extension once in chrome://extensions");
console.log("[extension:dev] 2. Keep the Hostier tab open");
console.log("[extension:dev] 3. This watcher will rewrite config + trigger extension reload on file changes");
console.log("");

const watchDirs = [
  ...collectWatchDirs(extensionDir),
  scriptDir,
];

const watchers = watchDirs.map((dir) =>
  watch(dir, (eventType, filename) => {
    if (!filename) return;
    const label = `${dir.replace(`${rootDir}/`, "")}/${filename}`;
    if (shouldIgnore(label)) return;
    scheduleReload(label);
  }),
);

process.on("SIGINT", () => {
  for (const watcher of watchers) {
    watcher.close();
  }
  console.log("\n[extension:dev] stopped");
  process.exit(0);
});
