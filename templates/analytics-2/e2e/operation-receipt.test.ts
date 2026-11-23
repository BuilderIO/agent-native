import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readRequestId, retainRequestId } from "./operation-receipt.js";

const id = "3f2b8a52-64d4-4a9e-9d58-0f8c3f4b7a11";

describe("operation receipt", () => {
  it("reads only a strict UUID request id", () => {
    assert.equal(readRequestId({ requestId: id }), id);
    assert.equal(readRequestId({ requestId: "nope" }), undefined);
    assert.equal(readRequestId(null), undefined);
  });
  it("persists the id before any later step can be interrupted", () => {
    const dir = mkdtempSync(join(tmpdir(), "receipt-"));
    retainRequestId(dir, id, "native");
    const [file] = readdirSync(dir);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, file), "utf8")), {
      requestId: id,
      writer: "native",
    });
  });
});
