import { describe, it, expect, afterEach } from "vitest";
import { parseMergedKey } from "./remote-store.js";
import { isMcpToolAllowedForRequest } from "./visibility.js";
import { runWithRequestContext } from "../server/request-context.js";
import { hashEmail } from "./remote-store.js";

describe("parseMergedKey", () => {
  it("parses user-scope keys", () => {
    expect(parseMergedKey("user_ab12cd34ef_zapier")).toEqual({
      scope: "user",
      owner: "ab12cd34ef",
      name: "zapier",
    });
  });

  it("parses org-scope keys", () => {
    expect(parseMergedKey("org_acme123_zapier")).toEqual({
      scope: "org",
      owner: "acme123",
      name: "zapier",
    });
  });

  it("projects hub-sourced keys to org scope so they pass through the same visibility gate", () => {
    expect(parseMergedKey("hub_acme123_zapier")).toEqual({
      scope: "org",
      owner: "acme123",
      name: "zapier",
    });
  });

  it("strips the mcp__ prefix + tool name first", () => {
    expect(parseMergedKey("mcp__hub_acme123_zapier__run-task")).toEqual({
      scope: "org",
      owner: "acme123",
      name: "zapier",
    });
  });

  it("returns null for non-merged keys (e.g. file-config stdio servers)", () => {
    expect(parseMergedKey("claude-in-chrome")).toBeNull();
    expect(parseMergedKey("mcp__claude-in-chrome__navigate")).toBeNull();
  });
});

describe("isMcpToolAllowedForRequest — hub tools must not bypass the org gate", () => {
  it("blocks a hub-sourced tool from a different org than the active request", async () => {
    await runWithRequestContext(
      { userEmail: "alice@acme.com", orgId: "acme" },
      async () => {
        expect(isMcpToolAllowedForRequest("mcp__hub_beta_zapier__run")).toBe(
          false,
        );
      },
    );
  });

  it("allows a hub-sourced tool from the active request's org", async () => {
    await runWithRequestContext(
      { userEmail: "alice@acme.com", orgId: "acme" },
      async () => {
        expect(isMcpToolAllowedForRequest("mcp__hub_acme_zapier__run")).toBe(
          true,
        );
      },
    );
  });

  it("still allows personal user-scope tools for the matching user", async () => {
    const hash = hashEmail("alice@acme.com");
    await runWithRequestContext(
      { userEmail: "alice@acme.com", orgId: "acme" },
      async () => {
        expect(
          isMcpToolAllowedForRequest(`mcp__user_${hash}_zapier__run`),
        ).toBe(true);
      },
    );
  });
});

afterEach(() => {
  // No-op placeholder for future per-test cleanup.
});
