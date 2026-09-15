import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { createSkeletonProjectIR } from "./agent-introspection.js";
import {
  selectSourceAdapter,
  sourceAdapterRegistry,
} from "./source-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../__fixtures__");

describe("source adapter selection", () => {
  it("selects the deterministic Next.js adapter for local Next.js paths", async () => {
    expect(sourceAdapterRegistry.map((adapter) => adapter.id)).toEqual([
      "nextjs",
    ]);

    const adapter = await selectSourceAdapter({
      sourceRoot: path.join(fixtures, "next-pages"),
      inputKind: "path",
    });

    expect(adapter?.id).toBe("nextjs");
  });

  it("does not run path-only deterministic adapters for URL inputs", async () => {
    const adapter = await selectSourceAdapter({
      sourceRoot: "https://example.com/dashboard",
      inputKind: "url",
    });

    expect(adapter).toBeNull();
  });
});

describe("agent-introspection skeleton IR", () => {
  it("creates a valid URL fallback inventory", () => {
    const ir = createSkeletonProjectIR({
      sourceRoot: "https://example.com/docs/getting-started?ref=test",
      inputKind: "url",
      inputDescription: "Docs site to migrate",
      generatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(ir.site.framework).toBe("unknown");
    expect(ir.site.routes[0]).toMatchObject({
      path: "/docs/getting-started",
      router: "unknown",
      kind: "docs",
      public: true,
    });
    expect(ir.site.metadata).toMatchObject({
      source: "agent-introspection",
      inputKind: "url",
      needsAgentIntrospection: true,
    });
  });

  it("creates a valid description fallback inventory", () => {
    const ir = createSkeletonProjectIR({
      sourceRoot: "A private dashboard for invoices and approvals",
      inputKind: "description",
    });

    expect(ir.site.sourceRoot).toBe(
      "A private dashboard for invoices and approvals",
    );
    expect(ir.site.routes[0]).toMatchObject({
      path: "/",
      kind: "app",
      public: false,
    });
    expect(ir.behavior.apiEndpoints).toEqual([]);
  });
});
