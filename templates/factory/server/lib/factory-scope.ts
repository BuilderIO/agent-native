import { and, eq, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { getDb } from "../db/index.js";
import {
  factoryDefinitions,
  factoryGraphVersions,
  triageConfig,
  triageDecisions,
  triageFeedback,
  triageItems,
  triageRules,
  triageRuns,
} from "../db/schema.js";
import { DEFAULT_FACTORY_ID } from "../factory-graph/store.js";

export { DEFAULT_FACTORY_ID };

export const factoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const builderSlackUserIdSchema = z
  .string()
  .trim()
  .max(32)
  .refine((value) => value === "" || /^[UW][A-Z0-9]+$/i.test(value), {
    message: "Builder Slack member id must look like U01234567.",
  });

export function factoryConfigRowId(orgId: string, factoryId: string): string {
  return `${orgId}:${factoryId}`;
}

const MAX_FACTORY_ID_LENGTH = 120;

export function slugifyFactoryId(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 100);
  const base =
    normalized && /^[a-z0-9]/.test(normalized)
      ? normalized
      : `factory-${normalized || "untitled"}`;
  return base.slice(0, MAX_FACTORY_ID_LENGTH);
}

export function factoryIdCandidateWithSuffix(
  base: string,
  suffix: number,
): string {
  const suffixText = `-${suffix}`;
  const maxBaseLength = MAX_FACTORY_ID_LENGTH - suffixText.length;
  return `${base.slice(0, maxBaseLength)}${suffixText}`;
}

export async function resolveUniqueFactoryId(
  db: Db,
  orgId: string,
  name: string,
): Promise<string> {
  const base = slugifyFactoryId(name);
  let candidate = base;
  let suffix = 2;
  while (await factoryIdTaken(db, orgId, candidate)) {
    candidate = factoryIdCandidateWithSuffix(base, suffix);
    suffix += 1;
  }
  return candidate;
}

async function factoryIdTaken(
  db: Db,
  orgId: string,
  factoryId: string,
): Promise<boolean> {
  const definition = (
    await db
      .select({ id: factoryDefinitions.id })
      .from(factoryDefinitions)
      .where(eq(factoryDefinitions.id, factoryId))
      .limit(1)
  )[0];
  if (definition) return true;

  const config = (
    await db
      .select({ factoryId: triageConfig.factoryId })
      .from(triageConfig)
      .where(
        and(
          eq(triageConfig.orgId, orgId),
          eq(triageConfig.factoryId, factoryId),
        ),
      )
      .limit(1)
  )[0];
  if (config) return true;

  const graphVersion = (
    await db
      .select({ factoryId: factoryGraphVersions.factoryId })
      .from(factoryGraphVersions)
      .where(
        and(
          eq(factoryGraphVersions.orgId, orgId),
          eq(factoryGraphVersions.factoryId, factoryId),
        ),
      )
      .limit(1)
  )[0];
  return Boolean(graphVersion);
}

export function legacyFactoryConfigRowId(orgId: string): string {
  return orgId;
}

/** Row id to use when persisting poll cursors — follows the loaded config row. */
export function triageConfigUpdateRowId(
  config: { id: string } | null | undefined,
  orgId: string,
  factoryId: string,
): string {
  return config?.id ?? factoryConfigRowId(orgId, factoryId);
}

type Db = ReturnType<typeof getDb>;

export async function readTriageConfigRow(
  db: Db,
  orgId: string,
  factoryId: string,
) {
  const scopedId = factoryConfigRowId(orgId, factoryId);
  const scoped = (
    await db
      .select()
      .from(triageConfig)
      .where(and(eq(triageConfig.id, scopedId), eq(triageConfig.orgId, orgId)))
      .limit(1)
  )[0];
  if (scoped) return scoped;
  if (factoryId !== DEFAULT_FACTORY_ID) return undefined;
  return (
    await db
      .select()
      .from(triageConfig)
      .where(
        and(
          eq(triageConfig.id, legacyFactoryConfigRowId(orgId)),
          eq(triageConfig.orgId, orgId),
        ),
      )
      .limit(1)
  )[0];
}

export function orgFactoryFilter(
  table: { orgId: AnyColumn; factoryId: AnyColumn },
  orgId: string,
  factoryId: string,
): SQL {
  return and(eq(table.orgId, orgId), eq(table.factoryId, factoryId))!;
}

export function orgFactoryItemFilter(orgId: string, factoryId: string): SQL {
  return orgFactoryFilter(triageItems, orgId, factoryId);
}

export function orgFactoryScopedItemWhere(
  itemId: string,
  orgId: string,
  factoryId: string,
): SQL {
  return and(
    eq(triageItems.id, itemId),
    orgFactoryItemFilter(orgId, factoryId),
  )!;
}

export function orgFactoryRuleFilter(orgId: string, factoryId: string): SQL {
  return orgFactoryFilter(triageRules, orgId, factoryId);
}

export function orgFactoryDecisionFilter(
  orgId: string,
  factoryId: string,
): SQL {
  return orgFactoryFilter(triageDecisions, orgId, factoryId);
}

export function orgFactoryRunFilter(orgId: string, factoryId: string): SQL {
  return orgFactoryFilter(triageRuns, orgId, factoryId);
}

export function orgFactoryFeedbackFilter(
  orgId: string,
  factoryId: string,
): SQL {
  return orgFactoryFilter(triageFeedback, orgId, factoryId);
}

export function resolveAutomationFactoryId(
  meta: Record<string, unknown> | object | undefined,
): string {
  const raw =
    meta && typeof meta === "object" && "factoryId" in meta
      ? (meta as { factoryId?: unknown }).factoryId
      : undefined;
  return typeof raw === "string" && raw.trim()
    ? raw.trim()
    : DEFAULT_FACTORY_ID;
}

function readFrontmatterFactoryId(content: string): string | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const match = content.slice(4, end).match(/^factoryId:\s*(.*)$/m);
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^(\"|')|((\"|')$)/g, "");
}

export function readAutomationFactoryId(
  meta: object,
  content: string,
  path: string,
): string {
  const fromPath = readFactoryIdFromAutomationPath(path);
  if (fromPath) return fromPath;
  const fromContent = readFrontmatterFactoryId(content);
  return resolveAutomationFactoryId(
    fromContent ? { ...meta, factoryId: fromContent } : meta,
  );
}

export function factoryAutomationJobPath(
  factoryId: string,
  automationName: string,
): string {
  if (factoryId === DEFAULT_FACTORY_ID) {
    return `jobs/${automationName}.md`;
  }
  return `jobs/factories/${factoryId}/${automationName}.md`;
}

export function legacyFactoryAutomationJobPath(automationName: string): string {
  return `jobs/${automationName}.md`;
}

export function isLegacyFactoryAutomationPath(path: string): boolean {
  return /^jobs\/factory-[^/]+\.md$/.test(path);
}

/** Scheduler trigger names keep the nested path; role allowlists use the leaf. */
export function factoryAutomationLeafName(nameOrPath: string): string {
  const withoutJobsPrefix = nameOrPath
    .replace(/^jobs\//, "")
    .replace(/\.md$/, "");
  const slash = withoutJobsPrefix.lastIndexOf("/");
  return slash === -1 ? withoutJobsPrefix : withoutJobsPrefix.slice(slash + 1);
}

export function readFactoryIdFromAutomationPath(path: string): string | null {
  const match = path.match(/^jobs\/factories\/([^/]+)\/factory-[^/]+\.md$/);
  return match?.[1] ?? null;
}

export async function findFactoryIdForSlackChannel(
  db: Db,
  orgId: string,
  channelId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      factoryId: triageConfig.factoryId,
      slackChannelId: triageConfig.slackChannelId,
    })
    .from(triageConfig)
    .where(
      and(
        eq(triageConfig.orgId, orgId),
        eq(triageConfig.slackChannelId, channelId),
      ),
    );
  const factoryIds = rows
    .map((row) => row.factoryId)
    .filter((value): value is string => Boolean(value?.trim()));
  if (factoryIds.length === 1) return factoryIds[0]!;
  return null;
}

export async function assertUniqueSlackChannelForFactory(
  db: Db,
  orgId: string,
  factoryId: string,
  channelId: string | null | undefined,
): Promise<void> {
  const normalized = channelId?.trim();
  if (!normalized) return;
  const conflict = (
    await db
      .select({ factoryId: triageConfig.factoryId })
      .from(triageConfig)
      .where(
        and(
          eq(triageConfig.orgId, orgId),
          eq(triageConfig.slackChannelId, normalized),
        ),
      )
  ).find((row) => row.factoryId !== factoryId);
  if (conflict) {
    throw new Error(
      "That Slack channel is already used by another Factory in this workspace.",
    );
  }
}

function readFrontmatterField(
  content: string,
  key: string,
): string | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const match = content
    .slice(4, end)
    .match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^(\"|')|((\"|')$)/g, "");
}

export function readAutomationDisplayName(content: string): string | null {
  const value = readFrontmatterField(content, "displayName")?.trim();
  return value || null;
}

export function resolveAutomationDisplayName(
  automationName: string,
  content: string,
): string {
  return readAutomationDisplayName(content) ?? automationName;
}

export function setAutomationFrontmatterField(
  content: string,
  key: string,
  value: string,
): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const trimmed = value.trim();
  const frontmatter = content.slice(4, end);
  const pattern = new RegExp(`^${key}:.*\\n?`, "m");
  if (!trimmed) {
    if (!pattern.test(frontmatter)) return content;
    const nextFrontmatter = frontmatter.replace(pattern, "").trimEnd();
    return nextFrontmatter
      ? `---\n${nextFrontmatter}${content.slice(end)}`
      : content;
  }
  if (pattern.test(frontmatter)) {
    return `---\n${frontmatter.replace(pattern, `${key}: ${trimmed}\n`)}${content.slice(end)}`;
  }
  return `${content.slice(0, end)}\n${key}: ${trimmed}${content.slice(end)}`;
}

export function replaceAutomationBody(content: string, body: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const trimmedBody = body.trim();
  return `${content.slice(0, end + 4)}\n${trimmedBody ? `${trimmedBody}\n` : ""}`;
}

export function patchAutomationResource(
  content: string,
  patch: {
    body?: string;
    enabled?: boolean;
    schedule?: string;
    model?: string | null;
    displayName?: string;
  },
): string {
  let next =
    patch.body === undefined
      ? content
      : replaceAutomationBody(content, patch.body);
  if (patch.enabled !== undefined) {
    next = setAutomationFrontmatterField(
      next,
      "enabled",
      patch.enabled ? "true" : "false",
    );
  }
  if (patch.schedule !== undefined) {
    next = setAutomationFrontmatterField(next, "schedule", patch.schedule);
  }
  if (patch.model !== undefined) {
    next = setAutomationFrontmatterField(
      next,
      "model",
      patch.model?.trim() ?? "",
    );
  }
  if (patch.displayName !== undefined) {
    next = setAutomationFrontmatterField(
      next,
      "displayName",
      patch.displayName,
    );
  }
  return next;
}

export function readAutomationEnabled(content: string): boolean {
  const value = readFrontmatterField(content, "enabled")?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export function readAutomationSchedule(content: string): string | null {
  return readFrontmatterField(content, "schedule")?.trim() || null;
}

export function readAutomationModel(content: string): string | null {
  return readFrontmatterField(content, "model")?.trim() || null;
}
