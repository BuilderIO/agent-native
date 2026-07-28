import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollabPlugin, normalizeCollabAccess } from "./collab-plugin.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeCollabAccess", () => {
  it("normalizes the resource access policy", () => {
    const resolveResourceId = (docId: string) => `parent-${docId}`;

    expect(
      normalizeCollabAccess({
        access: {
          mode: "resource",
          resourceType: "document",
          resolveResourceId,
        },
      }),
    ).toEqual({
      mode: "resource",
      resourceType: "document",
      resolveResourceId,
    });
  });

  it("normalizes the deprecated root options without changing behavior", () => {
    const resolveResourceId = (docId: string) => `parent-${docId}`;

    expect(
      normalizeCollabAccess({
        resourceType: "document",
        resolveResourceId,
      }),
    ).toEqual({
      mode: "resource",
      resourceType: "document",
      resolveResourceId,
    });
  });

  it("distinguishes explicit and implicit all-authenticated access", () => {
    expect(
      normalizeCollabAccess({ access: { mode: "all-authenticated" } }),
    ).toEqual({ mode: "all-authenticated", explicit: true });
    expect(normalizeCollabAccess({})).toEqual({
      mode: "all-authenticated",
      explicit: false,
    });
  });

  it.each([
    { resourceType: "document" },
    { resolveResourceId: (docId: string) => docId },
  ])("rejects access combined with deprecated root options", (legacy) => {
    expect(() =>
      normalizeCollabAccess({
        access: { mode: "all-authenticated" },
        ...legacy,
      }),
    ).toThrow(/cannot combine "access" with the deprecated root/);
  });

  it.each([
    { access: { mode: "resource" as const, resourceType: "" } },
    { access: { mode: "resource" as const, resourceType: "   " } },
    { resourceType: "" },
    { resourceType: "   " },
  ])("rejects an empty resource type", (options) => {
    expect(() => normalizeCollabAccess(options)).toThrow(
      /non-empty (resourceType|string)/,
    );
  });

  it("rejects a legacy resolver without a resource type", () => {
    expect(() =>
      normalizeCollabAccess({ resolveResourceId: (docId) => docId }),
    ).toThrow(/requires a non-empty "resourceType"/);
  });
});

describe("createCollabPlugin access warning", () => {
  it("names the affected table and explains both explicit choices", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const table = `implicit_collab_${Date.now()}`;

    createCollabPlugin({ table });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"${table}"`));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('access: { mode: "resource"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('access: { mode: "all-authenticated" }'),
    );
  });

  it("warns only once per implicitly unscoped table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const table = `repeated_implicit_collab_${Date.now()}`;

    createCollabPlugin({ table });
    createCollabPlugin({ table });

    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    { access: { mode: "all-authenticated" as const } },
    { access: { mode: "resource" as const, resourceType: "document" } },
    { resourceType: "document" },
  ])("does not warn for an explicit access policy", (options) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createCollabPlugin({
      table: `explicit_collab_${Math.random()}`,
      ...options,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
