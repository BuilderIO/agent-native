import { isActionContractError } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyWorkspaceResourceCreate: vi.fn(),
  getWorkspaceResourceByPath: vi.fn(),
  requireWorkspaceResourceCtx: vi.fn(() => ({
    ownerEmail: "owner@example.test",
    orgId: null,
  })),
}));

vi.mock("./workspace-resources-store.js", () => ({
  applyWorkspaceResourceCreate: (...args: unknown[]) =>
    mocks.applyWorkspaceResourceCreate(...args),
  getWorkspaceResourceByPath: (...args: unknown[]) =>
    mocks.getWorkspaceResourceByPath(...args),
  requireWorkspaceResourceCtx: (...args: unknown[]) =>
    mocks.requireWorkspaceResourceCtx(...args),
}));

describe("applyAgentPackCreate", () => {
  it("rejects an attached-file path collision as a clean 409, not a crash", async () => {
    mocks.getWorkspaceResourceByPath.mockImplementation(async (path: string) =>
      path === "agents/researcher/context/glossary.md"
        ? { path, content: "existing" }
        : null,
    );

    const { applyAgentPackCreate } = await import("./agent-pack-store.js");

    let caught: unknown;
    try {
      await applyAgentPackCreate([
        {
          kind: "agent",
          name: "Researcher",
          path: "agents/researcher.md",
          content: "# Agent",
          scope: "all",
        },
        {
          kind: "agent-file",
          name: "glossary.md",
          path: "agents/researcher/context/glossary.md",
          content: "# Glossary",
          scope: "all",
        },
      ]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isActionContractError(caught)).toBe(true);
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
    expect((caught as Error).message).toContain(
      "agents/researcher/context/glossary.md",
    );
    expect(mocks.applyWorkspaceResourceCreate).not.toHaveBeenCalled();
  });

  it("rejects two pack files that normalize to the same path", async () => {
    mocks.getWorkspaceResourceByPath.mockResolvedValue(null);

    const { applyAgentPackCreate } = await import("./agent-pack-store.js");

    let caught: unknown;
    try {
      await applyAgentPackCreate([
        {
          kind: "agent",
          name: "Researcher",
          path: "agents/researcher.md",
          content: "# Agent",
          scope: "all",
        },
        {
          kind: "agent-file",
          name: "glossary.md",
          path: "agents/researcher/context/glossary.md",
          content: "# Glossary",
          scope: "all",
        },
        {
          kind: "agent-file",
          name: "glossary-2.md",
          path: "agents/researcher/context/glossary.md",
          content: "# Glossary v2",
          scope: "all",
        },
      ]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isActionContractError(caught)).toBe(true);
    expect((caught as { statusCode?: number }).statusCode).toBe(409);
    expect(mocks.applyWorkspaceResourceCreate).not.toHaveBeenCalled();
  });
});
