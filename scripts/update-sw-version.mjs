import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CACHE_PREFIX = "disuko-pwa";
const CACHE_NAME_PATTERN = /const CACHE_NAME = "disuko-pwa-[^"]+";/u;
const WORKER_FILES = ["public/sw.js", "sw.js"];

function getGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function normalizeVersion(value) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
}

const rawVersion = process.env.DISUKO_CACHE_VERSION || process.env.GITHUB_SHA || getGitSha();
const version = normalizeVersion(rawVersion) || `local-${Date.now()}`;
const cacheName = `${CACHE_PREFIX}-${version}`;

for (const file of WORKER_FILES) {
  const path = resolve(file);
  const source = readFileSync(path, "utf8");
  const updated = source.replace(CACHE_NAME_PATTERN, `const CACHE_NAME = "${cacheName}";`);

  if (!CACHE_NAME_PATTERN.test(source)) {
    throw new Error(`Could not find CACHE_NAME in ${file}`);
  }

  if (updated === source) {
    continue;
  }

  writeFileSync(path, updated);
}

console.log(`Updated service worker cache name to ${cacheName}`);
