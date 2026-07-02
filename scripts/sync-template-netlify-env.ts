#!/usr/bin/env tsx

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TEMPLATES } from "../packages/core/src/cli/templates-meta.js";

type TemplateSite = {
  name: string;
  siteId: string;
};

type Options = {
  accountId: string | undefined;
  context: string;
  scopes: string[];
  sources: string[];
  templates: string[];
  write: boolean;
};

type ApiResult = {
  ok: boolean;
  status: number;
};

type TemplateEnvPlan = {
  entries: Array<readonly [string, string]>;
  forbiddenKeys: string[];
  foundSources: string[];
  normalizedKeys: string[];
  skippedKeys: string[];
  sourcesByKey: Map<string, string[]>;
  template: string;
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const NETLIFY_SITES = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "scripts/netlify-sites.json"), "utf8"),
) as Record<string, string>;

const TEMPLATE_SITES: TemplateSite[] = Object.entries(NETLIFY_SITES)
  .filter(([name]) => name !== "fw")
  .map(([name, siteId]) => ({ name, siteId }));

const SITE_BY_NAME = new Map(TEMPLATE_SITES.map((site) => [site.name, site]));
const DEFAULT_SOURCES = [".env", ".env.local"];
const DEFAULT_SCOPES = ["builds", "functions", "runtime"];
const DEFAULT_CONTEXT = "production";
const DEFAULT_HOSTED_TEMPLATE_ENV = new Map([
  ["GA_MEASUREMENT_ID", "G-ESF7FYXGN9"],
  ["VITE_AGENT_NATIVE_SESSION_REPLAY_ENABLED", "true"],
  ["VITE_AGENT_NATIVE_SESSION_REPLAY_SAMPLE_RATE", "0.1"],
]);
const AGENT_NATIVE_ANALYTICS_PUBLIC_ENV_KEYS = [
  "AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
  "VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
  "VITE_AGENT_NATIVE_SESSION_REPLAY_PUBLIC_KEY",
  "VITE_SESSION_REPLAY_PUBLIC_KEY",
];
const HOSTED_TEMPLATE_ENV_ALLOWLIST_EXACT = new Set([
  ...AGENT_NATIVE_ANALYTICS_PUBLIC_ENV_KEYS,
  "APP_URL",
  "BETTER_AUTH_URL",
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "EMAIL_FROM",
  "ENABLE_BUILDER",
  "GA4_PROPERTY_ID",
  "GA_MEASUREMENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_LEGACY_CLIENT_ID",
  "GOOGLE_LEGACY_CLIENT_SECRET",
  "GOOGLE_PICKER_APP_ID",
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "NEON_AUTH_BASE_URL",
  "NETLIFY_DATABASE_AUTH_TOKEN",
  "NETLIFY_DATABASE_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED",
  "NITRO_PRESET",
  "SENDGRID_API_KEY",
  "SUPABASE_URL",
  "ZOOM_CLIENT_ID",
]);
const HOSTED_TEMPLATE_ENV_ALLOWLIST_PREFIXES = ["VITE_"];
const HOSTED_TEMPLATE_ALLOWED_SECRET_EXACT = new Set([
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_LEGACY_CLIENT_SECRET",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "NETLIFY_DATABASE_AUTH_TOKEN",
  "NETLIFY_DATABASE_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED",
  "SENDGRID_API_KEY",
]);
const FORBIDDEN_HOSTED_TEMPLATE_ENV_EXACT = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
]);
const FORBIDDEN_HOSTED_TEMPLATE_ENV_PREFIXES = ["BUILDER_"];
const SECRET_LIKE_ENV_KEY_PATTERN =
  /(^|_)(API_KEY|ACCESS_KEY|PRIVATE_KEY|PUBLIC_KEY|SECRET|TOKEN|PASSWORD|KEY)$/;
const PUBLIC_KEY_EXACT = new Set([
  ...AGENT_NATIVE_ANALYTICS_PUBLIC_ENV_KEYS,
  "APP_URL",
  "BETTER_AUTH_URL",
  "EMAIL_FROM",
  "ENABLE_BUILDER",
  "GA4_PROPERTY_ID",
  "GA_MEASUREMENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_PICKER_APP_ID",
  "NEON_AUTH_BASE_URL",
  "NITRO_PRESET",
  "SUPABASE_URL",
  "ZOOM_CLIENT_ID",
]);
const PUBLIC_KEY_PREFIXES = HOSTED_TEMPLATE_ENV_ALLOWLIST_PREFIXES;
const PRODUCTION_URL_KEYS = new Set(["APP_URL", "BETTER_AUTH_URL"]);
const TEMPLATE_PROD_URL_BY_NAME = new Map(
  TEMPLATES.map((template) => [template.name, template.prodUrl]).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  ),
);

function usage(): string {
  const names = TEMPLATE_SITES.map((site) => site.name).join(", ");
  return `Usage:
  pnpm exec tsx scripts/sync-template-netlify-env.ts --template clips
  NETLIFY_AUTH_TOKEN=... NETLIFY_ACCOUNT_ID=... pnpm exec tsx scripts/sync-template-netlify-env.ts --template clips --write

Options:
  --template <name>       Template to sync. Can be repeated.
  --templates <a,b>       Comma-separated templates to sync.
  --all                   Sync all known template Netlify sites.
  --write                 Apply changes. Omit for a key-only dry run.
  --account <id-or-slug>  Netlify account/team id. Defaults to NETLIFY_ACCOUNT_ID.
  --context <context>     Netlify deploy context. Defaults to "${DEFAULT_CONTEXT}".
  --scope <scope>         Scope to set. Can be repeated. Defaults to ${DEFAULT_SCOPES.join(",")}.
  --source <file>         Env file inside each template. Can be repeated.
                           Defaults to ${DEFAULT_SOURCES.join(", ")}.
                           GA_MEASUREMENT_ID defaults to the hosted Agent-Native
                           GA4 property unless an env source overrides it.
  --help                  Show this help.

Known templates:
  ${names}
`;
}

function parseArgs(argv: string[]): Options {
  const templates: string[] = [];
  const scopes: string[] = [];
  const sources: string[] = [];
  let accountId = process.env.NETLIFY_ACCOUNT_ID;
  let context = DEFAULT_CONTEXT;
  let all = false;
  let write = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };

    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg === "--template") {
      templates.push(next());
    } else if (arg === "--templates") {
      templates.push(...splitCsv(next()));
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--write") {
      write = true;
    } else if (arg === "--dry-run") {
      write = false;
    } else if (arg === "--account") {
      accountId = next();
    } else if (arg === "--context") {
      context = next();
    } else if (arg === "--scope") {
      scopes.push(next());
    } else if (arg === "--source") {
      sources.push(next());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const selected = all ? TEMPLATE_SITES.map((site) => site.name) : templates;
  const uniqueTemplates = [...new Set(selected.map((name) => name.trim()))]
    .filter(Boolean)
    .sort();

  if (uniqueTemplates.length === 0) {
    throw new Error("Select at least one template with --template or --all.");
  }

  const unknownTemplates = uniqueTemplates.filter(
    (name) => !SITE_BY_NAME.has(name),
  );
  if (unknownTemplates.length > 0) {
    throw new Error(`Unknown template(s): ${unknownTemplates.join(", ")}`);
  }

  return {
    accountId,
    context,
    scopes: scopes.length > 0 ? scopes : DEFAULT_SCOPES,
    sources: sources.length > 0 ? sources : DEFAULT_SOURCES,
    templates: uniqueTemplates,
    write,
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseEnvFile(filePath: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;

    const [, key, rawValue] = match;
    env.set(key, parseEnvValue(rawValue));
  }

  return env;
}

function parseEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) return "";

  if (value.startsWith("'")) {
    const end = value.lastIndexOf("'");
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }

  if (value.startsWith('"')) {
    const end = findClosingDoubleQuote(value);
    const quoted = end > 0 ? value.slice(1, end) : value.slice(1);
    return quoted.replace(/\\([nrtbf"\\])/g, (_, escaped: string) => {
      switch (escaped) {
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "b":
          return "\b";
        case "f":
          return "\f";
        default:
          return escaped;
      }
    });
  }

  return value.replace(/\s+#.*$/, "").trimEnd();
}

function findClosingDoubleQuote(value: string): number {
  for (let i = value.length - 1; i > 0; i -= 1) {
    if (value[i] !== '"') continue;
    let slashCount = 0;
    for (let j = i - 1; j >= 0 && value[j] === "\\"; j -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return i;
  }
  return -1;
}

function loadTemplateEnv(template: string, sources: string[]) {
  const values = new Map<string, string>(DEFAULT_HOSTED_TEMPLATE_ENV);
  const foundSources: string[] = [];
  const sourcesByKey = new Map<string, string[]>();

  for (const source of sources) {
    const filePath = path.join(REPO_ROOT, "templates", template, source);
    if (!existsSync(filePath)) continue;

    const relativePath = path.relative(REPO_ROOT, filePath);
    foundSources.push(relativePath);
    for (const [key, value] of parseEnvFile(filePath)) {
      values.set(key, value);
      sourcesByKey.set(key, [...(sourcesByKey.get(key) ?? []), relativePath]);
    }
  }

  return { foundSources, sourcesByKey, values };
}

function redactedKeyList(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "(none)";
}

export function isAllowedHostedTemplateEnvKey(key: string): boolean {
  return (
    HOSTED_TEMPLATE_ENV_ALLOWLIST_EXACT.has(key) ||
    HOSTED_TEMPLATE_ENV_ALLOWLIST_PREFIXES.some((prefix) =>
      key.startsWith(prefix),
    )
  );
}

export function isForbiddenHostedTemplateEnvKey(key: string): boolean {
  if (HOSTED_TEMPLATE_ALLOWED_SECRET_EXACT.has(key)) return false;
  if (PUBLIC_KEY_EXACT.has(key)) return false;
  if (FORBIDDEN_HOSTED_TEMPLATE_ENV_EXACT.has(key)) return true;
  if (
    FORBIDDEN_HOSTED_TEMPLATE_ENV_PREFIXES.some((prefix) =>
      key.startsWith(prefix),
    )
  ) {
    return true;
  }
  return SECRET_LIKE_ENV_KEY_PATTERN.test(key);
}

function formatKeySources(
  key: string,
  sourcesByKey: Map<string, string[]>,
): string {
  const sources = sourcesByKey.get(key) ?? [];
  return sources.length > 0 ? `${key} (${sources.join(", ")})` : key;
}

function buildTemplateEnvPlan(
  template: string,
  context: string,
  sources: string[],
): TemplateEnvPlan {
  const { foundSources, sourcesByKey, values } = loadTemplateEnv(
    template,
    sources,
  );
  const forbiddenKeys = [...values.keys()]
    .filter((key) => isForbiddenHostedTemplateEnvKey(key))
    .sort();
  const normalizedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const entries: Array<readonly [string, string]> = [];

  for (const [key, value] of values) {
    if (value === "") continue;
    if (isForbiddenHostedTemplateEnvKey(key)) continue;
    if (!isAllowedHostedTemplateEnvKey(key)) {
      skippedKeys.push(key);
      continue;
    }

    const normalized = normalizeProductionUrlEntry(
      template,
      context,
      key,
      value,
    );
    if (normalized.normalized) normalizedKeys.push(key);
    entries.push([key, normalized.value] as const);
  }

  return {
    entries,
    forbiddenKeys,
    foundSources,
    normalizedKeys,
    skippedKeys: [...new Set(skippedKeys)].sort(),
    sourcesByKey,
    template,
  };
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function normalizeProductionUrlEntry(
  template: string,
  context: string,
  key: string,
  value: string,
): { value: string; normalized: boolean } {
  if (
    context !== "production" ||
    !PRODUCTION_URL_KEYS.has(key) ||
    !isLoopbackUrl(value)
  ) {
    return { value, normalized: false };
  }

  const prodUrl = TEMPLATE_PROD_URL_BY_NAME.get(template);
  return prodUrl
    ? { value: prodUrl, normalized: true }
    : { value, normalized: false };
}

function netlifyEnvUrl(
  accountId: string,
  siteId: string,
  key?: string,
): string {
  const encodedAccount = encodeURIComponent(accountId);
  const encodedSite = encodeURIComponent(siteId);
  const keyPath = key ? `/${encodeURIComponent(key)}` : "";
  return `https://api.netlify.com/api/v1/accounts/${encodedAccount}/env${keyPath}?site_id=${encodedSite}`;
}

async function requestNetlifyEnv(
  token: string,
  method: "POST" | "PUT",
  url: string,
  body: unknown,
): Promise<ApiResult> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "agent-native-template-env-sync",
    },
    body: JSON.stringify(body),
  });

  await response.arrayBuffer();
  return { ok: response.ok, status: response.status };
}

async function deleteNetlifyEnv(
  token: string,
  accountId: string,
  siteId: string,
  key: string,
): Promise<ApiResult> {
  const response = await fetch(netlifyEnvUrl(accountId, siteId, key), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "agent-native-template-env-sync",
    },
  });

  await response.arrayBuffer();
  return { ok: response.ok, status: response.status };
}

function isSecretKey(key: string): boolean {
  if (PUBLIC_KEY_EXACT.has(key)) return false;
  if (PUBLIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }
  return true;
}

async function syncKey({
  accountId,
  context,
  key,
  scopes,
  siteId,
  token,
  value,
}: {
  accountId: string;
  context: string;
  key: string;
  scopes: string[];
  siteId: string;
  token: string;
  value: string;
}): Promise<"created" | "updated"> {
  const is_secret = isSecretKey(key);
  const create = await requestNetlifyEnv(
    token,
    "POST",
    netlifyEnvUrl(accountId, siteId),
    [
      {
        key,
        is_secret,
        scopes,
        values: [{ context, value }],
      },
    ],
  );

  if (create.ok) return "created";

  if (![400, 409, 422].includes(create.status)) {
    throw new Error(`${key}: create failed with HTTP ${create.status}`);
  }

  if (!is_secret) {
    const deleted = await deleteNetlifyEnv(token, accountId, siteId, key);
    if (!deleted.ok && deleted.status !== 404) {
      throw new Error(
        `${key}: delete before recreate failed with HTTP ${deleted.status}`,
      );
    }

    const recreated = await requestNetlifyEnv(
      token,
      "POST",
      netlifyEnvUrl(accountId, siteId),
      [
        {
          key,
          is_secret,
          scopes,
          values: [{ context, value }],
        },
      ],
    );
    if (recreated.ok) return "updated";
    throw new Error(
      `${key}: recreate as plain env var failed with HTTP ${recreated.status}`,
    );
  }

  const update = await requestNetlifyEnv(
    token,
    "PUT",
    netlifyEnvUrl(accountId, siteId, key),
    {
      key,
      is_secret,
      scopes,
      values: [{ context, value }],
    },
  );

  if (update.ok) return "updated";
  throw new Error(
    `${key}: create returned HTTP ${create.status}; update returned HTTP ${update.status}`,
  );
}

async function main() {
  const options = parseOptionsOrExit(process.argv.slice(2));

  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (options.write && !token) {
    throw new Error("NETLIFY_AUTH_TOKEN must be set when using --write.");
  }
  if (options.write && !options.accountId) {
    throw new Error(
      "NETLIFY_ACCOUNT_ID must be set, or pass --account, when using --write.",
    );
  }

  const plans = options.templates.map((template) =>
    buildTemplateEnvPlan(template, options.context, options.sources),
  );
  const forbidden = plans.flatMap((plan) =>
    plan.forbiddenKeys.map((key) => ({
      key,
      template: plan.template,
      sources: formatKeySources(key, plan.sourcesByKey),
    })),
  );
  if (forbidden.length > 0) {
    const details = forbidden
      .map(({ template, sources }) => `  - ${template}: ${sources}`)
      .join("\n");
    throw new Error(
      [
        "Refusing to sync forbidden hosted template env key(s).",
        "Remove these from local template env files or set them manually in the host when they are truly deploy-owned:",
        details,
      ].join("\n"),
    );
  }

  console.log(
    options.write
      ? `Writing Netlify env vars for context=${options.context} scopes=${options.scopes.join(",")}`
      : `Dry run: no Netlify changes will be made. Add --write to apply.`,
  );

  for (const plan of plans) {
    const site = SITE_BY_NAME.get(plan.template);
    if (!site) throw new Error(`Missing site mapping for ${plan.template}.`);

    const entries = plan.entries;
    const keys = entries.map(([key]) => key).sort();

    console.log("");
    console.log(`[${plan.template}] site=${site.siteId}`);
    console.log(
      `  sources: ${plan.foundSources.length > 0 ? plan.foundSources.join(", ") : "(none)"}`,
    );
    console.log(`  keys: ${redactedKeyList(keys)}`);
    if (plan.skippedKeys.length > 0) {
      console.log(
        `  skipped non-hosted key(s): ${plan.skippedKeys.join(", ")}`,
      );
    }
    if (plan.normalizedKeys.length > 0) {
      console.log(
        `  normalized production URL key(s): ${plan.normalizedKeys
          .sort()
          .join(", ")}`,
      );
    }

    if (entries.length === 0) {
      console.log("  skipped: no non-empty env values found");
      continue;
    }

    if (!options.write) {
      console.log(`  would sync ${entries.length} key(s)`);
      continue;
    }

    let created = 0;
    let updated = 0;

    for (const [key, value] of entries.sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const result = await syncKey({
        accountId: options.accountId!,
        context: options.context,
        key,
        scopes: options.scopes,
        siteId: site.siteId,
        token: token!,
        value,
      });
      if (result === "created") created += 1;
      else updated += 1;
      console.log(`  ${result}: ${key}`);
    }

    console.log(
      `  synced ${entries.length} key(s): ${created} created, ${updated} updated`,
    );
  }
}

function parseOptionsOrExit(argv: string[]): Options {
  try {
    return parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
