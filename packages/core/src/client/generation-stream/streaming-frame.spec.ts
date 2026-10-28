import { describe, expect, it } from "vitest";

import { buildStreamingFrameDocument } from "./streaming-frame";

function frameScript(doc: string): string {
  const match = /<script>([\s\S]*)<\/script><\/head>/.exec(doc);
  if (!match?.[1]) throw new Error("frame document has no script");
  return match[1];
}

describe("buildStreamingFrameDocument", () => {
  it("serializes a script that compiles on its own", () => {
    const script = frameScript(buildStreamingFrameDocument());
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  });

  it("escapes the base href", () => {
    const doc = buildStreamingFrameDocument({
      baseHref: 'https://example.com/"><script>',
    });
    expect(doc).toContain(
      '<base href="https://example.com/&quot;>&lt;script>">',
    );
  });
});
