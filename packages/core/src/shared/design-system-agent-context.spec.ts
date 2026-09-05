import { describe, expect, it, vi } from "vitest";

import {
  formatAgentDesignSystemContext,
  loadAgentDesignSystemContext,
} from "./design-system-agent-context.js";

describe("agent design-system context", () => {
  it("keeps a linked system's context available in a stable shape", async () => {
    const context = await loadAgentDesignSystemContext(" ds-1 ", async () => ({
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    }));

    expect(context).toEqual({
      status: "available",
      id: "ds-1",
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    });
    expect(formatAgentDesignSystemContext(context)).toContain(
      "Use --brand-accent: #123456.",
    );
  });

  it("does not collapse an unreadable link into no design system", async () => {
    const load = vi.fn(async () => {
      throw new Error("not readable");
    });

    const context = await loadAgentDesignSystemContext("ds-1", load);

    expect(load).toHaveBeenCalledWith("ds-1");
    expect(context).toMatchObject({ status: "unavailable", id: "ds-1" });
    expect(formatAgentDesignSystemContext(context).join("\n")).toContain(
      "do not invent a replacement style",
    );
    await expect(
      loadAgentDesignSystemContext(undefined, load),
    ).resolves.toBeNull();
  });
});
