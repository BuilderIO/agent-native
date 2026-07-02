import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetDemoRedactCacheForTests,
  redactDemoData,
  redactDemoString,
} from "./redact.js";

beforeEach(() => {
  // Caches are process-global by design; isolate tests from each other.
  __resetDemoRedactCacheForTests();
});

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const NANOID = "V1StGXR8_Z5jdHi6B-myT";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const ISO = "2026-05-16T14:32:00Z";

describe("determinism", () => {
  it("same input + same salt produces identical output across calls", () => {
    const input = "Contact John Smith at john.smith@acme.com about $1,240.50";
    const a = redactDemoString(input, { salt: "demo" });
    const b = redactDemoString(input, { salt: "demo" });
    expect(a).toBe(b);
  });

  it("different salt produces different output", () => {
    const input = "Reach out to Sarah Connor";
    const a = redactDemoString(input, { salt: "alpha" });
    const b = redactDemoString(input, { salt: "beta" });
    expect(a).not.toBe(b);
  });

  it("repeated value maps consistently within one redactDemoData call", () => {
    const input = {
      a: { from: "Acme Corp" },
      b: { from: "Acme Corp" },
      c: { author: "Acme Corp" },
    };
    const out = redactDemoData(input, { salt: "s" }) as typeof input;
    expect(out.a.from).toBe(out.b.from);
    expect(out.a.from).toBe(out.c.author);
    expect(out.a.from).not.toBe("Acme Corp");
  });

  it("repeated number maps consistently across a chart and a summary", () => {
    const out = redactDemoString(
      "Revenue was $1,240.50 in Q1. The summary again states $1,240.50.",
      { salt: "s" },
    );
    const matches = out.match(/\$[\d,]+\.\d{2}/g) ?? [];
    expect(matches.length).toBe(2);
    expect(matches[0]).toBe(matches[1]);
  });

  it("is process-independent for a fixed salt (regression on stable hash)", () => {
    // Stability check: the same literal should not vary run to run.
    const first = redactDemoString("Jane Doe", { salt: "fixed" });
    const second = redactDemoString("Jane Doe", { salt: "fixed" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});

describe("emails", () => {
  it("replaces emails with realistic (non-example.com) addresses", () => {
    const out = redactDemoString("Email me at jane.doe@acme.io please");
    expect(out).not.toContain("jane.doe@acme.io");
    expect(out).not.toContain("example.com");
    const m = out.match(/\S+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain("example.com");
  });

  it("keeps email consistent across occurrences", () => {
    const out = redactDemoString("a@x.com then again a@x.com", { salt: "k" });
    const emails = out.match(/[a-z0-9._]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBe(2);
    expect(emails[0]).toBe(emails[1]);
    expect(emails[0]).not.toContain("example.com");
  });
});

describe("full names", () => {
  it("replaces 2+ capitalized word sequences", () => {
    const out = redactDemoString("Please call Sarah Connor today");
    expect(out).not.toContain("Sarah Connor");
    expect(out).toMatch(/Please call [A-Z][a-z]+ [A-Z][a-z]+ today/);
  });

  it("handles a middle initial (Sarah J Connor)", () => {
    const out = redactDemoString("From Sarah J Connor");
    expect(out).not.toContain("Sarah J Connor");
  });

  it("does NOT replace lone capitalized words in prose", () => {
    const input = "Monday Inbox The Quarterly Report is ready";
    const out = redactDemoString(input);
    // "Monday" / "Inbox" / "The" alone must survive; multi-word runs may not,
    // so assert the standalone-at-sentence-start words individually.
    const lone = redactDemoString("Monday. Inbox. The. Done.");
    expect(lone).toBe("Monday. Inbox. The. Done.");
    expect(typeof out).toBe("string");
  });

  it("does not mangle label/tab names under a name key", () => {
    const labels = redactDemoData(
      [
        { name: "Important", count: 4200 },
        { name: "Automated notifications" },
        { name: "Note to Self" },
        { name: "Other" },
        { name: "Olivia Parker" }, // a real person name still gets faked
      ],
      { salt: "s" },
    ) as Array<{ name: string; count?: number }>;
    expect(labels[0].name).toBe("Important");
    expect(labels[0].count).not.toBe(4200); // numbers still redacted
    expect(labels[1].name).toBe("Automated notifications");
    expect(labels[2].name).toBe("Note to Self");
    expect(labels[3].name).toBe("Other");
    expect(labels[4].name).not.toBe("Olivia Parker");
    expect(labels[4].name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("leaves single-token name-key values alone; still fakes 2+ word names", () => {
    const out = redactDemoData(
      { from: "Cher", name: "Madonna", full: "Jane Cooper", note: "Madonna" },
      { salt: "s" },
    ) as { from: string; name: string; full: string; note: string };
    // Single first name under a name key — user explicitly OK keeping these.
    expect(out.from).toBe("Cher");
    expect(out.name).toBe("Madonna");
    // A genuine 2-word name under a name key is still faked.
    expect(out.full).not.toBe("Jane Cooper");
    expect(out.full).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    // Single capitalized word in a non-name field stays.
    expect(out.note).toBe("Madonna");
  });
});

describe("numbers", () => {
  it("preserves currency, grouping, and decimal shape", () => {
    const out = redactDemoString("Total $1,240.50 due", { salt: "n" });
    const m = out.match(/\$\d,\d{3}\.\d{2}/);
    expect(m).not.toBeNull();
    expect(out).not.toContain("$1,240.50");
  });

  it("preserves digit count for a bare 4-digit amount", () => {
    const out = redactDemoString("count 4200 items", { salt: "n" });
    const m = out.match(/count (\d{4}) items/);
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toBe("4200");
  });

  it("leading digit is non-zero so digit count is observable", () => {
    const out = redactDemoString("$9999", { salt: "z" });
    expect(out).toMatch(/^\$[1-9]\d{3}$/);
  });

  it("leaves standalone integers < 1000 with no currency untouched", () => {
    expect(redactDemoString("3 unread messages")).toBe("3 unread messages");
    expect(redactDemoString("page 2 of 5")).toBe("page 2 of 5");
    expect(redactDemoString("999 left")).toBe("999 left");
  });

  it("rewrites integers >= 1000", () => {
    const out = redactDemoString("1000 visitors", { salt: "n" });
    expect(out).not.toContain("1000 visitors");
    expect(out).toMatch(/^\d{4} visitors$/);
  });

  it("leaves 4-digit years 1900-2099 untouched", () => {
    expect(redactDemoString("in 2026 we grew")).toBe("in 2026 we grew");
    expect(redactDemoString("since 1999")).toBe("since 1999");
  });

  it("preserves euro and sign and decimals", () => {
    const out = redactDemoString("balance -€12,000.00", { salt: "n" });
    expect(out).toMatch(/-€\d{2},\d{3}\.\d{2}/);
  });

  it("redacts numeric leaf in structured data and keeps it a number", () => {
    const out = redactDemoData({ amount: 4200 }, { salt: "n" }) as {
      amount: number;
    };
    expect(typeof out.amount).toBe("number");
    expect(String(out.amount).length).toBe(4);
    expect(out.amount).not.toBe(4200);
  });
});

describe("ID-safety (critical)", () => {
  it("never alters a UUID", () => {
    expect(redactDemoString(`ref ${UUID} done`)).toContain(UUID);
  });

  it("never alters a nanoid", () => {
    expect(redactDemoString(`token ${NANOID} ok`)).toContain(NANOID);
  });

  it("never alters a JWT", () => {
    expect(redactDemoString(`auth ${JWT}`)).toContain(JWT);
  });

  it("never alters an ISO timestamp", () => {
    expect(redactDemoString(`at ${ISO} happened`)).toContain(ISO);
  });

  it("never alters a clock time", () => {
    expect(redactDemoString("meeting at 14:32:00 sharp")).toContain("14:32:00");
  });

  it("never alters a URL", () => {
    const url = "https://x.com/u/42";
    expect(redactDemoString(`see ${url} now`)).toContain(url);
  });

  it("never alters order-2024-abc style ids", () => {
    expect(redactDemoString("ref order-2024-abc shipped")).toContain(
      "order-2024-abc",
    );
  });

  it("never alters embedded alphanumerics (abc123, v2, step3)", () => {
    expect(redactDemoString("build abc123 on v2 at step3")).toBe(
      "build abc123 on v2 at step3",
    );
  });

  it("protected key values pass through untouched even if they look sensitive", () => {
    const input = {
      id: "John Smith",
      userId: "jane.doe@acme.com",
      threadId: "1,240.50",
      createdAt: ISO,
      updatedAt: "2026-05-16",
      apiKey: "Sarah Connor",
      session_id: "Acme Corp",
      messageId: "$9,999.00",
      slug: "john-smith",
      url: "https://x.com/a Big Name",
      expiresAt: 1747405920,
      nested: { id: "Bob Jones", label: "Bob Jones" },
    };
    const out = redactDemoData(input, { salt: "s" }) as typeof input;
    expect(out.id).toBe("John Smith");
    expect(out.userId).toBe("jane.doe@acme.com");
    expect(out.threadId).toBe("1,240.50");
    expect(out.createdAt).toBe(ISO);
    expect(out.updatedAt).toBe("2026-05-16");
    expect(out.apiKey).toBe("Sarah Connor");
    expect(out.session_id).toBe("Acme Corp");
    expect(out.messageId).toBe("$9,999.00");
    expect(out.slug).toBe("john-smith");
    expect(out.url).toBe("https://x.com/a Big Name");
    expect(out.expiresAt).toBe(1747405920);
    // Recurse into nested objects under a protected key, but the protected key
    // itself does not transform its own leaf.
    expect(out.nested.id).toBe("Bob Jones");
    // A non-protected sibling at the nested level IS still redacted.
    expect(out.nested.label).not.toBe("Bob Jones");
  });

  it("never rewrites SQL/query/code keys (chart titles still faked)", () => {
    const dashboard = {
      name: "Maya Davis (First-party)",
      panels: [
        {
          id: "p1",
          title: "Clicks by Henry Moore",
          sql: "WITH t AS (SELECT user_id, name FROM events WHERE name = 'Henry Moore' LIMIT 1000) SELECT * FROM t",
          query: "SELECT count(*) FROM signups WHERE owner = 'Jane Cooper'",
          expression: "sum(revenue) / count(distinct Maya Davis)",
        },
      ],
    };
    const out = redactDemoData(dashboard, { salt: "s" }) as typeof dashboard;
    // SQL/query/expression pass through byte-identical so the query runs.
    expect(out.panels[0].sql).toBe(dashboard.panels[0].sql);
    expect(out.panels[0].query).toBe(dashboard.panels[0].query);
    expect(out.panels[0].expression).toBe(dashboard.panels[0].expression);
    // But human-facing strings are still redacted.
    expect(out.name).not.toBe(dashboard.name);
    expect(out.panels[0].title).not.toBe("Clicks by Henry Moore");
  });

  it("recurses into arrays/objects under protected keys", () => {
    const input = {
      ids: ["John Smith", "Jane Doe"],
      meta: { id: "x", owner: "Mary Major" },
    };
    const out = redactDemoData(input, { salt: "s" }) as typeof input;
    // Array under protected key: entries are NOT name-coerced (no name key),
    // and a two-word run inside prose would be redacted, so just assert it
    // still recursed (array preserved) and the id-ish strings are safe-ish.
    expect(Array.isArray(out.ids)).toBe(true);
    expect(out.ids.length).toBe(2);
    expect(out.meta.id).toBe("x");
    expect(out.meta.owner).not.toBe("Mary Major");
  });

  it("name-key coercion still defers to ID protection", () => {
    const out = redactDemoData(
      { name: NANOID, from: UUID, sender: "jane.doe@acme.com" },
      { salt: "s" },
    ) as { name: string; from: string; sender: string };
    expect(out.name).toBe(NANOID);
    expect(out.from).toBe(UUID);
    expect(out.sender).not.toBe("jane.doe@acme.com");
    expect(out.sender).not.toContain("example.com");
    expect(out.sender).toMatch(/\S+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("is stable across edits: produced names/emails round-trip unchanged", () => {
    // Simulate the real scenario: data is redacted for display → the user
    // edits the (now fake) draft → it autosaves → it's refetched and
    // redacted again. Names/emails must NOT drift on the round-trip.
    const real = {
      from: "Jane Cooper",
      to: "jane.cooper@acme.com",
      body: "Thanks Jane Cooper — reply to jane.cooper@acme.com.",
    };
    const first = redactDemoData(real, { salt: "demo" }) as typeof real;
    const second = redactDemoData(first, { salt: "demo" }) as typeof real;
    expect(second.from).toBe(first.from);
    expect(second.to).toBe(first.to);
    expect(second.body).toBe(first.body);
    // An unrelated edit around the already-fake content keeps them identical.
    const edited = { ...first, body: `${first.body} Cheers!` };
    const third = redactDemoData(edited, { salt: "demo" }) as typeof real;
    expect(third.from).toBe(first.from);
    expect(third.to).toBe(first.to);
    expect(third.body.startsWith(first.body)).toBe(true);
  });
});

describe("structure preservation", () => {
  it("preserves arrays and nested object shape", () => {
    const input = {
      list: [
        { person: "John Smith", count: 4200 },
        { person: "Jane Roe", count: 7 },
      ],
      active: true,
      missing: null,
      maybe: undefined,
    };
    const out = redactDemoData(input, { salt: "s" }) as typeof input;
    expect(Array.isArray(out.list)).toBe(true);
    expect(out.list.length).toBe(2);
    expect(out.active).toBe(true);
    expect(out.missing).toBeNull();
    expect(out.maybe).toBeUndefined();
    expect(out.list[0].person).not.toBe("John Smith");
    expect(typeof out.list[0].count).toBe("number");
    expect(out.list[1].count).toBe(7); // < 1000 untouched
  });

  it("leaves booleans, null, Date untouched", () => {
    const d = new Date("2026-05-16T00:00:00Z");
    const out = redactDemoData(
      { ok: false, none: null, when: d },
      { salt: "s" },
    ) as { ok: boolean; none: null; when: Date };
    expect(out.ok).toBe(false);
    expect(out.none).toBeNull();
    expect(out.when).toBe(d);
  });

  it("guards against cycles without throwing", () => {
    const obj: Record<string, unknown> = { label: "John Smith" };
    obj.self = obj;
    expect(() => redactDemoData(obj, { salt: "s" })).not.toThrow();
  });

  it("does not blow the stack on deep structures", () => {
    let deep: Record<string, unknown> = { name: "John Smith" };
    for (let i = 0; i < 500; i++) deep = { child: deep };
    expect(() => redactDemoData(deep, { salt: "s" })).not.toThrow();
  });

  it("passthrough for non-string/number primitives in string redactor", () => {
    // redactDemoString only touches strings.
    expect(redactDemoString("")).toBe("");
  });
});
