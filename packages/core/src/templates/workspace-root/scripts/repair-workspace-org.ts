#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";

interface Options {
  name?: string;
  domain?: string;
  ownerEmail?: string;
  a2aSecret?: string;
  envPath: string;
  setDispatchDefaultOwner: boolean;
}

const HELP = `Usage:
  pnpm repair:workspace-org -- --name "Example Co" --domain example.com --owner-email owner@example.com

Options:
  --name <value>                 Sets WORKSPACE_ORG_NAME
  --domain <value>               Sets WORKSPACE_ORG_DOMAIN
  --owner-email <value>          Sets WORKSPACE_OWNER_EMAIL
  --a2a-secret <value>           Reads A2A_SECRET for validation
  --env <path>                   Env file to read for fallback values (default: .env)
  --force                        Accepted for compatibility; no file is written
  --dry-run                      Accepted for compatibility; no file is written
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
        break;
      case "--dry-run":
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
  const a2aSecret = firstValue(
    opts.a2aSecret,
    process.env.A2A_SECRET,
    current.A2A_SECRET,
  );

  if (!name) fail("--name or WORKSPACE_ORG_NAME is required.");
  if (!rawDomain) fail("--domain or WORKSPACE_ORG_DOMAIN is required.");
  if (!ownerEmail) fail("--owner-email or WORKSPACE_OWNER_EMAIL is required.");
  if (!a2aSecret) {
    fail(
      "--a2a-secret or A2A_SECRET is required. This script reads existing " +
        "configuration but does not write env files.",
    );
  }

  const domain = normalizeDomain(rawDomain);
  validateDomain(domain);
  validateEmail(ownerEmail);

  const desired: Record<RequiredKey, string> = {
    WORKSPACE_ORG_NAME: name,
    WORKSPACE_ORG_DOMAIN: domain,
    WORKSPACE_OWNER_EMAIL: ownerEmail,
    A2A_SECRET: a2aSecret,
  };

  const displayEntries: Array<[string, string]> = REQUIRED_KEYS.map((key) => [
    key,
    key === "A2A_SECRET" ? "[configured]" : desired[key],
  ]);
  if (opts.setDispatchDefaultOwner) {
    displayEntries.push(["DISPATCH_DEFAULT_OWNER_EMAIL", ownerEmail]);
  }

  console.log(
    `Validated workspace org settings from ${path.relative(process.cwd(), envPath) || envPath}.`,
  );
  console.log("No env files were written.");
  console.log("");
  console.log("Resolved configuration:");
  for (const [key, value] of displayEntries) {
    console.log(`- ${key}: ${value}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("1. Sign in as WORKSPACE_OWNER_EMAIL.");
  console.log("2. Create or select the org named by WORKSPACE_ORG_NAME.");
  console.log("3. Set the org allowed domain to WORKSPACE_ORG_DOMAIN.");
  console.log(
    "4. Configure A2A_SECRET through the scoped secret/deployment secret manager for apps that need cross-app A2A.",
  );
}

main();
