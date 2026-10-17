import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveCopyError, type LiveCopyBinding } from "../collab/live-copy.js";
import {
  createCollabSourceSeeder,
  createCollabPlugin,
  liveCopyErrorStatus,
  normalizeCollabAccess,
} from "./collab-plugin.js";

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

describe("createCollabPlugin lazy seeding configuration", () => {
  it("accepts a reverse source mapping for document IDs", () => {
    expect(() =>
      createCollabPlugin({
        table: `mapped_collab_${Date.now()}`,
        resolveSourceIdFromCollabDocumentId: (docId) =>
          docId.startsWith("dash-") ? docId.slice("dash-".length) : docId,
        access: { mode: "all-authenticated" },
      }),
    ).not.toThrow();
  });
});

describe("createCollabPlugin live copies", () => {
  const binding = {} as LiveCopyBinding;
  const access = { mode: "all-authenticated" as const };

  it("refuses the removed onContentSync option instead of ignoring it", () => {
    expect(() =>
      createCollabPlugin({
        access,
        onContentSync: async () => undefined,
      } as Parameters<typeof createCollabPlugin>[0]),
    ).toThrow(/no longer accepts onContentSync/);
  });

  it("requires autoSeed: false and a text content type", () => {
    expect(() => createCollabPlugin({ access, liveCopy: binding })).toThrow(
      /requires autoSeed: false/,
    );
    expect(() =>
      createCollabPlugin({
        access,
        liveCopy: binding,
        autoSeed: false,
        contentType: "json",
      }),
    ).toThrow(/contentType: "json"/);
    expect(() =>
      createCollabPlugin({
        table: `live_copy_${Date.now()}`,
        access,
        liveCopy: binding,
        autoSeed: false,
      }),
    ).not.toThrow();
  });

  it.each([
    ["write_refused", undefined, 409],
    ["not_live_copy", undefined, 409],
    ["not_seeded", "absent", 409],
    ["version_conflict", "5", 409],
    ["state_too_large", "9000000", 413],
    ["malformed_state", "base64", 422],
    ["unsupported_content", "notes", 422],
    ["derive_refused", "unsupported_node", 422],
    ["build_refused", "empty", 422],
    ["derive_failed", "queue_full", 503],
    ["derive_failed", "unavailable", 503],
    ["build_failed", "queue_timeout", 503],
    ["derive_failed", "deadline_exceeded", 503],
    ["derive_failed", "memory_exceeded", 503],
    ["build_failed", "worker_crashed", 503],
    ["derive_failed", "startup_failed", 503],
    ["derive_failed", "output_too_large", 413],
    ["derive_failed", "task_threw", 500],
    ["derive_failed", "invalid_output", 500],
    ["build_failed", "invalid_update", 500],
  ] as const)("maps %s (%s) to HTTP %i", (code, reason, status) => {
    expect(
      liveCopyErrorStatus(
        new LiveCopyError(code, "doc", "message", reason ? { reason } : {}),
      ),
    ).toBe(status);
  });
});

describe("createCollabSourceSeeder", () => {
  it("coalesces a concurrent first load and preserves an empty source", async () => {
    let releaseSource!: () => void;
    const sourceReady = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    const hasState = vi.fn(async () => false);
    const loadSource = vi.fn(async () => {
      await sourceReady;
      return "";
    });
    const seed = vi.fn(async () => {});
    const ensureSeeded = createCollabSourceSeeder({
      hasState,
      loadSource,
      seed,
    });

    const requests = Array.from({ length: 12 }, () =>
      ensureSeeded("design-file-1"),
    );

    expect(hasState).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(loadSource).toHaveBeenCalledOnce());
    releaseSource();
    await Promise.all(requests);

    expect(seed).toHaveBeenCalledOnce();
    expect(seed).toHaveBeenCalledWith("design-file-1", "");
  });
});
