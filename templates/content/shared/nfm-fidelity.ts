import type { Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";

import { createContentEditorStructuralSchema } from "./content-editor-structural-schema.js";
import { LIVE_BODY_FIELD, materializeLiveBody } from "./live-body.js";
import {
  canonicalNfmDoc,
  docToNfm,
  nfmToDoc,
  parseNfmWithLosses,
  type NfmParseLossKind,
  type PMDoc,
} from "./nfm.js";

// The canonical form of a page body is what the editor's live copy would
// save. Canonicalizing must never change the document a writer meant, so
// anything the parse, the editor schema or the writer cannot keep is named
// here, and a writer that must not lose content refuses the write.

export type NfmFidelityLossKind =
  | NfmParseLossKind
  /** The editor schema rejects a node, mark or nesting the parse produced. */
  | "invalid-structure"
  /** The editor's live copy would save different Markdown. */
  | "editor-mismatch"
  /** The canonical Markdown parses to a different document. */
  | "reparse-mismatch"
  | "unparseable";

export interface NfmFidelityLoss {
  kind: NfmFidelityLossKind;
  count: number;
  samples: string[];
}

export type NfmCanonicalization =
  | {
      kind: "canonical";
      markdown: string;
      /** Whether `markdown` differs from the input bytes. */
      changed: boolean;
      /** Empty when canonicalizing keeps everything the input says. */
      losses: NfmFidelityLoss[];
    }
  | { kind: "unparseable"; losses: NfmFidelityLoss[] };

const MAX_SAMPLES = 5;
const MAX_SAMPLE_LENGTH = 200;

let structuralSchema: Schema | undefined;

function schema(): Schema {
  structuralSchema ??= createContentEditorStructuralSchema();
  return structuralSchema;
}

class LossList {
  private readonly byKind = new Map<NfmFidelityLossKind, NfmFidelityLoss>();

  add(kind: NfmFidelityLossKind, sample: string): void {
    let loss = this.byKind.get(kind);
    if (!loss) {
      loss = { kind, count: 0, samples: [] };
      this.byKind.set(kind, loss);
    }
    loss.count += 1;
    if (loss.samples.length < MAX_SAMPLES)
      loss.samples.push(sample.slice(0, MAX_SAMPLE_LENGTH));
  }

  list(): NfmFidelityLoss[] {
    return [...this.byKind.values()];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * JSON with sorted keys, so two parses compare by content. A node's marks
 * are a set, as the editor holds them, so their order does not count.
 */
function stableJson(value: unknown, key?: string): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => stableJson(item));
    if (key === "marks") items.sort();
    return `[${items.join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v, k)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function firstDifferentLine(a: string, b: string): string {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i])
      return `line ${i + 1}: ${JSON.stringify(left[i] ?? null)} → ${JSON.stringify(right[i] ?? null)}`;
  }
  return "";
}

function firstDifferentBlock(a: PMDoc, b: PMDoc): string {
  const count = Math.max(a.content.length, b.content.length);
  for (let i = 0; i < count; i++) {
    const left = stableJson(a.content[i] ?? null);
    const right = stableJson(b.content[i] ?? null);
    if (left !== right) return `block ${i + 1}: ${left} → ${right}`;
  }
  return "";
}

/**
 * Canonical Markdown for a page body, with everything canonicalizing would
 * lose. Never throws: a body that cannot be read comes back `unparseable`.
 */
export function canonicalizeNfmWithFidelity(
  nfm: string | null | undefined,
): NfmCanonicalization {
  const source = nfm ?? "";
  const losses = new LossList();
  try {
    const parsed = parseNfmWithLosses(source);
    for (const loss of parsed.losses) losses.add(loss.kind, loss.sample);
    const markdown = docToNfm(parsed.doc);

    try {
      const root = schema().nodeFromJSON(parsed.doc);
      root.check();
      const live = materializeLiveBody(
        prosemirrorJSONToYDoc(schema(), root.toJSON(), LIVE_BODY_FIELD),
      );
      if (live.kind !== "body")
        losses.add("editor-mismatch", `the live copy reads as ${live.kind}`);
      else if (live.markdown !== markdown)
        losses.add(
          "editor-mismatch",
          firstDifferentLine(markdown, live.markdown),
        );
    } catch (error) {
      losses.add("invalid-structure", errorMessage(error));
    }

    const kept = canonicalNfmDoc(parsed.doc);
    const reparsed = nfmToDoc(markdown);
    if (stableJson(reparsed) !== stableJson(kept))
      losses.add("reparse-mismatch", firstDifferentBlock(kept, reparsed));
    else if (docToNfm(reparsed) !== markdown)
      losses.add(
        "reparse-mismatch",
        firstDifferentLine(markdown, docToNfm(reparsed)),
      );

    return {
      kind: "canonical",
      markdown,
      changed: markdown !== source,
      losses: losses.list(),
    };
  } catch (error) {
    losses.add("unparseable", errorMessage(error));
    return { kind: "unparseable", losses: losses.list() };
  }
}

/** Thrown by a writer that refuses to store a body it would change in meaning. */
export class NfmFidelityError extends Error {
  readonly code = "NFM_FIDELITY_LOSS";

  constructor(
    readonly losses: NfmFidelityLoss[],
    /** The canonical Markdown, or null when the body could not be read. */
    readonly canonical: string | null,
  ) {
    super(
      `NFM_FIDELITY_LOSS: Markdown would lose content when stored: ${losses
        .map(
          (loss) =>
            `${loss.kind} ×${loss.count}${loss.samples[0] ? ` (${loss.samples[0]})` : ""}`,
        )
        .join("; ")}`,
    );
    this.name = "NfmFidelityError";
  }
}

/** Canonical Markdown for a body that loses nothing; throws `NfmFidelityError` otherwise. */
export function requireLosslessNfm(nfm: string | null | undefined): string {
  const result = canonicalizeNfmWithFidelity(nfm);
  if (result.kind === "unparseable")
    throw new NfmFidelityError(result.losses, null);
  if (result.losses.length > 0)
    throw new NfmFidelityError(result.losses, result.markdown);
  return result.markdown;
}
