import { expect, it } from "vitest";

it("uses an isolated in-memory database for tests", () => {
  expect(process.env.DATABASE_URL).toBe("pglite:memory");
});
