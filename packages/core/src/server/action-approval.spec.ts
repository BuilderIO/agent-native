import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ActionCaller, ActionRunContext } from "../action.js";
import { UI_CAPABILITY_REQUIRED_ERROR_CODE } from "../shared/action-error-codes.js";
import {
  actionApprovalRequiredError,
  directHttpActionApprovalRefusal,
} from "./action-approval.js";

describe("HTTP action approval refusals", () => {
  it.each<ActionCaller>(["mcp-widget", "mcp-widget-write", "webmcp", "http"])(
    "does not turn a %s call into UI proof",
    (caller) => {
      expect(
        actionApprovalRequiredError("write-record", caller, false),
      ).toMatchObject({
        statusCode: 409,
        errorCode: "approval_required",
      });
    },
  );

  it("reserves mint-and-retry for an ordinary frontend call", () => {
    expect(
      actionApprovalRequiredError("write-record", "frontend", false),
    ).toMatchObject({
      statusCode: 403,
      errorCode: UI_CAPABILITY_REQUIRED_ERROR_CODE,
    });
    const embedded = actionApprovalRequiredError(
      "write-record",
      "frontend",
      false,
      true,
    );
    expect(embedded).toMatchObject({
      statusCode: 409,
      errorCode: "approval_required",
    });
    expect(embedded.message).toContain("Open the full app");
    expect(
      actionApprovalRequiredError("write-record", "http", true).message,
    ).toContain("service identity can never");
  });

  it.each([undefined, false])(
    "passes an action with approval %s through to normal execution",
    async (needsApproval) => {
      const refusal = await directHttpActionApprovalRefusal(
        { ...(needsApproval === undefined ? {} : { needsApproval }) },
        {},
        { actionName: "write-record", caller: "http" },
      );
      expect(refusal).toBeNull();
    },
  );

  it("leaves invalid arguments to the normal action validator", async () => {
    const predicate = vi.fn(() => true);
    const refusal = await directHttpActionApprovalRefusal(
      { schema: z.object({ recordId: z.string() }), needsApproval: predicate },
      { recordId: 42 },
      { actionName: "write-record", caller: "frontend" },
    );
    expect(refusal).toBeNull();
    expect(predicate).not.toHaveBeenCalled();
  });

  it.each([
    {
      authorization: false,
      statusCode: 403,
      errorCode: UI_CAPABILITY_REQUIRED_ERROR_CODE,
    },
    { authorization: true, statusCode: 409, errorCode: "approval_required" },
  ])(
    "checks a frontend label as HTTP, with bearer=$authorization",
    async ({ authorization, statusCode, errorCode }) => {
      const predicate = vi.fn(
        (_args: unknown, ctx?: ActionRunContext) => ctx?.caller === "http",
      );
      const headers = new Headers(
        authorization ? { authorization: "Bearer fake-agent-credential" } : {},
      );
      const refusal = await directHttpActionApprovalRefusal(
        {
          schema: z.object({ recordId: z.string().trim() }),
          needsApproval: predicate,
        },
        { recordId: " record-1 " },
        {
          actionName: "write-record",
          caller: "frontend",
          requestHeaders: headers,
        },
      );
      expect(predicate).toHaveBeenCalledExactlyOnceWith(
        { recordId: "record-1" },
        expect.objectContaining({ caller: "http", requestHeaders: headers }),
      );
      expect(refusal).toMatchObject({ statusCode, errorCode });
    },
  );

  it("requires approval when its predicate cannot decide", async () => {
    const refusal = await directHttpActionApprovalRefusal(
      {
        needsApproval: () => {
          throw new Error("approval provider unavailable");
        },
      },
      {},
      { actionName: "write-record", caller: "http" },
    );
    expect(refusal).toMatchObject({
      statusCode: 409,
      errorCode: "approval_required",
    });
  });
});
