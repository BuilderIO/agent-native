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

  it("keeps Agent chats on the standard chat surface", () => {
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");
    const runDetail = between(
      agent,
      "function RunDetailCard(",
      "function TranscriptPanel(",
    );

    expect(runDetail).toContain("<TranscriptPanel");
    expect(runDetail).toContain("Approval pending");
    expect(runDetail).toContain('secondaryActionLabel="API keys"');
    expect(runDetail).not.toContain("Task paused");
    expect(runDetail).not.toContain("code-agents-session-details");
    expect(runDetail).not.toContain("TokenUsageMeter");
    expect(runDetail).not.toContain("Open Task workspace");
    expect(agent).toContain('code-agents-rail-label">Chats');
    expect(agent).not.toContain('code-agents-rail-label">Tasks');
  });

  it("retries a missing-provider chat after Builder connects", () => {
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");
    const connectFlow = between(
      agent,
      "const connectBuilderProvider = useCallback(async () =>",
      "useEffect(() => {\n    if (!isActive || !host.getRemoteConnectorStatus)",
    );

    expect(connectFlow).toContain('modelSelection.model === "auto"');
    expect(connectFlow).toContain("hasMissingCredentialSignal(");
    expect(connectFlow).toContain("await host.retryRun({");
    expect(connectFlow).toContain("setSelectedRunId(retryResult.run.id)");
    expect(agent).toContain(
      "const hasCredentialGap = providerBlocked && hasCredentialHistory",
    );
    expect(agent).toContain("hideCredentialMessages={hasCredentialHistory}");
  });

  it("does not treat unreadable saved provider blobs as a runtime provider", () => {
    const main = source("./index.ts");
    const runtimeCheck = between(
      main,
      "function hasRuntimeNonCodexCodeAgentLlmProvider()",
      "function normalizeCodeAgentRequestedEngine(",
    );

    expect(runtimeCheck).not.toContain(
      "AppStore.getCodeAgentProviderSettingsStatus()",
    );
    expect(main).toContain("applyCodeAgentProviderCredentialsToEnv()");
    expect(main).toContain("applyResult.failedKeys.length > 0");
  });

  it("only marks the local Codex provider configured after authentication", () => {
    const main = source("./index.ts");
    const providerStatus = between(
      main,
      "function withLocalCodexProviderStatus(",
      "function updateCodeAgentProviderSettings(",
    );
    const modelList = between(
      main,
      "function getCodeAgentModelList(",
      "function getCodeAgentHostMetadata(",
    );

    expect(providerStatus).toContain("configured: codex.authenticated");
    expect(providerStatus).toContain(
      'source: codex.authenticated ? ("local-codex" as const) : undefined',
    );
    expect(modelList).toContain("configured: codex.authenticated");
    expect(modelList).toContain(
      "codex.authenticated && !apiProviderConfigured",
    );
  });
});
