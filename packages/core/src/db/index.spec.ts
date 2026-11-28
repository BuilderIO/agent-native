import { describe, expect, it } from "vitest";

import {
  claimLease,
  holdsLease,
  isLeaseHeld,
  isLeaseLost,
  leaseHeld,
  LeaseLostError,
  releaseLease,
  renewLease,
  sql,
  writeUnderLease,
  type SqlFragment,
} from "./index.js";

describe("database exports", () => {
  it("exports typed SQL fragments from the database entry point", () => {
    const fragment: SqlFragment = sql`SELECT ${sql.value("thread-1")}`;

    expect(fragment.sql).toBe("SELECT ?");
    expect(fragment.args).toEqual(["thread-1"]);
  });

  it("exports the lease helpers from the database entry point", () => {
    for (const helper of [
      claimLease,
      holdsLease,
      isLeaseHeld,
      isLeaseLost,
      leaseHeld,
      releaseLease,
      renewLease,
      writeUnderLease,
    ]) {
      expect(helper).toBeTypeOf("function");
    }
    expect(
      new LeaseLostError({
        table: "leases",
        key: "job",
        token: "token",
        expiresAt: 0,
      }).code,
    ).toBe("lease_lost");
  });
});
