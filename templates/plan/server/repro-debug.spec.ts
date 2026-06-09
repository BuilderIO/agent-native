import { describe, it, expect } from "vitest";
import { attributeValue } from "@agent-native/core/blocks";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";

describe("debug template literal estree", () => {
  it("resolves via source attributeValue", () => {
    const proc = unified().use(remarkParse).use(remarkMdx).use(remarkStringify);
    const src = '<Screen surface="browser" html={`<div>hi</div>`} />';
    const tree = proc.parse(src) as any;
    function find(node: any): any {
      if (node.type === "mdxJsxFlowElement" && node.name === "Screen")
        return node;
      for (const c of node.children ?? []) {
        const r = find(c);
        if (r) return r;
      }
      return null;
    }
    const screen = find(tree);
    const htmlAttr = screen.attributes.find((a: any) => a.name === "html");
    const estree = htmlAttr.value?.data?.estree;
    expect(estree).toBeTruthy();
    expect(estree?.body?.[0]?.type).toBe("ExpressionStatement");
    expect(estree?.body?.[0]?.expression?.type).toBe("TemplateLiteral");
    expect(attributeValue(htmlAttr)).toBe("<div>hi</div>");
  });
});
