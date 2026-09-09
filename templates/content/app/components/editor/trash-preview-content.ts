import { docToNfm, nfmToDoc, type PMNode } from "../../../shared/nfm";

export function prepareTrashPreviewContent(content: string) {
  let hasSourceBlocks = false;
  function inertNode(node: PMNode): PMNode {
    if (
      ["registryBlock", "localMdxComponent", "contentReference"].includes(
        node.type,
      ) ||
      (node.type === "notionBlockAtom" && node.attrs?.tagName !== "equation")
    ) {
      hasSourceBlocks = true;
      const raw =
        node.type === "notionBlockAtom"
          ? docToNfm({ type: "doc", content: [node] })
          : node.attrs?.__raw;
      if (typeof raw !== "string")
        throw new Error("Preview block source is unreadable");
      return {
        type: "codeBlock",
        attrs: { language: "mdx" },
        content: [{ type: "text", text: raw }],
      };
    }
    return node.content
      ? { ...node, content: node.content.map(inertNode) }
      : node;
  }
  const document = nfmToDoc(content);
  return {
    content: docToNfm({
      ...document,
      content: document.content.map(inertNode),
    }),
    hasSourceBlocks,
  };
}
