import { describe, expect, it } from "vitest";

import {
  isAutozQaEmail,
  isQaTestEmail,
  isTestIdentityEmail,
  testIdentityEmailSql,
} from "./qa-test-email.js";

describe("isAutozQaEmail", () => {
  it("requires the reserved +autoz marker", () => {
    expect(isAutozQaEmail("qa+autoz-run@example.com")).toBe(true);
    expect(isAutozQaEmail("qa+AUTOZ@example.com")).toBe(true);
    expect(isAutozQaEmail("qa+qa-test-bot-run@example.com")).toBe(false);
    expect(isAutozQaEmail("qa@example.com")).toBe(false);
  });
});

const TEST_IDENTITIES = [
  "steve+autoz-run-9f2@builder.io",
  "steve+AUTOZ@gmail.com",
  "steve+qa-test-bot-9f2@builder.io",
  "qa-test-bot-9f2@agent-native.com",
  "an-e2e-probe-4471@e2e.agent-native.test",
  "e2e-4471@example.com",
  "beta-sweep@anything.invalid",
  "qa-owner@example.test",
  "qa-owner-b1-3803@example.test",
  "dev@local.test",
  "local@localhost",
  "someone@sub.localhost",
  "x@foo.example",
  "  QA-Owner@Example.TEST ",
];

const REAL_USERS = [
  "steve@builder.io",
  "test@gmail.com",
  "qa@acme.co",
  "demo@startup.io",
  "e2e@realcompany.com",
  "someone@example.company.com",
  "user@testing.com",
  "someone@test.com",
  "jane@corp.local",
  "ops@contest",
  "a@mytest",
  "qa+qa-slides@builder.io",
  "steve+auto@builder.io",
  "cron@example.com",
  "someone+tag@example.org",
  "x@mail.example.net",
];

describe("isTestIdentityEmail", () => {
  it("matches reserved domains and QA harness markers", () => {
    for (const email of TEST_IDENTITIES) {
      expect(isTestIdentityEmail(email), email).toBe(true);
      expect(isQaTestEmail(email), email).toBe(true);
    }
  });

  it("leaves real signups alone, including ones that merely look synthetic", () => {
    for (const email of REAL_USERS) {
      expect(isTestIdentityEmail(email), email).toBe(false);
    }
  });

  it("ignores non-strings, blanks, and non-addresses", () => {
    for (const value of [undefined, null, 42, {}, "", "   ", "qa", "@test"]) {
      expect(isTestIdentityEmail(value)).toBe(false);
    }
  });

  it("adds configured exact addresses and @domain entries", () => {
    const extra = ["qa-lead@builder.io", "@qa.acme.co", "@example.com"];
    expect(isTestIdentityEmail("QA-Lead@builder.io", extra)).toBe(true);
    expect(isTestIdentityEmail("cron@example.com", extra)).toBe(true);
    expect(isTestIdentityEmail("anyone@qa.acme.co", extra)).toBe(true);
    expect(isTestIdentityEmail("anyone@eu.qa.acme.co", extra)).toBe(true);
    expect(isTestIdentityEmail("steve@builder.io", extra)).toBe(false);
    expect(isTestIdentityEmail("anyone@acme.co", extra)).toBe(false);
    expect(isTestIdentityEmail("anyone@notqa.acme.co", extra)).toBe(false);
  });
});

describe("testIdentityEmailSql", () => {
  it("builds one boolean expression over the same rules", () => {
    const sql = testIdentityEmailSql("user_email", ["qa-lead@builder.io"]);
    expect(sql).toContain("coalesce(user_email, '')");
    expect(sql).toContain("'+autoz'");
    expect(sql).toContain("'.test'");
    expect(sql).toContain("'qa-lead@builder.io'");
    expect(sql.startsWith("(")).toBe(true);
  });

  it("agrees with the matcher when PostgreSQL evaluates it", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = await PGlite.create("memory://");
    try {
      const extra = ["qa-lead@builder.io", "@qa.acme.co"];
      const cases = [
        ...TEST_IDENTITIES,
        ...REAL_USERS,
        "QA-Lead@builder.io",
        "anyone@eu.qa.acme.co",
        "anyone@notqa.acme.co",
      ];
      await pg.query("CREATE TABLE t (email TEXT)");
      for (const email of [...cases, null]) {
        await pg.query("INSERT INTO t VALUES ($1)", [email]);
      }
      const { rows } = await pg.query<{ email: string | null; hit: boolean }>(
        `SELECT email, ${testIdentityEmailSql("email", extra)} AS hit FROM t`,
      );
      for (const row of rows) {
        expect(row.hit, String(row.email)).toBe(
          isTestIdentityEmail(row.email, extra),
        );
      }
    } finally {
      await pg.close();
    }
  });

  it("refuses a literal that could break out of the expression", () => {
    expect(() => testIdentityEmailSql("e", ["x'@y.com"])).toThrow();
    expect(() => testIdentityEmailSql("e", ["x\\@y.com"])).toThrow();
  });
});
