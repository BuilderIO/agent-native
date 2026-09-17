import { describe, expect, it } from "vitest";

import { actionErrorDetail } from "./action-error";

function actionError(message: string, status?: number): Error {
  const error = new Error(message);
  if (status !== undefined) (error as { status?: number }).status = status;
  return error;
}

describe("actionErrorDetail", () => {
  it("surfaces the server message for an explicit client error", () => {
    expect(
      actionErrorDetail(
        actionError(
          'Action read-local-file failed: Local connection "conn_1" is registered in the personal workspace',
          409,
        ),
      ),
    ).toBe('Local connection "conn_1" is registered in the personal workspace');
  });

  it("drops the generic 500 body so the toast cannot claim a cause it lacks", () => {
    expect(
      actionErrorDetail(
        actionError(
          "Action read-local-file failed: Internal server error",
          500,
        ),
      ),
    ).toBeUndefined();
  });

  it("drops errors with no HTTP status (network, timeout, thrown locally)", () => {
    expect(actionErrorDetail(actionError("boom"))).toBeUndefined();
    expect(actionErrorDetail("not an error")).toBeUndefined();
    expect(actionErrorDetail(null)).toBeUndefined();
  });

  it("returns undefined rather than an empty description", () => {
    expect(
      actionErrorDetail(actionError("Action read-local-file failed: ", 409)),
    ).toBeUndefined();
  });
});
