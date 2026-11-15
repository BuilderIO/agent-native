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

import {
  findAccessibleCustomAgent,
  resolveAccessibleCustomAgentReference,
} from "./agents.js";

const OWNER = "owner@example.com";
const SHARED = "__shared__";
const CONTENT = "---\nname: Alpha\n---\nAlpha instructions";

function listing(id: string, path: string, owner = OWNER) {
  return { id, path, owner };
}

function stored(id: string, path: string, owner = OWNER, content = CONTENT) {
  return { id, path, owner, content };
}

function reference(
  options: {
    metadata?: Record<string, unknown>;
    refId?: string;
    path?: string;
    name?: string;
  } = {},
) {
  return {
    type: "custom-agent" as const,
    path: options.path ?? "agents/alpha.md",
    name: options.name ?? "Alpha",
    source: "resource",
    ...(options.refId ? { refId: options.refId } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

/** Only the `agents/` listing has rows; workspace enrichment sees none. */
function listAgents(rows: ReturnType<typeof listing>[]) {
  resourceListAccessibleMock.mockImplementation(
    async (_owner: string, prefix?: string) =>
      prefix === "agents/" ? rows : [],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listAgents([]);
});

describe("resolveAccessibleCustomAgentReference", () => {
  it("resolves an active bound resource by its id", async () => {
    listAgents([listing("agent-a", "agents/alpha.md")]);
    resourceGetMock.mockResolvedValue(stored("agent-a", "agents/alpha.md"));

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "agent-a" } }),
      vi.fn(),
    );

    expect(profile).toMatchObject({
      id: "alpha",
      path: "agents/alpha.md",
      name: "Alpha",
    });
    expect(resourceGetMock).toHaveBeenCalledWith("agent-a");
  });

  it("fails closed when the recorded id is gone even though a new profile now holds the old path", async () => {
    // A was trashed and B was created at the same path. The cached reference
    // still names A, so B's profile must never run.
    listAgents([listing("agent-b", "agents/alpha.md")]);
    resourceGetMock.mockResolvedValue(
      stored("agent-b", "agents/alpha.md", OWNER, "---\nname: Beta\n---\nBeta"),
    );
    const legacy = vi.fn();

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "agent-a" } }),
      legacy,
    );

    expect(profile).toBeNull();
    expect(resourceGetMock).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("fails closed when the listing still names the id but the fresh row is trashed", async () => {
    listAgents([listing("agent-a", "agents/alpha.md")]);
    resourceGetMock.mockResolvedValue(null);
    const legacy = vi.fn();

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "agent-a" } }),
      legacy,
    );

    expect(profile).toBeNull();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("fails closed when the fresh row changed owner after it was listed", async () => {
    listAgents([listing("agent-a", "agents/alpha.md")]);
    resourceGetMock.mockResolvedValue(
      stored("agent-a", "agents/alpha.md", "someone-else@example.com"),
    );
    const legacy = vi.fn();

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "agent-a" } }),
      legacy,
    );

    expect(profile).toBeNull();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("fails closed for an id the caller cannot list", async () => {
    listAgents([]);
    const legacy = vi.fn();

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "foreign-agent" } }),
      legacy,
    );

    expect(profile).toBeNull();
    expect(resourceGetMock).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each([
    ["a number", 123],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["an over-long string", "x".repeat(201)],
    ["an object", { nested: true }],
  ])(
    "fails closed on a malformed resourceId (%s) without a path fallback",
    async (_label, resourceId) => {
      listAgents([listing("agent-a", "agents/alpha.md")]);
      resourceGetMock.mockResolvedValue(stored("agent-a", "agents/alpha.md"));
      const legacy = vi.fn();

      const profile = await resolveAccessibleCustomAgentReference(
        OWNER,
        reference({ metadata: { resourceId } }),
        legacy,
      );

      expect(profile).toBeNull();
      expect(resourceGetMock).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it("resolves the same id after the profile is renamed within agents/", async () => {
    listAgents([listing("agent-a", "agents/alpha.md")]);
    resourceGetMock.mockResolvedValue(
      stored("agent-a", "agents/alpha-renamed.md"),
    );

    const profile = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { resourceId: "agent-a" } }),
      vi.fn(),
    );

    expect(profile).toMatchObject({
      id: "alpha-renamed",
      path: "agents/alpha-renamed.md",
    });
  });

  it("keeps ordinary references on the legacy resolver, untouched", async () => {
    const legacy = vi.fn(async () => ({
      id: "alpha",
      path: "agents/alpha.md",
      name: "Alpha",
      instructions: "",
    }));

    const noMetadata = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference(),
      legacy,
    );
    const otherMetadata = await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ metadata: { note: "not a binding" } }),
      legacy,
    );

    expect(noMetadata).toMatchObject({ id: "alpha" });
    expect(otherMetadata).toMatchObject({ id: "alpha" });
    expect(legacy).toHaveBeenCalledWith(OWNER, "agents/alpha.md");
  });

  it("prefers the legacy refId over path and name", async () => {
    const legacy = vi.fn(async () => null);

    await resolveAccessibleCustomAgentReference(
      OWNER,
      reference({ refId: "alpha-id", path: "agents/other.md", name: "Other" }),
      legacy,
    );

    expect(legacy).toHaveBeenCalledWith(OWNER, "alpha-id");
  });
});

describe("findAccessibleCustomAgent legacy path lookup", () => {
  it("keeps the shared-owner fallback and its access-filtered reads", async () => {
    resourceGetByPathMock.mockImplementation(
      async (owner: string, path: string) => {
        if (owner === SHARED && path === "agents/alpha.md") {
          return stored("shared-a", "agents/alpha.md", SHARED);
        }
        return null;
      },
    );

    const profile = await findAccessibleCustomAgent(OWNER, "alpha");

    expect(profile).toMatchObject({ id: "alpha", path: "agents/alpha.md" });
    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      OWNER,
      "agents/alpha.md",
    );
    expect(resourceGetByPathMock).toHaveBeenCalledWith(
      SHARED,
      "agents/alpha.md",
    );
  });
});
