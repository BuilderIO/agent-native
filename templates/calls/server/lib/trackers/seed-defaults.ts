import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { nanoid } from "../calls.js";

export interface DefaultTrackerDef {
  name: string;
  description: string;
  kind: "keyword" | "smart";
  keywordsJson?: string;
  classifierPrompt?: string;
  isDefault: true;
  enabled: true;
}

export const DEFAULT_TRACKERS: DefaultTrackerDef[] = [
  {
    name: "Pricing",
    description:
      "Mentions of price, pricing, quotes, cost, discount, or budget.",
    kind: "keyword",
    keywordsJson: JSON.stringify([
      "price",
      "pricing",
      "quote",
      "cost",
      "discount",
      "budget",
    ]),
    isDefault: true,
    enabled: true,
  },
  {
    name: "Competitors",
    description:
      "Moments where a competing product, vendor, or tool is mentioned.",
    kind: "smart",
    classifierPrompt:
      "Does this paragraph mention a competing product, vendor, or tool — either by name or by a clear reference such as 'the other solution we looked at', 'our current tool', or 'what we use today'?",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Objections",
    description:
      "Moments where the prospect raises a concern, hesitation, or pushback.",
    kind: "smart",
    classifierPrompt:
      "Does this paragraph contain an objection, concern, hesitation, or pushback from the prospect — for example doubts about fit, timing, price, security, or team buy-in?",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Next Steps",
    description:
      "Commitments to a future action, meeting, deliverable, or follow-up.",
    kind: "smart",
    classifierPrompt:
      "Does this paragraph contain an explicit commitment to a future action, meeting, deliverable, or follow-up? Examples: 'I'll send the proposal tomorrow', 'let's meet Thursday', 'we'll loop in legal next week'.",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Budget",
    description:
      "Discussion of budget authority, spend approval, or purchasing power.",
    kind: "smart",
    classifierPrompt:
      "Does this paragraph discuss budget authority, purchasing power, or spend approval — who owns the budget, what the budget cap is, whether funds are approved, or who signs off on spend?",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Timing",
    description:
      "Timelines, deadlines, urgency, quarters, or renewal dates.",
    kind: "smart",
    classifierPrompt:
      "Does this paragraph reference a timeline, deadline, quarter, renewal date, or urgency signal — for example 'by end of Q2', 'we need this live before launch', 'our contract renews in March'?",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Filler words",
    description: "Common filler words and verbal tics.",
    kind: "keyword",
    keywordsJson: JSON.stringify([
      "um",
      "uh",
      "like",
      "you know",
      "basically",
      "actually",
    ]),
    isDefault: true,
    enabled: true,
  },
];

export async function seedDefaultTrackers(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  const db = getDb();

  const existing = await db
    .select({ name: schema.trackerDefinitions.name })
    .from(schema.trackerDefinitions)
    .where(eq(schema.trackerDefinitions.workspaceId, workspaceId));
  const existingNames = new Set(existing.map((r) => r.name));

  const now = new Date().toISOString();
  const rowsToInsert = DEFAULT_TRACKERS.filter(
    (t) => !existingNames.has(t.name),
  ).map((t) => ({
    id: nanoid(),
    workspaceId,
    name: t.name,
    description: t.description,
    kind: t.kind,
    keywordsJson: t.keywordsJson ?? "[]",
    classifierPrompt: t.classifierPrompt ?? null,
    color: "#111111",
    isDefault: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }));

  if (rowsToInsert.length === 0) return;
  await db.insert(schema.trackerDefinitions).values(rowsToInsert);
}

export async function seedDefaultTrackersIfEmpty(
  workspaceId: string,
): Promise<boolean> {
  if (!workspaceId) return false;
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.trackerDefinitions.id })
    .from(schema.trackerDefinitions)
    .where(
      and(
        eq(schema.trackerDefinitions.workspaceId, workspaceId),
        eq(schema.trackerDefinitions.isDefault, true),
      ),
    )
    .limit(1);
  if (existing) return false;
  await seedDefaultTrackers(workspaceId);
  return true;
}
