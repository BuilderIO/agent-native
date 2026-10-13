import { describe, expect, it } from "vitest";

import { DevDatabaseLink } from "./DevDatabaseLink.js";

describe("DevDatabaseLink", () => {
  it("does not render the database admin sidebar affordance", () => {
    expect(
      DevDatabaseLink({ className: "sidebar-footer", to: "/database" }),
    ).toBeNull();
  });
});
