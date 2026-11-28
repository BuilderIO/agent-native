// @vitest-environment happy-dom

import { SqlQueryRefusalError } from "@shared/sql-query-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeSqlQuery } from "./sql-query";

function stubPanelFailure(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/query-dashboard-panel")
        ? new Response(JSON.stringify(body), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(null, { status: 204 }),
    ),
  );
}

describe("a dashboard panel's failure through the real action client", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a data program's own message instead of the generic action error", async () => {
    stubPanelFailure({
      error: "program_error: The panels haven't been saved yet",
      errorCode: "data_program_program_error",
      details: { panelMessage: "The panels haven't been saved yet" },
    });

    const error = await executeSqlQuery(
      JSON.stringify({ programId: "dp_repo_health" }),
      "program",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SqlQueryRefusalError);
    expect(error).toMatchObject({
      code: "data_program_program_error",
      message: "The panels haven't been saved yet",
    });
  });

  it("leaves a failure that isn't a data program's to the action client", async () => {
    stubPanelFailure({
      error: 'relation "orders" does not exist',
      errorCode: "query_failed",
      details: { panelMessage: 'relation "orders" does not exist' },
    });

    const error = await executeSqlQuery(
      "SELECT * FROM orders",
      "postgres",
    ).catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(SqlQueryRefusalError);
    expect(error).toMatchObject({ code: "query_failed" });
    expect((error as Error).message).not.toContain("orders");
  });
});
