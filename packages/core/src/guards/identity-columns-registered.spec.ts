import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanIdentityColumnsRegistered } from "./identity-columns-registered.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function makeRepo(schema: string, migration = ""): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "identity-columns-"));
  roots.push(root);
  const source = path.join(root, "packages/core/src/org");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "schema.ts"), schema);
  if (migration)
    fs.writeFileSync(path.join(source, "migrations.ts"), migration);
  return root;
}

describe("scanIdentityColumnsRegistered", () => {
  it("accepts registered and ignored fields", () => {
    const root = makeRepo(`
      export const members = table("org_members", {
        email: text("email"),
      });
      export const directives = table("context_directives", {
        createdBy: text("created_by"),
      });
    `);
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([]);
  });

  it("does not accept a source pragma the runtime registry cannot see", () => {
    const root = makeRepo(`
      export const members = table("org_members", {
        // guard:allow-identity-column — this is a notification destination, not an account identity
        contactEmail: text("contact_email"),
      });
    `);
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("org_members.contact_email"),
      }),
    ]);
  });

  it("flags unregistered identity columns in both schema and migration declarations", () => {
    const root = makeRepo(
      `export const custom = table("custom_members", { email: text("email") });`,
      `CREATE TABLE custom_memberships (
        principal_id TEXT NOT NULL,
        user_id TEXT NOT NULL
      );`,
    );
    fs.writeFileSync(
      path.join(root, "packages/core/src/org/schema-migrations.ts"),
      `ALTER TABLE custom_memberships ADD COLUMN invited_by TEXT NOT NULL;`,
    );
    const findings = scanIdentityColumnsRegistered({ root }).findings;
    expect(findings).toHaveLength(4);
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "custom_members.email",
    );
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "custom_memberships.principal_id",
    );
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "custom_memberships.user_id",
    );
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "custom_memberships.invited_by",
    );
  });

  it("recognizes bare scope_id as an identity column", () => {
    const root = makeRepo(
      `export const custom = table("custom_scopes", { scope: text("scope_id") });`,
    );
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("custom_scopes.scope_id"),
      }),
    ]);
  });

  it("does not apply to generated apps that do not contain the framework source tree", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "identity-columns-app-"),
    );
    roots.push(root);
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([]);
  });

  it("scans inline store DDL outside schema and migration filenames", () => {
    const root = makeRepo("");
    fs.writeFileSync(
      path.join(root, "packages/core/src/org/member-store.ts"),
      `const sql = \`CREATE TABLE member_snapshots (owner_email TEXT NOT NULL)\`;`,
    );
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([
      expect.objectContaining({
        file: "packages/core/src/org/member-store.ts",
        message: expect.stringContaining("member_snapshots.owner_email"),
      }),
    ]);
  });

  it("keeps scanning declarations after nested SQL type parentheses", () => {
    const root = makeRepo("");
    fs.writeFileSync(
      path.join(root, "packages/core/src/org/member-store.ts"),
      `const sql = \`CREATE TABLE member_snapshots (
        id TEXT,
        owner_email VARCHAR(255) NOT NULL
      )\`;`,
    );
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("member_snapshots.owner_email"),
      }),
    ]);
  });

  it("scans Drizzle pgTable declarations", () => {
    const root = makeRepo(
      `export const sessions = pgTable("sessions", {
        ownerEmail: text("owner_email"),
      });`,
    );
    expect(scanIdentityColumnsRegistered({ root }).findings).toEqual([
      expect.objectContaining({
        file: "packages/core/src/org/schema.ts",
        message: expect.stringContaining("sessions.owner_email"),
      }),
    ]);
  });
});
