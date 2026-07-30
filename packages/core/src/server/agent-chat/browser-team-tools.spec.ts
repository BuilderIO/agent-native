import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBuilderBrowserTool,
  createTeamTools,
} from "./browser-team-tools.js";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getBuilderCredentialAuthFailure: vi.fn(),
  getBuilderBrowserConnectUrlForOwner: vi.fn(),
  resolveBuilderBranchProjectId: vi.fn(),
  resolveBuilderCredentials: vi.fn(),
}));

vi.mock("../../sharing/access.js", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../builder-browser.js", () => ({
  getBuilderBrowserConnectUrlForOwner:
    mocks.getBuilderBrowserConnectUrlForOwner,
  resolveBuilderBranchProjectId: mocks.resolveBuilderBranchProjectId,
}));

vi.mock("../credential-provider.js", () => ({
  getBuilderCredentialAuthFailure: mocks.getBuilderCredentialAuthFailure,
  resolveBuilderCredentials: mocks.resolveBuilderCredentials,
}));

const extension = {
  id: "ext-1",
  name: "Revenue cohorts",
  description: "A custom cohort visualization",
  content:
    '<section x-data="{ note: `keep ``` complete` }">Revenue cohorts</section>',
  updatedAt: "2026-07-29T12:00:00.000Z",
  archivedAt: null,
};

describe("createBuilderBrowserTool extension promotion", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.getBuilderCredentialAuthFailure.mockReset();
    mocks.getBuilderBrowserConnectUrlForOwner.mockReset();
    mocks.resolveBuilderBranchProjectId.mockReset();
    mocks.resolveBuilderCredentials.mockReset();

    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: extension,
    });
    mocks.getBuilderCredentialAuthFailure.mockResolvedValue(null);
    mocks.getBuilderBrowserConnectUrlForOwner.mockReturnValue(
      "https://builder.example.test/connect",
    );
    mocks.resolveBuilderBranchProjectId.mockResolvedValue("project-1");
    mocks.resolveBuilderCredentials.mockResolvedValue({
      privateKey: "private-test-key",
      publicKey: "public-test-key",
      orgName: "Test org",
    });
  });

  async function runConnectBuilder(args: Record<string, unknown>) {
    const entry = createBuilderBrowserTool({
      getOrigin: () => "https://app.example.test",
      getOwner: () => "owner@example.test",
    })["connect-builder"];
    return JSON.parse(await entry.run(args));
  }

  it("loads the authoritative SQL artifact with editor access", async () => {
    const result = await runConnectBuilder({
      prompt: "Promote this custom block to app code.",
      extensionId: "ext-1",
      content: "<p>client-supplied content must be ignored</p>",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "extension",
      "ext-1",
      "editor",
    );
    expect(result.prompt).toContain(extension.content);
    expect(result.prompt).not.toContain("client-supplied content");
    expect(result.prompt).toContain(
      "Do not modify, archive, delete, or replace it",
    );
    expect(result.promotion).toEqual({
      extensionId: "ext-1",
      contentLength: extension.content.length,
      contentSha256: createHash("sha256")
        .update(extension.content)
        .digest("hex"),
    });
    expect(result.prompt).toContain(
      `End of complete server-verified artifact ext-1 (sha256: ${result.promotion.contentSha256}).`,
    );
  });

  it("fails instead of handing off an artifact without editor access", async () => {
    mocks.assertAccess.mockRejectedValue(
      new Error("Requires editor role on extension ext-1 (have viewer)"),
    );

    await expect(
      runConnectBuilder({
        prompt: "Promote this custom block to app code.",
        extensionId: "ext-1",
      }),
    ).rejects.toThrow("Requires editor role");
  });

  it("fails loudly instead of truncating oversized extension content", async () => {
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: {
        ...extension,
        content: "x".repeat(200_001),
      },
    });

    await expect(
      runConnectBuilder({
        prompt: "Promote this custom block to app code.",
        extensionId: "ext-1",
      }),
    ).rejects.toThrow(
      "promotion supports at most 200,000 characters. No extension content was sent.",
    );
  });

  it("keeps private extension source out of the waitlist fallback prompt", async () => {
    mocks.resolveBuilderBranchProjectId.mockResolvedValue(null);

    const result = await runConnectBuilder({
      prompt: "Promote this custom block to app code.",
      extensionId: "ext-1",
    });

    expect(result.builderEnabled).toBe(false);
    expect(result.prompt).toBe("Promote this custom block to app code.");
    expect(result.prompt).not.toContain(extension.content);
    expect(result.promotion).toEqual({
      extensionId: "ext-1",
      contentLength: extension.content.length,
    });
  });
});

describe("createTeamTools Plan-mode effects", () => {
  it("allows task observation but blocks delegation and messages", () => {
    const entry = createTeamTools({
      getOwner: () => "owner@example.test",
      getSystemPrompt: () => "",
      getActions: () => ({}),
      getEngine: () => ({}) as any,
      getModel: () => "test-model",
      getParentThreadId: () => "thread-1",
      getSend: () => null,
    })["agent-teams"];
    const effect = entry.planMode?.effect;
    expect(typeof effect).toBe("function");
    if (typeof effect !== "function") throw new Error("Missing classifier");

    expect(effect({ action: "status" })).toBe("read");
    expect(effect({ action: "read-result" })).toBe("read");
    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "spawn" })).toBe("write");
    expect(effect({ action: "send" })).toBe("write");
  });
});
