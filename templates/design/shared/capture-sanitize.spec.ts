/**
 * Tests for the shared capture-sanitize helpers.
 *
 * These helpers are used by both create-design-state and capture-design-state
 * to strip XSS vectors from arbitrary caller-supplied markup before persisting
 * it into design_state rows.
 */

import { describe, expect, it } from "vitest";

import {
  CAPTURE_DATA_MAX_BYTES,
  looksLikeMarkup,
  sanitizeCaptureData,
  sanitizeMarkup,
} from "./capture-sanitize.js";

describe("CAPTURE_DATA_MAX_BYTES", () => {
  it("is 256 KB", () => {
    expect(CAPTURE_DATA_MAX_BYTES).toBe(256 * 1024);
  });
});

describe("sanitizeMarkup", () => {
  it("strips <script> tags", () => {
    const input = "<div><script>alert(1)</script><p>hello</p></div>";
    expect(sanitizeMarkup(input)).not.toContain("<script");
    expect(sanitizeMarkup(input)).toContain("<p>hello</p>");
  });

  it("strips self-closing <script> tags", () => {
    expect(sanitizeMarkup('<script src="evil.js"/>')).not.toContain("<script");
  });

  it("strips <iframe> tags", () => {
    expect(sanitizeMarkup('<iframe src="x"></iframe>')).not.toContain(
      "<iframe",
    );
  });

  it("strips inline on* event handlers", () => {
    const input = '<button onclick="alert(1)">click</button>';
    expect(sanitizeMarkup(input)).not.toContain("onclick");
    expect(sanitizeMarkup(input)).toContain("<button");
  });

  it("strips javascript: href", () => {
    const input = '<a href="javascript:alert(1)">link</a>';
    expect(sanitizeMarkup(input)).not.toContain("javascript:");
  });

  it("strips data: src", () => {
    const input = '<img src="data:text/html,<script>alert(1)</script>">';
    expect(sanitizeMarkup(input)).not.toContain('src="data:');
  });

  it("preserves safe content", () => {
    const input = '<div class="hero"><p>Hello world</p></div>';
    expect(sanitizeMarkup(input)).toBe(input);
  });
});

describe("looksLikeMarkup", () => {
  it("returns true for HTML strings", () => {
    expect(looksLikeMarkup("<div>hello</div>")).toBe(true);
    expect(looksLikeMarkup("</p>")).toBe(true);
    expect(looksLikeMarkup("<!DOCTYPE html>")).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(looksLikeMarkup("/dashboard")).toBe(false);
    expect(looksLikeMarkup("Loading")).toBe(false);
    expect(looksLikeMarkup("route_id_123")).toBe(false);
  });
});

describe("sanitizeCaptureData", () => {
  it("sanitizes HTML strings nested in objects", () => {
    const input = {
      domHtml: '<div onmouseover="evil()">hi</div>',
      route: "/dashboard",
    };
    const result = sanitizeCaptureData(input) as Record<string, unknown>;
    expect(result.domHtml).not.toContain("onmouseover");
    expect(result.domHtml).toContain("<div");
    // Plain string left untouched
    expect(result.route).toBe("/dashboard");
  });

  it("recurses into arrays", () => {
    const input = ["<script>x</script>", "safe"];
    const result = sanitizeCaptureData(input) as string[];
    expect(result[0]).not.toContain("<script");
    expect(result[1]).toBe("safe");
  });

  it("recurses into nested objects", () => {
    const input = { nested: { html: '<iframe src="x"></iframe>' } };
    const result = sanitizeCaptureData(input) as {
      nested: { html: string };
    };
    expect(result.nested.html).not.toContain("<iframe");
  });

  it("leaves non-string, non-object primitives unchanged", () => {
    expect(sanitizeCaptureData(42)).toBe(42);
    expect(sanitizeCaptureData(true)).toBe(true);
    expect(sanitizeCaptureData(null)).toBeNull();
  });
});
