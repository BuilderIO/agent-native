import { describe, expect, it } from "vitest";

import { chatThreads } from "./schema.js";

describe("chatThreads edit lineage columns", () => {
  it("stores the edited thread's root as nullable text", () => {
    expect(chatThreads.editRootId.name).toBe("edit_root_id");
    expect(chatThreads.editRootId.dataType).toBe("string");
    expect(chatThreads.editRootId.notNull).toBe(false);
  });

  it("stores the kept message prefix as a nullable numeric bigint", () => {
    expect(chatThreads.editPrefixCount.name).toBe("edit_prefix_count");
    expect(chatThreads.editPrefixCount.dataType).toBe("number");
    expect(chatThreads.editPrefixCount.notNull).toBe(false);
  });
});
