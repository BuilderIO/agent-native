import { describe, expect, it } from "vitest";

import { hasDocBlockSyntax } from "./doc-block-detection";

describe("hasDocBlockSyntax", () => {
  it.each([
    "```an-diagram\n{}\n```",
    "```mermaid\ngraph TD\n```",
    '<Diagram title="Request lifecycle" />',
    "  <OpenApiSpec>\n  </OpenApiSpec>",
    '<AnnotatedCode\n  id="x"\n  code={\n    "const value = 1;"\n  }\n/>',
  ])("detects %s", (markdown) => {
    expect(hasDocBlockSyntax(markdown)).toBe(true);
  });

  it.each([
    "# A normal document\n\n```ts\nconst value = 1;\n```",
    "```tsx\n<Component />\n```",
    "Inline <code>HTML</code> is not a visual block.",
    "<div>ordinary HTML</div>",
  ])("keeps ordinary Markdown on the light path: %s", (markdown) => {
    expect(hasDocBlockSyntax(markdown)).toBe(false);
  });
});
