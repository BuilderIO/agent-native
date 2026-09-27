import { fail } from "@agent-native/core/action";
import {
  getJevContextCredentials,
  isJevEnabled,
} from "@agent-native/core/server";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { resolvePinnedLabels } from "../../app/lib/inbox-tabs.js";
import {
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  normalizedAiFilterLabelId,
} from "../../shared/ai-filter-rules.js";
import { AI_FILTER_LABEL } from "../../shared/ai-filter.js";
import type {
  AutomationAction,
  AutomationRule,
  Label,
} from "../../shared/types.js";
import { db, schema } from "../db/index.js";
import { buildLabelCache, ensureGmailLabel } from "./automation-actions.js";
import { getClientsWithErrors, isConnected } from "./google-auth.js";
import { readCachedLabels } from "./inbox-store.js";
import { normalizeMailSettings } from "./mail-settings.js";

function aiTagLabel(
  domain: string,
  kind: string | undefined,
  actions: AutomationAction[],
): string | null {
  if (domain !== "mail" || kind !== "ai-filter") return null;
  const rule = { actions };
  if (aiFilterRuleMode(rule) !== "tag") return null;
  return aiFilterRuleLabelName(rule).trim() || null;
}

async function existingAiFilterRuleState(ownerEmail: string): Promise<{
  tagLabelIds: Set<string>;
  hasFilteredRule: boolean;
}> {
  const rules = await db
    .select()
    .from(schema.automationRules)
    .where(eq(schema.automationRules.ownerEmail, ownerEmail));
  const tagLabelIds = new Set<string>();
  let hasFilteredRule = false;
  for (const rule of rules as any[]) {
    const actions = JSON.parse(rule.actions) as AutomationAction[];
    const mode = aiFilterRuleMode({ actions });
    if (rule.domain === "mail" && rule.kind === "ai-filter") {
      hasFilteredRule ||= mode === "filtered";
    }
    const labelName = aiTagLabel(rule.domain, rule.kind, actions);
    if (labelName) tagLabelIds.add(normalizedAiFilterLabelId(labelName));
  }
  return { tagLabelIds, hasFilteredRule };
}

function labelsFromSetting(value: unknown): Label[] {
  const labels = (value as { labels?: unknown } | null)?.labels;
  return Array.isArray(labels)
    ? labels.filter(
        (label): label is Label =>
          !!label &&
          typeof label === "object" &&
          typeof (label as Label).id === "string" &&
          typeof (label as Label).name === "string",
      )
    : [];
}

async function reconcileAiTagPins(
  ownerEmail: string,
  changedLabels: string[],
  newlyAddedLabels: string[] = [],
  autoPinFilteredView = false,
): Promise<void> {
  const [rules, storedLabels, cachedLabels, googleConnected] =
    await Promise.all([
      db
        .select()
        .from(schema.automationRules)
        .where(eq(schema.automationRules.ownerEmail, ownerEmail)),
      getUserSetting(ownerEmail, "labels"),
      readCachedLabels(ownerEmail).then((result) => result.labels),
      isConnected(ownerEmail),
    ]);
  const knownLabels = [...cachedLabels, ...labelsFromSetting(storedLabels)];
  const tags = new Map<string, string>();
  for (const rule of rules as any[]) {
    const labelName = aiTagLabel(
      rule.domain,
      rule.kind,
      JSON.parse(rule.actions) as AutomationAction[],
    );
    if (labelName) tags.set(normalizedAiFilterLabelId(labelName), labelName);
  }

  const aliasesFor = (labelName: string): Set<string> => {
    const normalized = normalizedAiFilterLabelId(labelName);
    const aliases = new Set([normalized, labelName.trim()]);
    for (const label of knownLabels) {
      if (normalizedAiFilterLabelId(label.name) === normalized) {
        aliases.add(label.id);
        aliases.add(label.name);
      }
    }
    return new Set([...aliases].map(normalizedAiFilterLabelId));
  };

  const canonicalId = (labelName: string): string => {
    const normalized = normalizedAiFilterLabelId(labelName);
    return (
      knownLabels.find(
        (label) => normalizedAiFilterLabelId(label.name) === normalized,
      )?.id ?? normalized
    );
  };

  await mutateUserSetting(ownerEmail, "mail-settings", (current) => {
    const settings = normalizeMailSettings(current, ownerEmail);
    const pinned = [
      ...new Set(resolvePinnedLabels(settings.pinnedLabels, googleConnected)),
    ];
    const newLabelIds = new Set(
      newlyAddedLabels.map(normalizedAiFilterLabelId),
    );
    for (const labelName of [...new Set(changedLabels)]) {
      const normalized = normalizedAiFilterLabelId(labelName);
      const aliases = aliasesFor(labelName);
      const isRuleBacked = tags.has(normalized);
      if (!isRuleBacked) {
        for (let index = pinned.length - 1; index >= 0; index -= 1) {
          if (aliases.has(normalizedAiFilterLabelId(pinned[index]))) {
            pinned.splice(index, 1);
          }
        }
        continue;
      }
      if (
        newLabelIds.has(normalized) &&
        !pinned.some((id) => aliases.has(normalizedAiFilterLabelId(id)))
      ) {
        pinned.push(canonicalId(tags.get(normalized)!));
      }
    }
    const filteredAliases = aliasesFor(AI_FILTER_LABEL);
    const existingPinIndex = pinned.findIndex((id) =>
      filteredAliases.has(normalizedAiFilterLabelId(id)),
    );
    if (existingPinIndex !== -1) {
      pinned[existingPinIndex] = AI_FILTER_LABEL;
      for (
        let index = pinned.length - 1;
        index > existingPinIndex;
        index -= 1
      ) {
        if (filteredAliases.has(normalizedAiFilterLabelId(pinned[index]))) {
          pinned.splice(index, 1);
        }
      }
    } else if (autoPinFilteredView) {
      pinned.push(AI_FILTER_LABEL);
    }
    return { ...settings, pinnedLabels: pinned } as unknown as Record<
      string,
      unknown
    >;
  });
}

async function ensureAiTagLabelExists(
  ownerEmail: string,
  labelName: string,
): Promise<void> {
  const { clients, errors } = await getClientsWithErrors(ownerEmail);
  if (clients.length === 0 && errors.length > 0) {
    throw new Error(
      `Unable to create the Mail tag label: ${errors.map((error) => error.error).join("; ")}`,
    );
  }
  if (clients.length === 0) {
    await mutateUserSetting(ownerEmail, "labels", (current) => {
      const labels = labelsFromSetting(current);
      if (
        labels.some(
          (label) =>
            normalizedAiFilterLabelId(label.name) ===
            normalizedAiFilterLabelId(labelName),
        )
      ) {
        return { labels };
      }
      const id = normalizedAiFilterLabelId(labelName);
      return {
        labels: [...labels, { id, name: labelName, type: "user" }],
      };
    });
    return;
  }

  await Promise.all(
    clients.map(async (client) => {
      const cache = await buildLabelCache(client.accessToken);
      await ensureGmailLabel(client.accessToken, labelName, cache);
    }),
  );
}

function assertAiFilterActions(actions: AutomationAction[]): void {
  if (!aiFilterRuleMode({ actions })) {
    failInvalidAiFilterActions();
  }
}

function failInvalidAiFilterActions(): never {
  fail("AI filter rules can only add a label or archive a conversation.", {
    errorCode: "invalid_ai_filter_actions",
    statusCode: 400,
  });
}

export async function assertMailJevEnabled(ownerEmail: string): Promise<void> {
  const credentials = await getJevContextCredentials(ownerEmail);
  if (!(await isJevEnabled(credentials))) {
    fail("Jev is not enabled for this account.", {
      errorCode: "jev_not_enabled",
      statusCode: 403,
    });
  }
}

export function toApiRule(row: any): AutomationRule {
  const kind = row.kind ?? "automation";
  if (kind !== "automation" && kind !== "ai-filter") {
    throw new Error(`Unknown automation rule kind: ${kind}`);
  }
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  const toDate = (value: number) =>
    new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString();
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    domain: row.domain,
    kind,
    name: row.name,
    condition: row.condition,
    actions: JSON.parse(row.actions),
    enabled: row.enabled === 1 || row.enabled === true || row.enabled === "1",
    createdAt: toDate(createdAt),
    updatedAt: toDate(updatedAt),
  };
}

function ownedRule(ownerEmail: string, id: string) {
  return and(
    eq(schema.automationRules.id, id),
    eq(schema.automationRules.ownerEmail, ownerEmail),
  );
}

export async function listAutomationRules(
  ownerEmail: string,
  ruleId?: string,
): Promise<AutomationRule[]> {
  const rules = await db
    .select()
    .from(schema.automationRules)
    .where(
      ruleId
        ? and(
            eq(schema.automationRules.ownerEmail, ownerEmail),
            eq(schema.automationRules.id, ruleId),
          )
        : eq(schema.automationRules.ownerEmail, ownerEmail),
    );
  return rules.map(toApiRule);
}

export async function createAutomationRule(
  ownerEmail: string,
  input: {
    name: string;
    condition: string;
    actions: AutomationAction[];
    domain?: string;
    kind?: "automation" | "ai-filter";
    enabled?: boolean;
  },
  options: { deferJevAvailabilityCheck?: boolean } = {},
): Promise<AutomationRule> {
  const domain = input.domain ?? "mail";
  const kind = input.kind ?? "automation";
  let existingTagIds = new Set<string>();
  let hadFilteredRule = false;
  if (domain === "mail" && kind === "ai-filter") {
    if (!options.deferJevAvailabilityCheck) {
      await assertMailJevEnabled(ownerEmail);
    }
    assertAiFilterActions(input.actions);
    const tagLabel = aiTagLabel(domain, kind, input.actions);
    const mode = aiFilterRuleMode({ actions: input.actions });
    if (tagLabel || mode === "filtered") {
      const existingRules = await existingAiFilterRuleState(ownerEmail);
      existingTagIds = existingRules.tagLabelIds;
      hadFilteredRule = existingRules.hasFilteredRule;
    }
    if (tagLabel) await ensureAiTagLabelExists(ownerEmail, tagLabel);
  }
  const now = Math.floor(Date.now() / 1_000);
  const rule = {
    id: nanoid(12),
    ownerEmail,
    domain,
    kind,
    name: input.name,
    condition: input.condition,
    actions: JSON.stringify(input.actions),
    enabled: (input.enabled ?? true) ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.automationRules).values(rule as any);
  const result = toApiRule(rule);
  const tagLabel = aiTagLabel(result.domain, result.kind, result.actions);
  if (
    tagLabel ||
    (result.domain === "mail" &&
      result.kind === "ai-filter" &&
      aiFilterRuleMode(result) === "filtered")
  ) {
    await reconcileAiTagPins(
      ownerEmail,
      tagLabel ? [tagLabel] : [],
      tagLabel && !existingTagIds.has(normalizedAiFilterLabelId(tagLabel))
        ? [tagLabel]
        : [],
      !hadFilteredRule && aiFilterRuleMode(result) === "filtered",
    );
  }
  return result;
}

export async function updateAutomationRule(
  ownerEmail: string,
  id: string,
  patch: {
    name?: string;
    condition?: string;
    actions?: AutomationAction[];
    enabled?: boolean;
    domain?: string;
    kind?: "automation" | "ai-filter";
  },
  options: { deferJevAvailabilityCheck?: boolean } = {},
): Promise<AutomationRule> {
  const [existing] = await db
    .select()
    .from(schema.automationRules)
    .where(ownedRule(ownerEmail, id));
  if (!existing) throw new Error("Rule not found");

  const existingIsMailAiFilter =
    existing.domain === "mail" &&
    (existing.kind ?? "automation") === "ai-filter";
  const nextDomain = patch.domain ?? existing.domain;
  const nextKind = patch.kind ?? existing.kind ?? "automation";
  const disableOnly =
    Object.keys(patch).length === 1 && patch.enabled === false;
  const nextIsMailAiFilter = nextDomain === "mail" && nextKind === "ai-filter";
  if (
    (existingIsMailAiFilter || nextIsMailAiFilter) &&
    !disableOnly &&
    !options.deferJevAvailabilityCheck
  ) {
    await assertMailJevEnabled(ownerEmail);
  }
  const nextActions =
    patch.actions ?? (JSON.parse(existing.actions) as AutomationAction[]);
  if (nextIsMailAiFilter && !disableOnly) {
    assertAiFilterActions(nextActions);
  }
  const existingActions = JSON.parse(existing.actions) as AutomationAction[];
  const previousMode = aiFilterRuleMode({ actions: existingActions });
  const nextMode =
    nextIsMailAiFilter && aiFilterRuleMode({ actions: nextActions });
  const oldTagLabel = aiTagLabel(
    existing.domain,
    existing.kind,
    existingActions,
  );
  const nextTagLabel = aiTagLabel(nextDomain, nextKind, nextActions);
  const oldTagId = oldTagLabel ? normalizedAiFilterLabelId(oldTagLabel) : null;
  const nextTagId = nextTagLabel
    ? normalizedAiFilterLabelId(nextTagLabel)
    : null;
  const tagChanged = oldTagId !== nextTagId;
  const enteringFiltered =
    previousMode !== "filtered" && nextMode === "filtered";
  const existingRules =
    (nextTagLabel && tagChanged) || enteringFiltered
      ? await existingAiFilterRuleState(ownerEmail)
      : undefined;
  const existingTagIds = existingRules?.tagLabelIds ?? new Set<string>();
  if (nextTagLabel && tagChanged) {
    await ensureAiTagLabelExists(ownerEmail, nextTagLabel);
  }

  const updates: Record<string, any> = {
    updatedAt: Math.max(
      Math.floor(Date.now() / 1_000),
      Number(existing.updatedAt) + 1,
    ),
  };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.condition !== undefined) updates.condition = patch.condition;
  if (patch.actions !== undefined) {
    updates.actions = JSON.stringify(patch.actions);
  }
  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.domain !== undefined) updates.domain = patch.domain;
  if (patch.kind !== undefined) updates.kind = patch.kind;

  await db
    .update(schema.automationRules)
    .set(updates)
    .where(ownedRule(ownerEmail, id));

  const [updated] = await db
    .select()
    .from(schema.automationRules)
    .where(ownedRule(ownerEmail, id));

  if (!updated) throw new Error("Rule not found");
  const result = toApiRule(updated);
  const nextTag = aiTagLabel(result.domain, result.kind, result.actions);
  if (tagChanged || enteringFiltered) {
    await reconcileAiTagPins(
      ownerEmail,
      [oldTagLabel, nextTag].filter((label): label is string => label !== null),
      nextTag && !existingTagIds.has(normalizedAiFilterLabelId(nextTag))
        ? [nextTag]
        : [],
      enteringFiltered && !existingRules?.hasFilteredRule,
    );
  }
  return result;
}

export async function deleteAutomationRule(
  ownerEmail: string,
  id: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.automationRules)
    .where(ownedRule(ownerEmail, id));
  if (!existing) return;
  await db.delete(schema.automationRules).where(ownedRule(ownerEmail, id));
  const oldTag = aiTagLabel(
    existing.domain,
    existing.kind,
    JSON.parse(existing.actions) as AutomationAction[],
  );
  if (oldTag) await reconcileAiTagPins(ownerEmail, [oldTag]);
}

export async function consolidateAutomationRules(
  ownerEmail: string,
  input: {
    id: string;
    duplicateIds: string[];
    expectedRules: {
      id: string;
      name: string;
      condition: string;
      actions: AutomationAction[];
    }[];
    name: string;
    condition: string;
    actions: AutomationAction[];
  },
): Promise<boolean> {
  await assertMailJevEnabled(ownerEmail);
  assertAiFilterActions(input.actions);
  const ids = [input.id, ...input.duplicateIds];
  if (new Set(ids).size !== ids.length) return false;

  return db.transaction(async (tx: any) => {
    const matching = await tx
      .select({
        id: schema.automationRules.id,
        name: schema.automationRules.name,
        condition: schema.automationRules.condition,
        actions: schema.automationRules.actions,
      })
      .from(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.ownerEmail, ownerEmail),
          inArray(schema.automationRules.id, ids),
          eq(schema.automationRules.domain, "mail"),
          eq(schema.automationRules.kind, "ai-filter"),
          eq(schema.automationRules.enabled, 1),
        ),
      )
      .for("update");
    if (matching.length !== ids.length) return false;

    const expectedById = new Map(
      input.expectedRules.map((rule) => [rule.id, rule]),
    );
    if (
      expectedById.size !== ids.length ||
      ids.some((id) => !expectedById.has(id)) ||
      matching.some((rule: any) => {
        const expected = expectedById.get(rule.id);
        return (
          !expected ||
          expected.name !== rule.name ||
          expected.condition !== rule.condition ||
          JSON.stringify(expected.actions) !==
            JSON.stringify(JSON.parse(rule.actions))
        );
      })
    ) {
      return false;
    }

    const ownerRule = and(
      eq(schema.automationRules.ownerEmail, ownerEmail),
      eq(schema.automationRules.domain, "mail"),
      eq(schema.automationRules.kind, "ai-filter"),
      eq(schema.automationRules.enabled, 1),
    );
    const updated = await tx
      .update(schema.automationRules)
      .set({
        name: input.name,
        condition: input.condition,
        actions: JSON.stringify(input.actions),
        updatedAt: Math.floor(Date.now() / 1_000),
      })
      .where(and(ownerRule, eq(schema.automationRules.id, input.id)))
      .returning({ id: schema.automationRules.id });
    if (updated.length !== 1) {
      throw new Error("Prompt rule changed during consolidation");
    }

    if (input.duplicateIds.length) {
      const deleted = await tx
        .delete(schema.automationRules)
        .where(
          and(
            ownerRule,
            inArray(schema.automationRules.id, input.duplicateIds),
          ),
        )
        .returning({ id: schema.automationRules.id });
      if (deleted.length !== input.duplicateIds.length) {
        throw new Error("Duplicate prompt rules changed during consolidation");
      }
    }

    return true;
  });
}
