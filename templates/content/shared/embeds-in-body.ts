import { parseRegistryBlockData } from "./nfm-registry.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

function walk(node: PMNode | undefined, visit: (node: PMNode) => void) {
  if (!node) return;
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

export function embedTagsInBody(content: string, blockType: string): string[] {
  const raws: string[] = [];
  walk(nfmToDoc(content), (node) => {
    if (node.type === "registryBlock" && node.attrs?.blockType === blockType) {
      raws.push(typeof node.attrs.__raw === "string" ? node.attrs.__raw : "");
    }
  });
  return raws;
}

export async function embedsInBody<T>(
  content: string | null | undefined,
  kind: { tag: string; blockType: string; read: (data: unknown) => T | null },
): Promise<{ found: T[]; unreadable: number }> {
  if (!content || !content.includes(`<${kind.tag}`)) {
    return { found: [], unreadable: 0 };
  }
  const raws = embedTagsInBody(content, kind.blockType);
  const parsed = await Promise.all(
    raws.map(async (raw) => {
      try {
        return await parseRegistryBlockData(raw);
        // coercion-ok: a tag that doesn't parse is counted as unreadable by the caller
      } catch {
        return null;
      }
    }),
  );
  const found: T[] = [];
  for (const block of parsed) {
    const item = block?.type === kind.blockType ? kind.read(block.data) : null;
    if (item !== null) found.push(item);
  }
  return { found, unreadable: parsed.length - found.length };
}
