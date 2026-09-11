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
  it("reloads the packaged shell from its entry file after SPA route changes", () => {
    const main = source("./index.ts");
    const createWindow = between(
      main,
      "function createWindow(): BrowserWindow {",
      "// ---------- DevTools: target the active app webview ----------",
    );

    expect(createWindow).toContain('win.webContents.on("will-navigate"');
    expect(createWindow).toContain('"did-fail-load"');
    expect(createWindow).toContain('protocol !== "file:"');
    expect(createWindow).toContain("event.preventDefault();");
    expect(createWindow).toContain("loadDesktopRenderer(win);");
    expect(main).toContain("function desktopRendererEntryPath(): string");
  });

  it("keeps remote status read-only", () => {
    // The Agent-Native Code IPC handlers live in ./ipc/code-agents.ts.
    const codeAgentsIpc = source("./ipc/code-agents.ts");
    const handler = between(
      codeAgentsIpc,
      "IPC.CODE_AGENTS_REMOTE_CONNECTOR_GET_STATUS",
      "IPC.CODE_AGENTS_REMOTE_CONNECTOR_SET_ENABLED",
    );

    expect(handler).toContain("getRemoteConnectorStatus()");
    expect(handler).not.toContain("startRemoteCodeAgentConnector");
  });

  it("keeps first-launch Code Agent inventory metadata-only", () => {
    const main = source("./index.ts");
    const projects = between(
      main,
      "function readCodeAgentProjectsState()",
      "function writeCodeAgentProjectsState",
    );
    const runProjection = between(
      main,
      "function backgroundRunToDesktopRun(",
      "function readJsonObjectFile(",
    );
    const runInventory = between(
      main,
      "function listDesktopCodeAgentRuns(",
      "function readDesktopCodeAgentRun(",
    );
    const hostMetadata = between(
      main,
      "function getCodeAgentHostMetadata()",
      "function getDesktopComputerControlMetadata(",
    );
    const projectPacks = between(
      main,
      "function listCodeAgentProjectPacks(",
      "function walkMarkdownFiles(",
    );
    const worktrees = between(
      main,
      "function listCodeAgentWorktrees(",
      "function restoreCodeAgentWorktree(",
    );
    const startup = between(
      main,
      "void app.whenReady().then(async () => {",
      "// Webviews now run in per-app persisted partitions",
    );

    expect(projects).not.toContain("resolveUsableDirectory");
    expect(projects).toContain("normalizeRememberedCodeAgentPath");
    expect(runProjection).not.toContain("fs.existsSync");
    expect(runInventory).toContain("resumeQueuedCodeAgentWorktreeRuns");
    expect(runInventory).toContain("ensureCodeAgentWorktreeSweepScheduled");
    expect(hostMetadata).not.toContain("resolveCodeAgentsTerminalCwd");
    expect(hostMetadata).not.toContain("resolveRepositoryRoot");
    expect(projectPacks).toContain(
      'if (!requestedPath) return { status: "ok" };',
    );
    expect(projectPacks).not.toContain("resolveCodeAgentsTerminalCwd(input)");
    expect(worktrees).not.toContain("resolveCodeAgentsTerminalCwd");
    expect(worktrees).toContain("ensureCodeAgentWorktreeSweepScheduled");
    expect(startup).not.toContain("initializeDesktopComputerMcpBridge");
    expect(startup).not.toContain("reclaimTerminalCodeAgentWorktree");
    expect(startup).not.toContain("cleanupDueManagedCodeAgentWorktrees");
    expect(startup).not.toContain("resumeQueuedCodeAgentWorktreeRuns");
    expect(main).toContain("function ensureDesktopComputerMcpBridge()");
    expect(main).toContain("remoteConnectorStartPromise");
    expect(main).toContain("startRemoteCodeAgentConnectorInternal()");
  });

  it("does not revalidate a verified desktop identity on tab status reads", () => {
    const identity = source("./desktop-identity.ts");
    const refreshStatus = between(
      identity,
      "async refreshStatus(authorityApp: DesktopIdentityApp | null)",
      "private ensureAppSessionInternal(",
    );

    expect(refreshStatus).toContain('this.status === "signed-in"');
    expect(refreshStatus).toContain("statusRevalidationIntervalMs");
    expect(identity).toContain("statusTimeoutMs");

    const signOutGuard = refreshStatus.indexOf(
      "if (this.signOutOperation) return;",
    );
    const signedInFastPath = refreshStatus.indexOf(
      'this.status === "signed-in"',
    );
    expect(signOutGuard).toBeGreaterThanOrEqual(0);
    expect(signedInFastPath).toBeGreaterThan(signOutGuard);
  });

  it("starts native sign-in from the Dispatch authority, not the active app", () => {
    const main = source("./index.ts");
    const signIn = between(
      main,
      "ipcMain.handle(IPC.IDENTITY_SIGN_IN",
      "ipcMain.handle(IPC.IDENTITY_AUTHENTICATE",
    );

    expect(signIn).toContain("resolveDesktopIdentityAuthority()");
    expect(signIn).not.toContain("resolveDesktopIdentityApp(activeAppId)");

    const resolver = between(
      main,
      "function resolveDesktopIdentityApp(",
      "function listDesktopIdentityApps(",
    );
    expect(resolver).toContain(
      'allowDisabled: appId === "dispatch" && isCanonical',
    );
    expect(resolver).toContain("allowDisabled?: boolean");
    expect(main).toContain(
      'return resolveDesktopIdentityApp("dispatch", { allowDisabled: true });',
    );
    expect(main).not.toContain(
      'refreshStatus(resolveDesktopIdentityApp("dispatch"))',
    );
    expect(main).toContain("retryAppSessionFanout()");
  });

  it("keeps remembered Content folder discovery metadata-only", () => {
    const main = source("./index.ts");
    const normalization = between(
      main,
      "function normalizeContentFilesGrant(",
      "function loadContentFilesStore(",
    );
    // The Content-files IPC handlers live in ./ipc/content-files.ts.
    const contentFilesIpc = source("./ipc/content-files.ts");
    const handler = between(
      contentFilesIpc,
      "IPC.CONTENT_FILES_GET_FOLDER",
      "IPC.CONTENT_FILES_CHOOSE_FOLDER",
    );

    expect(normalization).not.toContain("resolveUsableContentFolder");
    expect(handler).not.toContain("collectLocalControlResources");
  });

  it("revision-guards every Content file mutation path", () => {
    const main = source("./index.ts");
    const bulkWrite = between(
      main,
      "async function writeContentFilesForRequest(",
      "async function writeContentFileForRequest(",
    );
    const deleteFile = between(
      main,
      "async function deleteContentFileForRequest(",
      "async function revealContentFileForRequest(",
    );
    const pickerBridge = source(
      "../renderer/lib/content-directory-picker-bridge.ts",
    );
    const localFilesRoute = source(
      "../../../../templates/content/app/routes/_app.local-files.tsx",
    );

    expect(bulkWrite).toContain("expectedRevisions[filePath]");
    expect(bulkWrite).toContain("removeStaleContentMarkdownFiles(");
    expect(deleteFile).toContain("file.expectedRevision");
    expect(pickerBridge).toContain("expectedRevision: expectedRevision");
    expect(localFilesRoute).toContain("expectedRevisions,");
  });

  it("does not bulk-pull local folders when Content mounts", () => {
    const route = source(
      "../../../../templates/content/app/routes/_app.local-files.tsx",
    );
    const restore = between(
      route,
      "const restoreDirectories = async () =>",
      "restoreDirectories()",
    );
    expect(restore).not.toContain("pullDirectoryFiles");
    expect(restore).not.toContain("connectLocalComponentWorkspaces");
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
    expect(runDetail).toContain('secondaryActionLabel="Custom keys"');
    expect(runDetail).not.toContain("Task paused");
    expect(runDetail).not.toContain("code-agents-session-details");
    expect(runDetail).not.toContain("TokenUsageMeter");
    expect(runDetail).not.toContain("Open Task workspace");
    expect(agent).toContain("<ChatFirstChatHistory");
    expect(agent).toContain("chatFirstNavigation?.onOpenChats");
  });

  it("retries a missing-provider chat after Builder connects", () => {
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");
    const connectFlow = between(
      agent,
      "const connectBuilderProvider = useCallback(async () =>",
      "  const connectLocalRuntime = useCallback(",
    );

    expect(connectFlow).toContain('modelSelection.model === "auto"');
    expect(connectFlow).toContain("hasMissingCredentialSignal(");
    expect(connectFlow).toContain("await host.retryRun({");
    expect(connectFlow).toContain("selectRun(retryResult.run.id)");
    expect(agent).toContain("shouldShowCodeAgentCredentialCallout({");
    expect(agent).toContain("providerBlocked,");
    expect(agent).toContain("hasCredentialHistory,");
    expect(agent).toContain("phase: run.phase,");
    expect(agent).toContain("hideCredentialMessages={hasCredentialHistory}");
  });

  it("detects credential-gap transcript events through the shared core helper", () => {
    const agent = source("../../../code-agents-ui/src/CodeAgentsApp.tsx");

    expect(agent).toContain("isCredentialGapCodeAgentEvent,");
    expect(agent).toContain('} from "@agent-native/core/client/agent-chat";');
    const detector = between(
      agent,
      "function isCredentialTranscriptEvent(",
      "function hasPendingApproval(",
    );
    expect(detector).toContain("isCredentialGapCodeAgentEvent(event)");
    // No local regex duplicate — the shared helper owns the fallback match.
    expect(detector).not.toContain("No LLM provider key was found");
  });

  it("does not treat unreadable saved provider blobs as a runtime provider", () => {
    const main = source("./index.ts");
    const runtimeCheck = between(
      main,
      "function hasRuntimeNonCodexCodeAgentLlmProvider(",
      "function normalizeCodeAgentRequestedEngine(",
    );

    expect(runtimeCheck).not.toContain(
      "AppStore.getCodeAgentProviderSettingsStatus()",
    );
    expect(main).toContain("applyCodeAgentProviderCredentialsToEnv()");
    expect(main).toContain("applyResult.failedKeys.length > 0");
  });

  it("checks saved provider credentials before rejecting a coding chat", () => {
    const main = source("./index.ts");
    const providerCheck = between(
      main,
      "function ensureCodeAgentLlmProvider()",
      "const CLI_PROBE_TIMEOUT_MS",
    );

    expect(providerCheck).toContain(
      "AppStore.getCodeAgentProviderProcessEnv(process.env)",
    );
    expect(providerCheck).toContain(
      "hasRuntimeNonCodexCodeAgentLlmProvider(providerEnv)",
    );
  });

  it("keeps desktop app creation visible while provider setup is incomplete", () => {
    const main = source("./index.ts");
    const createRun = between(
      main,
      "async function createCodeAgentRun(",
      "async function rerunCodeAgentRun(",
    );
    const runner = between(
      main,
      "async function spawnCodeAgentRunner(",
      "function spawnCodeAgentApprovalRunner(",
    );

    expect(createRun).toContain(
      'const isDesktopAppCreation = userMetadata.kind === "desktop-create-app"',
    );
    expect(createRun).toContain("if (!provider.ok && !isDesktopAppCreation)");
    expect(runner).toContain('phase: "missing-credentials"');
  });

  it("starts empty desktop app creation from the framework workspace", () => {
    const main = source("./index.ts");
    const repository = between(
      main,
      "function resolveRepositoryRoot(",
      "function touchCodeAgentRunRecord(",
    );
    const creation = between(
      main,
      "async function createDesktopAppFromPrompt(",
      "const lastDesktopAppRuntimeStatus",
    );

    expect(repository).toContain(
      'IS_DEV ? path.resolve(__dirname, "../../../..") : undefined',
    );
    expect(creation).toContain(
      "const appCreationCwd = resolveRepositoryRoot(appsRoot);",
    );
    expect(creation).toContain("cwd: appCreationCwd");
    expect(creation).toContain(
      "const requestedName = requestedDesktopAppName(prompt);",
    );
    expect(creation).toContain("requestedName ??");
    expect(main).toContain("includeWorkspaceApps: true");
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
    expect(modelList).toContain('statusLabel: "ChatGPT subscription"');
    expect(modelList).toContain('statusLabel: "Claude subscription"');
    expect(modelList).not.toContain('engine: "auto"');
  });

  it("closes both desktop bridges during update preparation and quit", () => {
    const main = source("./index.ts");
    const closeLifecycle = between(
      main,
      "async function closeDesktopComputerMcpBridge(): Promise<void> {",
      "function isShellIdentityIpc(",
    );

    expect(closeLifecycle).toContain("if (computerBridge)");
    expect(closeLifecycle).toContain("computerBridge.close()");
    expect(closeLifecycle).toContain("if (browserBridge)");
    expect(closeLifecycle).toContain("browserBridge.close()");
    expect(closeLifecycle).toContain("Promise.allSettled(closePromises)");
    expect(closeLifecycle).not.toContain("} else {");
    expect(closeLifecycle).toContain("prepareForUpdate: async () => {");
    expect(closeLifecycle).toContain("await closeDesktopComputerMcpBridge();");
    expect(closeLifecycle).toContain(
      "await disposeMultiFrontierAppIntegration();",
    );
    expect(main).toContain("void closeDesktopComputerMcpBridge().catch(");
    expect(main).toContain("restoreAfterUpdateFailure: async () => {");
    expect(main).toContain("await ensureDesktopComputerMcpBridge();");
    expect(main).toContain(
      "initializeMultiFrontierAppIntegrationForRuntime();",
    );
    expect(main).toContain("multiFrontierDisposePromise = undefined;");
  });

  it("runs the quit guard before poisoning shutdown state", () => {
    const main = source("./index.ts");
    const beforeQuit = between(
      main,
      'app.on("before-quit", (event) => {',
      'app.on("will-quit", () => {',
    );
    const guardIndex = beforeQuit.indexOf("multiFrontierQuitGuard(event)");
    const quittingIndex = beforeQuit.indexOf("appIsQuitting = true");
    const stopServicesIndex = beforeQuit.indexOf(
      "stopManagedDesktopApp(appId)",
    );

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(quittingIndex);
    expect(guardIndex).toBeLessThan(stopServicesIndex);
  });

  it("captures a cold-start deep link from argv on Windows/Linux instead of dropping it", () => {
    const main = source("./index.ts");
    const singleInstanceSetup = between(
      main,
      "function capturePendingDeepLinkFromArgv(argv: string[]): void {",
      "interface OAuthInjectionTarget {",
    );

    // Reuses the same isDeepLinkArg/pendingDeepLink path as the macOS
    // open-url cold start, instead of a parallel deep-link path.
    expect(singleInstanceSetup).toContain("argv.find(isDeepLinkArg)");
    expect(singleInstanceSetup).toContain("pendingDeepLink = deepLink;");

    // Both the dev (no single-instance lock) and packaged (lock acquired)
    // startup paths must capture it — a cold start can happen either way.
    const devBranch = between(singleInstanceSetup, "if (IS_DEV) {", "} else {");
    const lockAcquiredBranch = between(
      singleInstanceSetup,
      'app.on("second-instance", handleSecondInstance);\n    capturePendingDeepLinkFromArgv(process.argv);',
      "}\n}",
    );

    expect(devBranch).toContain(
      "capturePendingDeepLinkFromArgv(process.argv);",
    );
    expect(lockAcquiredBranch).toContain(
      "capturePendingDeepLinkFromArgv(process.argv);",
    );

    // app.whenReady() must be the only place pendingDeepLink is dispatched,
    // so a cold-start link isn't handled before dependent startup steps run.
    const whenReady = between(
      main,
      "app.whenReady().then(async () => {",
      "// Webviews now run in per-app persisted partitions",
    );
    expect(whenReady).toContain("if (pendingDeepLink) {");
    expect(whenReady).toContain("handleDeepLink(deepLink);");
  });

  it("registers development deep links against the current app path", () => {
    const main = source("./index.ts");
    const registration = between(
      main,
      "const DEEP_LINK_PROTOCOL = DESKTOP_DEEP_LINK_PROTOCOL;",
      "let pendingDeepLink: string | null = null;",
    );

    expect(registration).toContain(
      "app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [",
    );
    expect(registration).toContain("app.getAppPath(),");
    expect(registration).not.toContain("process.argv[1]");
    expect(registration).toContain(
      "app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);",
    );
  });

  it("does not let embedded pages invoke privileged desktop deep links", () => {
    const main = source("./index.ts");
    const windowOpen = between(
      main,
      "function handleWindowOpenForContents(",
      "function installWebviewOAuthNavigationHandler(",
    );

    expect(windowOpen).toContain(
      "isTrustedShell && handleDesktopProtocolUrl(url)",
    );
    expect(windowOpen).toContain(
      "denied desktop deep link from embedded content",
    );
    const navigation = between(
      main,
      "function installWebviewOAuthNavigationHandler(",
      "// ---------- Webview popup handling ----------",
    );
    expect(navigation).toContain(
      "denied desktop deep-link navigation from embedded content",
    );
    expect(navigation).not.toContain("handleDesktopProtocolUrl(url)");
    expect(
      navigation.indexOf("if (isDesktopDeepLinkUrl(url))"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      navigation.indexOf("if (mcpOAuthNavigationGate.isActive(contents.id))"),
    ).toBeGreaterThan(navigation.indexOf("if (isDesktopDeepLinkUrl(url))"));
  });

  it("keeps stable and nightly protocol registration channel-specific", () => {
    expect(
      readFileSync(
        new URL("../../electron-builder.yml", import.meta.url),
        "utf8",
      ),
    ).toContain("- agentnative");
    expect(
      readFileSync(
        new URL(
          "../../../../.github/workflows/desktop-release.yml",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain("agentnative(?:-nightly)?");
  });

  it("does not claim unsupported desktop deep-link routes were handled", () => {
    const main = source("./index.ts");
    const handler = between(
      main,
      "function handleDesktopProtocolUrl(url: string): boolean {",
      "function cleanContextMenuTemplate(",
    );

    expect(handler).toContain("recognizedRoute");
    expect(handler).toContain("return false;");
    expect(handler).toContain("ignored unsupported desktop deep link route");
  });
});
