const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const SAFE_TOKEN = /^[\p{L}\p{N}][\p{L}\p{N} ._+\-/]{0,79}$/u;
const VOICE_DESCRIPTORS = new Set([
  "bold",
  "casual",
  "concise",
  "direct",
  "formal",
  "optimistic",
  "playful",
  "restrained",
  "technical",
  "warm",
]);

export interface PublishedBrandContextInput {
  profileId: string;
  dnaVersionId: string;
  colors?: unknown;
  fonts?: unknown;
  numericScales?: unknown;
  voiceDescriptors?: unknown;
  layoutPatterns?: unknown;
  logos?: unknown;
  terminology?: unknown;
  exclusions?: unknown;
  inventory?: unknown;
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return SAFE_TOKEN.test(normalized) ? normalized : null;
}

function stringArray(value: unknown, limit = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(safeToken)
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, limit);
}

function structuredColors(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const value = entry.toUpperCase();
        return HEX_COLOR.test(value) ? { value } : null;
      }
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const value =
        typeof record.value === "string" ? record.value.toUpperCase() : "";
      if (!HEX_COLOR.test(value)) return null;
      return {
        ...(safeToken(record.name) ? { name: safeToken(record.name) } : {}),
        ...(safeToken(record.role) ? { role: safeToken(record.role) } : {}),
        value,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 40);
}

function structuredFonts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const family = safeToken(entry);
        return family ? { family } : null;
      }
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const family = safeToken(record.family);
      if (!family) return null;
      const weight = Number(record.weight);
      return {
        family,
        ...(safeToken(record.role) ? { role: safeToken(record.role) } : {}),
        ...(Number.isInteger(weight) && weight >= 100 && weight <= 1000
          ? { weight }
          : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 20);
}

function numericScales(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = safeToken(key);
    if (!name || !Array.isArray(raw)) continue;
    const values = raw
      .map(Number)
      .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 10000)
      .slice(0, 20);
    if (values.length) result[name] = values;
  }
  return result;
}

function structuredTerminology(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const use = safeToken(record.use);
      if (!use) return null;
      const avoid = safeToken(record.avoid);
      return { use, ...(avoid ? { avoid } : {}) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 40);
}

function structuredInventory(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = safeToken(key);
    const count = Number(raw);
    if (name && Number.isInteger(count) && count >= 0 && count <= 10_000_000) {
      result[name] = count;
    }
  }
  return result;
}

export function compilePublishedBrandContext(
  input: PublishedBrandContextInput,
): string {
  const voiceDescriptors = stringArray(input.voiceDescriptors).filter((value) =>
    VOICE_DESCRIPTORS.has(value.toLowerCase()),
  );
  const data = {
    profileId: safeToken(input.profileId) ?? "published-profile",
    dnaVersionId: safeToken(input.dnaVersionId) ?? "published-version",
    colors: structuredColors(input.colors),
    fonts: structuredFonts(input.fonts),
    numericScales: numericScales(input.numericScales),
    voiceDescriptors,
    layoutPatterns: stringArray(input.layoutPatterns),
    logos: stringArray(input.logos),
    terminology: structuredTerminology(input.terminology),
    exclusions: stringArray(input.exclusions),
    inventory: structuredInventory(input.inventory),
  };
  return [
    `<brand-context profile-id=${JSON.stringify(data.profileId)} dna-version-id=${JSON.stringify(data.dnaVersionId)}>`,
    JSON.stringify(data),
    "Use approved company examples before generating new creative work. Search creative context for 2-5 task-relevant examples, keep style/layout examples separate from factual evidence, and preserve the resulting context pack as provenance.",
    "</brand-context>",
  ].join("\n");
}
