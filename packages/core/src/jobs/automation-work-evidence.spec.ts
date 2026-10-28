import { describe, expect, it } from "vitest";

import type { AgentChatEvent } from "../agent/types.js";
import { AUTOMATION_NO_OP_TOOL } from "./actions/automation-no-op.js";
import { inspectAutomationWork } from "./automation-work-evidence.js";

type ToolDone = Extract<AgentChatEvent, { type: "tool_done" }>;

const rejectedNoOp: ToolDone = {
  type: "tool_done",
  tool: AUTOMATION_NO_OP_TOOL,
  result: "Validation error: reason must be at most 500 characters",
  isError: true,
  errorCode: "validation_error",
};
const declaredNoOp: ToolDone = {
  type: "tool_done",
  tool: AUTOMATION_NO_OP_TOOL,
  result: JSON.stringify({ status: "skipped", reason: "No remaining work." }),
};
const failedSend: ToolDone = {
  type: "tool_done",
  tool: "send-digest",
  result: "HTTP 503: notification rejected",
  isError: true,
  errorCode: "http_503",
};

describe("inspectAutomationWork no-op vetoes", () => {
  it("skips when a rejected no-op precedes a valid declaration", () => {
    expect(inspectAutomationWork([rejectedNoOp, declaredNoOp])).toEqual({
      status: "skipped",
      reason: "No remaining work.",
    });
  });

  it("skips when a rejected no-op follows a valid declaration", () => {
    expect(inspectAutomationWork([declaredNoOp, rejectedNoOp])).toEqual({
      status: "skipped",
      reason: "No remaining work.",
    });
  });

  it("keeps another tool's failure as the veto of a valid declaration", () => {
    expect(inspectAutomationWork([declaredNoOp, failedSend])).toEqual({
      status: "unconfirmed",
      noOpDeclared: true,
      failedTool: failedSend,
    });
  });

  it("reports the other tool's failure, not a later rejected no-op", () => {
    expect(
      inspectAutomationWork([declaredNoOp, failedSend, rejectedNoOp]),
    ).toEqual({
      status: "unconfirmed",
      noOpDeclared: true,
      failedTool: failedSend,
    });
  });

  it("does not skip when a rejected no-op is the only failure", () => {
    expect(inspectAutomationWork([rejectedNoOp])).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: rejectedNoOp,
    });
  });
});
