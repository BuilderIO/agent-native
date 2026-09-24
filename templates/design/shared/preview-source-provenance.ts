import { parse } from "parse5";

import { scriptGrammar } from "./html-integrity";
import { sourceContentHash } from "./source-workspace";

/** Identity evidence tied to one exact authored preview document. */
export interface SourceDocumentProvenance {
  /** Empty when authored scripts make positional source lineage uncertain. */
  versionHash: string;
  uniqueNodeIds: string[];
}

/** Identity evidence for one element reported by a preview iframe. */
export interface SourceNodeProvenance {
  versionHash?: string;
  uniqueNodeId?: string;
}

export interface AuthorizedSourceNodeProvenance {
  /** A current, unique raw bridge ID; use it without a positional selector. */
  uniqueNodeId?: string;
  /** True only when the reported selector belongs to the current HTML bytes. */
  allowSelector: boolean;
}

// Keep this list in sync with editor-chrome.bridge.ts getSourceId. A raw ID
// can be exposed through any one of these aliases. Count every alias across
// nodes, since the source resolver can match any alias even when the bridge
// returns another alias as the element's preferred sourceId.
const SOURCE_ID_ATTRIBUTES = new Set([
  "data-agent-native-node-id",
  "data-code-layer-id",
  "data-layer-id",
  "data-builder-id",
  "data-loc",
  "id",
]);

type SourceTreeNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: SourceTreeNode[];
  content?: { childNodes?: SourceTreeNode[] };
};

export function createSourceDocumentProvenance(
  content: string,
): SourceDocumentProvenance {
  const counts = new Map<string, number>();
  let hasExecutableScript = false;
  const stack = [parse(content) as unknown as SourceTreeNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.tagName === "script" &&
      scriptGrammar(
        node.attrs?.find((attribute) => attribute.name === "type")?.value ?? "",
      ) !== null
    ) {
      hasExecutableScript = true;
    }
    if (node.tagName) {
      const ids = new Set(
        (node.attrs ?? [])
          .filter((attribute) => SOURCE_ID_ATTRIBUTES.has(attribute.name))
          .map((attribute) => attribute.value)
          .filter(Boolean),
      );
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    stack.push(...(node.childNodes ?? []), ...(node.content?.childNodes ?? []));
  }
  // The ownership snapshot is taken after synchronous authored scripts may
  // have changed the DOM. A byte hash cannot prove an idless runtime path;
  // normalized screens still use their unique authored IDs in this case.
  return {
    versionHash: hasExecutableScript ? "" : sourceContentHash(content),
    uniqueNodeIds: [...counts]
      .filter(([, count]) => count === 1)
      .map(([id]) => id)
      .sort(),
  };
}

/** Read the optional, untrusted per-node proof attached to bridge messages. */
export function readSourceNodeProvenance(
  value: unknown,
): SourceNodeProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const versionHash =
    typeof record.versionHash === "string" && record.versionHash.length > 0
      ? record.versionHash
      : undefined;
  const uniqueNodeId =
    typeof record.uniqueNodeId === "string" && record.uniqueNodeId.length > 0
      ? record.uniqueNodeId
      : undefined;
  if (!versionHash && !uniqueNodeId) return undefined;
  return {
    ...(versionHash ? { versionHash } : {}),
    ...(uniqueNodeId ? { uniqueNodeId } : {}),
  };
}

/**
 * Validate node provenance against the fresh authored bytes before a caller
 * tries a bridge selector. A unique raw ID can survive unrelated document
 * changes; positional selectors require the exact source version.
 */
export function resolveSourceNodeProvenance(
  currentContent: string,
  value: unknown,
): AuthorizedSourceNodeProvenance | undefined {
  const nodeProvenance = readSourceNodeProvenance(value);
  if (!nodeProvenance) return undefined;

  const currentDocument = createSourceDocumentProvenance(currentContent);
  const allowSelector =
    nodeProvenance.versionHash === currentDocument.versionHash;
  const uniqueNodeId = nodeProvenance.uniqueNodeId;
  if (uniqueNodeId && currentDocument.uniqueNodeIds.includes(uniqueNodeId)) {
    return { uniqueNodeId, allowSelector };
  }
  return allowSelector ? { allowSelector: true } : undefined;
}
