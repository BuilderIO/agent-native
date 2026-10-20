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

  it("does not apply the default when name is an empty string", async () => {
    const result = await action.run({ name: "" });

    expect(result).toEqual({ message: "Hello, !" });
  });
});
