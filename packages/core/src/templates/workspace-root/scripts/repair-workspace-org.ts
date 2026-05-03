#!/usr/bin/env tsx

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface Options {
  name?: string;
  domain?: string;
  ownerEmail?: string;
  a2aSecret?: string;
  envPath: string;
  force: boolean;
  dryRun: boolean;
  setDispatchDefaultOwner: boolean;
}

const HELP = `Usage:
  pnpm repair:workspace-org -- --name "Example Co" --domain example.com --owner-email owner@example.com

Options:
  --name <value>                 Sets WORKSPACE_ORG_NAME
  --domain <value>               Sets WORKSPACE_ORG_DOMAIN
  --owner-email <value>          Sets WORKSPACE_OWNER_EMAIL
  --a2a-secret <value>           Sets A2A_SECRET (generated when omitted)
  --env <path>                   Env file to update (default: .env)
  --force                        Overwrite existing non-empty values
  --dry-run                      Print the changes without writing
  --set-dispatch-default-owner   Also set DISPATCH_DEFAULT_OWNER_EMAIL
`;

const REQUIRED_KEYS = [
  "WORKSPACE_ORG_NAME",
  "WORKSPACE_ORG_DOMAIN",
  "WORKSPACE_OWNER_EMAIL",
  "A2A_SECRET",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    envPath: ".env",
    force: false,
    dryRun: false,
    setDispatchDefaultOwner: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=")
      ? arg.split(/=(.*)/s, 2)
      : [arg, undefined];
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (!next) fail(`Missing value for ${flag}.`);
      return next;
    };

    switch (flag) {
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      case "--name":
        opts.name = value();
        break;
      case "--domain":
        opts.domain = value();
        break;
      case "--owner-email":
        opts.ownerEmail = value();
        break;
      case "--a2a-secret":
        opts.a2aSecret = value();
        break;
      case "--env":
        opts.envPath = value();
        break;
      case "--force":
        opts.force = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--set-dispatch-default-owner":
        opts.setDispatchDefaultOwner = true;
        break;
      default:
        fail(`Unknown option: ${arg}\n\n${HELP}`);
    }
  }

  return opts;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readEnvFile(envPath: string): string {
  if (fs.existsSync(envPath)) return fs.readFileSync(envPath, "utf-8");
  const examplePath = path.join(path.dirname(envPath), ".env.example");
  if (fs.existsSync(examplePath)) return fs.readFileSync(examplePath, "utf-8");
  return "";
}

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function validateDomain(domain: string): void {
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    fail(`Invalid --domain "${domain}". Use a bare domain like example.com.`);
  }
}

function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`Invalid --owner-email "${email}".`);
  }
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_@./:+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function upsertEnvValue(
  content: string,
  key: string,
  value: string,
  force: boolean,
): { content: string; changed: boolean; skipped: boolean } {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  let found = false;
  let changed = false;
  let skipped = false;

  const next = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (!match || match[2] !== key) return line;

    found = true;
    const existing = unquote(match[4]);
    if (existing && !force) {
      skipped = true;
      return line;
    }

    const replacement = `${match[1]}${key}${match[3]}${formatEnvValue(value)}`;
    if (replacement !== line) changed = true;
    return replacement;
  });

  if (!found) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${formatEnvValue(value)}`);
    changed = true;
  }

  return { content: next.join("\n"), changed, skipped };
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.map((v) => v?.trim()).find(Boolean);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const envPath = path.resolve(opts.envPath);
  const original = readEnvFile(envPath);
  const current = parseEnv(original);

  const name = firstValue(
    opts.name,
    process.env.WORKSPACE_ORG_NAME,
    current.WORKSPACE_ORG_NAME,
  );
  const rawDomain = firstValue(
    opts.domain,
    process.env.WORKSPACE_ORG_DOMAIN,
    current.WORKSPACE_ORG_DOMAIN,
  );
  const ownerEmail = firstValue(
    opts.ownerEmail,
    process.env.WORKSPACE_OWNER_EMAIL,
    current.WORKSPACE_OWNER_EMAIL,
  )?.toLowerCase();
  const a2aSecret =
    firstValue(opts.a2aSecret, process.env.A2A_SECRET, current.A2A_SECRET) ??
    crypto.randomBytes(32).toString("hex");

  if (!name) fail("--name or WORKSPACE_ORG_NAME is required.");
  if (!rawDomain) fail("--domain or WORKSPACE_ORG_DOMAIN is required.");
  if (!ownerEmail) fail("--owner-email or WORKSPACE_OWNER_EMAIL is required.");

  const domain = normalizeDomain(rawDomain);
  validateDomain(domain);
  validateEmail(ownerEmail);

  const desired: Record<RequiredKey, string> = {
    WORKSPACE_ORG_NAME: name,
    WORKSPACE_ORG_DOMAIN: domain,
    WORKSPACE_OWNER_EMAIL: ownerEmail,
    A2A_SECRET: a2aSecret,
  };

  let next = original.trimEnd();
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const result = upsertEnvValue(next, key, desired[key], opts.force);
    next = result.content;
    if (result.changed) changed.push(key);
    if (result.skipped) skipped.push(key);
  }

  if (opts.setDispatchDefaultOwner) {
    const result = upsertEnvValue(
      next,
      "DISPATCH_DEFAULT_OWNER_EMAIL",
      ownerEmail,
      opts.force,
    );
    next = result.content;
    if (result.changed) changed.push("DISPATCH_DEFAULT_OWNER_EMAIL");
    if (result.skipped) skipped.push("DISPATCH_DEFAULT_OWNER_EMAIL");
  }

  next = next.trimEnd() + "\n";

  if (opts.dryRun) {
    console.log(next);
  } else {
    fs.writeFileSync(envPath, next);
  }

  console.log(
    `${opts.dryRun ? "Validated" : "Updated"} ${path.relative(process.cwd(), envPath) || envPath}.`,
  );
  if (changed.length > 0) console.log(`Changed: ${changed.join(", ")}`);
  if (skipped.length > 0) {
    console.log(
      `Kept existing values: ${skipped.join(", ")} (use --force to overwrite)`,
    );
  }
  console.log("");
  console.log("Next steps:");
  console.log("1. Sign in as WORKSPACE_OWNER_EMAIL.");
  console.log("2. Create or select the org named by WORKSPACE_ORG_NAME.");
  console.log("3. Set the org allowed domain to WORKSPACE_ORG_DOMAIN.");
  console.log("4. Set or sync the org A2A secret from A2A_SECRET across apps.");
}

main();
