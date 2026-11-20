import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { formsMigrationEntries } from "./db.js";

describe("forms-org-scope migration", () => {
  it("backfills org_id on existing rows from their workspace", async () => {
    const sqlOf = (version: number) => {
      const sql = formsMigrationEntries.find(
        (entry) => entry.version === version,
      )?.sql;
      if (typeof sql !== "string") throw new Error(`No SQL for v${version}`);
      return sql;
    };
    const db = new PGlite();
    await db.exec(sqlOf(1));
    await db.exec(`
      INSERT INTO forms_workspaces (id, org_id, created_by, name, created_at, updated_at) VALUES ('w', 'org-a', 'a@x.test', 'W', 't', 't');
      INSERT INTO forms_forms (id, workspace_id, revision_updated_at, created_at, updated_at) VALUES ('f', 'w', 't', 't', 't');
      INSERT INTO forms_questions (id, form_id, block_group_id, type) VALUES ('q', 'f', 'g', 'INPUT_TEXT');
      INSERT INTO forms_submissions (id, form_id, session_id, respondent_id, submitted_at) VALUES ('s', 'f', 'session-1', 'r', 't');
      INSERT INTO forms_responses (id, submission_id, question_id, answer) VALUES ('r1', 's', 'q', '"hi"');
      INSERT INTO forms_events (id, form_id, session_id, type, at) VALUES ('e', 'f', 'session-1', 'visit', 't');
    `);
    await db.exec(sqlOf(2));
    for (const table of [
      "forms_forms",
      "forms_questions",
      "forms_submissions",
      "forms_responses",
      "forms_events",
    ]) {
      const { rows } = await db.query<{ org_id: string | null }>(
        `SELECT org_id FROM ${table}`,
      );
      expect(rows, table).toEqual([{ org_id: "org-a" }]);
    }
  });
});

describe("forms migration list", () => {
  it("is ordered by version", () => {
    const versions = formsMigrationEntries.map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });
});
