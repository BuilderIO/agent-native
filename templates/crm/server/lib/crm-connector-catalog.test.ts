import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CRM_CONNECTOR_CATALOG } from "./crm-connector-catalog";

describe("CRM MCP connector catalog", () => {
  it("exposes access-scoped reads of records, lists, and tasks", () => {
    expect(CRM_CONNECTOR_CATALOG).toEqual([
      "get-crm-overview",
      "list-crm-records",
      "get-crm-record",
      "get-crm-record-page",
      "list-crm-lists",
      "list-crm-list-entries",
      "list-crm-tasks",
    ]);
    for (const write of [
      "create-crm-record",
      "update-crm-record",
      "merge-crm-records",
      "sync-crm",
      "provider-api-request",
    ]) {
      expect(CRM_CONNECTOR_CATALOG).not.toContain(write);
    }
  });

  it("wires the catalog into MCP and keeps every read authenticated read-only", () => {
    const root = process.cwd();
    const plugin = readFileSync(
      join(root, "server", "plugins", "agent-chat.ts"),
      "utf8",
    );
    expect(plugin).toContain(
      "mcp: { connectorCatalog: [...CRM_CONNECTOR_CATALOG] }",
    );
    for (const actionName of CRM_CONNECTOR_CATALOG) {
      const action = readFileSync(
        join(root, "actions", `${actionName}.ts`),
        "utf8",
      );
      expect(action).toContain("readOnly: true");
      expect(action).toContain(
        "publicAgent: { expose: true, readOnly: true, requiresAuth: true }",
      );
    }
  });
});
