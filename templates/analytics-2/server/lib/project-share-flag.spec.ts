import { expect, it } from "vitest";

import { isProjectShareRole, PROJECT_SHARE_ROLES } from "./project-share-flag";

// oracle-change: project sharing is now always available subject to project ACLs.
it("accepts only the storage roles a project grant may carry", () => {
  expect(PROJECT_SHARE_ROLES).toEqual(["viewer", "editor", "admin"]);
  expect(isProjectShareRole("editor")).toBe(true);
  expect(isProjectShareRole("commenter")).toBe(false);
  expect(isProjectShareRole("owner")).toBe(false);
});
