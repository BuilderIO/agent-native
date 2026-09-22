import { and, eq, isNull } from "drizzle-orm";

import { DEFAULT_GENERATION_PRESET_SEEDS } from "../../shared/generation-presets.js";
import { schema } from "../db/index.js";
import { stringifyJson } from "./json.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsertDb = any;

async function defaultTemplateId(
  ownerEmail: string,
  orgId: string | null | undefined,
  seedId: string,
) {
  const identity = new TextEncoder().encode(
    JSON.stringify([ownerEmail, orgId ?? null, seedId]),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", identity);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `default-template-${hash.slice(0, 32)}`;
}

export async function ensureDefaultTemplates({
  db,
  ownerEmail,
  orgId,
  now,
}: {
  db: InsertDb;
  ownerEmail: string;
  orgId: string | null | undefined;
  now: string;
}) {
  const existing = await db
    .select({ settings: schema.assetTemplates.settings })
    .from(schema.assetTemplates)
    .where(
      and(
        eq(schema.assetTemplates.ownerEmail, ownerEmail),
        orgId
          ? eq(schema.assetTemplates.orgId, orgId)
          : isNull(schema.assetTemplates.orgId),
        isNull(schema.assetTemplates.libraryId),
      ),
    );
  const existingSeedIds = new Set(
    existing.flatMap((row: { settings?: string | null }) => {
      const settings = JSON.parse(row.settings ?? "{}") as { seedId?: unknown };
      return typeof settings.seedId === "string" ? [settings.seedId] : [];
    }),
  );
  let sortOrder = 0;
  for (const preset of DEFAULT_GENERATION_PRESET_SEEDS) {
    if (existingSeedIds.has(preset.seedId)) continue;
    await db
      .insert(schema.assetTemplates)
      .values({
        id: await defaultTemplateId(ownerEmail, orgId, preset.seedId),
        libraryId: null,
        collectionId: null,
        title: preset.title,
        description: preset.description,
        category: preset.category,
        mediaType: "image",
        promptTemplate: preset.promptTemplate,
        aspectRatio: preset.aspectRatio,
        imageSize: preset.imageSize,
        model: preset.model,
        textPolicy: preset.textPolicy,
        referencePolicy: preset.referencePolicy,
        settings: stringifyJson({
          ...preset.settings,
          seedId: preset.seedId,
          source: "default-generation-preset",
        }),
        sortOrder,
        ownerEmail,
        orgId: orgId ?? null,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    sortOrder += 10;
  }
}

export async function ensureDefaultTemplatesForScopes({
  db,
  scopes,
  now,
}: {
  db: InsertDb;
  scopes: Array<{ ownerEmail?: unknown; orgId?: unknown }>;
  now: string;
}) {
  const seen = new Set<string>();
  for (const scope of scopes) {
    const ownerEmail =
      typeof scope.ownerEmail === "string" ? scope.ownerEmail.trim() : "";
    if (!ownerEmail || ownerEmail === "migration-orphan@invalid.local")
      continue;
    const orgId =
      typeof scope.orgId === "string" && scope.orgId ? scope.orgId : null;
    const key = JSON.stringify([ownerEmail, orgId]);
    if (seen.has(key)) continue;
    seen.add(key);
    await ensureDefaultTemplates({ db, ownerEmail, orgId, now });
  }
}

export function applyPromptTemplate(
  template: string | null | undefined,
  prompt: string,
) {
  const trimmed = prompt.trim();
  const source = template?.trim();
  if (!source) return trimmed;
  if (source.includes("{{prompt}}") || source.includes("{{topic}}")) {
    return source
      .split("{{prompt}}")
      .join(trimmed)
      .split("{{topic}}")
      .join(trimmed);
  }
  return `${source}\n\nUser request:\n${trimmed}`;
}
