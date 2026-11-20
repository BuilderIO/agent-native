import { describe, expect, it } from "vitest";

import { matchesFilter, type AccountRow, type ContactRow } from "./filter.js";

const contact = (over: Partial<ContactRow>) =>
  ({ id: "c1", name: "Avery Nguyen", email: "a@x.example", lifecycleStage: "lead", accountId: "a1", lists: [], activity: { pricing_viewed: 2 }, ...over }) as ContactRow;
const account = { id: "a1", name: "Acme", plan: "Enterprise" } as AccountRow;
const filter = (conditions: object[], logic = "and") => ({ logic: "and" as const, groups: [{ logic: logic as "and", conditions: conditions as never }] });

describe("matchesFilter", () => {
  it("matches everyone when there are no conditions", () => {
    expect(matchesFilter(contact({}), account, { logic: "and", groups: [] }, new Map())).toBe(true);
  });
  it("matches account properties", () => {
    const f = filter([{ type: "property", field: "account.plan", op: "equal to", value: "enterprise" }]);
    expect(matchesFilter(contact({}), account, f, new Map())).toBe(true);
    expect(matchesFilter(contact({}), { ...account, plan: "Starter" }, f, new Map())).toBe(false);
  });
  it("applies activity frequency operators", () => {
    expect(matchesFilter(contact({}), account, filter([{ type: "activity", field: "pricing_viewed", op: "at least", count: 2 }]), new Map())).toBe(true);
    expect(matchesFilter(contact({}), account, filter([{ type: "activity", field: "pricing_viewed", op: "never" }]), new Map())).toBe(false);
  });
  it("supports OR inside a group and list membership", () => {
    const f = filter([{ type: "property", field: "name", op: "contains", value: "zzz" }, { type: "list", op: "in", value: "l1" }], "or");
    expect(matchesFilter(contact({}), account, f, new Map([["l1", new Set(["c1"])]]))).toBe(true);
    expect(matchesFilter(contact({}), account, f, new Map())).toBe(false);
  });
});
