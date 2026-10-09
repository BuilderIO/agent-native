import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE } from "../../../../templates/content/server/lib/chatgpt-directory-tools.js";
import { signEmbedSessionToken } from "../server/embed-session.js";
import {
  createMcpDirectoryWidgetWriteCapability,
  MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH,
  type McpDirectoryWidgetReadArgument,
} from "./embed-auth.js";

// Browsers drop an `an_embed_session` cookie whose name and value exceed 4096
// bytes, and the cookie value is the signed token wrapping this scope.
const SCOPE_HEADROOM = 700;
const TOKEN_BUDGET = 4000;

type ArgumentRules = Record<string, Record<string, unknown>>;
type ScopedArguments = Record<
  string,
  Record<string, McpDirectoryWidgetReadArgument>
>;

// Mirrors how the MCP server materializes a profile's rules for one target: an
// action is granted only when every string rule resolves to a resource id.
function materialize(
  rules: ArgumentRules,
  resourceIds: Record<string, string>,
  only?: readonly string[],
): ScopedArguments {
  const granted: ScopedArguments = {};
  for (const [actionName, argumentMap] of Object.entries(rules)) {
    if (only && !only.includes(actionName)) continue;
    const scoped: Record<string, McpDirectoryWidgetReadArgument> = {};
    for (const [name, rule] of Object.entries(argumentMap)) {
      if (typeof rule === "string") {
        if (!resourceIds[rule]) break;
        scoped[name] = resourceIds[rule];
      } else {
        scoped[name] = rule as McpDirectoryWidgetReadArgument;
      }
    }
    if (Object.keys(scoped).length === Object.keys(argumentMap).length) {
      granted[actionName] = scoped;
    }
  }
  return granted;
}

describe("Content widget write capability size", () => {
  const ORIGINAL_SECRET = process.env.OAUTH_STATE_SECRET;
  const uuid = (seed: string) =>
    `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-a${seed.repeat(3)}-${seed.repeat(12)}`;
  const documentId = uuid("1");
  const spaceId = uuid("2");
  const databaseId = uuid("3");
  const orgId = uuid("4");
  const userEmail = `${"u".repeat(48)}@example.com`;

  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = "embed-size-test-secret";
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.OAUTH_STATE_SECRET;
    else process.env.OAUTH_STATE_SECRET = ORIGINAL_SECRET;
  });

  function measure(
    targetName: "create-document" | "create-content-database",
    result: Record<string, unknown>,
  ) {
    const target = CHATGPT_DIRECTORY_PROFILE.widgetTargets[targetName](
      {},
      result,
    );
    if (!target) throw new Error(`${targetName} resolved no widget target.`);
    const readRules = CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments;
    const writeRules = CHATGPT_DIRECTORY_PROFILE.widgetWriteActionArguments;
    const scope = createMcpDirectoryWidgetWriteCapability({
      appId: "content",
      resourceUri: "ui://content/shell-v66",
      resourceIds: target.resourceIds,
      userEmail,
      orgId,
      expiresAtMs: Date.now() + 10 * 60_000,
      readActionArguments: materialize(readRules, target.resourceIds),
      writeActionArguments: materialize(
        writeRules,
        target.resourceIds,
        target.writeActions,
      ),
    });
    if (!scope) throw new Error("The Content grant did not fit a capability.");
    const token = signEmbedSessionToken({
      ownerEmail: userEmail,
      orgId,
      targetPath: `${target.targetPath}?__an_mcp_chat_bridge=1&embedded=1&agentSidebar=closed`,
      audienceHost: "beta.content.agent-native.com",
      scope,
      ticketCreatedAtMs: Date.now(),
      sessionId: "f".repeat(64),
      ttlSeconds: 300,
    });
    return { scope, token };
  }

  it("fits a document grant with headroom in the scope and the signed token", () => {
    const { scope, token } = measure("create-document", {
      id: documentId,
      spaceId,
    });

    expect(scope.length).toBeLessThanOrEqual(
      MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH - SCOPE_HEADROOM,
    );
    expect(token.length).toBeLessThanOrEqual(TOKEN_BUDGET);
  });

  it("fits a collection grant with headroom in the scope and the signed token", () => {
    const { scope, token } = measure("create-content-database", {
      database: { id: databaseId, documentId },
      spaceId,
    });

    expect(scope.length).toBeLessThanOrEqual(
      MCP_DIRECTORY_WIDGET_WRITE_CAPABILITY_MAX_LENGTH - SCOPE_HEADROOM,
    );
    expect(token.length).toBeLessThanOrEqual(TOKEN_BUDGET);
  });
});
