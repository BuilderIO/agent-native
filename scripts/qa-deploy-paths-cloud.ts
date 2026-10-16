/**
 * What the deploy-path check and its reaper both do to the outside world:
 * run a command with a clean environment, talk to a Postgres server, and find
 * the Netlify site the check reuses. Everything here refuses to touch a name the
 * check did not generate.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_DATABASE_NAME_PATTERN,
  DEPLOY_PROJECT_NAME_PATTERN,
} from "./qa-deploy-paths-lib";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export interface Sql {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
  unsafe(query: string): Promise<unknown>;
  end(): Promise<void>;
}

const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const postgres = requireFromCore("postgres") as (
  url: string,
  options?: Record<string, unknown>,
) => Sql;

export async function withSql<T>(
  url: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

// The only variables of the caller's environment a child process gets: what a
// shell, a toolchain, a proxy, and the Docker CLI need to run. Everything else
// is left out, so the check's contract holds by construction: the app under
// test and the install and build scripts around it run with exactly what the
// check sets, and nothing from the shell or the `pnpm` run that started it. A
// list of names to remove cannot give that: each name it missed was a way
// for the shell to redirect the check. The app reads `<APP>_DATABASE_URL`,
// `DATABASE_URL`, `NETLIFY_DATABASE_URL` and their `_UNPOOLED` forms, and
// migrations prefer the unpooled ones, so a stray one of any of them would
// point `migrate:production` at someone else's database. Credentials, email
// provider keys that change how sign-up behaves, and `NODE_OPTIONS` hooks are
// out for the same reason.
const ENV_ALLOWED_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "TERM",
  "LANG",
  "LANGUAGE",
  "CI",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "DOCKER_BUILDKIT",
  "COREPACK_HOME",
  "COREPACK_NPM_REGISTRY",
]);

// Locale and XDG directories, and the version managers that put node on PATH
// through shims that look their own settings up.
const ENV_ALLOWED_PREFIXES = [
  "LC_",
  "XDG_",
  "VOLTA_",
  "NVM_",
  "FNM_",
  "ASDF_",
  "MISE_",
];

export function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      ENV_ALLOWED_NAMES.has(key) ||
      ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      env[key] = value;
    }
  }
  return env;
}

// The Netlify CLI the check runs. It is pinned because it runs with the team's
// token, and the repo's other credentialed workflows pin netlify-cli the same
// way (27.9.0 is the newest of those); bump them together.
// The guide says `npx netlify`; the docs contract still checks that text, and
// the subcommands and flags here are the guide's own.
export const NETLIFY_CLI_PACKAGE = "netlify-cli@27.9.0";

/** `npx` arguments that run the pinned Netlify CLI with these arguments. */
export function netlifyCliArgs(args: string[]): string[] {
  return ["--yes", "--package", NETLIFY_CLI_PACKAGE, "netlify", ...args];
}

// A host CLI's environment: the clean base plus that host's token, and nothing
// else. Install scripts of the CLI's own dependencies stay off, as they do where
// the repo's workflows install it with `--ignore-scripts`. Without the env
// token the CLI falls back to the user's own login.
function hostCliEnv(tokenName: string): NodeJS.ProcessEnv {
  const env = baseEnv();
  const token = process.env[tokenName];
  if (token) env[tokenName] = token;
  env.npm_config_ignore_scripts = "true";
  return env;
}

// The one environment that carries the Netlify token, for Netlify CLI calls only.
export function netlifyEnv(): NodeJS.ProcessEnv {
  return hostCliEnv("NETLIFY_AUTH_TOKEN");
}

// The Vercel CLI the check runs, pinned like the Netlify one (64.2.0 was the
// newest release when this was written). The guide says `npx vercel`; the docs
// contract still checks that text, and the subcommands and flags here are the
// guide's own.
export const VERCEL_CLI_PACKAGE = "vercel@64.2.0";

/** `npx` arguments that run the pinned Vercel CLI with these arguments. */
export function vercelCliArgs(args: string[]): string[] {
  return ["--yes", "--package", VERCEL_CLI_PACKAGE, "vercel", ...args];
}

// The one environment that carries the Vercel token, for Vercel CLI calls only.
export function vercelEnv(): NodeJS.ProcessEnv {
  return hostCliEnv("VERCEL_TOKEN");
}

export function runQuiet(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  return execFileSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? baseEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5 * 60_000,
  });
}

export const REQUEST_TIMEOUT_MS = 20_000;

// Every HTTP request the check makes to the app under test is bounded. A server
// that accepts a connection and never answers would otherwise hold a request
// past the deadline of the loop around it, and past the cleanup that follows,
// until the job's own timeout kills the process and skips cleanup.
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function runNetlifyApi(method: string, data: unknown): string {
  return runQuiet(
    "npx",
    netlifyCliArgs(["api", method, "--data", JSON.stringify(data)]),
    { env: netlifyEnv() },
  );
}

export interface NetlifySite {
  id: string;
  name: string;
  account_slug?: string;
}

const SITES_PER_PAGE = 100;

// `netlify api` prints the API's JSON on stdout. Anything else on stdout, or an
// answer that is not a list of sites, means the listing cannot be trusted, and
// a site that cannot be listed cannot be found.
export function listNetlifySites(nameFilter: string): NetlifySite[] {
  const sites: NetlifySite[] = [];
  for (let page = 1; ; page++) {
    const stdout = runNetlifyApi("listSites", {
      name: nameFilter,
      filter: "all",
      page,
      per_page: SITES_PER_PAGE,
    });
    const parsed: unknown = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed), "listSites did not return a list.");
    sites.push(...(parsed as NetlifySite[]));
    if (parsed.length < SITES_PER_PAGE) return sites;
  }
}

// The site the check reuses, found by its exact name. Null when it has not been
// created yet. A site of that name in another team than the one asked for is an
// error, not a match: the check must never deploy to a project it does not own.
export function findNetlifySite(
  name: string,
  accountSlug?: string,
): NetlifySite | null {
  assert.match(
    name,
    DEPLOY_PROJECT_NAME_PATTERN,
    `Refusing to look up "${name}": this check does not use that project.`,
  );
  const matches = listNetlifySites(name).filter((site) => site.name === name);
  assert.ok(
    matches.length <= 1,
    `Expected at most one Netlify site named ${name}.`,
  );
  const site = matches[0] ?? null;
  if (site && accountSlug) {
    assert.equal(
      site.account_slug,
      accountSlug,
      `The Netlify site ${name} belongs to "${site.account_slug}", not "${accountSlug}".`,
    );
  }
  return site;
}

// A new site's visibility follows its team's default, and some teams (a
// personal Netlify team, for one) put every new site behind a Netlify login.
// The check reaches its site as an anonymous visitor, so it turns that off for
// its own project. The team's default is untouched.
export function makeNetlifySitePublic(name: string): void {
  const site = findNetlifySite(name);
  assert.ok(site, `Expected a Netlify site named ${name}.`);
  const updated = JSON.parse(
    runNetlifyApi("updateSite", {
      site_id: site.id,
      body: { sso_login: false },
    }),
  ) as { sso_login?: boolean };
  assert.equal(
    updated.sso_login,
    false,
    `Netlify did not turn off the login requirement on ${name}.`,
  );
}

export async function dropDatabase(
  adminUrl: string,
  name: string,
): Promise<void> {
  assert.match(
    name,
    DEPLOY_DATABASE_NAME_PATTERN,
    `Refusing to drop "${name}": this check did not create it.`,
  );
  await withSql(adminUrl, (sql) =>
    sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
}
