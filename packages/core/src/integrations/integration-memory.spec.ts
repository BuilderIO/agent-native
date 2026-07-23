import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scopeId: undefined as string | undefined,
  resources: new Map<
    string,
    { content: string; updatedAt: number; size: number }
  >(),
}));

function key(owner: string, path: string): string {
  return `${owner}\u0000${path}`;
}

vi.mock("../server/request-context.js", () => ({
  getIntegrationRequestContext: () =>
    state.scopeId ? { scopeId: state.scopeId } : undefined,
}));

vi.mock("../resources/store.js", () => ({
  resourcePut: vi.fn(async (owner: string, path: string, content: string) => {
    state.resources.set(key(owner, path), {
      content,
      updatedAt: Date.now(),
      size: content.length,
    });
    return { path, content };
  }),
  resourceGetByPath: vi.fn(async (owner: string, path: string) => {
    const resource = state.resources.get(key(owner, path));
    return resource ? { path, ...resource } : null;
  }),
  resourceDeleteByPath: vi.fn(async (owner: string, path: string) =>
    state.resources.delete(key(owner, path)),
  ),
  resourceList: vi.fn(async (owner: string, prefix: string) =>
    [...state.resources.entries()]
      .filter(([storedKey]) => storedKey.startsWith(`${owner}\u0000${prefix}`))
      .map(([storedKey, value]) => ({
        path: storedKey.split("\u0000")[1],
        updatedAt: value.updatedAt,
        size: value.size,
      })),
  ),
}));

const memory = await import("./integration-memory.js");

beforeEach(() => {
  state.scopeId = undefined;
  state.resources.clear();
  vi.clearAllMocks();
});

describe("explicit integration memory", () => {
  it("isolates saved memories and prompts by exact conversation scope", async () => {
    await memory.rememberForIntegrationScope(
      {
        name: "launch-style",
        description: "How launch updates should read",
        content: "Use a terse executive summary.",
      },
      "scope-a",
    );
    await memory.rememberForIntegrationScope(
      {
        name: "launch-style",
        description: "A different channel preference",
        content: "Use a detailed engineering summary.",
      },
      "scope-b",
    );

    await expect(memory.listIntegrationMemory("scope-a")).resolves.toEqual([
      expect.objectContaining({ name: "launch-style" }),
    ]);
    const promptA = await memory.loadIntegrationMemoryPrompt("scope-a");
    const promptB = await memory.loadIntegrationMemoryPrompt("scope-b");
    expect(promptA).toContain('scope="scope-a"');
    expect(promptA).toContain("terse executive summary");
    expect(promptA).not.toContain("detailed engineering summary");
    expect(promptB).toContain('scope="scope-b"');
    expect(promptB).toContain("detailed engineering summary");
    expect(promptB).not.toContain("terse executive summary");
  });

  it("deletes only the named memory in the current scope", async () => {
    for (const scopeId of ["scope-a", "scope-b"]) {
      await memory.rememberForIntegrationScope(
        {
          name: "preference",
          description: "Channel preference",
          content: `Memory for ${scopeId}`,
        },
        scopeId,
      );
    }

    await expect(
      memory.forgetIntegrationMemory({ name: "preference" }, "scope-a"),
    ).resolves.toEqual({ name: "preference", deleted: true });
    await expect(memory.listIntegrationMemory("scope-a")).resolves.toEqual([]);
    await expect(memory.listIntegrationMemory("scope-b")).resolves.toEqual([
      expect.objectContaining({ name: "preference" }),
    ]);
  });

  it("requires authorized scope context and explicit valid memory input", async () => {
    await expect(memory.listIntegrationMemory()).rejects.toThrow(
      "authorized integration scope",
    );
    await expect(
      memory.rememberForIntegrationScope(
        { name: "../escape", description: "bad", content: "bad" },
        "scope-a",
      ),
    ).rejects.toThrow("Memory name");
    expect(
      memory.integrationMemoryActions()["remember-for-integration-scope"].tool
        .description,
    ).toContain("explicitly asks");
  });
});
