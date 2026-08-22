/**
 * Report env vars a production Netlify site sets that the matching template's
 * `.env.example` never mentions.
 *
 * This exists because "copy production env into local .env" is the obvious
 * request and the wrong one: production sets `DATABASE_URL` plus a dozen
 * `<app>_DATABASE_URL` vars pointing at production Neon, so a local dev server
 * loaded with them reads and writes production data. It also sets
 * `NITRO_PRESET=netlify`, `COOKIE_DOMAIN=.agent-native.com` and an https
 * `BETTER_AUTH_URL`, none of which work on a laptop.
 *
 * So the question worth asking is not "does local hold production's values"
 * but "is anything production depends on undocumented". Names only: this never
 * reads or prints a value, and Netlify keeps most of them write-only anyway.
 *
 * Usage: tsx scripts/audit-prod-env-coverage.ts
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Netlify/CI plumbing that has no meaning in a checkout. */
const DEPLOY_ONLY =
  /^(NETLIFY|AWS_|CI$|NODE_VERSION|NPM_|SITE_ID|DEPLOY_|BRANCH$|CONTEXT$|INCOMING_HOOK|PULL_REQUEST|URL$|REPOSITORY_URL|COMMIT_REF|CACHED_COMMIT_REF|HEAD$|GIT_)/;
/** Real config, but pointing it at a laptop is wrong or actively harmful. */
const PROD_ONLY =
  /^(NITRO_PRESET|NODE_ENV|COOKIE_DOMAIN|BETTER_AUTH_URL|VITE_BETTER_AUTH_URL|SENTRY_|VITE_SENTRY_|GA_MEASUREMENT_ID|GTM_CONTAINER_ID|AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT|VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT|SENTRY_ENVIRONMENT|APP_URL|.*_DATABASE_URL$|DATABASE_URL_UNPOOLED|AGENT_NATIVE_SKIP_ENSURE_TABLES|ANALYTICS_SKIP_BOOT_MIGRATIONS)$/;

async function api<T>(method: string, data: unknown): Promise<T> {
  const { stdout } = await run(
    "netlify",
    ["api", method, "--data", JSON.stringify(data)],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as T;
}

interface Site {
  id: string;
  name: string;
}
interface EnvVar {
  key: string;
  values?: { context?: string }[];
}

function documentedKeys(path: string): Set<string> {
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^#\s*/, "").split("=")[0].trim())
      .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)),
  );
}

const sites = await api<Site[]>("listSites", {});
let gapCount = 0;

for (const site of sites.sort((a, b) => a.name.localeCompare(b.name))) {
  const matched = /^agent-native-(.+)$/.exec(site.name);
  if (!matched) continue;
  const template = matched[1] === "images" ? "assets" : matched[1];
  const examplePath = `${REPO}/templates/${template}/.env.example`;
  if (!existsSync(examplePath)) continue;

  const documented = documentedKeys(examplePath);
  const vars = await api<EnvVar[]>("getEnvVars", {
    account_id: "builder-io",
    site_id: site.id,
  });
  const undocumented = vars
    .filter((v) =>
      (v.values ?? []).some((value) =>
        ["production", "all"].includes(value.context ?? ""),
      ),
    )
    .map((v) => v.key)
    .filter((key) => !DEPLOY_ONLY.test(key) && !PROD_ONLY.test(key))
    .filter((key) => !documented.has(key))
    .sort();

  if (!undocumented.length) continue;
  gapCount += undocumented.length;
  console.log(`${template} (${undocumented.length})`);
  console.log(`  ${undocumented.join(", ")}\n`);
}

console.log(
  gapCount === 0
    ? "Every production env var is documented in its template's .env.example."
    : `${gapCount} production env var(s) are undocumented.`,
);
