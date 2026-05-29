import { describe, expect, it } from "vitest";
import { resolveNavigatePath } from "./navigate";

describe("navigate action", () => {
  it("uses explicit paths first", async () => {
    await expect(
      resolveNavigatePath(
        {
          path: "/page/explicit",
          documentId: "document",
          databaseId: "database",
        },
        async () => "database-document",
      ),
    ).resolves.toBe("/page/explicit");
  });

  it("opens document pages by document ID", async () => {
    await expect(resolveNavigatePath({ documentId: "doc_123" })).resolves.toBe(
      "/page/doc_123",
    );
  });

  it("opens database pages by database ID", async () => {
    await expect(
      resolveNavigatePath({ databaseId: "database" }, async (databaseId) =>
        databaseId === "database" ? "database-page" : null,
      ),
    ).resolves.toBe("/page/database-page");
  });

  it("fails clearly when a database ID cannot be resolved", async () => {
    await expect(
      resolveNavigatePath({ databaseId: "missing" }, async () => null),
    ).rejects.toThrow('Database "missing" not found');
  });

  it("requires a navigation target", async () => {
    await expect(resolveNavigatePath({})).rejects.toThrow(
      "At least --path, --documentId, or --databaseId is required",
    );
  });
});
