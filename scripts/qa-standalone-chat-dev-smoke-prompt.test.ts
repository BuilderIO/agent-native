import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { originalUserPrompt } from "./qa-standalone-chat-dev-smoke-prompt";

const approvalPrompt =
  "Call accept-agentkit-release with release agentkit-acceptance for production and wait for my approval.";
const approvedContinuationPrompt =
  "Approved. Go ahead and run the requested action.";

describe("standalone chat smoke prompt normalization", () => {
  it("maps an approved continuation with appended framework context", () => {
    const value = `${approvedContinuationPrompt}\n\n<current-time>2026-10-07</current-time>`;

    assert.equal(
      originalUserPrompt(value, approvalPrompt, approvedContinuationPrompt),
      approvalPrompt,
    );
  });

  it("maps an exact approved continuation to the original approval request", () => {
    assert.equal(
      originalUserPrompt(
        approvedContinuationPrompt,
        approvalPrompt,
        approvedContinuationPrompt,
      ),
      approvalPrompt,
    );
  });

  it("keeps a user prompt when the approved continuation is appended", () => {
    const prompt = "Call hello with name AgentKit Browser.";
    const value = `${prompt}\n\n${approvedContinuationPrompt}\n\n<current-time>2026-10-07</current-time>`;

    assert.equal(
      originalUserPrompt(value, approvalPrompt, approvedContinuationPrompt),
      prompt,
    );
  });
});
