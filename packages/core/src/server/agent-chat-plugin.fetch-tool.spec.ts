import { describe, expect, it, vi } from "vitest";

// `resolveFetchToolKeyAllowlist` is a plain module-level function in
// agent-chat-plugin.ts (hoisted out of the per-request fetch-tool wiring
// specifically so it's unit-testable here without booting the whole plugin —
// see its doc comment in agent-chat-plugin.ts).
// It takes its `getKeyAllowlist` / `getResolvedKeyAllowlist` dependencies as
// explicit parameters, so no module mocking is needed here at all.
import { resolveFetchToolKeyAllowlist } from "./agent-chat-plugin.js";

describe("resolveFetchToolKeyAllowlist", () => {
  it("looks up the allowlist at the resolved scope when resolvedKeys reports one (org scope)", async () => {
    // A key stored at org scope (e.g. synced in by the Dispatch vault) must
    // have its allowlist checked at that same org scope — not user scope —
    // per the audit 05 H2 alignment note in secrets/substitution.ts.
    const getKeyAllowlist = vi.fn();
    const getResolvedKeyAllowlist = vi
      .fn()
      .mockResolvedValue(["https://api.github.com"]);

    const result = await resolveFetchToolKeyAllowlist(
      "GITHUB_TOKEN",
      [{ name: "GITHUB_TOKEN", scope: "org", scopeId: "org_123" }],
      "alice@example.com",
      { getKeyAllowlist, getResolvedKeyAllowlist },
    );

    expect(result).toEqual(["https://api.github.com"]);
    expect(getResolvedKeyAllowlist).toHaveBeenCalledWith({
      name: "GITHUB_TOKEN",
      scope: "org",
      scopeId: "org_123",
    });
    expect(getKeyAllowlist).not.toHaveBeenCalled();
  });

  it("falls back to the user-scope allowlist lookup when the key has no resolved ref", async () => {
    const getKeyAllowlist = vi
      .fn()
      .mockResolvedValue(["https://hooks.example.com"]);
    const getResolvedKeyAllowlist = vi.fn();

    const result = await resolveFetchToolKeyAllowlist(
      "SLACK_WEBHOOK",
      undefined,
      "alice@example.com",
      { getKeyAllowlist, getResolvedKeyAllowlist },
    );

    expect(result).toEqual(["https://hooks.example.com"]);
    expect(getKeyAllowlist).toHaveBeenCalledWith(
      "SLACK_WEBHOOK",
      "user",
      "alice@example.com",
    );
    expect(getResolvedKeyAllowlist).not.toHaveBeenCalled();
  });

  it("falls back to the user-scope lookup when resolvedKeys is present but doesn't include this key", async () => {
    const getKeyAllowlist = vi.fn().mockResolvedValue(null);
    const getResolvedKeyAllowlist = vi.fn();

    const result = await resolveFetchToolKeyAllowlist(
      "OTHER_KEY",
      [{ name: "GITHUB_TOKEN", scope: "org", scopeId: "org_123" }],
      "alice@example.com",
      { getKeyAllowlist, getResolvedKeyAllowlist },
    );

    expect(result).toBeNull();
    expect(getKeyAllowlist).toHaveBeenCalledWith(
      "OTHER_KEY",
      "user",
      "alice@example.com",
    );
    expect(getResolvedKeyAllowlist).not.toHaveBeenCalled();
  });
});
