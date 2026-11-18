import { resolveFrameworkTools } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

import { normalizeDatabaseToolsMode } from "../../../../packages/core/dist/scripts/db/tool-mode.js";
import { createDbScriptEntries } from "../../../../packages/core/dist/server/agent-chat/script-entries.js";

const captured = vi.hoisted(() => ({
  options: undefined as
    | { frameworkTools?: { database?: "off" | "read" | "write" } }
    | undefined,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  createAgentChatPlugin: (options: {
    frameworkTools?: { database?: "off" | "read" | "write" };
  }) => {
    captured.options = options;
    return () => undefined;
  },
  loadActionsFromStaticRegistry: () => ({}),
}));
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));
vi.mock("../register-secrets.js", () => ({}));

import "./agent-chat.js";

describe("Brain agent database boundary", () => {
  it("withdraws raw SQL tools whose ownership views cannot enforce evidence audiences", async () => {
    const options = captured.options;
    if (!options) throw new Error("Brain plugin was not constructed");
    const policy = resolveFrameworkTools(options);
    const mode = normalizeDatabaseToolsMode(policy.database);
    const tools = await createDbScriptEntries(mode);
    expect(Object.keys(tools)).not.toContain("db-query");
    expect(Object.keys(tools)).not.toContain("db-schema");
    expect(Object.keys(tools)).not.toContain("db-exec");
    expect(Object.keys(tools)).not.toContain("db-patch");
  });
});
