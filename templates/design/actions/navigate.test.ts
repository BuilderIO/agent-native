import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mockWriteAppStateForCurrentTab(...args),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("design navigate action", () => {
  it("carries the requested editor tool into the one-shot navigation command", async () => {
    const result = await action.run({
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      tool: "comment",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      tool: "comment",
    });
    expect(result).toContain("(comment tool)");
  });

  it("focuses the Threads left panel", async () => {
    const args = {
      view: "editor",
      designId: "design-123",
      leftPanel: "threads",
    } as const;
    expect(action.schema!.safeParse(args).success).toBe(true);

    const result = await action.run(args);

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      leftPanel: "threads",
    });
    expect(result).toContain("(threads panel)");
  });

  it("carries the Interact device and theme into the one-shot navigation command", async () => {
    const result = await action.run({
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      interactDevice: "iPhone 17",
      interactTheme: "dark",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      interactDevice: "iPhone 17",
      interactTheme: "dark",
    });
    expect(result).toContain("(device: iPhone 17)");
    expect(result).toContain("(theme: dark)");
  });

  it("only accepts a device the Interact picker offers and a known theme", () => {
    const base = { view: "editor", designId: "design-123" } as const;
    const schema = action.schema!;

    expect(
      schema.safeParse({ ...base, interactDevice: 'MacBook Air 13"' }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...base, interactDevice: "Custom" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...base, interactDevice: "Toaster" }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...base, interactTheme: "light" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, interactTheme: "dark" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, interactTheme: "sepia" }).success).toBe(
      false,
    );
  });

  it("offers Light, Dark and System, and keeps each as asked", async () => {
    const base = { view: "editor", designId: "design-123" } as const;
    const schema = action.schema!;

    const advertised = (
      schema as unknown as {
        "~standard": {
          jsonSchema: {
            input: (options: { target: string }) => {
              properties: Record<
                string,
                { enum?: string[]; description?: string }
              >;
            };
          };
        };
      }
    )["~standard"].jsonSchema.input({ target: "draft-07" });
    expect(advertised.properties.interactTheme?.enum).toEqual([
      "light",
      "dark",
      "system",
    ]);
    expect(advertised.properties.interactTheme?.description).toMatch(
      /system is the default and shows the design exactly as authored/,
    );
    expect(advertised.properties.interactTheme?.description).not.toMatch(
      /editor/,
    );
    expect(action.tool.description).toMatch(
      /interactTheme=light\|dark\|system/,
    );

    for (const interactTheme of ["light", "dark", "system"] as const) {
      const parsed = schema.safeParse({ ...base, interactTheme });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toMatchObject({ interactTheme });
    }
    expect(schema.safeParse({ ...base, interactTheme: "auto" }).success).toBe(
      false,
    );

    await action.run({ ...base, interactTheme: "system" });
    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ interactTheme: "system" }),
    );
  });

  it("rejects an empty navigation command", async () => {
    await expect(action.run({})).rejects.toThrow(
      "At least --view or --path is required.",
    );

    expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it.each(["design", "comments", "tweaks", "code"] as const)(
    "accepts inspector=%s and does not forward it: the inspector has no tabs",
    async (tab) => {
      const base = {
        view: "editor",
        designId: "design-123",
        editorView: "single",
        fileId: "screen-456",
      } as const;
      expect(
        action.schema!.safeParse({ ...base, inspector: tab }).success,
      ).toBe(true);
      expect(
        action.schema!.safeParse({ ...base, inspectorTab: tab }).success,
      ).toBe(true);

      const result = await action.run({ ...base, inspector: tab });

      expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
        view: "editor",
        designId: "design-123",
        editorView: "single",
        fileId: "screen-456",
      });
      expect(result).not.toContain("inspector");
    },
  );

  it("keeps the legacy inspector=extensions alias for the Tools panel", async () => {
    await action.run({
      view: "editor",
      designId: "design-123",
      inspectorTab: "extensions",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      leftPanel: "tools",
    });
  });

  it("prefers an explicit left panel over the legacy inspector alias", async () => {
    await action.run({
      view: "editor",
      designId: "design-123",
      inspector: "extensions",
      leftPanel: "assets",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      leftPanel: "assets",
    });
  });
});
