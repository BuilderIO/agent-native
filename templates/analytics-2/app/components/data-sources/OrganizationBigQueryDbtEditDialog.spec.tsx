import { describe, expect, it } from "vitest";

import { dbtRefusalMessage } from "./OrganizationBigQueryDbtEditDialog";

describe("dbtRefusalMessage", () => {
  it("surfaces the reason a dbt save was refused", () => {
    const failure = Object.assign(new Error("dbt settings not verified"), {
      errorCode: "dbt_configuration_not_verified",
    });
    expect(dbtRefusalMessage(failure)).toBe("dbt settings not verified");
    const validationFailure = Object.assign(
      new Error("Enter a valid dbt Access URL."),
      {
        errorCode: "data_dbt_configuration_invalid",
      },
    );
    expect(dbtRefusalMessage(validationFailure)).toBe(
      "Enter a valid dbt Access URL.",
    );
  });

  it("leaves unconfirmed or foreign failures to the generic message", () => {
    expect(dbtRefusalMessage(new Error("Unconfirmed dbt settings save"))).toBe(
      undefined,
    );
    expect(
      dbtRefusalMessage(
        Object.assign(new Error("boom"), { errorCode: "other" }),
      ),
    ).toBe(undefined);
  });
});
