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
console.log("ATTR value.type:", JSON.stringify(htmlAttr.value?.type));
console.log(
  "ATTR value.value (source):",
  JSON.stringify(htmlAttr.value?.value),
);
const estree = htmlAttr.value?.data?.estree;
const stmt = estree?.body?.[0];
console.log("STMT TYPE:", stmt?.type);
console.log("EXPR TYPE:", stmt?.expression?.type);
console.log("EXPR keys:", Object.keys(stmt?.expression ?? {}));
console.log(
  "quasis:",
  JSON.stringify(
    stmt?.expression?.quasis?.map((q) => ({
      cooked: q.value?.cooked,
      raw: q.value?.raw,
    })),
    null,
    2,
  ),
);
console.log("expressions len:", stmt?.expression?.expressions?.length);
