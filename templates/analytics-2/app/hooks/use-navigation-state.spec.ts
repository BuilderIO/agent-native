import { describe, expect, it } from "vitest";

import { dataBrowserResourcePath } from "../lib/navigation-contract";
import { navigationStateForLocation } from "./use-navigation-state";

describe("navigationStateForLocation", () => {
  it("exposes decoded table and schema metadata for data browser detail routes", () => {
    const pathname = dataBrowserResourcePath(
      "builtin-sample-data",
      "table",
      "table:sample:PUBLIC:orders",
    );
    expect(
      navigationStateForLocation({ pathname, search: "", hash: "" }),
    ).toMatchObject({
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
      dataResourceKind: "table",
      dataResourceId: "table:sample:PUBLIC:orders",
      dataResourceName: "orders",
      dataSchemaName: "PUBLIC",
    });
  });

  it("keeps query params on workspace search routes", () => {
    expect(
      navigationStateForLocation({
        pathname: "/home/search",
        search: "?q=revenue",
        hash: "",
      }),
    ).toMatchObject({
      view: "home/search",
      path: "/home/search?q=revenue",
    });
  });
});
