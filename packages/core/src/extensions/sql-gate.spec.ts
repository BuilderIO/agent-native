import { describe, it, expect } from "vitest";

import {
  DESTRUCTIVE_SQL_RE,
  SENSITIVE_SQL_RE,
  POSITIONAL_INSERT_RE,
  matchesSqlGate,
} from "./routes.js";

/**
 * Regression coverage for the extension SQL blocklist gates. The blocklist is
 * best-effort defense in depth (the authoritative ownership boundary is the
 * fail-closed temp-view scoping in scripts/db/scoping.ts), but it must at least
 * resist the obvious comment-splitting evasions. `matchesSqlGate` tests each
 * regex against the SQL with comments normalized two ways — replaced with a
 * space (keeps token boundaries) and removed entirely (rejoins split keywords)
 * — and blocks if EITHER trips. Between them they cover both token-splitting
 * (`DR/**​/OP`) and separator-injection (`FROM/**​/recordings`).
 */
describe("extension SQL gate — comment-evasion resistance", () => {
  describe("destructive statements", () => {
    const blocked = [
      "DROP TABLE recordings",
      "DROP /* x */ TABLE recordings", // separator-injection → caught by →space
      "DR/**/OP TABLE recordings", // token-split → caught by →empty
      "DELETE FROM recordings", // non-tool_data delete
      "DELETE FROM/**/recordings", // separator-injection → caught by →space
      "TRUNCATE recordings",
      "CREATE TABLE evil (id int)",
      "ALTER TABLE recordings ADD COLUMN x int",
    ];
    for (const sql of blocked) {
      it(`blocks: ${sql}`, () => {
        expect(matchesSqlGate(DESTRUCTIVE_SQL_RE, sql)).toBe(true);
      });
    }

    const allowed = [
      "SELECT * FROM tool_data",
      "INSERT INTO tool_data (a, b) VALUES (?, ?)",
      "DELETE FROM tool_data WHERE id = ?", // extensions may delete their own rows
      "UPDATE tool_data SET a = ? WHERE id = ?",
    ];
    for (const sql of allowed) {
      it(`allows: ${sql}`, () => {
        expect(matchesSqlGate(DESTRUCTIVE_SQL_RE, sql)).toBe(false);
      });
    }
  });

  describe("sensitive tables", () => {
    it("blocks a direct read of a framework table", () => {
      expect(
        matchesSqlGate(SENSITIVE_SQL_RE, "SELECT * FROM app_secrets"),
      ).toBe(true);
    });
    it("blocks a comment-split sensitive table name", () => {
      expect(
        matchesSqlGate(SENSITIVE_SQL_RE, "SELECT * FROM app/**/_secrets"),
      ).toBe(true);
    });
    it("does not flag a legitimate tool_data query with a real comment", () => {
      expect(
        matchesSqlGate(
          SENSITIVE_SQL_RE,
          "SELECT id FROM tool_data /* notes */ WHERE note = ?",
        ),
      ).toBe(false);
    });
  });

  describe("positional inserts", () => {
    it("blocks a column-less INSERT", () => {
      expect(
        matchesSqlGate(
          POSITIONAL_INSERT_RE,
          "INSERT INTO recordings VALUES (?)",
        ),
      ).toBe(true);
    });
    it("allows an explicit column-list INSERT", () => {
      expect(
        matchesSqlGate(
          POSITIONAL_INSERT_RE,
          "INSERT INTO recordings (a, b) VALUES (?, ?)",
        ),
      ).toBe(false);
    });
  });
});
