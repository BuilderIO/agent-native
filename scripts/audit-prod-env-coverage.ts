import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const DEPLOY_ONLY =
  /^(NETLIFY|AWS_|CI$|NODE_VERSION|NPM_|SITE_ID|DEPLOY_|BRANCH$|CONTEXT$|INCOMING_HOOK|PULL_REQUEST|URL$|REPOSITORY_URL|COMMIT_REF|CACHED_COMMIT_REF|HEAD$|GIT_)/;
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

const sites: Site[] = [];
for (let page = 1; ; page += 1) {
  const batch = await api<Site[]>("listSites", { page, per_page: 100 });
  sites.push(...batch);
  if (batch.length < 100) break;
}
let gapCount = 0;

for (const site of sites.sort((a, b) => a.name.localeCompare(b.name))) {
  const matched = /^agent-native-(.+)$/.exec(site.name);
  if (!matched) continue;
  const SITE_TO_TEMPLATE: Record<string, string> = {
    images: "assets",
    starter: "chat",
  };
  const template = SITE_TO_TEMPLATE[matched[1]] ?? matched[1];
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
