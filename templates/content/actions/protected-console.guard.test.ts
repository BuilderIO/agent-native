import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const actionsDirectory = new URL("./", import.meta.url);

describe("protected action logging guard", () => {
  it("forbids raw console calls in every protected action module", () => {
    const violations = readdirSync(actionsDirectory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => {
        const source = readFileSync(new URL(name, actionsDirectory), "utf8");
        return (
          /resourcePrivacy\s*:/.test(source) && /\bconsole\s*\./.test(source)
        );
      });
    expect(violations).toEqual([]);
  });
});
