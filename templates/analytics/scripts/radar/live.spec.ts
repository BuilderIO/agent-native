import { describe, expect, it } from "vitest";

import { liveDatabaseUrlFromEnv } from "./live.ts";

describe("liveDatabaseUrlFromEnv", () => {
  it("reads a remote DATABASE_URL without exposing it in errors", () => {
    expect(
      liveDatabaseUrlFromEnv(
        'DATABASE_URL="postgres://radar:example@db.example.test/analytics"',
      ),
    ).toBe("postgres://radar:example@db.example.test/analytics");
  });

  it("rejects missing or local URLs with a value-free error", () => {
    for (const contents of ["OTHER_KEY=value", "DATABASE_URL=pglite:./local"]) {
      expect(() => liveDatabaseUrlFromEnv(contents)).toThrow(
        "Live radar requires a remote DATABASE_URL in the selected environment file.",
      );
    }
  });
});
