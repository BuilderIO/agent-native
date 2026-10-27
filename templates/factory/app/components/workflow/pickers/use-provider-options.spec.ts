import { describe, expect, it } from "vitest";

import { providerOptionsRequest } from "./use-provider-options";

const list = {
  factoryId: "fac_1",
  provider: "github",
  resource: "repositories",
};

describe("providerOptionsRequest", () => {
  it("sends only the list's identity when nothing narrows it", () => {
    expect(providerOptionsRequest(list)).toEqual(list);
  });

  it("carries the parent, the search and the cursor of a later page together", () => {
    expect(
      providerOptionsRequest({
        ...list,
        parent: "acme",
        search: "web",
        cursor: "3",
      }),
    ).toEqual({ ...list, parent: "acme", search: "web", cursor: "3" });
  });

  it("keys a search apart from the unsearched list", () => {
    expect(providerOptionsRequest({ ...list, search: "web" })).not.toEqual(
      providerOptionsRequest(list),
    );
  });
});
