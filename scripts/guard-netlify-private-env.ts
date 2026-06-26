#!/usr/bin/env tsx

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { isForbiddenHostedTemplateEnvKey } from "./sync-template-netlify-env.js";

const FORBIDDEN_DEPLOY_KEY = "BUILDER_PRIVATE_KEY";

const mustReject = [
  "ANTHROPIC_API_KEY",
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
  "GOOGLE_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "SENDGRID_API_KEY",
  "SLACK_BOT_TOKEN",
];

const mustAllow = [
  "APP_URL",
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "GA_MEASUREMENT_ID",
  "GOOGLE_CLIENT_ID",
  "NETLIFY_DATABASE_URL",
  "VITE_NEON_AUTH_URL",
];

const failures: string[] = [];

for (const key of mustReject) {
  if (!isForbiddenHostedTemplateEnvKey(key)) {
    failures.push(`sync-template-netlify-env allows forbidden key ${key}`);
  }
}

for (const key of mustAllow) {
  if (isForbiddenHostedTemplateEnvKey(key)) {
    failures.push(`sync-template-netlify-env forbids deploy-safe key ${key}`);
  }
}

for (const file of collectDeployConfigFiles()) {
  const text = readFileSync(file, "utf8");
  if (text.includes(FORBIDDEN_DEPLOY_KEY)) {
    failures.push(
      `${path.relative(process.cwd(), file)} references ${FORBIDDEN_DEPLOY_KEY}`,
    );
  }
}

if (failures.length > 0) {
  console.error("guard-netlify-private-env failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "guard-netlify-private-env: clean (no Builder private key in Netlify deploy config).",
);

function collectDeployConfigFiles(): string[] {
  const files: string[] = [];
  collectNetlifyToml("templates", files);
  collectNetlifyToml("packages/docs", files);
  collectWorkflowYaml(".github/workflows", files);
  return files.sort();
}

function collectNetlifyToml(dir: string, out: string[]) {
  if (!existsDir(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".netlify") continue;
      collectNetlifyToml(fullPath, out);
    } else if (entry === "netlify.toml") {
      out.push(fullPath);
    }
  }
}

function collectWorkflowYaml(dir: string, out: string[]) {
  if (!existsDir(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) continue;
    if (entry.endsWith(".yml") || entry.endsWith(".yaml")) out.push(fullPath);
  }
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
