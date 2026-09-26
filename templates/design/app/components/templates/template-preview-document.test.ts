// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { templatePreviewDocument } from "./template-preview-document";

describe("read-only template preview document", () => {
  it("places its restrictive policy before authored executable content", () => {
    const result = templatePreviewDocument(
      "<html><head><script>window.fixture=true</script></head><body><button onclick=\"this.textContent='Changed'\">Try</button></body></html>",
    );
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(
      result.indexOf("window.fixture"),
    );
    for (const restriction of [
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
    ])
      expect(result).toContain(restriction);
    expect(result).toContain("script-src 'unsafe-inline' 'unsafe-eval'");
    expect(result).toContain("onclick=\"this.textContent='Changed'\"");
    expect(result).toContain("event.preventDefault()");
    expect(result.indexOf("design-template-preview:escape")).toBeLessThan(
      result.indexOf("window.fixture"),
    );
  });

  it("does not grant app-origin render requests and strips automatic refresh", () => {
    const result = templatePreviewDocument(
      `<meta http-equiv="refresh" content="0;url=${window.location.origin}/_agent-native/actions/delete-design"><img src="${window.location.origin}/api/private"><img src="https://images.example.test/image.png"><iframe src="https://other.example.test"></iframe>`,
    );
    const policy = result.match(
      /http-equiv="Content-Security-Policy" content="([^"]+)"/,
    )![1];
    expect(
      policy
        .split(";")
        .map((part) => part.trim())
        .find((directive) => directive.startsWith("img-src")),
    ).toBe(
      "img-src data: blob: https://images.example.test https://other.example.test",
    );
    expect(result).not.toContain('http-equiv="refresh"');
    expect(policy).not.toContain("'self'");
    expect(policy).not.toContain("connect-src https:");
  });

  it("substitutes the same local Alpine and Tailwind runtimes as Design presentation", () => {
    const result = templatePreviewDocument(
      '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script><script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script><div x-data="{open:false}" @click="open=!open" x-show="open">Demo</div>',
    );
    const scripts = [...result.matchAll(/<script src="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain("tailwindcss");
    expect(scripts[1]).toContain("alpinejs/dist/cdn.min.js");
    expect(
      scripts.every((script) => script.startsWith(window.location.origin)),
    ).toBe(true);
    expect(result).toContain('@click="open=!open"');
  });
});
