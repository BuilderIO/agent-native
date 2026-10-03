import { describe, expect, it } from "vitest";

import vitestConfig from "./vitest.config";

describe("Chat Vitest config", () => {
  it("does not load the production Vite plugin stack", () => {
    expect(vitestConfig.plugins).toBeUndefined();
  });
});
