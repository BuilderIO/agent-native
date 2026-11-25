import { afterEach, describe, expect, it } from "vitest";

import {
  __resetAppIdentityColumnsForTests,
  registerIdentityColumns,
  resolveIdentityColumns,
} from "./rekey.js";

const rows = [
  { table_name: "dispatch_destinations", column_name: "created_by" },
  { table_name: "dispatch_identity_links", column_name: "owner_email" },
  { table_name: "identity_sso_bootstrap", column_name: "email" },
];

afterEach(() => __resetAppIdentityColumnsForTests());

describe("first-party app identity policies", () => {
  it("covers Dispatch tables in a shared database without Dispatch's plugin loaded", () => {
    const resolved = resolveIdentityColumns(rows);
    expect(
      resolved.find(
        (c) => c.table === "dispatch_destinations" && c.column === "created_by",
      ),
    ).toMatchObject({ emailChange: "retain", offboard: "retain" });
  });

  it("accepts an older Dispatch redeclaring an identical policy", () => {
    expect(() =>
      registerIdentityColumns([
        {
          table: "dispatch_destinations",
          column: "created_by",
          emailChange: "retain",
          offboard: "retain",
          reason: "Creator attribution; ownership is owner_email.",
        },
      ]),
    ).not.toThrow();
  });

  it("still refuses a conflicting redeclaration", () => {
    expect(() =>
      registerIdentityColumns([
        {
          table: "dispatch_destinations",
          column: "created_by",
          emailChange: "rekey",
          offboard: "delete",
          reason: "different",
        },
      ]),
    ).toThrow(/framework registry/);
  });
});
