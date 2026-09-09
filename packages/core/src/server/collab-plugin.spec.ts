import { createApp } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CollabDocumentLifecycleError,
  registerCollabLifecycle,
} from "../collab/lifecycle.js";
import * as manager from "../collab/ydoc-manager.js";
import {
  createCollabPlugin,
  normalizeCollabAccess,
  selectUnseededCollabRows,
} from "./collab-plugin.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));
vi.mock("./auth.js", () => ({
  getSession: vi.fn(async () => ({ email: "editor@example.test" })),
}));
vi.mock("../org/context.js", () => ({
  getOrgContext: vi.fn(async () => null),
}));
vi.mock("../collab/emitter.js", () => ({
  getCollabEmitter: () => ({ on: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collab lifecycle HTTP responses", () => {
  const mutations = [
    ["update", "applyUpdate", { update: "AAA=" }],
    ["text", "applyText", { text: "changed" }],
    ["search-replace", "searchAndReplace", { find: "old", replace: "new" }],
    ["json", "applyJson", { json: { title: "changed" } }],
    ["patch", "applyPatchOps", { ops: [] }],
  ] as const;

  it.each(mutations)(
    "serializes terminal errors from %s through the mounted framework route",
    async (action, mutation, body) => {
      const app = createApp();
      await createCollabPlugin({
        access: { mode: "all-authenticated" },
        autoSeed: false,
      })({ h3: app });
      const persist = vi.spyOn(manager, mutation);

      for (const trashed of [true, false]) {
        const error = new CollabDocumentLifecycleError(trashed);
        persist.mockRejectedValueOnce(error);
        const response = await app.request(
          `http://example.test/_agent-native/collab/document-1/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        expect(response.status).toBe(error.statusCode);
        expect(await response.json()).toEqual({
          error: error.message,
          errorCode: error.errorCode,
        });
      }
      expect(persist).toHaveBeenCalledTimes(2);
    },
  );

  it("leaves unexpected persistence failures to the framework error handler", async () => {
    const app = createApp();
    await createCollabPlugin({
      access: { mode: "all-authenticated" },
      autoSeed: false,
    })({ h3: app });
    vi.spyOn(manager, "applyUpdate").mockRejectedValueOnce(
      new Error("Persistence unavailable"),
    );
    const response = await app.request(
      "http://example.test/_agent-native/collab/document-1/update",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update: "AAA=" }),
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Persistence unavailable" });
  });
});

describe("collab lifecycle configuration", () => {
  it("registers the configured source lifecycle when the plugin is created", () => {
    createCollabPlugin({
      table: "example_documents",
      idColumn: "document_id",
      lifecycle: { deletedAtColumn: "trashed_at" },
      access: { mode: "all-authenticated" },
    });
    const unregister = registerCollabLifecycle({
      table: "example_documents",
      idColumn: "document_id",
      deletedAtColumn: "trashed_at",
    });
    try {
      expect(() =>
        registerCollabLifecycle({
          table: "other_documents",
          idColumn: "id",
          deletedAtColumn: "trashed_at",
        }),
      ).toThrow(/different lifecycle policy/);
    } finally {
      unregister();
    }
  });

  it("requires inverse source mapping for mapped collaboration IDs", () => {
    expect(() =>
      createCollabPlugin({
        resolveCollabDocumentId: (id) => `example-${id}`,
        lifecycle: { deletedAtColumn: "trashed_at" },
        access: { mode: "all-authenticated" },
      }),
    ).toThrow(/requires resolveSourceId/);
  });
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

describe("selectUnseededCollabRows", () => {
  it("filters using mapped collab ids and batches duplicate mappings", () => {
    const rows = [
      { id: "one", config: "first" },
      { id: "two", config: "second" },
      { id: "three", config: "third" },
    ];

    expect(
      selectUnseededCollabRows(
        rows,
        "id",
        new Set(["dash-one"]),
        (sourceId) => `dash-${sourceId}`,
      ),
    ).toEqual([
      { row: rows[1], docId: "dash-two" },
      { row: rows[2], docId: "dash-three" },
    ]);
  });
});
