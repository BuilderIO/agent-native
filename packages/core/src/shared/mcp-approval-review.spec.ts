import { describe, expect, it } from "vitest";

import {
  isMcpApprovalId,
  mcpApprovalAppPagePath,
  readMcpApprovalId,
} from "./mcp-approval-review.js";

const ID = "0b7f4c1e-2f4a-4d1c-9a43-5f1e8f0d2c6b";

describe("a grant id", () => {
  it("is a lowercase UUID v4, the only id the auth guard lets through", () => {
    expect(isMcpApprovalId(ID)).toBe(true);
    expect(isMcpApprovalId(ID.toUpperCase())).toBe(false);
    // Version 1, and a variant outside 8, 9, a and b.
    expect(isMcpApprovalId("0b7f4c1e-2f4a-1d1c-9a43-5f1e8f0d2c6b")).toBe(false);
    expect(isMcpApprovalId("0b7f4c1e-2f4a-4d1c-7a43-5f1e8f0d2c6b")).toBe(false);
    expect(isMcpApprovalId(`${ID}0`)).toBe(false);
    expect(isMcpApprovalId(`x${ID}`)).toBe(false);
    expect(isMcpApprovalId(undefined)).toBe(false);
  });
});

describe("the review page's fragment", () => {
  it("reads the grant id with or without the leading #", () => {
    expect(readMcpApprovalId(`#mcpApproval=${ID}`)).toBe(ID);
    expect(readMcpApprovalId(`mcpApproval=${ID}`)).toBe(ID);
    expect(readMcpApprovalId(`#tab=mail&mcpApproval=${ID}`)).toBe(ID);
    expect(readMcpApprovalId(`#mcpApproval=${ID}x`)).toBeUndefined();
  });

  it("puts the id after the app's home path, under its base path when it has one", () => {
    expect(mcpApprovalAppPagePath(ID, "/")).toBe(`/#mcpApproval=${ID}`);
    expect(mcpApprovalAppPagePath(ID, "/plans", "/calendar")).toBe(
      `/calendar/plans#mcpApproval=${ID}`,
    );
  });
});
