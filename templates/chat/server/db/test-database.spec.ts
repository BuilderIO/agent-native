import { getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { expect, it } from "vitest";

it("uses an isolated in-memory database for tests", () => {
  expect(getRuntimeDatabaseUrl("pglite:./data/pglite")).toBe("pglite:memory");
});
