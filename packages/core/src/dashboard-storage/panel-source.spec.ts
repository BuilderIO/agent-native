import { describe, expect, it, vi } from "vitest";

import {
  createPanelSourceResolverRegistry,
  createProgramPanelSourceResolver,
  parseProgramPanelDescriptor,
} from "./panel-source.js";

describe("dashboard panel source resolvers", () => {
  it("routes requests by source and rejects unknown sources", async () => {
    const resolve = vi.fn(async () => ({ rows: [{ total: 3 }] }));
    const registry = createPanelSourceResolverRegistry({
      resolvers: [{ source: "warehouse", resolve }],
    });

    await expect(
      registry.resolve({ source: "warehouse", query: "select 3" }, {}),
    ).resolves.toEqual({ rows: [{ total: 3 }] });
    await expect(
      registry.resolve({ source: "missing", query: "" }, {}),
    ).rejects.toThrow("Unsupported dashboard panel source: missing");
  });

  it("rejects duplicate resolver registrations", () => {
    expect(() =>
      createPanelSourceResolverRegistry({
        resolvers: [
          { source: "program", resolve: async () => ({ rows: [] }) },
          { source: "program", resolve: async () => ({ rows: [] }) },
        ],
      }),
    ).toThrow("Duplicate panel source resolver: program");
  });

  it("parses bounded program descriptors", () => {
    expect(
      parseProgramPanelDescriptor(
        JSON.stringify({ programId: "dp_pipeline", params: { days: 30 } }),
      ),
    ).toEqual({ programId: "dp_pipeline", params: { days: 30 } });
    expect(() => parseProgramPanelDescriptor("{}")).toThrow(
      "Program panel query requires a programId",
    );
  });

  it("runs program panels with the viewer context and stale fallback", async () => {
    const run = vi.fn(async () => ({
      ok: false,
      lastGoodRun: {
        rows: [{ stage: "Open", value: 12 }],
        schema: [
          { name: "stage", type: "string" },
          { name: "value", type: "number" },
        ],
      },
    }));
    const resolver = createProgramPanelSourceResolver({ appId: "crm", run });

    await expect(
      resolver.resolve(
        {
          source: "program",
          query: JSON.stringify({ programId: "dp_pipeline" }),
        },
        { userEmail: "owner@example.com", orgId: "org_1" },
      ),
    ).resolves.toMatchObject({ rows: [{ stage: "Open", value: 12 }] });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "crm",
        programId: "dp_pipeline",
        ctx: { userEmail: "owner@example.com", orgId: "org_1" },
        triggeredBy: "panel_view",
      }),
    );
  });
});
