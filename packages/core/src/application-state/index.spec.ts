import { describe, expect, it } from "vitest";

import * as handlers from "./handlers.js";
import {
  getStateMany,
  MAX_APP_STATE_BATCH_KEYS,
  MAX_APP_STATE_BATCH_WRITES,
  putStateMany,
} from "./index.js";

describe("@agent-native/core/application-state", () => {
  it("exports the batched read and write handlers with their limits", () => {
    expect(getStateMany).toBe(handlers.getStateMany);
    expect(putStateMany).toBe(handlers.putStateMany);
    expect(MAX_APP_STATE_BATCH_KEYS).toBe(handlers.MAX_APP_STATE_BATCH_KEYS);
    expect(MAX_APP_STATE_BATCH_WRITES).toBe(
      handlers.MAX_APP_STATE_BATCH_WRITES,
    );
  });
});
