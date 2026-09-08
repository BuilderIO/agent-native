// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApprovalValueBlock,
  approvalValuePreview,
  parseApprovalValue,
} from "./approval-value-block";

describe("approval value display", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("parses serialized approval values and preserves plain strings", () => {
    expect(
      parseApprovalValue('{"scope":"all","path":"context/brand.md"}'),
    ).toEqual({
      scope: "all",
      path: "context/brand.md",
    });
    expect(parseApprovalValue("plain text")).toBe("plain text");
    expect(parseApprovalValue(null)).toBeNull();
  });

  it("formats before/after payloads for readable approval review", () => {
    expect(approvalValuePreview(null)).toBe("None");
    expect(approvalValuePreview("plain text")).toBe("plain text");
    expect(approvalValuePreview({ scope: "all" })).toBe(
      JSON.stringify({ scope: "all" }, null, 2),
    );

    act(() => {
      root.render(
        <ApprovalValueBlock
          label="After"
          value={{ path: "context/brand.md", scope: "all" }}
        />,
      );
    });

    expect(container.textContent).toContain("After");
    expect(container.textContent).toContain('"path": "context/brand.md"');
    expect(container.textContent).toContain('"scope": "all"');
  });
});
