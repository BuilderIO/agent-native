import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

const mockFrom = vi.fn();

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

describe("index-design-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  // oracle-change: Design Systems removed from Design; its assertions no longer apply

  it("classifies text-size dimensions as font sizes rather than colors", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({}),
    };
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: fakeDesign,
    });
    mockFrom.mockReturnValue({
      where: () =>
        Promise.resolve([
          {
            filename: "tokens.css",
            content: ":root { --text-body-size-medium: 1rem; }",
          },
        ]),
    });

    const result = await action.run({ designId: "design_1" });

    expect(result.tokens).toEqual([
      expect.objectContaining({
        cssVar: "--text-body-size-medium",
        type: "font-size",
      }),
    ]);
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

  it("omits malformed hex values from source CSS and saved selections", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({
        tweakSelections: { "--color-legacy-invalid": "#GGGGGG" },
      }),
    };

    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: fakeDesign,
    });
    mockFrom.mockReturnValue({
      where: () =>
        Promise.resolve([
          {
            filename: "tokens.css",
            content:
              ":root { --color-source-invalid: #GGGGGG; --color-source-valid: #123; }",
          },
        ]),
    });

    const result = await action.run({ designId: "design_1" });
    const cssVars = result.tokens.map(
      (token: { cssVar: string }) => token.cssVar,
    );

    expect(cssVars).not.toContain("--color-source-invalid");
    expect(cssVars).not.toContain("--color-legacy-invalid");
    expect(cssVars).toContain("--color-source-valid");
  });

  it("uses the stored type instead of guessing from the name", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({
        tweakSelections: {
          "--opacity-1": "0.5",
          "--breakpoint-1": "768px",
          "--legacy-unknown": "3",
        },
        tokenTypes: {
          "--opacity-1": "opacity",
          "--breakpoint-1": "breakpoint",
          "--legacy-unknown": "not-a-type",
        },
      }),
    };

    mockResolveAccess.mockResolvedValue({
      role: "editor",
      resource: fakeDesign,
    });

    mockFrom.mockReturnValue({
      where: () => Promise.resolve([]),
    });

    const result = await action.run({ designId: "design_1" });
    const byVar = (cssVar: string) =>
      result.tokens.find((t: { cssVar: string }) => t.cssVar === cssVar);

    expect(byVar("--opacity-1")).toMatchObject({ type: "opacity" });
    expect(byVar("--breakpoint-1")).toMatchObject({ type: "breakpoint" });
    expect(byVar("--legacy-unknown")).toMatchObject({ type: "other" });
    expect(result.groups.map((section) => section.group)).toEqual([
      "spacing",
      "shadow",
      "other",
    ]);
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

  it("lists every contributing file when multiple files declare the same cssVar with the same value", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({}),
    };
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: fakeDesign,
    });
    mockFrom.mockReturnValue({
      where: () =>
        Promise.resolve([
          {
            filename: "task-details.html",
            content: ":root { --radius: 8px; }",
          },
          { filename: "index.html", content: ":root { --radius: 8px; }" },
        ]),
    });

    const result = await action.run({ designId: "design_1" });
    const token = result.tokens.find(
      (t: { cssVar: string }) => t.cssVar === "--radius",
    );

    expect(token).toMatchObject({
      cssVar: "--radius",
      source: "index.html",
      sources: ["index.html", "task-details.html"],
      value: "8px",
    });
    expect(token?.sourceValues).toBeUndefined();
  });

  it("surfaces per-file values when files disagree on the same cssVar", async () => {
    const fakeDesign = {
      id: "design_1",
      data: JSON.stringify({}),
    };
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: fakeDesign,
    });
    mockFrom.mockReturnValue({
      where: () =>
        Promise.resolve([
          {
            filename: "task-details.html",
            content: ":root { --radius: 12px; }",
          },
          { filename: "index.html", content: ":root { --radius: 8px; }" },
        ]),
    });

    const result = await action.run({ designId: "design_1" });
    const token = result.tokens.find(
      (t: { cssVar: string }) => t.cssVar === "--radius",
    );

    expect(token).toMatchObject({
      cssVar: "--radius",
      source: "index.html",
      sources: ["index.html", "task-details.html"],
      sourceValues: { "index.html": "8px", "task-details.html": "12px" },
      value: "8px",
    });
  });
});

describe("index-design-tokens compact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runWith(compact?: boolean) {
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: { id: "design_1", data: JSON.stringify({}) },
    });
    mockFrom.mockReturnValue({
      where: () =>
        Promise.resolve([
          { filename: "a.html", content: ":root { --brand: #111111; }" },
          { filename: "b.html", content: ":root { --brand: #222222; }" },
        ]),
    });
    return action.run({ designId: "design_1", compact });
  }

  it("lists every contributing file by default", async () => {
    const result = await runWith();

    expect(result.tokens[0]).toMatchObject({
      cssVar: "--brand",
      sources: ["a.html", "b.html"],
      sourceValues: { "a.html": "#111111", "b.html": "#222222" },
    });
  });

  it("leaves out the per-file lists but keeps the token and its groups", async () => {
    const result = await runWith(true);

    expect(result.tokens[0]).not.toHaveProperty("sources");
    expect(result.tokens[0]).not.toHaveProperty("sourceValues");
    expect(result.tokens[0]).toMatchObject({ cssVar: "--brand" });
    expect(result.tokenCount).toBe(1);
    expect(result.groups.flatMap((group) => group.tokens)).toHaveLength(1);
  });
});
