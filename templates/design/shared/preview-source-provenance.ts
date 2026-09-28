import { parse } from "parse5";

import { scriptGrammar } from "./html-integrity";
import { sourceContentHash } from "./source-workspace";

export interface SourceDocumentProvenance {
  versionHash: string;
  uniqueNodeIds: string[];
}

export interface SourceNodeProvenance {
  versionHash?: string;
  uniqueNodeId?: string;
}

export interface AuthorizedSourceNodeProvenance {
  uniqueNodeId?: string;
  allowSelector: boolean;
}

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
  return {
    versionHash: hasExecutableScript ? "" : sourceContentHash(content),
    uniqueNodeIds: [...counts]
      .filter(([, count]) => count === 1)
      .map(([id]) => id)
      .sort(),
  };
}

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
