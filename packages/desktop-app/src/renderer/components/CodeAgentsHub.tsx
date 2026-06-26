import {
  CodeAgentsApp,
  type CodeAgentModelListResult,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptRequest,
  type CodeAgentsHost,
} from "@agent-native/code-agents-ui";
import { toAppDefinition, type AppConfig } from "@shared/app-registry";
import { useMemo } from "react";

import AppWebview from "./AppWebview.js";

const agentNativeIconUrl = new URL(
  "../assets/agent-native-icon-dark.svg",
  import.meta.url,
).href;

interface CodeAgentsHubProps {
  apps: AppConfig[];
  openRequest?: { goalId?: string; runId?: string; nonce: number };
  refreshKey?: number;
  onOpenSettings?: () => void;
}

type CodeAgentTranscriptSubscriptionBatch = {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  error?: string;
  subscriptionId?: string;
  reason?: string;
};

interface CodeAgentsHostWithTranscriptSubscription extends CodeAgentsHost {
  subscribeTranscript?(
    request: CodeAgentTranscriptRequest,
    cb: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
  ): () => void;
}

export default function CodeAgentsHub({
  apps,
  openRequest,
  refreshKey = 0,
  onOpenSettings,
}: CodeAgentsHubProps) {
  const host = useMemo<CodeAgentsHostWithTranscriptSubscription>(
    () => ({
      async listRuns(goalId?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listRuns) {
          return {
            status: "unavailable",
            goalId,
            runs: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listRuns(goalId);
      },
      async createRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.createRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.createRun(request);
      },
      async listModels() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listModels) {
          return {
            status: "unavailable",
            models: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listModels() as Promise<CodeAgentModelListResult>;
      },
      async getHostMetadata() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getHostMetadata) {
          return {
            status: "unavailable",
            llmProvider: { configured: false },
            error: "Desktop bridge is not available.",
          };
        }
        return api.getHostMetadata();
      },
      async listCodePacks(cwd?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listCodePacks) {
          return {
            status: "unavailable",
            error: "Desktop bridge is not available.",
          };
        }
        return api.listCodePacks(cwd);
      },
      async listProjects() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listProjects) {
          return {
            status: "unavailable",
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listProjects();
      },
      async selectProject(cwd) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.selectProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.selectProject(cwd);
      },
      async chooseProject() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.chooseProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.chooseProject();
      },
      async readTranscript(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.readTranscript) {
          return {
            status: "unavailable",
            runId: request.runId,
            events: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.readTranscript(request);
      },
      subscribeTranscript(request, callback) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.subscribeTranscript) return () => {};
        return api.subscribeTranscript(request, callback);
      },
      async appendFollowUp(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.appendFollowUp) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.appendFollowUp(request);
      },
      async updateRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.updateRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.updateRun(request);
      },
      async retryRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.retryRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.retryRun(request);
      },
      async rerunRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.rerunRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.rerunRun(request);
      },
      async controlRun(goalId, runId, command, permissionMode) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.controlRun) {
          return {
            ok: false,
            command,
            action: "none",
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.controlRun(goalId, runId, command, permissionMode);
      },
      async openTerminal(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.openTerminal) {
          return {
            ok: false,
            cwd:
              request?.cwd ?? request?.outputRoot ?? request?.sourceRoot ?? "",
            error: "Desktop bridge is not available.",
          };
        }
        return api.openTerminal(request);
      },
      async getRemoteConnectorStatus() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getRemoteConnectorStatus) {
          return {
            state: "error",
            enabled: false,
            configured: false,
            configPath: "",
            restartCount: 0,
            error: "Desktop bridge is not available.",
          };
        }
        return api.getRemoteConnectorStatus();
      },
      async setRemoteConnectorEnabled(enabled) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.setRemoteConnectorEnabled) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.setRemoteConnectorEnabled(enabled);
      },
      async pairRemoteConnector(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.pairRemoteConnector) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.pairRemoteConnector(request);
      },
      async connectBuilderProvider() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.connectBuilderProvider) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.connectBuilderProvider();
      },
    }),
    [],
  );

  return (
    <CodeAgentsApp
      apps={apps}
      host={host}
      openRequest={openRequest}
      refreshKey={refreshKey}
      brandIconUrl={agentNativeIconUrl}
      onOpenSettings={onOpenSettings}
      renderAppSurface={({ app, urlParams, refreshKey: appRefreshKey }) => (
        <div className="code-agents-embedded-app-surface">
          <AppWebview
            app={toAppDefinition(app)}
            appConfig={app}
            isActive
            urlParams={urlParams}
            refreshKey={appRefreshKey}
          />
        </div>
      )}
    />
  );
}
