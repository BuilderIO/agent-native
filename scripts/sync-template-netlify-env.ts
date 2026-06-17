#!/usr/bin/env tsx

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TEMPLATE_SITES: TemplateSite[] = [
  { name: "analytics", siteId: "ba983662-dac4-478d-a481-5079e67e4d33" },
  { name: "assets", siteId: "5868670b-649a-4a45-9e34-45ef3e75f3fd" },
  { name: "brain", siteId: "af978d13-aa58-44f3-9b5c-f12568467079" },
  { name: "calendar", siteId: "954fe53b-052e-4401-aac2-2e973e498af8" },
  { name: "clips", siteId: "7e3f4fee-258d-4d16-9aaf-154a714e87e2" },
  { name: "content", siteId: "5c2198f5-bee4-41c3-8a6d-4869f400eec2" },
  { name: "design", siteId: "1e6bd63d-2972-4272-86bd-7b33f493606d" },
  { name: "dispatch", siteId: "1171ef84-ed50-418b-bced-e19470475e49" },
  { name: "forms", siteId: "aa0b2020-9983-4d6c-8fb0-65462f960fc4" },
  { name: "macros", siteId: "0700a8ac-6a9f-4834-80dd-734102228132" },
  { name: "mail", siteId: "dee98bb0-6143-4205-8c04-afe7bf83d5b5" },
  { name: "plan", siteId: "9d0d7a73-385d-4da1-ba10-1581ffc4d413" },
  { name: "slides", siteId: "fd5deb5b-5539-47e1-830c-e5fb5e105efd" },
  { name: "starter", siteId: "864ab6ba-0889-4265-99c0-7a18d1888585" },
  { name: "videos", siteId: "3f0c2cd2-06cd-4ab8-bfb4-c199430d1dac" },
];

const SITE_BY_NAME = new Map(TEMPLATE_SITES.map((site) => [site.name, site]));
const DEFAULT_SOURCES = [".env", ".env.local"];
const DEFAULT_SCOPES = ["builds", "functions", "runtime"];
const DEFAULT_CONTEXT = "production";
const BLOCKED_TEMPLATE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
]);
const PUBLIC_KEY_EXACT = new Set([
  "APP_URL",
  "BETTER_AUTH_URL",
  "BUILDER_ORG_KIND",
  "BUILDER_ORG_NAME",
  "BUILDER_PUBLIC_KEY",
  "BUILDER_USER_ID",
  "EMAIL_FROM",
  "ENABLE_BUILDER",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_PICKER_API_KEY",
  "GOOGLE_PICKER_APP_ID",
  "NEON_AUTH_BASE_URL",
]);
const PUBLIC_KEY_PREFIXES = ["VITE_"];

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
  const values = new Map<string, string>();
  const foundSources: string[] = [];

  for (const source of sources) {
    const filePath = path.join(REPO_ROOT, "templates", template, source);
    if (!existsSync(filePath)) continue;

    foundSources.push(path.relative(REPO_ROOT, filePath));
    for (const [key, value] of parseEnvFile(filePath)) {
      values.set(key, value);
    }
  }

  return { foundSources, values };
}

function redactedKeyList(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "(none)";
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

  console.log(
    options.write
      ? `Writing Netlify env vars for context=${options.context} scopes=${options.scopes.join(",")}`
      : `Dry run: no Netlify changes will be made. Add --write to apply.`,
  );

  for (const template of options.templates) {
    const site = SITE_BY_NAME.get(template);
    if (!site) throw new Error(`Missing site mapping for ${template}.`);

    const { foundSources, values } = loadTemplateEnv(template, options.sources);
    const blockedKeys = [...values.keys()]
      .filter((key) => BLOCKED_TEMPLATE_ENV_KEYS.has(key))
      .sort();
    const entries = [...values.entries()].filter(
      ([key, value]) => value !== "" && !BLOCKED_TEMPLATE_ENV_KEYS.has(key),
    );
    const keys = entries.map(([key]) => key).sort();

    console.log("");
    console.log(`[${template}] site=${site.siteId}`);
    console.log(
      `  sources: ${foundSources.length > 0 ? foundSources.join(", ") : "(none)"}`,
    );
    console.log(`  keys: ${redactedKeyList(keys)}`);
    if (blockedKeys.length > 0) {
      console.log(
        `  skipped blocked hosted LLM key(s): ${blockedKeys.join(", ")}`,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
