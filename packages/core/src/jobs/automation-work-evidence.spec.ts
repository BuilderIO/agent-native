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

describe("inspectAutomationWork failure evidence", () => {
  it("does not treat earlier confirmed work as success when a later write is uncertain", () => {
    const confirmed: ToolDone = {
      type: "tool_done",
      tool: "record-report",
      result: "Recorded",
      completedSideEffect: true,
    };
    const uncertain: ToolDone = { ...failedSend, outcomeUnknown: true };

    expect(inspectAutomationWork([confirmed, uncertain])).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: uncertain,
    });
  });

  it("preserves an unknown web request failure over a later sibling refusal", () => {
    const blocked: ToolDone = {
      type: "tool_done",
      tool: "web-request",
      result: "Web request URL blocked",
      isError: true,
      errorCode: "web_request_url_blocked",
      outcomeUnknown: true,
    };
    const refusal: ToolDone = {
      type: "tool_done",
      tool: "web-request",
      result: "Refused another request after an unknown outcome",
      isError: true,
    };

    expect(inspectAutomationWork([blocked, refusal])).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: blocked,
    });
  });

  it("prioritizes the most recent unknown work failure over later routine errors", () => {
    const earlierUnknown: ToolDone = {
      ...failedSend,
      result: "Earlier send outcome unknown",
      outcomeUnknown: true,
    };
    const laterUnknown: ToolDone = {
      ...failedSend,
      result: "Later send outcome unknown",
      outcomeUnknown: true,
    };

    expect(
      inspectAutomationWork([earlierUnknown, laterUnknown, failedSend]),
    ).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: laterUnknown,
    });
  });

  it("selects the most recent work failure when no outcome is unknown", () => {
    const earlierFailure: ToolDone = {
      ...failedSend,
      result: "HTTP 429: notification rejected",
      errorCode: "http_429",
    };

    expect(inspectAutomationWork([earlierFailure, failedSend])).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: failedSend,
    });
  });

  it("does not prioritize an unknown no-op failure over a work failure", () => {
    const unknownNoOp: ToolDone = { ...rejectedNoOp, outcomeUnknown: true };

    expect(inspectAutomationWork([failedSend, unknownNoOp])).toEqual({
      status: "unconfirmed",
      noOpDeclared: false,
      failedTool: failedSend,
    });
  });
});

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
