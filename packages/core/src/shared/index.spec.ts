import { describe, expect, it } from "vitest";

import * as shared from "./index.js";
import * as reasoningEffort from "./reasoning-effort.js";

describe("shared export surface", () => {
  it("re-exports isUnsetReasoningEffort from the reasoning effort module", () => {
    expect(shared.isUnsetReasoningEffort).toBe(
      reasoningEffort.isUnsetReasoningEffort,
    );
  });
});
