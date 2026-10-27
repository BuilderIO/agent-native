import { describe, expect, it } from "vitest";

import config from "./agent-native.config.js";

describe("theme family opt-in", () => {
  it("defaults this replica template to Agent-Native and keeps Original available", () => {
    expect(config).toMatchObject({
      themeFamily: {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      },
    });
  });
});
