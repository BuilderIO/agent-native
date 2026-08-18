import type { BrandDnaPayload } from "../types.js";
import {
  findBrandProfileIdForInferenceSource,
  getBrandProfile,
  saveBrandDnaCandidate,
} from "./brand.js";
import {
  getCreativeContextItem,
  listAccessibleSearchDocuments,
} from "./content.js";
import { getContextSource } from "./sources.js";

function collectFonts(value: unknown, key = "", fonts = new Set<string>()) {
  if (typeof value === "string" && /font|typeface|family/i.test(key)) {
    for (const font of value.split(/[,/]/).map((entry) => entry.trim())) {
      if (font && font.length <= 100) fonts.add(font);
    }
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      collectFonts(child, childKey, fonts);
    }
  }
  return fonts;
}

const VOICE_DESCRIPTOR_ORDER = [
  "direct",
  "concise",
  "optimistic",
  "technical",
  "formal",
  "warm",
] as const;

const LAYOUT_MOTIFS = [
  ["kpi-scorecard", /\b(kpi|metric|scorecard|dashboard)\b/i],
  ["card-grid", /\b(card|grid|tile)\b/i],
  ["hero-centered", /\b(hero|centered|device render)\b/i],
  ["split-layout", /\b(split|two[- ]column|side[- ]by[- ]side)\b/i],
  ["editorial-stack", /\b(editorial|narrative|stacked|article)\b/i],
  ["full-bleed-visual", /\b(full[- ]bleed|campaign image|poster)\b/i],
] as const;

function inferVoiceFeatures(
  details: Array<
    NonNullable<Awaited<ReturnType<typeof getCreativeContextItem>>>
  >,
) {
  const text = details
    .map((detail) => `${detail.version.title}\n${detail.version.content}`)
    .join("\n")
    .slice(0, 80_000);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const words = sentences.map((sentence) => sentence.split(/\s+/).length);
  const averageSentenceWords = words.length
    ? words.reduce((sum, count) => sum + count, 0) / words.length
    : 0;
  const headings = text
    .split("\n")
    .filter(
      (line) => line.trim() && line.trim().split(/\s+/).length <= 8,
    ).length;
  const ctaCount = (
    text.match(/\b(?:start|try|build|launch|explore|learn|book)\b/gi) ?? []
  ).length;
  const descriptors = new Set<string>();
  if (averageSentenceWords > 0 && averageSentenceWords <= 20)
    descriptors.add("direct");
  if (averageSentenceWords > 0 && averageSentenceWords <= 14)
    descriptors.add("concise");
  if (/\b(?:grow|improve|success|launch|opportunity|better)\b/i.test(text))
    descriptors.add("optimistic");
  if (/\b(?:api|data|system|metric|kpi|workflow|technical)\b/i.test(text))
    descriptors.add("technical");
  if (!/\b(?:can't|won't|we're|you're|it's)\b/i.test(text))
    descriptors.add("formal");
  if (/\b(?:welcome|together|help|support|people)\b/i.test(text))
    descriptors.add("warm");
  return {
    descriptors: VOICE_DESCRIPTOR_ORDER.filter((descriptor) =>
      descriptors.has(descriptor),
    ),
    stats: {
      sentenceCount: sentences.length,
      averageSentenceWords: Number(averageSentenceWords.toFixed(2)),
      shortHeadingCount: headings,
      ctaTokenCount: ctaCount,
    },
  };
}

function inferLayoutMotifs(
  details: Array<
    NonNullable<Awaited<ReturnType<typeof getCreativeContextItem>>>
  >,
  documents: Awaited<ReturnType<typeof listAccessibleSearchDocuments>>,
): string[] {
  const signal = [
    ...documents.flatMap((document) => [document.title, ...document.tags]),
    ...details.flatMap((detail) => [
      detail.version.title,
      detail.version.summary ?? "",
      JSON.stringify(detail.version.metadata),
    ]),
  ].join("\n");
  return LAYOUT_MOTIFS.filter(([, pattern]) => pattern.test(signal))
    .map(([name]) => name)
    .slice(0, 6);
}

export const BRAND_DNA_MATERIAL_DRIFT_THRESHOLD = 0.2;

function dnaSignals(payload: BrandDnaPayload): Set<string> {
  const signals = new Set<string>();
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
      if (normalized) signals.add(`${path}:${normalized}`);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      signals.add(`${path}:${String(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, path);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (/^(itemId|itemVersionId|thumbnailBlobRef)$/i.test(key)) continue;
        visit(child, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(payload.visual, "visual");
  visit(payload.voice, "voice");
  visit(payload.principles, "principles");
  visit(payload.constraints, "constraints");
  return signals;
}

export function brandDnaDriftScore(
  previous: BrandDnaPayload,
  candidate: BrandDnaPayload,
): number {
  const before = dnaSignals(previous);
  const after = dnaSignals(candidate);
  if (!before.size && !after.size) return 0;
  const union = new Set([...before, ...after]);
  let intersection = 0;
  for (const signal of before) if (after.has(signal)) intersection += 1;
  return 1 - intersection / union.size;
}

function representativeScore(
  row: Awaited<ReturnType<typeof listAccessibleSearchDocuments>>[number],
): number {
  return (
    (row.curationRank === "canonical"
      ? 100
      : row.curationRank === "exemplar"
        ? 60
        : 0) +
    (row.starred ? 80 : 0) +
    Math.min(50, row.priorReuseCount * 5) +
    Math.min(30, row.helpfulFeedbackCount * 3)
  );
}

export function selectRepresentativeBrandDocuments(
  documents: Awaited<ReturnType<typeof listAccessibleSearchDocuments>>,
  limit = 50,
) {
  const unique = [
    ...new Map(documents.map((row) => [row.itemId, row])).values(),
  ]
    .filter((row) => !row.inventoryOnly)
    .sort(
      (left, right) =>
        representativeScore(right) - representativeScore(left) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.sourceId.localeCompare(right.sourceId) ||
        left.kind.localeCompare(right.kind) ||
        left.itemId.localeCompare(right.itemId),
    );
  const selected = [];
  const seenSources = new Set<string>();
  const seenKinds = new Set<string>();
  for (const row of unique) {
    if (selected.length >= limit) break;
    if (!seenSources.has(row.sourceId) || !seenKinds.has(row.kind)) {
      selected.push(row);
      seenSources.add(row.sourceId);
      seenKinds.add(row.kind);
    }
  }
  const selectedIds = new Set(selected.map((row) => row.itemId));
  for (const row of unique) {
    if (selected.length >= limit) break;
    if (!selectedIds.has(row.itemId)) selected.push(row);
  }
  return selected;
}

export async function inferBrandDnaProposalFromCorpus(input: {
  sourceId: string;
  profileId?: string;
  materialDriftThreshold?: number;
}) {
  const [source, documents] = await Promise.all([
    getContextSource(input.sourceId),
    listAccessibleSearchDocuments({ sourceIds: [input.sourceId], limit: 100 }),
  ]);
  if (!source) throw new Error("Context source not found or not accessible");
  const unique = selectRepresentativeBrandDocuments(documents, 50);
  if (!unique.length)
    return { proposal: null, reason: "no-hydrated-evidence" as const };
  const details = (
    await Promise.all(
      unique.map((row) =>
        getCreativeContextItem(row.itemId, row.itemVersionId),
      ),
    )
  ).filter((detail) => detail !== null);
  const colors = [
    ...new Set([
      ...unique.flatMap((row) => row.colors),
      ...details.flatMap((detail) =>
        detail.media.flatMap((media) => media.palette),
      ),
    ]),
  ].slice(0, 16);
  const fonts = [
    ...details.reduce(
      (set, detail) => collectFonts(detail.version.metadata, "metadata", set),
      new Set<string>(),
    ),
  ].slice(0, 12);
  const layoutThumbnails = details
    .filter((detail) => detail.item.thumbnailBlobRef)
    .slice(0, 3)
    .map((detail) => ({
      itemId: detail.item.id,
      itemVersionId: detail.version.id,
      hasThumbnail: true,
      title: detail.item.title,
    }));
  const voice = inferVoiceFeatures(details);
  const layoutPatterns = inferLayoutMotifs(details, unique);
  const confidence = Math.min(
    0.95,
    0.35 +
      Math.min(0.3, unique.length / 50) +
      (colors.length ? 0.15 : 0) +
      (fonts.length ? 0.1 : 0) +
      (layoutPatterns.length ? 0.05 : 0),
  );
  const configuredProfileId =
    typeof source.config.profileId === "string" && source.config.profileId
      ? source.config.profileId
      : undefined;
  const profileId =
    input.profileId ??
    configuredProfileId ??
    (await findBrandProfileIdForInferenceSource(source.id)) ??
    undefined;
  const candidate: BrandDnaPayload = {
    summary: `Deterministic proposal inferred from ${unique.length} hydrated corpus items.`,
    visual: { colors, fonts, layoutPatterns },
    voice: {
      descriptors: voice.descriptors,
      evidenceStats: voice.stats,
    },
    inference: {
      method: "deterministic-corpus-first-pass",
      confidence,
      evidenceCount: unique.length,
      sourceId: source.id,
    },
  };
  const existing = profileId
    ? await getBrandProfile({ profileId })
    : { profile: null, dna: null, versions: [] };
  const comparison = existing.versions[0] ?? existing.dna;
  const threshold = Math.max(
    0,
    Math.min(
      1,
      input.materialDriftThreshold ?? BRAND_DNA_MATERIAL_DRIFT_THRESHOLD,
    ),
  );
  const driftScore = comparison
    ? brandDnaDriftScore(comparison.payload, candidate)
    : 1;
  if (comparison && driftScore < threshold) {
    return {
      proposal: null,
      reason: "no-material-drift" as const,
      drift: {
        score: driftScore,
        threshold,
        comparedVersionId: comparison.id,
      },
    };
  }
  const inference = candidate.inference as Record<string, unknown>;
  inference.driftScore = driftScore;
  inference.materialDriftThreshold = threshold;
  inference.comparedVersionId = comparison?.id ?? null;
  const result = await saveBrandDnaCandidate({
    profileId,
    name: profileId ? undefined : source.name,
    status: "proposed",
    evidenceItemIds: unique.map((row) => row.itemId),
    dna: candidate,
  });
  return {
    proposal: result,
    preview: {
      profileId: result.profile.id,
      dnaVersionId: result.dna.id,
      contentHash: result.dna.contentHash,
      summary: result.dna.payload.summary,
      colors,
      fonts,
      layoutThumbnails,
      voiceLine: null,
      voiceDescriptors: voice.descriptors,
      voiceEvidenceStats: voice.stats,
      confidence,
      driftScore,
      materialDriftThreshold: threshold,
    },
  };
}
