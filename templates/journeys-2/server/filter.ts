import type { Condition, Filter } from "../shared/types.js";
import type * as schema from "./db/schema.js";

export type ContactRow = typeof schema.contacts.$inferSelect;
export type AccountRow = typeof schema.accounts.$inferSelect;

function fieldValue(contact: ContactRow, account: AccountRow | undefined, field: string): string {
  if (field.startsWith("account.")) {
    const key = field.slice(8) as keyof AccountRow;
    return account ? String(account[key] ?? "") : "";
  }
  return String((contact as Record<string, unknown>)[field] ?? "");
}

function matchesCondition(
  contact: ContactRow,
  account: AccountRow | undefined,
  condition: Condition,
  audienceMembers: Map<string, Set<string>>,
): boolean {
  if (condition.type === "property") {
    const actual = fieldValue(contact, account, condition.field ?? "").toLowerCase();
    const wanted = (condition.value ?? "").toLowerCase();
    switch (condition.op) {
      case "equal to": return actual === wanted;
      case "not equal to": return actual !== wanted;
      case "contains": return actual.includes(wanted);
      case "does not contain": return !actual.includes(wanted);
      case "begins with": return actual.startsWith(wanted);
      case "does not begin with": return !actual.startsWith(wanted);
      case "is known": return actual !== "";
      case "is unknown": return actual === "";
      case "greater than": return Number(actual) > Number(wanted);
      case "less than": return Number(actual) < Number(wanted);
      default: return false;
    }
  }
  if (condition.type === "list") {
    const inList =
      (contact.lists as string[]).includes(condition.value ?? "") ||
      (audienceMembers.get(condition.value ?? "")?.has(contact.id) ?? false);
    return condition.op === "not in" ? !inList : inList;
  }
  const done = Number((contact.activity as Record<string, number>)[condition.field ?? ""] ?? 0);
  const wanted = condition.count ?? 1;
  switch (condition.op) {
    case "at least": return done >= wanted;
    case "at most": return done <= wanted;
    case "exactly": return done === wanted;
    case "never": return done === 0;
    default: return done >= wanted;
  }
}

export function matchesFilter(
  contact: ContactRow,
  account: AccountRow | undefined,
  filter: Filter,
  audienceMembers: Map<string, Set<string>>,
): boolean {
  const groups = filter.groups.filter((g) => g.conditions.length > 0);
  if (groups.length === 0) return true;
  const groupResults = groups.map((group) => {
    const results = group.conditions.map((c) => matchesCondition(contact, account, c, audienceMembers));
    return group.logic === "or" ? results.some(Boolean) : results.every(Boolean);
  });
  return filter.logic === "or" ? groupResults.some(Boolean) : groupResults.every(Boolean);
}

