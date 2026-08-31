import { describe, expect, it } from "vitest";

import {
  emptyAutomationForm,
  formAuthorFilter,
  persistAuthorFilter,
} from "./factory-automation-form";

describe("factory-automation-form authors", () => {
  it("starts with no source and Everyone", () => {
    expect(emptyAutomationForm()).toMatchObject({
      source: null,
      authorFilter: "none",
      authorIds: [],
    });
  });

  it("maps stored exclude with no ids to Everyone", () => {
    expect(formAuthorFilter("exclude", [])).toBe("none");
    expect(formAuthorFilter("include", [])).toBe("none");
  });

  it("persists Everyone as exclude with no ids", () => {
    expect(persistAuthorFilter("none", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: [],
    });
  });

  it("keeps include and exclude when ids are present", () => {
    expect(formAuthorFilter("include", ["U1"])).toBe("include");
    expect(formAuthorFilter("exclude", ["U1"])).toBe("exclude");
    expect(persistAuthorFilter("include", ["U1"])).toEqual({
      authorMode: "include",
      authorIds: ["U1"],
    });
    expect(persistAuthorFilter("exclude", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: ["U1"],
    });
  });
});
