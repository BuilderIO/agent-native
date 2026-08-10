import { describe, expect, it } from "vitest";

import action from "./import-code";

describe("import-code", () => {
  it("keeps the Design action entrypoint backed by shared analysis", async () => {
    await expect(
      action.run({
        files: [
          {
            filename: "theme.css",
            content: ":root { --brand: #123456; }",
          },
        ],
      }),
    ).resolves.toMatchObject({
      source: "code",
      fileCount: 1,
      filesAnalyzed: ["theme.css"],
    });
  });
});
