import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

describe("desktop passive-access regressions", () => {
  it("keeps remote status read-only", () => {
    const main = source("./index.ts");
    const handler = between(
      main,
      "IPC.CODE_AGENTS_REMOTE_CONNECTOR_GET_STATUS",
      "IPC.CODE_AGENTS_REMOTE_CONNECTOR_SET_ENABLED",
    );

    expect(handler).toContain("getRemoteConnectorStatus()");
    expect(handler).not.toContain("startRemoteCodeAgentConnector");
  });

  it("keeps remembered Content folder discovery metadata-only", () => {
    const main = source("./index.ts");
    const normalization = between(
      main,
      "function normalizeContentFilesGrant(",
      "function loadContentFilesStore(",
    );
    const handler = between(
      main,
      "IPC.CONTENT_FILES_GET_FOLDER",
      "IPC.CONTENT_FILES_CHOOSE_FOLDER",
    );

    expect(normalization).not.toContain("resolveUsableContentFolder");
    expect(handler).not.toContain("collectLocalControlResources");
  });

  it("does not pull folders or local documents when Content mounts", () => {
    const route = source(
      "../../../../templates/content/app/routes/_app.local-files.tsx",
    );
    const restore = between(
      route,
      "const restoreDirectories = async () =>",
      "restoreDirectories()",
    );
    const editor = source(
      "../../../../templates/content/app/components/editor/DocumentEditor.tsx",
    );

    expect(restore).not.toContain("pullDirectoryFiles");
    expect(restore).not.toContain("connectLocalComponentWorkspaces");
    expect(editor).not.toContain("readDocumentFromLinkedLocalSource");
  });

  it("stops Agent metadata and connector polling while hidden", () => {
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");

    expect(agent).toContain("if (!isActive || !host.getHostMetadata) return;");
    expect(agent).toContain(
      "if (!isActive || !host.getRemoteConnectorStatus) return;",
    );
  });

  it("provides shared chat state and uses the canonical model picker", () => {
    const hub = source("../renderer/components/CodeAgentsHub.tsx");
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");

    expect(hub).toContain("createAgentNativeQueryClient()");
    expect(hub).toContain(
      "<QueryClientProvider client={codeAgentsQueryClient}>",
    );
    expect(agent).not.toContain("AgentAdvancedMenu");
    expect(agent).toContain("availableModels={availableModels}");
    expect(agent).toContain("onModelChange={(model, engine) =>");
  });
});
