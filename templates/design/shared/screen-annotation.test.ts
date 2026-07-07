import { describe, expect, it } from "vitest";

import { annotateScreenHtmlForPersist } from "./screen-annotation.js";

describe("annotateScreenHtmlForPersist", () => {
  it("stamps missing data-agent-native-node-id attributes on HTML content", () => {
    const html = "<main><section><button>Buy</button></section></main>";
    const result = annotateScreenHtmlForPersist(html, "html");

    expect(result).toContain("data-agent-native-node-id");
    expect(result).toMatch(/<main data-agent-native-node-id="[^"]+">/);
    expect(result).toMatch(/<section data-agent-native-node-id="[^"]+">/);
    expect(result).toMatch(
      /<button data-agent-native-node-id="[^"]+">Buy<\/button>/,
    );
  });

  it("is idempotent: a second pass over already-annotated content changes nothing", () => {
    const html = "<main><button>Buy</button></main>";
    const once = annotateScreenHtmlForPersist(html, "html");
    const twice = annotateScreenHtmlForPersist(once, "html");

    expect(twice).toBe(once);
  });

  it("preserves an existing clean id instead of replacing it", () => {
    const html =
      '<main data-agent-native-node-id="an-custom"><button>Buy</button></main>';
    const result = annotateScreenHtmlForPersist(html, "html");

    expect(result).toContain('data-agent-native-node-id="an-custom"');
    expect(result.match(/data-agent-native-node-id="an-custom"/g)).toHaveLength(
      1,
    );
  });

  it("defaults to treating an undefined fileType as html", () => {
    const html = "<main>Hi</main>";
    const result = annotateScreenHtmlForPersist(html, undefined);

    expect(result).toContain("data-agent-native-node-id");
  });

  it("is a no-op for non-HTML file types (css, jsx, asset)", () => {
    expect(annotateScreenHtmlForPersist(".a{color:red}", "css")).toBe(
      ".a{color:red}",
    );
    expect(
      annotateScreenHtmlForPersist("export default function App() {}", "jsx"),
    ).toBe("export default function App() {}");
    expect(
      annotateScreenHtmlForPersist("data:image/png;base64,abc", "asset"),
    ).toBe("data:image/png;base64,abc");
  });

  it("skips non-visual tags: head/script/style/meta/link/title/template/noscript", () => {
    const html =
      "<!doctype html><html><head>" +
      "<meta charset='utf-8'/><title>Test</title>" +
      "<style>.x{color:red}</style>" +
      "<script>const a = document.createElement('div');</script>" +
      "</head><body><main><section>Hi</section></main>" +
      "<template><div class='ghost'>Ghost</div></template>" +
      "<noscript><div>No JS</div></noscript>" +
      "</body></html>";

    const result = annotateScreenHtmlForPersist(html, "html");

    expect(result).toContain("<section data-agent-native-node-id=");
    expect(result.match(/<style>[\s\S]*?<\/style>/)?.[0]).not.toContain(
      "data-agent-native-node-id",
    );
    expect(result.match(/<script>[\s\S]*?<\/script>/)?.[0]).not.toContain(
      "data-agent-native-node-id",
    );
    expect(result.match(/<template>[\s\S]*?<\/template>/)?.[0]).not.toContain(
      "data-agent-native-node-id",
    );
    expect(result.match(/<noscript>[\s\S]*?<\/noscript>/)?.[0]).not.toContain(
      "data-agent-native-node-id",
    );
    expect(result).not.toMatch(/<meta[^>]*data-agent-native-node-id/);
    expect(result).not.toMatch(/<title[^>]*data-agent-native-node-id/);
  });

  it("returns the input unchanged for empty or non-string content instead of throwing", () => {
    expect(annotateScreenHtmlForPersist("", "html")).toBe("");
    expect(annotateScreenHtmlForPersist("   ", "html")).toBe("   ");
  });
});
