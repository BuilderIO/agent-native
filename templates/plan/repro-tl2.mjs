import { attributeValue } from "@agent-native/core/blocks";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";

const proc = unified().use(remarkParse).use(remarkMdx);
const src = '<Screen surface="browser" html={`<div>hi</div>`} />';
const tree = proc.parse(src);
function find(node) {
  if (node.type === "mdxJsxFlowElement" && node.name === "Screen") return node;
  for (const c of node.children ?? []) {
    const r = find(c);
    if (r) return r;
  }
  return null;
}
const screen = find(tree);
const htmlAttr = screen.attributes.find((a) => a.name === "html");
try {
  console.log("attributeValue =>", JSON.stringify(attributeValue(htmlAttr)));
} catch (e) {
  console.log("THROW:", e.message);
}
