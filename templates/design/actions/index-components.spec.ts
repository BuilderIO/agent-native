/**
 * Tests for index-components action.
 *
 * Issue: the action was declared readOnly:true / GET but inserts and updates
 * component_index rows. It must be a write action (readOnly:false / POST) that
 * requires editor access.
 */

import { describe, expect, it } from "vitest";

import action from "./index-components.js";

describe("index-components action metadata", () => {
  it("is NOT read-only (it writes component_index rows)", () => {
    expect((action as { readOnly?: boolean }).readOnly).toBe(false);
  });

  it("uses HTTP POST (not GET) because it persists data", () => {
    const http = (action as { http?: { method?: string } }).http;
    expect(http?.method).toBe("POST");
  });
});
