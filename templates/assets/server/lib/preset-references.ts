import {
  PRESET_REFERENCE_ROLES,
  type ImageRole,
  type PresetReference,
  type PresetReferenceRole,
} from "../../shared/api.js";

export const PRESET_REFERENCE_MAX_ENTRIES = 6;
export const PRESET_REFERENCE_MAX_IMAGES_PER_ENTRY = 4;
export const PRESET_REFERENCE_MAX_TOTAL_IMAGES = 8;
export const PRESET_REFERENCE_MAX_SUBJECT_IMAGES = 4;
export const PRESET_REFERENCE_TOTAL_IMAGES_ERROR =
  "The reference board may attach at most 8 images total.";
export const PRESET_REFERENCE_SUBJECT_IMAGES_ERROR =
  "Subject reference entries may attach at most 4 images total.";

export const PRESET_REFERENCE_ROLE_MAP: Record<PresetReferenceRole, ImageRole> =
  {
    subject: "subject_reference",
    style: "style_reference",
    product: "product_reference",
    background: "background_reference",
    composition: "background_reference",
  };

const ROLE_SET = new Set<string>(PRESET_REFERENCE_ROLES);
const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function normalizePresetReferences(value: unknown): PresetReference[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const seenIds = new Set<string>();
  const entries: PresetReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const role = raw.role;
    if (
      !id ||
      !ENTRY_ID_RE.test(id) ||
      id.length > 40 ||
      seenIds.has(id) ||
      !label ||
      label.length > 60 ||
      typeof role !== "string" ||
      !ROLE_SET.has(role)
    ) {
      continue;
    }
    seenIds.add(id);
    const description =
      typeof raw.description === "string"
        ? raw.description.trim().slice(0, 400)
        : undefined;
    const assetIds = Array.isArray(raw.assetIds)
      ? uniqueStrings(raw.assetIds).slice(
          0,
          PRESET_REFERENCE_MAX_IMAGES_PER_ENTRY,
        )
      : [];
    entries.push({
      id,
      label,
      role: role as PresetReferenceRole,
      ...(description ? { description } : {}),
      assetIds,
      variable: coerceBoolean(raw.variable),
      required: coerceBoolean(raw.required),
    });
    if (entries.length >= PRESET_REFERENCE_MAX_ENTRIES) break;
  }

  return trimToPinnedImageCaps(entries);
}

export type ResolvedPresetReference = {
  entry: PresetReference;
  assetIds: string[];
  filled: boolean;
};

export function resolvePresetReferenceFills(input: {
  entries: PresetReference[];
  fills?: Array<{ referenceId: string; assetIds: string[] }>;
  presetTitle: string;
}): ResolvedPresetReference[] {
  const byId = new Map(input.entries.map((entry) => [entry.id, entry]));
  const fillsById = new Map<string, string[]>();
  for (const fill of input.fills ?? []) {
    const entry = byId.get(fill.referenceId);
    if (!entry) {
      const available = input.entries.map((item) => item.id).join(", ");
      throw new Error(
        `Unknown reference entry "${fill.referenceId}" for preset "${input.presetTitle}". Available entries: ${available || "none"}.`,
      );
    }
    if (!entry.variable) {
      throw new Error(
        `Reference entry "${entry.id}" is fixed by the preset designer. Edit the preset to change it, or mark it as variable.`,
      );
    }
    const assetIds = uniqueStrings(fill.assetIds);
    if (assetIds.length > PRESET_REFERENCE_MAX_IMAGES_PER_ENTRY) {
      throw new Error(
        `Reference entry "${entry.id}" accepts at most 4 images; got ${assetIds.length}.`,
      );
    }
    fillsById.set(entry.id, assetIds);
  }

  const resolved = input.entries.map((entry) => {
    const hasFill = fillsById.has(entry.id);
    const assetIds = hasFill
      ? (fillsById.get(entry.id) ?? [])
      : uniqueStrings(entry.assetIds).slice(
          0,
          PRESET_REFERENCE_MAX_IMAGES_PER_ENTRY,
        );
    if (entry.required && assetIds.length === 0) {
      throw new Error(
        `Preset "${input.presetTitle}" requires image(s) for reference entry "${entry.label}" (${entry.id}). Pass them via presetReferenceFills (up to 4).`,
      );
    }
    return { entry, assetIds, filled: hasFill };
  });

  assertPresetReferenceImageCaps(resolved);
  return resolved.filter((item) => item.assetIds.length > 0);
}

export function assertPresetReferenceImageCaps(
  entries: Array<{ entry: Pick<PresetReference, "role">; assetIds: string[] }>,
) {
  const total = entries.reduce((sum, item) => sum + item.assetIds.length, 0);
  if (total > PRESET_REFERENCE_MAX_TOTAL_IMAGES) {
    throw new Error(PRESET_REFERENCE_TOTAL_IMAGES_ERROR);
  }
  const subjectTotal = entries
    .filter((item) => item.entry.role === "subject")
    .reduce((sum, item) => sum + item.assetIds.length, 0);
  if (subjectTotal > PRESET_REFERENCE_MAX_SUBJECT_IMAGES) {
    throw new Error(PRESET_REFERENCE_SUBJECT_IMAGES_ERROR);
  }
}

function trimToPinnedImageCaps(entries: PresetReference[]): PresetReference[] {
  const trimmed = [...entries];
  while (trimmed.length && exceedsPinnedImageCaps(trimmed)) {
    trimmed.pop();
  }
  return trimmed;
}

function exceedsPinnedImageCaps(entries: PresetReference[]) {
  const total = entries.reduce((sum, entry) => sum + entry.assetIds.length, 0);
  const subjectTotal = entries
    .filter((entry) => entry.role === "subject")
    .reduce((sum, entry) => sum + entry.assetIds.length, 0);
  return (
    total > PRESET_REFERENCE_MAX_TOTAL_IMAGES ||
    subjectTotal > PRESET_REFERENCE_MAX_SUBJECT_IMAGES
  );
}

function uniqueStrings(value: unknown[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}
