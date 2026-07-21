import { describe, expect, it } from "vitest";

import routes from "./routes";

describe("Brain routes", () => {
  it("registers the full-page Agent surface", () => {
    expect(routes).toContainEqual({
      file: "./routes/agent.tsx",
      path: "agent",
    });
  });
});
