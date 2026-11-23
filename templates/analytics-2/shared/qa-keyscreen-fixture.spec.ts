import { expect, it } from "vitest";

import {
  QA_KEYSCREEN_ENDORSED,
  QA_KEYSCREEN_PROJECT_TITLES,
  endorsedListSchema,
  planKeyscreenInventory,
} from "./qa-keyscreen-fixture.js";

it("S2 mirrors the original's endorsed models: Accounts, Campaign members, Customers, Opportunities", () => {
  expect(
    endorsedListSchema.parse({ items: QA_KEYSCREEN_ENDORSED }),
  ).toBeTruthy();
  expect(
    QA_KEYSCREEN_ENDORSED.filter((item) => item.group === "model").map(
      (item) => item.name,
    ),
  ).toEqual(["Accounts", "Campaign members", "Customers", "Opportunities"]);
});

it("S1 plans exactly the original's Home inventory from QA-flow clutter", () => {
  const plan = planKeyscreenInventory([
    { id: "a", title: "QA flow sample 5a4e" },
    { id: "b", title: "QA Keyscreen 1118" },
    { id: "c", title: "QA Keyscreen 1118" },
    { id: "d", title: "Revenue overview" },
  ]);
  expect(plan.archive).toEqual(["a", "c", "d"]);
  expect(plan.create).toEqual(
    QA_KEYSCREEN_PROJECT_TITLES.filter(
      (title) => title !== "QA Keyscreen 1118",
    ),
  );
});

it("S1 is a no-op once the inventory already matches", () => {
  const plan = planKeyscreenInventory(
    QA_KEYSCREEN_PROJECT_TITLES.map((title, id) => ({ id: String(id), title })),
  );
  expect(plan).toEqual({ create: [], archive: [] });
});
