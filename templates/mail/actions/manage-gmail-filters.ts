import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import {
  gmailCreateFilter,
  gmailCreateLabel,
  gmailDeleteFilter,
  gmailGetFilter,
  gmailListFilters,
  gmailListLabels,
  type GmailFilter,
  type GmailFilterAction,
  type GmailFilterCriteria,
} from "../server/lib/google-api.js";
import { getAccessTokens } from "./helpers.js";

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return value;
}, z.boolean().optional());

const criteriaSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  query: z.string().optional(),
  negatedQuery: z.string().optional(),
  hasAttachment: z.boolean().optional(),
  excludeChats: z.boolean().optional(),
  size: z.number().int().positive().optional(),
  sizeComparison: z.enum(["smaller", "larger", "unspecified"]).optional(),
});

const filterActionSchema = z.object({
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
  forward: z.string().optional(),
});

const schema = z.object({
  operation: z
    .enum(["list", "get", "create", "replace", "delete"])
    .default("list")
    .describe(
      "Filter operation. Use replace to edit: Gmail has no update endpoint, so the action creates a replacement and deletes the old filter.",
    ),
  account: z
    .string()
    .optional()
    .describe(
      "Connected Gmail account email. Required for create when multiple accounts are connected.",
    ),
  id: z
    .string()
    .optional()
    .describe("Gmail filter ID for get, replace, or delete"),
  from: z.string().optional().describe("Match sender"),
  to: z.string().optional().describe("Match recipient"),
  subject: z.string().optional().describe("Match subject text"),
  query: z
    .string()
    .optional()
    .describe(
      "Gmail advanced search query, such as from:alerts@example.com older_than:7d",
    ),
  negatedQuery: z
    .string()
    .optional()
    .describe("Gmail search query that must not match"),
  hasAttachment: optionalBoolean.describe(
    "Only match messages with attachments",
  ),
  excludeChats: optionalBoolean.describe("Exclude chat messages"),
  size: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Message size in bytes"),
  sizeComparison: z
    .enum(["smaller", "larger", "unspecified"])
    .optional()
    .describe("How to compare the size field"),
  criteriaJson: z
    .string()
    .optional()
    .describe("Advanced: exact Gmail Filter.criteria JSON"),
  replaceCriteria: optionalBoolean.describe(
    "For replace, rebuild criteria from provided fields instead of merging into the existing criteria",
  ),
  archive: optionalBoolean.describe(
    "Remove INBOX so matching messages skip the inbox",
  ),
  markRead: optionalBoolean.describe("Remove UNREAD from matching messages"),
  neverSpam: optionalBoolean.describe("Remove SPAM from matching messages"),
  neverImportant: optionalBoolean.describe(
    "Remove IMPORTANT from matching messages",
  ),
  important: optionalBoolean.describe("Add IMPORTANT to matching messages"),
  starred: optionalBoolean.describe("Add STARRED to matching messages"),
  trash: optionalBoolean.describe("Add TRASH to matching messages"),
  label: z
    .string()
    .optional()
    .describe(
      "Label name or ID to apply. One user label is allowed per Gmail filter.",
    ),
  createLabel: optionalBoolean.describe(
    "Create the label if it does not exist",
  ),
  addLabelIds: z
    .string()
    .optional()
    .describe("Comma-separated Gmail label IDs to add"),
  removeLabelIds: z
    .string()
    .optional()
    .describe("Comma-separated Gmail label IDs to remove"),
  forward: z
    .string()
    .optional()
    .describe("Forward matching messages to a verified forwarding address"),
  filterActionJson: z
    .string()
    .optional()
    .describe("Advanced: exact Gmail Filter.action JSON"),
  replaceAction: optionalBoolean.describe(
    "For replace, rebuild actions from provided fields instead of merging into the existing action",
  ),
});

type Args = z.infer<typeof schema>;

type ConnectedAccount = {
  email: string;
  accessToken: string;
};

type GmailLabelInfo = {
  id: string;
  name: string;
  type?: string;
};

const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  UNREAD: "Unread",
  SPAM: "Spam",
  IMPORTANT: "Important",
  STARRED: "Starred",
  TRASH: "Trash",
};

const CRITERIA_KEYS = [
  "from",
  "to",
  "subject",
  "query",
  "negatedQuery",
  "hasAttachment",
  "excludeChats",
  "size",
  "sizeComparison",
] as const satisfies readonly (keyof Args)[];

const ACTION_KEYS = [
  "archive",
  "markRead",
  "neverSpam",
  "neverImportant",
  "important",
  "starred",
  "trash",
  "label",
  "addLabelIds",
  "removeLabelIds",
  "forward",
] as const satisfies readonly (keyof Args)[];

function parseJson<T>(value: string, name: string, parser: z.ZodType<T>): T {
  try {
    return parser.parse(JSON.parse(value));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${name} must be valid JSON: ${detail}`);
  }
}

function hasAny(args: Args, keys: readonly (keyof Args)[]): boolean {
  return keys.some((key) => args[key] !== undefined);
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanCriteria(criteria: GmailFilterCriteria): GmailFilterCriteria {
  const cleaned: GmailFilterCriteria = {};
  for (const [key, value] of Object.entries(criteria)) {
    if (value === undefined || value === "") continue;
    (cleaned as Record<string, unknown>)[key] = value;
  }
  return cleaned;
}

function cleanAction(action: GmailFilterAction): GmailFilterAction {
  const addLabelIds = [...new Set(action.addLabelIds ?? [])].filter(Boolean);
  const removeLabelIds = [...new Set(action.removeLabelIds ?? [])].filter(
    Boolean,
  );
  const cleaned: GmailFilterAction = {};
  if (addLabelIds.length > 0) cleaned.addLabelIds = addLabelIds;
  if (removeLabelIds.length > 0) cleaned.removeLabelIds = removeLabelIds;
  if (trimString(action.forward)) cleaned.forward = action.forward?.trim();
  return cleaned;
}

function isEmptyObject(value: object): boolean {
  return Object.keys(value).length === 0;
}

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addLabel(action: GmailFilterAction, labelId: string): void {
  const add = new Set(action.addLabelIds ?? []);
  add.add(labelId);
  action.addLabelIds = [...add];
}

function removeAddedLabel(action: GmailFilterAction, labelId: string): void {
  action.addLabelIds = (action.addLabelIds ?? []).filter(
    (id) => id !== labelId,
  );
}

function removeLabel(action: GmailFilterAction, labelId: string): void {
  const remove = new Set(action.removeLabelIds ?? []);
  remove.add(labelId);
  action.removeLabelIds = [...remove];
}

function stopRemovingLabel(action: GmailFilterAction, labelId: string): void {
  action.removeLabelIds = (action.removeLabelIds ?? []).filter(
    (id) => id !== labelId,
  );
}

function applyRemoveFlag(
  action: GmailFilterAction,
  value: boolean | undefined,
  labelId: string,
): void {
  if (value === true) removeLabel(action, labelId);
  if (value === false) stopRemovingLabel(action, labelId);
}

function applyAddFlag(
  action: GmailFilterAction,
  value: boolean | undefined,
  labelId: string,
): void {
  if (value === true) addLabel(action, labelId);
  if (value === false) removeAddedLabel(action, labelId);
}

function labelDisplayName(
  labelId: string,
  labels: Map<string, GmailLabelInfo>,
) {
  return labels.get(labelId)?.name ?? SYSTEM_LABEL_NAMES[labelId] ?? labelId;
}

function labelType(labelId: string, labels: Map<string, GmailLabelInfo>) {
  return (
    labels.get(labelId)?.type ??
    (SYSTEM_LABEL_NAMES[labelId] ? "system" : undefined)
  );
}

function summarizeCriteria(criteria: GmailFilterCriteria = {}): string {
  const parts: string[] = [];
  if (criteria.from) parts.push(`from ${criteria.from}`);
  if (criteria.to) parts.push(`to ${criteria.to}`);
  if (criteria.subject) parts.push(`subject contains "${criteria.subject}"`);
  if (criteria.query) parts.push(`query "${criteria.query}"`);
  if (criteria.negatedQuery) parts.push(`not "${criteria.negatedQuery}"`);
  if (criteria.hasAttachment) parts.push("has attachment");
  if (criteria.excludeChats) parts.push("excludes chats");
  if (criteria.size && criteria.sizeComparison) {
    parts.push(`${criteria.sizeComparison} than ${criteria.size} bytes`);
  }
  return parts.join(", ") || "No criteria";
}

function summarizeAction(
  action: GmailFilterAction = {},
  labels: Map<string, GmailLabelInfo>,
): string {
  const parts: string[] = [];
  const add = new Set(action.addLabelIds ?? []);
  const remove = new Set(action.removeLabelIds ?? []);
  if (remove.has("INBOX")) parts.push("Archive");
  if (remove.has("UNREAD")) parts.push("Mark read");
  if (remove.has("SPAM")) parts.push("Never spam");
  if (remove.has("IMPORTANT")) parts.push("Never important");
  if (add.has("IMPORTANT")) parts.push("Mark important");
  if (add.has("STARRED")) parts.push("Star");
  if (add.has("TRASH")) parts.push("Trash");
  for (const labelId of add) {
    if (["IMPORTANT", "STARRED", "TRASH"].includes(labelId)) continue;
    parts.push(`Label: ${labelDisplayName(labelId, labels)}`);
  }
  for (const labelId of remove) {
    if (["INBOX", "UNREAD", "SPAM", "IMPORTANT"].includes(labelId)) continue;
    parts.push(`Remove label: ${labelDisplayName(labelId, labels)}`);
  }
  if (action.forward) parts.push(`Forward to ${action.forward}`);
  return parts.join(", ") || "No action";
}

function buildCriteria(
  args: Args,
  existing?: GmailFilterCriteria,
): GmailFilterCriteria {
  if (args.criteriaJson) {
    return cleanCriteria(
      parseJson(args.criteriaJson, "criteriaJson", criteriaSchema),
    );
  }

  const next: GmailFilterCriteria = {
    ...(!args.replaceCriteria && existing ? existing : {}),
  };
  for (const key of CRITERIA_KEYS) {
    const value = args[key];
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return cleanCriteria(next);
}

async function loadLabelMap(
  accessToken: string,
): Promise<Map<string, GmailLabelInfo>> {
  const res = await gmailListLabels(accessToken);
  const labels = new Map<string, GmailLabelInfo>();
  for (const label of res.labels ?? []) {
    if (!label.id) continue;
    labels.set(label.id, {
      id: label.id,
      name: label.name ?? label.id,
      type: label.type,
    });
  }
  for (const [id, name] of Object.entries(SYSTEM_LABEL_NAMES)) {
    if (!labels.has(id)) labels.set(id, { id, name, type: "system" });
  }
  return labels;
}

async function resolveLabelId(
  accessToken: string,
  labels: Map<string, GmailLabelInfo>,
  input: string,
  createIfMissing: boolean,
): Promise<string> {
  const wanted = input.trim();
  const systemId = wanted.toUpperCase().replace(/\s+/g, "_");
  if (SYSTEM_LABEL_NAMES[systemId]) return systemId;

  for (const label of labels.values()) {
    if (
      label.id === wanted ||
      label.name.toLowerCase() === wanted.toLowerCase()
    ) {
      return label.id;
    }
  }

  if (!createIfMissing) {
    throw new Error(
      `Gmail label "${wanted}" was not found. Pass createLabel=true to create it.`,
    );
  }

  const created = await gmailCreateLabel(accessToken, wanted);
  const id = created.id;
  if (!id) throw new Error(`Gmail did not return an ID for label "${wanted}".`);
  labels.set(id, {
    id,
    name: created.name ?? wanted,
    type: created.type ?? "user",
  });
  return id;
}

async function buildAction(
  args: Args,
  account: ConnectedAccount,
  labels: Map<string, GmailLabelInfo>,
  existing?: GmailFilterAction,
): Promise<GmailFilterAction> {
  if (args.filterActionJson) {
    return cleanAction(
      parseJson(args.filterActionJson, "filterActionJson", filterActionSchema),
    );
  }

  const next: GmailFilterAction = {
    addLabelIds: [
      ...(!args.replaceAction && existing ? (existing.addLabelIds ?? []) : []),
    ],
    removeLabelIds: [
      ...(!args.replaceAction && existing
        ? (existing.removeLabelIds ?? [])
        : []),
    ],
    forward: !args.replaceAction ? existing?.forward : undefined,
  };

  applyRemoveFlag(next, args.archive, "INBOX");
  applyRemoveFlag(next, args.markRead, "UNREAD");
  applyRemoveFlag(next, args.neverSpam, "SPAM");
  applyRemoveFlag(next, args.neverImportant, "IMPORTANT");
  applyAddFlag(next, args.important, "IMPORTANT");
  applyAddFlag(next, args.starred, "STARRED");
  applyAddFlag(next, args.trash, "TRASH");

  const label = trimString(args.label);
  if (label) {
    const id = await resolveLabelId(
      account.accessToken,
      labels,
      label,
      args.createLabel === true,
    );
    addLabel(next, id);
  }

  for (const id of splitCsv(args.addLabelIds)) addLabel(next, id);
  for (const id of splitCsv(args.removeLabelIds)) removeLabel(next, id);

  if (args.forward !== undefined) {
    next.forward = trimString(args.forward);
  }

  return cleanAction(next);
}

function enrichFilter(
  accountEmail: string,
  filter: GmailFilter,
  labels: Map<string, GmailLabelInfo>,
) {
  const action = filter.action ?? {};
  const actionLabels = [
    ...(action.addLabelIds ?? []).map((id) => ({
      id,
      name: labelDisplayName(id, labels),
      type: labelType(id, labels),
      operation: "add" as const,
    })),
    ...(action.removeLabelIds ?? []).map((id) => ({
      id,
      name: labelDisplayName(id, labels),
      type: labelType(id, labels),
      operation: "remove" as const,
    })),
  ];

  return {
    ...filter,
    id: filter.id ?? "",
    accountEmail,
    criteria: filter.criteria ?? {},
    action,
    criteriaSummary: summarizeCriteria(filter.criteria),
    actionSummary: summarizeAction(action, labels),
    actionLabels,
  };
}

function accountLabel(account: ConnectedAccount) {
  return `${account.email}`;
}

async function allAccounts(): Promise<ConnectedAccount[]> {
  const accounts = await getAccessTokens();
  if (accounts.length === 0) {
    throw new Error("No Google account connected. Connect Gmail first.");
  }
  return accounts;
}

function selectAccount(accounts: ConnectedAccount[], account?: string) {
  if (account) {
    const match = accounts.find(
      (item) => item.email.toLowerCase() === account.toLowerCase(),
    );
    if (!match) {
      throw new Error(
        `Google account ${account} is not connected. Connected: ${accounts.map(accountLabel).join(", ")}`,
      );
    }
    return match;
  }

  if (accounts.length > 1) {
    throw new Error(
      `Multiple Google accounts are connected. Pass account=<email>. Connected: ${accounts.map(accountLabel).join(", ")}`,
    );
  }

  return accounts[0];
}

async function findFilterTarget(
  accounts: ConnectedAccount[],
  id: string,
  account?: string,
): Promise<{ account: ConnectedAccount; filter: GmailFilter }> {
  if (account) {
    const selected = selectAccount(accounts, account);
    const filter = await gmailGetFilter(selected.accessToken, id);
    return { account: selected, filter };
  }

  const matches: Array<{ account: ConnectedAccount; filter: GmailFilter }> = [];
  for (const candidate of accounts) {
    const res = (await gmailListFilters(candidate.accessToken)) ?? {};
    const found = (res.filter ?? []).find((filter) => filter.id === id);
    if (found) matches.push({ account: candidate, filter: found });
  }

  if (matches.length === 0)
    throw new Error(`Gmail filter ${id} was not found.`);
  if (matches.length > 1) {
    throw new Error(
      `Filter ID ${id} exists in multiple accounts. Pass account=<email>. Matches: ${matches.map((m) => m.account.email).join(", ")}`,
    );
  }
  return matches[0];
}

async function signalRefresh() {
  await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {});
}

export default defineAction({
  description:
    "List, create, edit, or delete native Gmail filters. Use this for simple deterministic Gmail rules, such as auto-archive from a sender or query, instead of AI automations.",
  schema,
  run: async (args) => {
    const accounts = await allAccounts();

    if (args.operation === "list") {
      const selectedAccounts = args.account
        ? [selectAccount(accounts, args.account)]
        : accounts;
      const accountResults = [];

      for (const account of selectedAccounts) {
        const labels = await loadLabelMap(account.accessToken);
        const res = (await gmailListFilters(account.accessToken)) ?? {};
        accountResults.push({
          accountEmail: account.email,
          filters: (res.filter ?? []).map((filter) =>
            enrichFilter(account.email, filter, labels),
          ),
        });
      }

      return {
        ok: true,
        accounts: accountResults,
        total: accountResults.reduce(
          (count, account) => count + account.filters.length,
          0,
        ),
      };
    }

    if (args.operation === "get") {
      if (!args.id) throw new Error("id is required for get.");
      const target = await findFilterTarget(accounts, args.id, args.account);
      const labels = await loadLabelMap(target.account.accessToken);
      return {
        ok: true,
        accountEmail: target.account.email,
        filter: enrichFilter(target.account.email, target.filter, labels),
      };
    }

    if (args.operation === "delete") {
      if (!args.id) throw new Error("id is required for delete.");
      const target = await findFilterTarget(accounts, args.id, args.account);
      await gmailDeleteFilter(target.account.accessToken, args.id);
      await signalRefresh();
      return {
        ok: true,
        message: `Deleted Gmail filter ${args.id} from ${target.account.email}.`,
        accountEmail: target.account.email,
        deletedId: args.id,
      };
    }

    if (args.operation === "create") {
      const account = selectAccount(accounts, args.account);
      const labels = await loadLabelMap(account.accessToken);
      const criteria = buildCriteria(args);
      const action = await buildAction(args, account, labels);
      if (isEmptyObject(criteria)) {
        throw new Error(
          "At least one criterion is required: from, to, subject, query, negatedQuery, hasAttachment, or size.",
        );
      }
      if (isEmptyObject(action)) {
        throw new Error(
          "At least one action is required: archive, markRead, label, starred, trash, important, neverSpam, neverImportant, forward, addLabelIds, or removeLabelIds.",
        );
      }

      const created = await gmailCreateFilter(account.accessToken, {
        criteria,
        action,
      });
      await signalRefresh();
      return {
        ok: true,
        message: `Created Gmail filter ${created.id} in ${account.email}.`,
        accountEmail: account.email,
        filter: enrichFilter(account.email, created, labels),
      };
    }

    if (args.operation === "replace") {
      if (!args.id) throw new Error("id is required for replace.");
      if (
        !args.criteriaJson &&
        !args.filterActionJson &&
        !hasAny(args, CRITERIA_KEYS) &&
        !hasAny(args, ACTION_KEYS)
      ) {
        throw new Error(
          "No replacement fields were provided. Pass criteria/action fields to edit the filter.",
        );
      }

      const target = await findFilterTarget(accounts, args.id, args.account);
      const labels = await loadLabelMap(target.account.accessToken);
      const criteria = buildCriteria(args, target.filter.criteria);
      const action = await buildAction(
        args,
        target.account,
        labels,
        target.filter.action,
      );

      if (isEmptyObject(criteria)) {
        throw new Error(
          "The replacement filter must have at least one criterion.",
        );
      }
      if (isEmptyObject(action)) {
        throw new Error(
          "The replacement filter must have at least one action.",
        );
      }

      const created = await gmailCreateFilter(target.account.accessToken, {
        criteria,
        action,
      });
      await gmailDeleteFilter(target.account.accessToken, args.id);
      await signalRefresh();

      return {
        ok: true,
        message: `Replaced Gmail filter ${args.id} with ${created.id} in ${target.account.email}.`,
        accountEmail: target.account.email,
        deletedId: args.id,
        filter: enrichFilter(target.account.email, created, labels),
      };
    }

    throw new Error(`Unknown operation ${args.operation}.`);
  },
});
