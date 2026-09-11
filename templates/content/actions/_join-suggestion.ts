/**
 * Deterministic key-suggestion heuristic for federating a second source.
 *
 * The actual row join is always normalize-then-EXACT (no fuzzy matching). This
 * heuristic only proposes *which field* to join on and a normalization formula,
 * by measuring Jaccard overlap of each cross-source field pair's normalized
 * value sets. A name/format nudge breaks ties toward url/slug/id-like fields.
 * The user confirms (and may tweak the formula) before anything commits — and in
 * the agent-native flow, the session agent can compose the same join record
 * directly. No model is required here.
 */

import type { DocumentPropertyValue } from "../shared/api.js";
import { evaluateNormalizationFormula } from "../shared/properties.js";

export interface JoinSide {
  keyField: string;
  normalizationFormula: string;
}

export interface JoinSampleMatch {
  primaryRaw: string;
  secondaryRaw: string;
  normalized: string;
  matched: boolean;
}

export interface JoinSuggestion {
  source: "heuristic";
  canonicalKey: { propertyId: string | null; label: string; type: string };
  primary: JoinSide;
  secondary: JoinSide;
  sampleMatches: JoinSampleMatch[];
  confidence: number;
}

type ValueRow = Record<string, DocumentPropertyValue>;

const KEY_NAME_HINTS = [
  "url",
  "slug",
  "handle",
  "id",
  "key",
  "path",
  "ref",
  "author",
];

function stringValue(value: DocumentPropertyValue): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number") return String(value);
  return null;
}

function looksLikeUrl(values: string[]): boolean {
  return values.some(
    (value) =>
      value.includes("://") ||
      value.startsWith("/") ||
      /^[^/\s?#]+\.[^/\s?#]+(?:[/?#]|$)/i.test(value),
  );
}

function proposeFormula(field: string, urlLike: boolean): string {
  return urlLike
    ? `lower(trim(striphost({${field}})))`
    : `lower(trim({${field}}))`;
}

function looksLikeBuilderReference(values: string[]): boolean {
  return values.some((value) => /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(value));
}

function proposeFormulas(field: string, values: string[], urlLike: boolean) {
  const formulas = [proposeFormula(field, urlLike)];
  if (looksLikeBuilderReference(values)) {
    formulas.push(`lower(trim(regexreplace({${field}}, "^[^:]+:", "")))`);
  }
  return formulas;
}

function fieldLabel(field: string): string {
  return (
    field
      .replace(/^data\./, "")
      .replace(/[_.-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || field
  );
}

// String-valued field keys present across a set of rows.
function stringFieldKeys(rows: ValueRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (stringValue(value) !== null) keys.add(key);
    }
  }
  return [...keys];
}

interface FieldProfile {
  field: string;
  formula: string;
  normalizedByRaw: Map<string, string>; // raw value → normalized key
  normalizedSet: Set<string>;
}

function rawStringValuesForField(field: string, rows: ValueRow[]) {
  const raws: string[] = [];
  for (const row of rows) {
    const raw = stringValue(row[field]);
    if (raw !== null) raws.push(raw);
  }
  return raws;
}

function profileFieldWithFormula(
  field: string,
  raws: string[],
  formula: string,
): FieldProfile {
  const normalizedByRaw = new Map<string, string>();
  const normalizedSet = new Set<string>();
  for (const raw of raws) {
    const normalized = evaluateNormalizationFormula(formula, { [field]: raw });
    if (normalized === null) continue;
    if (!normalizedByRaw.has(raw)) normalizedByRaw.set(raw, normalized);
    normalizedSet.add(normalized);
  }
  return { field, formula, normalizedByRaw, normalizedSet };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection;
}

function lowInformationField(field: string): boolean {
  const normalized = field.toLowerCase();
  return /(^|[._-])(published|state|status|sync_state|created|updated|lastupdated|last_updated)([._-]|$)/.test(
    normalized,
  );
}

function nameNudge(primaryField: string, secondaryField: string): number {
  const hinted = (field: string) =>
    KEY_NAME_HINTS.some((hint) => field.toLowerCase().includes(hint));
  let nudge = 0;
  if (hinted(primaryField)) nudge += 0.05;
  if (hinted(secondaryField)) nudge += 0.05;
  return nudge;
}

/**
 * Propose a join between a primary source's sampled rows and a candidate
 * (secondary) source's sampled rows. Returns null when no field pair overlaps.
 */
export function suggestJoinKey(args: {
  primaryValues: ValueRow[];
  secondaryValues: ValueRow[];
}): JoinSuggestion | null {
  const primaryRawByField = new Map(
    stringFieldKeys(args.primaryValues).map((field) => [
      field,
      rawStringValuesForField(field, args.primaryValues),
    ]),
  );
  const secondaryRawByField = new Map(
    stringFieldKeys(args.secondaryValues).map((field) => [
      field,
      rawStringValuesForField(field, args.secondaryValues),
    ]),
  );

  let best: {
    primary: FieldProfile;
    secondary: FieldProfile;
    score: number;
    overlap: number;
  } | null = null;

  for (const [primaryField, primaryRaws] of primaryRawByField) {
    for (const [secondaryField, secondaryRaws] of secondaryRawByField) {
      const pairUrlLike =
        looksLikeUrl(primaryRaws) || looksLikeUrl(secondaryRaws);
      for (const primaryFormula of proposeFormulas(
        primaryField,
        primaryRaws,
        pairUrlLike,
      )) {
        for (const secondaryFormula of proposeFormulas(
          secondaryField,
          secondaryRaws,
          pairUrlLike,
        )) {
          const primary = profileFieldWithFormula(
            primaryField,
            primaryRaws,
            primaryFormula,
          );
          const secondary = profileFieldWithFormula(
            secondaryField,
            secondaryRaws,
            secondaryFormula,
          );
          const overlap = jaccard(
            primary.normalizedSet,
            secondary.normalizedSet,
          );
          if (overlap <= 0) continue;
          const sharedCount = intersectionSize(
            primary.normalizedSet,
            secondary.normalizedSet,
          );
          if (
            sharedCount < 2 &&
            (primary.normalizedByRaw.size > 2 ||
              secondary.normalizedByRaw.size > 2)
          ) {
            continue;
          }
          const lowInfoPenalty =
            lowInformationField(primary.field) ||
            lowInformationField(secondary.field)
              ? 0.5
              : 0;
          const cardinalityNudge =
            Math.min(primary.normalizedSet.size, secondary.normalizedSet.size) *
            0.001;
          const score =
            overlap +
            nameNudge(primary.field, secondary.field) +
            cardinalityNudge -
            lowInfoPenalty;
          if (!best || score > best.score) {
            best = { primary, secondary, score, overlap };
          }
        }
      }
    }
  }

  if (!best) return null;

  // Sample matches reflect the committed formulas exactly (same evaluator).
  const sampleMatches: JoinSampleMatch[] = [];
  for (const [raw, normalized] of best.primary.normalizedByRaw) {
    let secondaryRaw = "";
    for (const [sRaw, sNorm] of best.secondary.normalizedByRaw) {
      if (sNorm === normalized) {
        secondaryRaw = sRaw;
        break;
      }
    }
    sampleMatches.push({
      primaryRaw: raw,
      secondaryRaw,
      normalized,
      matched: secondaryRaw !== "",
    });
    if (sampleMatches.length >= 5) break;
  }

  return {
    source: "heuristic",
    canonicalKey: {
      propertyId: null,
      label: fieldLabel(best.primary.field),
      type: "text",
    },
    primary: {
      keyField: best.primary.field,
      normalizationFormula: best.primary.formula,
    },
    secondary: {
      keyField: best.secondary.field,
      normalizationFormula: best.secondary.formula,
    },
    sampleMatches,
    confidence: Number(best.overlap.toFixed(3)),
  };
}
