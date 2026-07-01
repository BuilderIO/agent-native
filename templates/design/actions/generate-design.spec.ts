import { describe, expect, it } from "vitest";

import action from "./generate-design.js";

describe("generate-design action tool schema", () => {
  it("exposes a lean native-tool schema while retaining Zod validation", () => {
    const parameters = action.tool.parameters as {
      properties?: Record<
        string,
        { type?: string | readonly string[]; description?: string }
      >;
      required?: string[];
    };

    expect(parameters.required).toEqual(["designId", "prompt", "files"]);
    expect(parameters.properties?.files?.type).toBe("string");
    expect(parameters.properties?.files?.description).toContain(
      "Do not use generate-design to replace a selected variant screen",
    );
    expect(parameters.properties?.files?.description).toContain("edit-design");
    expect(parameters.properties?.designSystemId?.type).toEqual([
      "string",
      "null",
    ]);
    expect(parameters.properties?.tweaks?.type).toBe("string");
    expect(parameters.properties?.canvasFrames?.type).toBe("string");

    const parsed = (action as any).schema.safeParse({
      designId: "design_123",
      prompt: "Dark SaaS landing page",
      designSystemId: null,
      files: JSON.stringify([
        {
          filename: "index.html",
          fileType: "html",
          content: "<!doctype html><html><body>Hello</body></html>",
        },
      ]),
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data.designSystemId).toBeNull();
    expect(parsed.data.files).toEqual([
      {
        filename: "index.html",
        fileType: "html",
        content: "<!doctype html><html><body>Hello</body></html>",
      },
    ]);
  });
});
