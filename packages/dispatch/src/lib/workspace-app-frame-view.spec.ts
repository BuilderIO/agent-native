import { expect, it } from "vitest";

import { workspaceAppFramePath } from "./workspace-app-frame-view.js";

it("keeps the app route while excluding the private child tab claim", () => {
  expect(
    workspaceAppFramePath(
      new URL(
        "https://app.example.test/inbox?agentNativeTab=fixture&sort=new#unread",
      ),
    ),
  ).toBe("/inbox?sort=new#unread");
});
