import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { parseDescriptor } from "./descriptor.ts";

await test("daily descriptor accepts isolated loopback ports and rejects broader targets", () => {
  const fixture = {
    base: "http://127.0.0.1:32123",
    fake: "http://127.0.0.1:32124",
    cookiePath: resolve(import.meta.dirname, "../../../../.tmp/test-cookie"),
    warmFile: resolve(import.meta.dirname, "../../../../.tmp/test-warmed"),
  };
  assert.equal(parseDescriptor(fixture).base, fixture.base);
  for (const base of [
    "http://127.0.0.1:1",
    "https://127.0.0.1:32123",
    "http://localhost:32123",
    "http://192.0.2.1:32123",
    "http://user@127.0.0.1:32123",
    "http://127.0.0.1:32123/home",
    "http://127.0.0.1:32123/?target=other",
    "http://127.0.0.1:32123/#other",
  ])
    assert.throws(() => parseDescriptor({ ...fixture, base }));
});
