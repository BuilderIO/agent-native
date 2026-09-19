#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const DEFAULT_EMAIL = "demo@example.local";
const DEFAULT_PASSWORD = "demo-content-password";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, "true");
  }
}

const email =
  args.get("email") || process.env.CONTENT_DEMO_EMAIL || DEFAULT_EMAIL;
const password =
  args.get("password") || process.env.CONTENT_DEMO_PASSWORD || DEFAULT_PASSWORD;
const shouldOpen = args.get("open") !== "false";

function candidateBaseUrls() {
  if (args.get("base-url") || process.env.CONTENT_BASE_URL) {
    return [args.get("base-url") || process.env.CONTENT_BASE_URL];
  }
  const urls = [];
  for (const port of [8080, 8081, 8082, 8083, 8084, 8085, 8090]) {
    urls.push(`http://127.0.0.1:${port}`);
  }
  return urls;
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-source": "clips-desktop",
      origin: baseUrl,
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  return { ok: response.ok, status: response.status, data };
}

async function findRunningBaseUrl() {
  for (const baseUrl of candidateBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}/`, { method: "HEAD" });
      if (response.ok || response.status === 401 || response.status === 405) {
        return baseUrl;
      }
    } catch {}
  }
  throw new Error(
    "Content dev server was not reachable. Start it with `pnpm dev:database`.",
  );
}

const baseUrl = await findRunningBaseUrl();
let login = await postJson(baseUrl, "/_agent-native/auth/login", {
  email,
  password,
});

if (!login.ok) {
  await postJson(baseUrl, "/_agent-native/auth/register", {
    email,
    password,
    name: email.split("@")[0] || "Demo",
    callbackURL: "/",
  });
  login = await postJson(baseUrl, "/_agent-native/auth/login", {
    email,
    password,
  });
}

if (!login.ok) {
  throw new Error(
    `Demo login failed (${login.status}): ${
      login.data?.error || login.data?.message || "unknown error"
    }`,
  );
}

const token = login.data?.token;
const url = token
  ? `${baseUrl}/?_session=${encodeURIComponent(token)}`
  : `${baseUrl}/`;

console.log(`[content demo] URL: ${url}`);
console.log(`[content demo] Email: ${email}`);
console.log(`[content demo] Password: ${password}`);

if (shouldOpen && process.platform === "darwin") {
  spawnSync("open", ["-a", "Google Chrome", url], { stdio: "ignore" });
}
