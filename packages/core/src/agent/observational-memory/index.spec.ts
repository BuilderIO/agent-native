import { describe, expect, it } from "vitest";

import * as compactor from "./compactor.js";
import * as observationalMemory from "./index.js";

describe("observational-memory export surface", () => {
  it("re-exports the on-demand compaction entry points", () => {
    expect(observationalMemory.compactThreadNow).toBe(
      compactor.compactThreadNow,
    );
    expect(observationalMemory.getThreadCompactionStatus).toBe(
      compactor.getThreadCompactionStatus,
    );
    expect(observationalMemory.maybeCompactThread).toBe(
      compactor.maybeCompactThread,
    );
  });
});
