import { docToNfm, nfmToDoc, type PMDoc, type PMNode } from "../nfm";
import type { ImportReferenceSlot, MarkdownImportDraft } from "./markdown";
import { isMarkdownFilePath } from "./paths";
import type {
  ImportAssetResolution,
  ImportedPage,
  ImportFinalizeMode,
  ImportPageStatus,
  ImportResolvers,
  ImportTextCoverage,
} from "./types";

const MAX_MISSING_SAMPLE = 5;

export class ImportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportContractError";
  }
}

/**
 * Resolves a parsed file's assets and links, serializes it to the stored
 * form, and reports what arrived by reading it back the way the editor will.
 *
 * In `apply` mode every asset must be uploaded or missing; an asset that is
 * only `available` means the caller skipped the upload, which is a bug.
 */
export function finalizeMarkdownImport(
  draft: MarkdownImportDraft,
  resolvers: ImportResolvers,
  mode: ImportFinalizeMode,
): ImportedPage {
  const notes = draft.notes.clone();
  const doc = structuredClone(draft.doc);
  const assets: ImportedPage["assets"] = [];

  const resolveAsset = (slot: ImportReferenceSlot): ImportAssetResolution => {
    const { reference } = slot;
    if (reference.kind === "relative") {
      return (
        resolvers.asset?.({
          kind: "file",
          path: reference.path,
          reference: slot.written,
        }) ?? { status: "missing" }
      );
    }
    if (
      reference.kind === "data-url" &&
      reference.mediaType.startsWith("image/")
    ) {
      return (
        resolvers.asset?.({
          kind: "data-url",
          mediaType: reference.mediaType,
          dataUrl: reference.url,
          reference: slot.written,
        }) ?? { status: "missing" }
      );
    }
    return { status: "missing" };
  };

  const placeholderSlot = (value: unknown): ImportReferenceSlot | null => {
    if (typeof value !== "string" || !value.startsWith(draft.referencePrefix)) {
      return null;
    }
    const slot = draft.slots[Number(value.slice(draft.referencePrefix.length))];
    if (!slot) {
      throw new ImportContractError(`Unknown import reference ${value}`);
    }
    return slot;
  };

  const assetUrl = (slot: ImportReferenceSlot): string | null => {
    const resolution = resolveAsset(slot);
    assets.push({ reference: slot.written, status: resolution.status });
    if (resolution.status === "resolved") return resolution.url;
    if (resolution.status === "available") {
      if (mode === "apply") {
        throw new ImportContractError(
          `Asset ${slot.written} must be uploaded before the import is applied`,
        );
      }
      return slot.reference.kind === "relative" ? slot.written : "";
    }
    return null;
  };

  visitNodes(doc.content, (node) => {
    const mediaSlot = placeholderSlot(node.attrs?.src);
    if (mediaSlot) {
      const url = assetUrl(mediaSlot);
      if (url === null) notes.add("asset-missing", slotLabel(mediaSlot));
      node.attrs = { ...node.attrs, src: url ?? "" };
    }
    for (const mark of node.marks ?? []) {
      const linkSlot = placeholderSlot(mark.attrs?.href);
      if (!linkSlot) continue;
      mark.attrs = { ...mark.attrs, href: resolveLink(linkSlot) };
    }
  });

  function resolveLink(slot: ImportReferenceSlot): string {
    const { reference } = slot;
    if (reference.kind === "relative" && isMarkdownFilePath(reference.path)) {
      const href = resolvers.link?.(reference.path) ?? null;
      if (href) return href;
      notes.add("link-target-not-imported", slotLabel(slot));
      return slot.written;
    }
    const url = assetUrl(slot);
    if (url !== null) return url;
    notes.add("link-target-not-imported", slotLabel(slot));
    return slot.written;
  }

  const content = docToNfm(doc);
  if (content.includes(draft.referencePrefix)) {
    throw new ImportContractError(
      "An import reference reached the stored body unresolved",
    );
  }
  const stored = nfmToDoc(content);

  const expected = structureOf(doc);
  const actual = structureOf(stored);
  const divergence = firstDifference(expected, actual);
  if (divergence !== -1) {
    notes.add(
      "structure-changed-on-save",
      `${expected[divergence] ?? "end"} → ${actual[divergence] ?? "end"}`,
    );
  }

  const coverage = measureCoverage(draft, stored);
  if (coverage.missingCharacters > 0) {
    notes.add(
      "text-not-landed",
      coverage.missingSample.join(", ") || undefined,
      Math.max(1, coverage.missingSample.length),
    );
  }

  const noteList = notes.toArray();
  const status: ImportPageStatus = noteList.some(
    (note) => note.severity === "lost",
  )
    ? "lost"
    : noteList.length > 0
      ? "converted"
      : "preserved";

  return {
    sourceName: draft.sourceName,
    dialect: draft.dialect,
    title: draft.title,
    titleSource: draft.titleSource,
    description: draft.description,
    icon: draft.icon,
    frontmatter: draft.frontmatter,
    content,
    doc: stored,
    assets,
    report: { status, notes: noteList, coverage },
  };
}

function slotLabel(slot: ImportReferenceSlot): string {
  return slot.reference.kind === "relative"
    ? slot.reference.path
    : slot.written;
}

function visitNodes(nodes: PMNode[], visit: (node: PMNode) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.content) visitNodes(node.content, visit);
  }
}

/** Block and inline node types by depth; text and marks are measured apart. */
function structureOf(doc: PMDoc): string[] {
  const out: string[] = [];
  const visit = (nodes: PMNode[], depth: number) => {
    for (const node of nodes) {
      if (node.type === "text") continue;
      out.push(`${depth}:${node.type}`);
      if (node.content) visit(node.content, depth + 1);
    }
  };
  visit(doc.content, 0);
  return out;
}

function firstDifference(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) return index;
  }
  return -1;
}

function measureCoverage(
  draft: MarkdownImportDraft,
  stored: PMDoc,
): ImportTextCoverage {
  const landedParts = draft.titleHeading ? [draft.titleHeading] : [];
  let sourceParts: string[];
  let accounted: string[] = [];
  if (draft.coverage.kind === "markdown") {
    sourceParts = draft.coverage.visible;
    accounted = draft.coverage.accounted;
    landedParts.push(...visibleDocText(stored));
  } else {
    sourceParts = [nfmVisibleText(draft.coverage.source)];
    landedParts.push(nfmVisibleText(docToNfm(stored)));
  }

  const source = characterCounts(sourceParts);
  for (const [character, count] of characterCounts(accounted)) {
    source.set(character, Math.max(0, (source.get(character) ?? 0) - count));
  }
  const landed = characterCounts(landedParts);
  let sourceCharacters = 0;
  let missingCharacters = 0;
  for (const [character, count] of source) {
    sourceCharacters += count;
    missingCharacters += Math.max(0, count - (landed.get(character) ?? 0));
  }

  const missingSample: string[] = [];
  if (missingCharacters > 0) {
    const landedText = compact(landedParts.join(" "));
    for (const word of sourceParts.join(" ").match(/[\p{L}\p{N}]+/gu) ?? []) {
      const token = word.normalize("NFKC").toLowerCase();
      if (landedText.includes(token) || missingSample.includes(token)) continue;
      missingSample.push(token.slice(0, 40));
      if (missingSample.length >= MAX_MISSING_SAMPLE) break;
    }
  }
  return { sourceCharacters, missingCharacters, missingSample };
}

/** Every string the editor shows for a document, including atom labels. */
function visibleDocText(doc: PMDoc): string[] {
  const out: string[] = [];
  visitNodes(doc.content, (node) => {
    if (node.type === "text" && node.text) out.push(node.text);
    for (const key of ["alt", "label", "summary"] as const) {
      const value = node.attrs?.[key];
      if (typeof value === "string" && value) out.push(value);
    }
  });
  return out;
}

/**
 * Strips NFM syntax that carries no reader-visible text. It is applied to
 * both the source and the stored body, so its blind spots cancel out.
 */
function nfmVisibleText(nfm: string): string {
  return nfm
    .replace(/^[\t ]*(```|~~~)[^\n]*$/gm, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g, "] ")
    .replace(/\{[a-z-]+="[^"]*"(?:\s+[a-z-]+="[^"]*")*\}/g, " ");
}

function characterCounts(parts: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const [character] of part
      .normalize("NFKC")
      .toLowerCase()
      .matchAll(/[\p{L}\p{N}]/gu)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }
  return counts;
}

function compact(text: string): string {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join("");
}
