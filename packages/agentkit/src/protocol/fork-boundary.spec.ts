import { describe, expect, it } from "vitest";

import { parseForkThreadInput } from "./index.js";

describe("fork boundary input", () => {
  it.each([
    { threadId: "thread" },
    { threadId: "thread", fromMessageId: "answer" },
    { threadId: "thread", beforeMessageId: "question" },
    { threadId: "thread", beforeMessageId: "question", forkPurpose: "edit" },
  ])("accepts the explicit compatible contract %j", (input) => {
    expect(parseForkThreadInput(input)).toEqual(input);
  });
  it.each([null, 3, "", "  ", {}, []])(
    "rejects malformed exclusive boundary %j",
    (beforeMessageId) => {
      expect(() =>
        parseForkThreadInput({ threadId: "thread", beforeMessageId }),
      ).toThrow();
    },
  );
  it("rejects unknown fork purposes", () => {
    expect(() =>
      parseForkThreadInput({ threadId: "thread", forkPurpose: "retry" }),
    ).toThrow();
  });
  it("refuses ambiguous inclusive and exclusive boundaries", () => {
    expect(() =>
      parseForkThreadInput({
        threadId: "thread",
        fromMessageId: "answer",
        beforeMessageId: "question",
      }),
    ).toThrow("mutually exclusive");
  });
});
