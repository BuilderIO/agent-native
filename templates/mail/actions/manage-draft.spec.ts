import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function manageDraftSource(): string {
  return readFileSync(new URL("./manage-draft.ts", import.meta.url), "utf8");
}

describe("manage-draft MCP App", () => {
  it("reuses the real Mail app embed instead of a bespoke compose form", () => {
    const source = manageDraftSource();

    expect(source).toContain("embedApp({");
    expect(source).toContain('openLabel: "Open in Mail"');
    expect(source).toContain('iframeTitle: "Agent-Native Mail"');
    expect(source).toContain("height: 900");
    expect(source).not.toContain("mailDraftMcpAppHtml");
    expect(source).not.toContain("_mcp-apps");
    expect(source).not.toContain("data-save");
    expect(source).not.toContain("Update draft");
    expect(existsSync(new URL("./_mcp-apps.ts", import.meta.url))).toBe(false);
  });
});

describe("manage-draft deep link", () => {
  // Security regression test: a previous implementation base64url-encoded the
  // full compose draft (subject + recipients + body) into a `compose=` query
  // param on the deep link. That URL is surfaced to external MCP host LLMs
  // (ChatGPT / Claude), which can see and remember it; shared / exported chat
  // transcripts would leak draft contents. The deep link now carries only the
  // opaque draft id, and the full draft is read from app-state on render.
  it("no longer encodes draft contents into the URL", () => {
    const source = manageDraftSource();

    // The compose-payload encoder helpers are removed entirely.
    expect(source).not.toContain("encodeComposeDraft");
    expect(source).not.toContain("encodeComposePayload");
    expect(source).not.toContain("MAX_COMPOSE_PAYLOAD_BYTES");
    // No `compose:` field passed to buildDeepLink.
    expect(source).not.toMatch(/\bcompose:\s*encode/);
    // The deep link still carries an id-only pointer.
    expect(source).toContain("composeDraftId");
  });

  it("composeDeepLink calls buildDeepLink with only id + view + to (no payload)", () => {
    const source = manageDraftSource();

    // The composeDeepLink helper body must contain ONLY the four expected
    // properties: app, view, to, params (with composeDraftId). It must not
    // contain a `compose:` field or any encoder call. Match the function
    // body precisely to catch a regression that re-adds the payload field.
    const match = source.match(
      /function composeDeepLink\([^)]*\)[^{]*{[\s\S]*?return buildDeepLink\(\{([\s\S]*?)\}\);[\s\S]*?}/,
    );
    expect(match).toBeTruthy();
    const body = match![1];
    expect(body).toContain('app: "mail"');
    expect(body).toContain('view: "inbox"');
    expect(body).toContain("composeDraftId: draft.id");
    expect(body).not.toContain("compose:");
    expect(body).not.toContain("encode");
  });
});
