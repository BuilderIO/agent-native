import { createRequire } from "node:module";

import type { AgentHarnessAdapter } from "./types.js";

const require = createRequire(import.meta.url);

export interface AgentHarnessEntry {
  name: string;
  label: string;
  description: string;
  installPackage?: string;
  capabilities: AgentHarnessAdapter["capabilities"];
  create(config?: Record<string, unknown>): AgentHarnessAdapter;
}

const registry = new Map<string, AgentHarnessEntry>();
const packageAvailabilityCache = new Map<string, boolean>();

export function registerAgentHarness(entry: AgentHarnessEntry): void {
  if (registry.has(entry.name) && process.env.NODE_ENV !== "test") {
    console.warn(
      `[agent-harness] Harness "${entry.name}" is already registered. Skipping.`,
    );
    return;
  }
  registry.set(entry.name, entry);
}

export function getAgentHarnessEntry(
  name: string,
): AgentHarnessEntry | undefined {
  return registry.get(name);
}

export function listAgentHarnesses(): AgentHarnessEntry[] {
  return Array.from(registry.values());
}

export function resolveAgentHarness(
  name: string,
  config?: Record<string, unknown>,
): AgentHarnessAdapter {
  const entry = registry.get(name);
  if (!entry) {
    throw new Error(`[agent-harness] Unknown harness "${name}"`);
  }
  assertAgentHarnessPackagesInstalled(entry);
  return entry.create(config);
}

export function isAgentHarnessPackageInstalled(
  entry: Pick<AgentHarnessEntry, "installPackage">,
): boolean {
  const packages =
    entry.installPackage
      ?.split(/\s+/)
      .map(packageNameFromInstallSpecifier)
      .filter((name): name is string => Boolean(name)) ?? [];
  return packages.every(canResolvePackage);
}

function assertAgentHarnessPackagesInstalled(entry: AgentHarnessEntry): void {
  if (isAgentHarnessPackageInstalled(entry)) return;
  const hint = entry.installPackage
    ? ` Run: pnpm add ${entry.installPackage}`
    : "";
  throw new Error(
    `[agent-harness] Harness "${entry.name}" requires optional packages that are not installed in this app.${hint}`,
  );
}

function packageNameFromInstallSpecifier(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (!trimmed || trimmed.startsWith("-")) return null;
  if (trimmed.startsWith("@")) {
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex === -1) return trimmed;
    const versionIndex = trimmed.indexOf("@", slashIndex + 1);
    return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
  }
  const versionIndex = trimmed.indexOf("@");
  return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
}

function canResolvePackage(packageName: string): boolean {
  const cached = packageAvailabilityCache.get(packageName);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    require.resolve(packageName);
    available = true;
  } catch {
    available = false;
  }
  packageAvailabilityCache.set(packageName, available);
  return available;
}
