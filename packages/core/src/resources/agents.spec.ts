import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetMock = vi.hoisted(() => vi.fn());
const resourceListAccessibleMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  resourceGet: resourceGetMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceListAccessible: resourceListAccessibleMock,
  SHARED_OWNER: "__shared__",
}));

import { listAccessibleCustomAgents } from "./agents.js";

describe("custom agent resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batches workspace enrichment from the accessible agents listing", async () => {
    resourceListAccessibleMock.mockResolvedValue([
      resource("alpha-profile", "agents/alpha.md"),
      resource("beta-profile", "agents/beta.md"),
      resource(
        "alpha-skill",
        "agents/alpha/skills/research.md",
        JSON.stringify({ name: "Research", description: "Research skill" }),
      ),
      resource("alpha-notes", "agents/alpha/context/brief.txt"),
      resource("nested-markdown", "agents/alpha/context/brief.md"),
    ]);
    resourceGetMock.mockImplementation(async (id: string) => {
      const content = {
        "alpha-profile": "---\nname: Alpha\n---\nAlpha instructions",
        "beta-profile": "---\nname: Beta\n---\nBeta instructions",
        "nested-markdown": "not a custom agent profile",
      }[id as "alpha-profile" | "beta-profile" | "nested-markdown"];
      return content ? { id, content } : null;
    });

    const agents = await listAccessibleCustomAgents("user@example.com");

    expect(resourceListAccessibleMock).toHaveBeenCalledTimes(1);
    expect(resourceListAccessibleMock).toHaveBeenCalledWith(
      "user@example.com",
      "agents/",
    );
    expect(agents).toEqual([
      expect.objectContaining({
        id: "alpha",
        workspace: {
          root: "agents/alpha",
          resources: [
            {
              path: "agents/alpha/skills/research.md",
              kind: "skill",
              name: "Research",
              description: "Research skill",
            },
            {
              path: "agents/alpha/context/brief.txt",
              kind: "file",
            },
            {
              path: "agents/alpha/context/brief.md",
              kind: "file",
            },
          ],
        },
      }),
      expect.objectContaining({
        id: "beta",
        workspace: { root: "agents/beta", resources: [] },
      }),
    ]);
  });
});

function resource(id: string, path: string, metadata: string | null = null) {
  return {
    id,
    path,
    metadata,
  };
}
