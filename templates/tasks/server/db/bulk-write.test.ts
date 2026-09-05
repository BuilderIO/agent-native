import { describe, expect, it } from "vitest";

import { BULK_WRITE_CHUNK_SIZE, chunk } from "./bulk-write.js";

const PARAMS_PER_ENTRY = 3;
const POSTGRES_PARAM_BUDGET = 900;

describe("bulk write chunking", () => {
  it("keeps a full chunk under the Postgres parameter budget", () => {
    expect(BULK_WRITE_CHUNK_SIZE * PARAMS_PER_ENTRY).toBeLessThan(
      POSTGRES_PARAM_BUDGET,
    );
  });

  it("splits at the chunk size and keeps every item", () => {
    const items = Array.from(
      { length: BULK_WRITE_CHUNK_SIZE * 2 + 1 },
      (_, index) => index,
    );
    const chunks = chunk(items);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(BULK_WRITE_CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(BULK_WRITE_CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(1);
    expect(chunks.flat()).toEqual(items);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunk([])).toEqual([]);
  });
});
