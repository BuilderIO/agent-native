import { describe, expect, it } from "vitest";

import { parsePersistedChatFirstPane } from "./chat-first-pane";

describe("parsePersistedChatFirstPane", () => {
  it("restores a valid saved pane", () => {
    expect(
      parsePersistedChatFirstPane({
        appId: "clips",
        placement: "side",
        path: "/inbox",
        view: "list",
        extra: true,
      }),
    ).toEqual({
      status: "restorable",
      pane: { appId: "clips", placement: "side", path: "/inbox", view: "list" },
    });
  });

  it("reports absent state when nothing was saved or it was cleared", () => {
    expect(parsePersistedChatFirstPane(null)).toEqual({ status: "absent" });
    expect(parsePersistedChatFirstPane(undefined)).toEqual({
      status: "absent",
    });
  });

  it.each([["pane"], [42], [[]], [{}], [{ appId: "  " }], [{ appId: 7 }]])(
    "reports corrupt state %j as unreadable",
    (value) => {
      expect(parsePersistedChatFirstPane(value)).toEqual({
        status: "unreadable",
      });
    },
  );
});
