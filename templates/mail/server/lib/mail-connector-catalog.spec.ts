import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAIL_CONNECTOR_CATALOG } from "./mail-connector-catalog";

describe("Mail MCP connector catalog", () => {
  it("exposes only deterministic email inventory reads", () => {
    expect(MAIL_CONNECTOR_CATALOG).toEqual(["list-emails"]);
    expect(MAIL_CONNECTOR_CATALOG).not.toContain("search-emails");
    expect(MAIL_CONNECTOR_CATALOG).not.toContain("get-email");
    expect(MAIL_CONNECTOR_CATALOG).not.toContain("send-email");
  });

  it("wires the catalog into MCP and keeps the action authenticated read-only", () => {
    const root = process.cwd();
    const plugin = readFileSync(
      join(root, "server", "plugins", "agent-chat.ts"),
      "utf8",
    );
    const action = readFileSync(
      join(root, "actions", "list-emails.ts"),
      "utf8",
    );

    expect(plugin).toContain("connectorCatalog: [");
    expect(plugin).toContain("...MAIL_CONNECTOR_CATALOG");
    expect(action).toContain("readOnly: true");
    expect(action).toContain(
      "publicAgent: { expose: true, readOnly: true, requiresAuth: true }",
    );
  });
});
