import * as vscode from "vscode";

import {
  buildConnectCommand,
  buildDesignConnectCommand,
  ConnectScope,
} from "./connect";
import { DEFAULT_APP_URL, normalizeOpenUrl, titleForUrl } from "./links";

type OpenResult = {
  url: string;
  title: string;
};

let currentPanel: vscode.WebviewPanel | undefined;
let currentUrl: string | undefined;
let lastOpenedUrl: string | undefined;
const DESIGN_APP_URL = "https://design.agent-native.com";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new AgentNativeController(context);

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        await controller.handleUri(uri);
      },
    }),
    vscode.commands.registerCommand("agentNative.openDefaultApp", () =>
      controller.openDefaultApp(),
    ),
    vscode.commands.registerCommand("agentNative.openUrl", (url?: string) =>
      controller.openUrl(url),
    ),
    vscode.commands.registerCommand(
      "agentNative.connectWorkspace",
      (appUrl?: string, scope?: ConnectScope) =>
        controller.connectWorkspace(appUrl, scope),
    ),
    vscode.commands.registerCommand(
      "agentNative.openDesignCanvas",
      (devServerUrl?: string, port?: number) =>
        controller.openDesignCanvas(devServerUrl, port),
    ),
    vscode.commands.registerCommand(
      "agentNative._getLastOpenedUrl",
      () => lastOpenedUrl,
    ),
    vscode.commands.registerCommand("agentNative._openUri", (uri: vscode.Uri) =>
      controller.handleUri(uri),
    ),
  );
}

export function deactivate(): void {}

class AgentNativeController {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async openDefaultApp(): Promise<OpenResult | undefined> {
    const configured = vscode.workspace
      .getConfiguration("agentNative")
      .get<string>("defaultAppUrl", DEFAULT_APP_URL);
    return this.openUrl(configured);
  }

  async openUrl(input?: string): Promise<OpenResult | undefined> {
    const raw =
      input ??
      (await vscode.window.showInputBox({
        title: "Open Agent Native URL",
        prompt: "Paste an Agent Native app or handoff URL.",
        value: DEFAULT_APP_URL,
      }));
    if (!raw) return undefined;

    const normalized = normalizeOpenUrl(raw);
    if (!normalized) {
      await vscode.window.showErrorMessage(
        "Agent Native can open http(s) app URLs or vscode://builder.agent-native/open links.",
      );
      return undefined;
    }

    return this.openWebview(normalized);
  }

  async handleUri(uri: vscode.Uri): Promise<OpenResult | undefined> {
    return this.openUrl(uri.toString(true));
  }

  async connectWorkspace(
    input?: string,
    scopeInput?: ConnectScope,
  ): Promise<string | undefined> {
    const appUrl =
      input ??
      (await vscode.window.showInputBox({
        title: "Connect Workspace to Agent Native MCP",
        prompt:
          "Agent Native app URL to connect to VS Code / GitHub Copilot MCP.",
        value: DEFAULT_APP_URL,
      }));
    if (!appUrl) return undefined;

    const normalized = normalizeOpenUrl(appUrl);
    if (!normalized) {
      await vscode.window.showErrorMessage(
        "Enter an http(s) Agent Native app URL.",
      );
      return undefined;
    }

    const scope =
      scopeInput ??
      ((await vscode.window.showQuickPick(["project", "user"], {
        title: "Where should the VS Code MCP config be written?",
        placeHolder: "project writes .vscode/mcp.json in this workspace",
      })) as ConnectScope | undefined);
    if (!scope) return undefined;

    const command = buildConnectCommand({ appUrl: normalized, scope });
    const terminal = vscode.window.createTerminal("Agent Native MCP");
    terminal.show();
    terminal.sendText(command);
    return command;
  }

  async openDesignCanvas(
    input?: string,
    bridgePortInput?: number,
  ): Promise<string | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await vscode.window.showErrorMessage(
        "Open a workspace folder before starting the Design Canvas bridge.",
      );
      return undefined;
    }

    const devServerUrl =
      input ??
      (await vscode.window.showInputBox({
        title: "Open Design Canvas",
        prompt: "URL of the running local app to edit visually.",
        value: "http://localhost:5173",
      }));
    if (!devServerUrl) return undefined;

    const normalized = normalizeOpenUrl(devServerUrl);
    if (!normalized) {
      await vscode.window.showErrorMessage(
        "Enter an http(s) local dev server URL.",
      );
      return undefined;
    }

    const command = buildDesignConnectCommand({
      devServerUrl: normalized,
      rootPath: workspaceFolder.uri.fsPath,
      port: bridgePortInput,
    });
    const terminal = vscode.window.createTerminal("Agent Native Design");
    terminal.show();
    terminal.sendText(command);
    this.openWebview(DESIGN_APP_URL);
    await vscode.window.showInformationMessage(
      "Agent Native Design bridge is starting. Design is opening in a side panel; choose Localhost to connect.",
    );
    return command;
  }

  private openWebview(url: string): OpenResult {
    const title = titleForUrl(url);
    currentUrl = url;
    lastOpenedUrl = url;

    if (!currentPanel) {
      currentPanel = vscode.window.createWebviewPanel(
        "agentNativeApp",
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      currentPanel.onDidDispose(
        () => {
          currentPanel = undefined;
          currentUrl = undefined;
        },
        null,
        this.context.subscriptions,
      );
      currentPanel.webview.onDidReceiveMessage(
        (message: { type?: string; url?: string }) => {
          if (message.type !== "openExternal" || !message.url) return;
          const normalized = normalizeOpenUrl(message.url);
          if (!normalized) return;
          void vscode.env.openExternal(vscode.Uri.parse(normalized));
        },
        null,
        this.context.subscriptions,
      );
    }

    currentPanel.title = title;
    currentPanel.webview.html = renderWebviewHtml(
      currentPanel.webview,
      url,
      title,
    );
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return { url, title };
  }
}

function renderWebviewHtml(
  webview: vscode.Webview,
  url: string,
  title: string,
): string {
  const nonce = randomNonce();
  const safeUrl = escapeHtml(url);
  const safeTitle = escapeHtml(title);
  const csp = [
    "default-src 'none'",
    "frame-src http: https:",
    "img-src http: https: data:",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      padding: 0;
      margin: 0;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    body {
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      box-sizing: border-box;
    }
    .url {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      flex: 1;
    }
    button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 2px;
      padding: 4px 10px;
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: white;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="url" title="${safeUrl}">${safeUrl}</div>
    <button type="button" id="reload">Reload</button>
    <button type="button" id="external">Browser</button>
  </div>
  <iframe
    id="app"
    title="${safeTitle}"
    src="${safeUrl}"
    sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"
  ></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById("app");
    document.getElementById("reload").addEventListener("click", () => {
      frame.src = ${JSON.stringify(url)};
    });
    document.getElementById("external").addEventListener("click", () => {
      vscode.postMessage({ type: "openExternal", url: ${JSON.stringify(url)} });
    });
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
