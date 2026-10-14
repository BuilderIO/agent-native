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

// The app under test gets exactly the settings this check sets, never ones
// left in the shell or inherited from the `pnpm` run that started it. Netlify's
// auth token is the one NETLIFY_* value that passes through: a NETLIFY_SITE_ID
// from the shell would point the deploy at someone's real site, and a
// NETLIFY_DATABASE_URL would win over the DATABASE_URL the check sets.
export function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (/^(npm_|PNPM_)/i.test(key)) delete env[key];
    if (key.startsWith("NETLIFY_") && key !== "NETLIFY_AUTH_TOKEN") {
      delete env[key];
    }
  }
  for (const key of [
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
    const stdout = runQuiet("npx", [
      "netlify",
      "api",
      "listSites",
      "--data",
      JSON.stringify({
        name: nameFilter,
        filter: "all",
        page,
        per_page: SITES_PER_PAGE,
      }),
    ]);
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
    runQuiet("npx", [
      "netlify",
      "api",
      "deleteSite",
      "--data",
      JSON.stringify({ site_id: site.id }),
    ]);
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
    runQuiet("npx", [
      "netlify",
      "api",
      "updateSite",
      "--data",
      JSON.stringify({ site_id: sites[0]!.id, body: { sso_login: false } }),
    ]),
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
