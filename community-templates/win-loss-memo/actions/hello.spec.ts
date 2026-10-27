import { describe, expect, it } from "vitest";

import action from "./hello";

describe("hello", () => {
  it("defaults name to world when omitted", async () => {
    const result = await action.run({});

    expect(result).toEqual({ message: "Hello, world!" });
  });

  it("greets the provided name", async () => {
    const result = await action.run({ name: "Steve" });

    expect(result).toEqual({ message: "Hello, Steve!" });
  });
});
