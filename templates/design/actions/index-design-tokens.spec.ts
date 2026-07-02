/**
 * Tests for index-design-tokens token-leakage fix.
 *
 * Issue: the action checked access on the design but then read a linked
 * design system's tokens without checking design-system access — bypassing the
 * design-system share boundary.
 *
 * Fix: when a design has a designSystemId, resolve access to that design
 * system before returning its tokens. If the caller has no access to the
 * design system, its tokens must be omitted.
 *
 * These tests verify the shape of the action (readOnly GET) and the
 * observable behaviour via mocking the access layer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the sharing module so we can simulate access scenarios.
// ---------------------------------------------------------------------------
const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

// Mock the DB so we never hit a real database.
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: mockFrom }),
  }),
  schema: {
    designFiles: {
      designId: "designId",
      filename: "filename",
      content: "content",
    },
    designSystems: { id: "id", data: "data" },
  },
}));

import action from "./index-design-tokens.js";

describe("index-design-tokens action metadata", () => {
  it("is read-only (returns tokens, no mutations)", () => {
    expect((action as { readOnly?: boolean }).readOnly).toBe(true);
  });

  it("uses HTTP GET", () => {
    const http = (action as { http?: { method?: string } }).http;
    expect(http?.method).toBe("GET");
  });
});

describe("index-design-tokens design-system access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips design-system tokens when the caller has no design-system access", async () => {
    // The design itself resolves fine.
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({}),
      designSystemId: "ds_1",
    };

    mockResolveAccess.mockImplementation(
      (resourceType: string, _id: string) => {
        if (resourceType === "design")
          return Promise.resolve({ role: "viewer", resource: fakeDesign });
        if (resourceType === "design-system") return Promise.resolve(null); // no access
        return Promise.resolve(null);
      },
    );

    // DB: return empty files list (no CSS vars to parse)
    mockFrom.mockReturnValue({
      where: () => Promise.resolve([]),
    });

    const result = await action.run({ designId: "design_1" });

    // Design system tokens must NOT appear in the output.
    expect(result.tokens).toEqual([]);
    expect(result.groups).toEqual([]);
    // resolveAccess should have been called for BOTH the design AND the design system.
    expect(mockResolveAccess).toHaveBeenCalledWith("design", "design_1");
    expect(mockResolveAccess).toHaveBeenCalledWith("design-system", "ds_1");
  });

  it("includes design-system tokens when the caller HAS design-system access", async () => {
    const dsData = JSON.stringify({
      colors: { primary: "#ff0000" },
    });
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({}),
      designSystemId: "ds_1",
    };
    const fakeDs = { data: dsData };

    mockResolveAccess.mockImplementation(
      (resourceType: string, _id: string) => {
        if (resourceType === "design")
          return Promise.resolve({ role: "viewer", resource: fakeDesign });
        if (resourceType === "design-system")
          return Promise.resolve({ role: "viewer", resource: {} });
        return Promise.resolve(null);
      },
    );

    // DB for files: empty; DB for design-system row: fakeDs
    let callCount = 0;
    mockFrom.mockImplementation(() => ({
      where: (_: unknown) => {
        callCount++;
        // First call is for design files (empty), second is for design system data
        if (callCount === 1) return Promise.resolve([]);
        return { limit: () => Promise.resolve([fakeDs]) };
      },
    }));

    const result = await action.run({ designId: "design_1" });

    // The primary Brand Kit color should be included.
    const colorToken = result.tokens.find(
      (t: { cssVar: string }) => t.cssVar === "--color-primary",
    );
    expect(colorToken).toBeDefined();
    expect(colorToken?.value).toBe("#ff0000");
  });

  it("includes raw CSS vars persisted in tweakSelections", async () => {
    const glow = "0 0 24px rgba(14, 165, 233, 0.4)";
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({
        tweakSelections: {
          "--shadow-glow": glow,
        },
      }),
      designSystemId: null,
    };

    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: fakeDesign,
    });

    mockFrom.mockReturnValue({
      where: () => Promise.resolve([]),
    });

    const result = await action.run({ designId: "design_1" });
    const token = result.tokens.find(
      (t: { cssVar: string }) => t.cssVar === "--shadow-glow",
    );

    expect(token).toMatchObject({
      cssVar: "--shadow-glow",
      isTweakOverride: true,
      name: "Shadow Glow",
      source: "Tweaks",
      type: "shadow",
      value: glow,
    });
  });

  it("uses import provenance as the source chip for imported tweak tokens", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({
        tweakSelections: {
          "--color-accent": "#2563eb",
        },
        tokenImportSources: {
          "--color-accent": "design.md",
        },
      }),
      designSystemId: null,
    };

    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: fakeDesign,
    });

    mockFrom.mockReturnValue({
      where: () => Promise.resolve([]),
    });

    const result = await action.run({ designId: "design_1" });
    const token = result.tokens.find(
      (t: { cssVar: string }) => t.cssVar === "--color-accent",
    );

    expect(token).toMatchObject({
      cssVar: "--color-accent",
      source: "design.md",
      value: "#2563eb",
    });
  });
});
