import { expect, it } from "vitest";

import setToolApprovalPolicy from "./set-tool-approval-policy.js";

it("refuses full-app panels", () => {
  expect(setToolApprovalPolicy.requiresSignedInBrowser).toBe(true);
});
