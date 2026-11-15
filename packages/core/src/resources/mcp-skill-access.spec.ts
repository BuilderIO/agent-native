import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  context: { userEmail: "a@example.test", orgId: "org-a" },
  lab: vi.fn(),
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => mocks.context,
  getRequestUserEmail: () => mocks.context.userEmail,
  getRequestOrgId: () => mocks.context.orgId,
}));
vi.mock("../labs/mcp-skill-lab.js", () => ({
  getMcpSkillLabEnabled: mocks.lab,
}));
const identity = {
  userEmail: "a@example.test",
  orgId: "org-a",
  identityAssurance: "user" as const,
  orgDomain: undefined,
};
const row = (path: string, content: string) => ({
  id: path,
  owner: "a@example.test",
  path,
  content,
  content_complete: 1,
  visibility: "workspace",
  metadata: null,
});
beforeEach(() => {
  mocks.context = { userEmail: "a@example.test", orgId: "org-a" };
  mocks.execute.mockReset();
  mocks.lab.mockReset();
});
describe("MCP skill read", () => {
  it("checks the manifest Lab before returning same-owner reference", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      })
      .mockResolvedValueOnce({
        rows: [row("skills/a/references/x.md", "reference")],
      })
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      });
    mocks.lab.mockResolvedValue(true);
    const { readScopedSkillForMcp } = await import("./store.js");
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/references/x.md",
      }),
    ).resolves.toMatchObject({ content: "reference" });
    expect(mocks.lab).toHaveBeenCalledWith(identity, "private.lab");
    expect(mocks.execute.mock.calls.every(([q]) => /^SELECT/.test(q.sql))).toBe(
      true,
    );
  });
  it("rejects conflicting org or personal scope before reading an ungated skill", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    mocks.context = {
      userEmail: "a@example.test",
      orgId: "org-a",
      orgScope: "personal",
    } as typeof mocks.context;
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toThrow(/Verified/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("discovers only verified eligible manifests within a bounded listing", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ path: "skills/a/SKILL.md", owner: "a@example.test" }],
      })
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\n---\nbody",
          ),
        ],
      });
    const { listScopedSkillsForMcp } = await import("./store.js");
    await expect(
      listScopedSkillsForMcp({ identity, scope: "personal" }),
    ).resolves.toMatchObject([{ name: "A", path: "skills/a/SKILL.md" }]);
    expect(mocks.execute.mock.calls[0]![0].sql).toMatch(/LIMIT/i);
  });

  it("filters references in SQL and skips denied skills without hiding Lab errors", async () => {
    const { listScopedSkillsForMcp } = await import("./store.js");
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ path: "skills/a/SKILL.md", owner: "a@example.test" }],
      })
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      });
    mocks.lab.mockResolvedValueOnce(false);
    await expect(
      listScopedSkillsForMcp({ identity, scope: "personal" }),
    ).resolves.toEqual([]);
    expect(mocks.execute.mock.calls[0]![0].sql).toContain("NOT LIKE");
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ path: "skills/a/SKILL.md", owner: "a@example.test" }],
      })
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      });
    mocks.lab.mockRejectedValueOnce(new Error("lab storage failed"));
    await expect(
      listScopedSkillsForMcp({ identity, scope: "personal" }),
    ).rejects.toThrow("lab storage failed");
  });

  it("refuses a reference if its manifest changes after the first check", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    const initial = "---\nname: A\ndescription: D\n---\nbody";
    const changed =
      "---\nname: A\ndescription: D\nrequires-lab: restricted\n---\nbody";
    mocks.execute
      .mockResolvedValueOnce({ rows: [row("skills/a/SKILL.md", initial)] })
      .mockResolvedValueOnce({
        rows: [row("skills/a/references/x.md", "secret")],
      })
      .mockResolvedValueOnce({ rows: [row("skills/a/SKILL.md", changed)] });
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/references/x.md",
      }),
    ).rejects.toThrow(/manifest/);
  });

  it("rechecks Lab access after a reference read", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      })
      .mockResolvedValueOnce({
        rows: [row("skills/a/references/x.md", "secret")],
      })
      .mockResolvedValueOnce({
        rows: [
          row(
            "skills/a/SKILL.md",
            "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
          ),
        ],
      });
    mocks.lab.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/references/x.md",
      }),
    ).rejects.toMatchObject({ code: "skill_denied" });
    expect(mocks.lab).toHaveBeenCalledTimes(2);
  });
  it("does not suggest manifests lacking name or description", async () => {
    const { listScopedSkillsForMcp } = await import("./store.js");
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner: "a@example.test", path: "skills/a/SKILL.md" }],
      })
      .mockResolvedValueOnce({
        rows: [row("skills/a/SKILL.md", "---\nname: A\n---\nbody")],
      });
    await expect(
      listScopedSkillsForMcp({ identity, scope: "personal" }),
    ).rejects.toThrow(/frontmatter/);
  });

  it("bounds candidate descriptions while keeping explicit manifest reads complete", async () => {
    const { listScopedSkillsForMcp, readScopedSkillForMcp } =
      await import("./store.js");
    const content = `---\nname: ${"a".repeat(300)}\ndescription: ${"b".repeat(500)}\n---\nbody`;
    mocks.execute
      .mockResolvedValueOnce({
        rows: [{ owner: "a@example.test", path: "skills/a/SKILL.md" }],
      })
      .mockResolvedValueOnce({ rows: [row("skills/a/SKILL.md", content)] })
      .mockResolvedValueOnce({ rows: [row("skills/a/SKILL.md", content)] });
    const candidates = await listScopedSkillsForMcp({
      identity,
      scope: "personal",
    });
    expect(candidates[0]!.name).toHaveLength(160);
    expect(candidates[0]!.description).toHaveLength(400);
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).resolves.toMatchObject({ content });
  });

  it("stops after cancellation during a manifest query", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    const controller = new AbortController();
    mocks.execute.mockImplementationOnce(async () => {
      controller.abort();
      return {
        rows: [
          row("skills/a/SKILL.md", "---\nname: A\ndescription: D\n---\nbody"),
        ],
      };
    });
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(mocks.lab).not.toHaveBeenCalled();
  });

  it("normalizes verified email consistently for discovery and resource reads", async () => {
    const { listScopedSkillsForMcp } = await import("./store.js");
    mocks.context = { userEmail: " a@example.test ", orgId: "org-a" };
    const spacedIdentity = { ...identity, userEmail: " a@example.test " };
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(
      listScopedSkillsForMcp({ identity: spacedIdentity, scope: "personal" }),
    ).resolves.toEqual([]);
    expect(mocks.execute.mock.calls[0]![0].args).toEqual(["a@example.test"]);
  });

  it("reports truncation instead of silently returning a partial skill list", async () => {
    const { listScopedSkillsForMcp } = await import("./store.js");
    mocks.execute.mockResolvedValueOnce({
      rows: Array.from({ length: 25 }, (_, i) => ({
        owner: "a@example.test",
        path: `skills/s${i}/SKILL.md`,
      })),
    });
    await expect(
      listScopedSkillsForMcp({ identity, scope: "personal" }),
    ).rejects.toMatchObject({ code: "resource_too_large" });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("refuses direct reads of manifests without a name or description", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    mocks.execute.mockResolvedValueOnce({
      rows: [row("skills/a/SKILL.md", "---\n: malformed\n---\nprivate")],
    });
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toThrow(/frontmatter/);
  });

  it("refuses malformed skill frontmatter before returning content", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    mocks.execute.mockResolvedValueOnce({
      rows: [
        row(
          "skills/a/SKILL.md",
          "---\nrequires-lab: restricted\nbody without closing fence",
        ),
      ],
    });
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toThrow(/frontmatter/);
    expect(mocks.lab).not.toHaveBeenCalled();
  });

  it("rejects missing manifests, disabled Labs, and unverified identity", async () => {
    const { readScopedSkillForMcp } = await import("./store.js");
    await expect(
      readScopedSkillForMcp({
        identity: { ...identity, identityAssurance: "organization" },
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/references/x.md",
      }),
    ).rejects.toThrow();
    mocks.execute.mockResolvedValueOnce({
      rows: [
        row(
          "skills/a/SKILL.md",
          "---\nname: A\ndescription: test skill\nrequires-lab: private.lab\n---\nbody",
        ),
      ],
    });
    mocks.lab.mockResolvedValue(false);
    await expect(
      readScopedSkillForMcp({
        identity,
        scope: "personal",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toThrow();
  });
});
