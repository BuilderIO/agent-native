import { describe, it, expect } from "vitest";

import { validateAppSql } from "./app-sql";

describe("validateAppSql", () => {
  it("accepts a single SELECT over an allowed table", () => {
    expect(() =>
      validateAppSql(
        "SELECT COUNT(*) AS value FROM strategic_account_contacts",
      ),
    ).not.toThrow();
  });

  it("accepts WITH/CTE that reads an allowed table", () => {
    expect(() =>
      validateAppSql(
        "WITH t AS (SELECT * FROM implementation_blockers) SELECT COUNT(*) AS value FROM t",
      ),
    ).not.toThrow();
  });

  it("rejects non-whitelisted tables", () => {
    expect(() => validateAppSql("SELECT * FROM secrets")).toThrow(
      /can only read/i,
    );
  });

  it("rejects write statements", () => {
    expect(() =>
      validateAppSql("DELETE FROM strategic_account_contacts"),
    ).toThrow(/SELECT or WITH/i);
  });

  it("rejects an UPDATE that targets an allowed table", () => {
    expect(() =>
      validateAppSql("UPDATE strategic_account_contacts SET email = 'x@y.z'"),
    ).toThrow();
  });

  it("rejects multiple statements", () => {
    expect(() =>
      validateAppSql(
        "SELECT * FROM strategic_accounts; DROP TABLE strategic_accounts",
      ),
    ).toThrow(/single SELECT/i);
  });

  it("requires reading from at least one allowed table", () => {
    expect(() => validateAppSql("SELECT 1 AS value")).toThrow(
      /must read from/i,
    );
  });
});
