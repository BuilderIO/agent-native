import { describe, expect, it, vi } from "vitest";

import {
  formatAgentDesignSystemContext,
  loadAgentDesignSystemContext,
} from "./design-system-agent-context.js";

describe("agent design-system context", () => {
  it("routes foreign references and full-context hints to the exact owner and content revision", async () => {
    const run = vi.fn(async () => ({
      title: "Owned by Design",
      agentContext: "Actual owner context",
    }));
    const context = await loadAgentDesignSystemContext(
      "same-id-local",
      { run },
      {
        reference: {
          id: "foreign-system",
          ownerApp: "design",
          consumedRevision: 7,
        },
      },
    );
    expect(run).toHaveBeenCalledWith({
      id: "foreign-system",
      compact: "true",
      ownerApp: "design",
      consumedRevision: 7,
    });
    expect(context).toMatchObject({
      status: "available",
      next: expect.stringContaining('ownerApp: "design", consumedRevision: 7'),
    });
  });

  it("does not replace an unavailable pinned revision with latest or a same-ID local system", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("pinned unavailable"), { statusCode: 409 });
    });
    const context = await loadAgentDesignSystemContext(
      "same-id",
      { run },
      { reference: { id: "same-id", ownerApp: "design", consumedRevision: 3 } },
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(context).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining(
        "pinned design system revision is unavailable",
      ),
    });
  });
  it("reads the bounded summary by default, calling run once with compact true", async () => {
    const run = vi.fn(async () => ({
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    }));

    const context = await loadAgentDesignSystemContext(" ds-1 ", { run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ id: "ds-1", compact: "true" });
    expect(context).toEqual({
      status: "available",
      scope: "summary",
      id: "ds-1",
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
      next: 'Call get-design-system { id: "ds-1" } once before the first slide or screen you author for the full tokens, assets, docs, and custom instructions; reuse it for every later write.',
    });
    expect(formatAgentDesignSystemContext(context)).toContain(
      "Use --brand-accent: #123456.",
    );
  });

  it("reads the full context on request, with no next pointer", async () => {
    const run = vi.fn(async () => ({
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    }));

    const context = await loadAgentDesignSystemContext(
      "ds-1",
      { run },
      { full: true },
    );

    expect(run).toHaveBeenCalledWith({ id: "ds-1", compact: "false" });
    expect(context).toMatchObject({ status: "available", scope: "full" });
    expect(context).not.toHaveProperty("next");
  });

  it("tells the caller not to retry a design system that no longer exists or is not shared", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    });

    const context = await loadAgentDesignSystemContext("ds-1", { run });

    expect(context).toMatchObject({ status: "unavailable", id: "ds-1" });
    expect(formatAgentDesignSystemContext(context).join("\n")).toContain(
      "Do not retry get-design-system",
    );
  });

  it("does not collapse a transient read failure into no design system", async () => {
    const run = vi.fn(async () => {
      throw new Error("not readable");
    });

    const context = await loadAgentDesignSystemContext("ds-1", { run });

    expect(run).toHaveBeenCalledWith({ id: "ds-1", compact: "true" });
    expect(context).toMatchObject({ status: "unavailable", id: "ds-1" });
    expect(formatAgentDesignSystemContext(context).join("\n")).toContain(
      "do not invent a replacement style",
    );
  });

  it("treats a malformed result as unavailable", async () => {
    const run = vi.fn(async () => ({ title: "Acme", agentContext: "" }));

    const context = await loadAgentDesignSystemContext("ds-1", { run });

    expect(context).toMatchObject({ status: "unavailable", id: "ds-1" });
  });

  it("returns null for an empty or missing id without reading anything", async () => {
    const run = vi.fn();

    await expect(
      loadAgentDesignSystemContext(undefined, { run }),
    ).resolves.toBeNull();
    await expect(
      loadAgentDesignSystemContext("  ", { run }),
    ).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
