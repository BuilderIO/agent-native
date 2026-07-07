import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDataProgram: vi.fn(),
}));

vi.mock("@agent-native/core/data-programs", () => ({
  runDataProgram: mocks.runDataProgram,
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: vi.fn(async () => "unused-in-program-tests"),
}));

import {
  isDashboardPanelSource,
  normalizeDashboardPanelQuery,
  runDashboardPanelQuery,
  serializeProgramDescriptorInput,
} from "./dashboard-panel-query";

describe("dashboard-panel-query: program source", () => {
  beforeEach(() => {
    mocks.runDataProgram.mockReset();
  });

  it("is a recognized dashboard panel source", () => {
    expect(isDashboardPanelSource("program")).toBe(true);
  });

  describe("normalizeDashboardPanelQuery", () => {
    it("serializes an object descriptor into canonical JSON", () => {
      const serialized = normalizeDashboardPanelQuery("program", {
        programId: "dp_risk_cohort",
        params: { riskStatuses: ["at_risk"] },
      });
      expect(JSON.parse(serialized)).toEqual({
        programId: "dp_risk_cohort",
        params: { riskStatuses: ["at_risk"] },
      });
    });

    it("passes through an already-serialized JSON string", () => {
      const raw = JSON.stringify({ programId: "dp_abc" });
      expect(normalizeDashboardPanelQuery("program", raw)).toBe(raw);
    });

    it("throws on a missing programId in object form", () => {
      expect(() =>
        normalizeDashboardPanelQuery("program", { params: {} }),
      ).toThrow(/programId/);
    });

    it("throws on missing/empty query", () => {
      expect(() => normalizeDashboardPanelQuery("program", "")).toThrow(
        /Missing or invalid query/,
      );
      expect(() => normalizeDashboardPanelQuery("program", undefined)).toThrow(
        /Missing or invalid query/,
      );
    });

    it("throws on a non-object, non-string descriptor", () => {
      expect(() =>
        serializeProgramDescriptorInput(["not", "an", "object"]),
      ).toThrow(/JSON string or object/);
    });
  });

  describe("runDashboardPanelQuery dispatch", () => {
    const ctx = { userEmail: "alice@example.com", orgId: "org_1" };

    it("maps an ok:true result to {rows, schema, truncated}", async () => {
      mocks.runDataProgram.mockResolvedValue({
        ok: true,
        rows: [{ dealname: "Acme", risk_status: "at_risk" }],
        schema: [
          { name: "dealname", type: "string" },
          { name: "risk_status", type: "string" },
        ],
        truncated: true,
        stale: false,
        cacheHit: true,
        asOfMs: Date.now(),
        runId: "run_1",
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_risk_cohort",
        params: { riskStatuses: ["at_risk"] },
      });
      const result = await runDashboardPanelQuery({
        source: "program",
        query,
        ctx,
      });

      expect(result).toEqual({
        rows: [{ dealname: "Acme", risk_status: "at_risk" }],
        schema: [
          { name: "dealname", type: "string" },
          { name: "risk_status", type: "string" },
        ],
        truncated: true,
      });
      expect(mocks.runDataProgram).toHaveBeenCalledWith({
        programId: "dp_risk_cohort",
        appId: "analytics",
        params: { riskStatuses: ["at_risk"] },
        ctx: { userEmail: "alice@example.com", orgId: "org_1" },
        triggeredBy: "panel_view",
      });
    });

    it("stale-serves lastGoodRun when ok:false but a prior good run exists", async () => {
      const asOfMs = Date.now() - 60_000;
      mocks.runDataProgram.mockResolvedValue({
        ok: false,
        error: {
          code: "timeout",
          message: "The program did not finish in time.",
        },
        lastGoodRun: {
          rows: [{ account: "Globex" }],
          schema: [{ name: "account", type: "string" }],
          truncated: true,
          asOfMs,
        },
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_risk_cohort",
      });
      const result = await runDashboardPanelQuery({
        source: "program",
        query,
        ctx,
      });

      expect(result).toEqual({
        rows: [{ account: "Globex" }],
        schema: [{ name: "account", type: "string" }],
        truncated: true,
      });
    });

    it("throws a structured error with code prefix when there is no lastGoodRun", async () => {
      mocks.runDataProgram.mockResolvedValue({
        ok: false,
        error: {
          code: "sandbox_error",
          message: "ReferenceError: foo is not defined",
        },
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_broken",
      });

      await expect(
        runDashboardPanelQuery({ source: "program", query, ctx }),
      ).rejects.toThrow(/sandbox_error: ReferenceError: foo is not defined/);
    });

    it("surfaces a friendly message for access_denied", async () => {
      mocks.runDataProgram.mockResolvedValue({
        ok: false,
        error: { code: "access_denied", message: "raw internal message" },
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_private",
      });

      await expect(
        runDashboardPanelQuery({ source: "program", query, ctx }),
      ).rejects.toThrow(
        /access_denied: You don't have access to this data program/,
      );
    });

    it("surfaces a friendly message for archived", async () => {
      mocks.runDataProgram.mockResolvedValue({
        ok: false,
        error: { code: "archived", message: "raw internal message" },
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_old",
      });

      await expect(
        runDashboardPanelQuery({ source: "program", query, ctx }),
      ).rejects.toThrow(/archived: This data program was archived/);
    });

    it("surfaces a friendly message for background_pending", async () => {
      mocks.runDataProgram.mockResolvedValue({
        ok: false,
        error: { code: "background_pending", message: "raw internal message" },
      });

      const query = normalizeDashboardPanelQuery("program", {
        programId: "dp_bg",
      });

      await expect(
        runDashboardPanelQuery({ source: "program", query, ctx }),
      ).rejects.toThrow(
        /background_pending: This data program is still computing — check back shortly/,
      );
    });

    it("throws a clear parse error for malformed JSON in the sql field", async () => {
      await expect(
        runDashboardPanelQuery({
          source: "program",
          query: "not json",
          ctx,
        }),
      ).rejects.toThrow(/program panel sql must be a JSON object/);
      expect(mocks.runDataProgram).not.toHaveBeenCalled();
    });

    it("throws a clear error when the descriptor is missing programId", async () => {
      await expect(
        runDashboardPanelQuery({
          source: "program",
          query: JSON.stringify({ params: {} }),
          ctx,
        }),
      ).rejects.toThrow(
        /program panel descriptor requires a 'programId' field/,
      );
      expect(mocks.runDataProgram).not.toHaveBeenCalled();
    });
  });
});
