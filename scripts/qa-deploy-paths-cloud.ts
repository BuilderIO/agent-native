/**
 * What the deploy-path check and its reaper both do to the outside world:
 * run a command with a clean environment, talk to a Postgres server, and list
 * or delete Netlify sites. Everything here refuses to touch a name the check
 * did not generate.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_DATABASE_NAME_PATTERN,
  DEPLOY_SITE_NAME_PATTERN,
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

// The two credentials the check runs with. They belong to the check's own
// process: one reaches the Netlify CLI, the other a SQL connection, and no
// install, build, or app process the check starts ever needs either.
const CHECK_CREDENTIALS = ["NETLIFY_AUTH_TOKEN", "DEPLOY_CHECK_DATABASE_URL"];

// What a child process the check starts gets: exactly the settings the check
// sets, never ones left in the shell or inherited from the `pnpm` run that
// started it, and never the check's own credentials. Install and build scripts
// run third-party code, and the app under test is the thing being judged, so
// none of them may hold a token that can delete Netlify sites. A NETLIFY_SITE_ID
// from the shell would also point the deploy at someone's real site, and a
// NETLIFY_DATABASE_URL would win over the DATABASE_URL the check sets.
export function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (/^(npm_|PNPM_)/i.test(key)) delete env[key];
    if (key.startsWith("NETLIFY_")) delete env[key];
  }
  for (const key of [
    ...CHECK_CREDENTIALS,
    "INIT_CWD",
    "NODE_ENV",
    "NITRO_PRESET",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "A2A_SECRET",
    "AUTH_DISABLED",
  ]) {
    delete env[key];
  }
  return env;
}

// The Netlify CLI the check runs. It is pinned because it runs with the team's
// token and can delete sites, and the repo's other credentialed workflows pin
// netlify-cli the same way (27.9.0 is the newest of those); bump them together.
// The guide says `npx netlify`; the docs contract still checks that text, and
// the subcommands and flags here are the guide's own.
export const NETLIFY_CLI_PACKAGE = "netlify-cli@27.9.0";

/** `npx` arguments that run the pinned Netlify CLI with these arguments. */
export function netlifyCliArgs(args: string[]): string[] {
  return ["--yes", "--package", NETLIFY_CLI_PACKAGE, "netlify", ...args];
}

// The one environment that carries the Netlify token, for Netlify CLI calls
// only. Install scripts of the CLI's own dependencies stay off, as they do where
// the repo's workflows install it with `--ignore-scripts`. Without the env
// token the CLI falls back to the user's own login.
export function netlifyEnv(): NodeJS.ProcessEnv {
  const env = baseEnv();
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (token) env.NETLIFY_AUTH_TOKEN = token;
  env.npm_config_ignore_scripts = "true";
  return env;
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
}

const SITES_PER_PAGE = 100;

// `netlify api` prints the API's JSON on stdout. Anything else on stdout, or an
// answer that is not a list of sites, means the listing cannot be trusted, and
// a site that cannot be listed cannot be proven deleted.
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

// Deleted by name, never by a remembered id: a site whose creation errored on
// the way back is still found, and only a name this check generated can match.
export function deleteNetlifySite(name: string): void {
  assert.match(
    name,
    DEPLOY_SITE_NAME_PATTERN,
    `Refusing to delete "${name}": this check did not create it.`,
  );
  for (const site of listNetlifySites(name).filter((s) => s.name === name)) {
    runNetlifyApi("deleteSite", { site_id: site.id });
  }
  const left = listNetlifySites(name).filter((site) => site.name === name);
  assert.equal(
    left.length,
    0,
    `The Netlify site ${name} is still there after the delete.`,
  );
}

// A new site's visibility follows its team's default, and some teams (a
// personal Netlify team, for one) put every new site behind a Netlify login.
// The check reaches its site as an anonymous visitor, so it turns that off for
// its own throwaway site. The team's default is untouched.
export function makeNetlifySitePublic(name: string): void {
  assert.match(
    name,
    DEPLOY_SITE_NAME_PATTERN,
    `Refusing to change "${name}": this check did not create it.`,
  );
  const sites = listNetlifySites(name).filter((site) => site.name === name);
  assert.equal(sites.length, 1, `Expected one Netlify site named ${name}.`);
  const updated = JSON.parse(
    runNetlifyApi("updateSite", {
      site_id: sites[0]!.id,
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
