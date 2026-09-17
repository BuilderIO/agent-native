import { callAction } from "@agent-native/core/client/hooks";
import { defineClientAction } from "@agent-native/core/client/host";
import {
  createAgentNativeWebMcpRegistration,
  type AgentNativeWebMcpApprovalRequest,
} from "@agent-native/core/client/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Safe browser-visible subset of the `open-visual-edit` action result.
 * `embedStartUrl` and bridge credentials are intentionally omitted: the page
 * action reuses an already-running bridge and never starts one in the browser.
 */
export interface OpenVisualEditWebMcpResult {
  designId: string;
  connectionId: string;
  createdDesign: boolean;
  publicReadOnly: boolean;
  devServerUrl: string;
  bridgeUrl?: string;
  screenCount: number;
  overview: boolean;
  urlPath: string;
  openUrl: string;
}

export interface OpenVisualEditWebMcpInput {
  designId?: string;
  connectionId?: string;
  title?: string;
  description?: string;
  devServerUrl: string;
  bridgeUrl: string;
  rootPath?: string;
  name?: string;
  routeManifest?: unknown;
  capabilities?: unknown;
  routes?: unknown[];
  paths?: string[];
  viewports?: unknown[];
  defaultWidth?: number;
  defaultHeight?: number;
  startX?: number;
  startY?: number;
  gap?: number;
  navigate?: boolean;
  publicReadOnly?: boolean;
}

export function createOpenVisualEditWebMcpActions() {
  return [
    defineClientAction<OpenVisualEditWebMcpInput, OpenVisualEditWebMcpResult>({
      name: "open-visual-edit",
      title: "Open visual edit", // i18n-ignore stable WebMCP tool title
      description: // i18n-ignore stable WebMCP tool description
        "Open or refresh a running localhost app in Design overview mode, using this browser tab's own signed-in session. Requires an already-running local bridge; no separate account login or hosted MCP connector is needed. Creates or reuses a design, places URL-backed screens, and navigates this session to the canvas.",
      requiresApproval: {
        title: "Open visual edit?", // i18n-ignore stable WebMCP approval title
        description: // i18n-ignore stable WebMCP approval description
          "This can create or update a Design project and localhost connection, and may make a new loopback design public.",
        confirmLabel: "Open visual edit", // i18n-ignore stable WebMCP approval label
        risk: "medium",
      },
      schema: {
        type: "object",
        properties: {
          designId: {
            type: "string",
            description:
              "Existing Design project to update. Omit to create a new visual-edit design.",
          },
          connectionId: {
            type: "string",
            description:
              "Existing localhost connection. Omit to reuse a stable per-user connection for devServerUrl + rootPath.",
          },
          title: {
            type: "string",
            description: "Title for a newly created design project.",
          },
          description: { type: "string" },
          devServerUrl: {
            type: "string",
            description:
              "Running local app URL, for example http://localhost:5173",
          },
          bridgeUrl: {
            type: "string",
            description:
              "URL of the already-running local bridge printed by agent-native design connect.",
          },
          rootPath: {
            type: "string",
            description: "Repository root for the app.",
          },
          name: {
            type: "string",
            description: "Human-readable connection name.",
          },
          routeManifest: {
            type: "object",
            description: "Route manifest from the local Design bridge.",
          },
          capabilities: { type: "array", items: { type: "object" } },
          routes: {
            type: "array",
            items: { type: "object" },
            description:
              "Screens to place. Each route may include path, url, connectionId, title, viewport width/height, and x/y/z.",
          },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Shortcut for routes when only paths/URLs are needed.",
          },
          viewports: {
            type: "array",
            items: {},
            description:
              'Place every requested route once per viewport ("desktop", "laptop", "tablet", "mobile", or {label?, width, height}).',
          },
          defaultWidth: { type: "number" },
          defaultHeight: { type: "number" },
          startX: { type: "number" },
          startY: { type: "number" },
          gap: { type: "number" },
          navigate: {
            type: "boolean",
            description:
              "Write a navigate app-state command to open overview mode. Defaults to true.",
          },
          publicReadOnly: {
            type: "boolean",
            description:
              "For newly created loopback localhost designs, make the design public viewer-access too. Defaults to true.",
          },
        },
        required: ["devServerUrl", "bridgeUrl"],
        additionalProperties: false,
      },
      run: async (input, runtime) => {
        const result = await callAction("open-visual-edit", input, {
          signal: runtime.signal,
        });
        // The browser session authorizes this call, but cannot safely start a
        // local process. Do not expose the bridge credentials needed by CLI.
        const {
          designId,
          connectionId,
          createdDesign,
          publicReadOnly,
          devServerUrl,
          bridgeUrl,
          screenCount,
          overview,
          urlPath,
          openUrl,
        } = result;
        return {
          designId,
          connectionId,
          createdDesign,
          publicReadOnly,
          devServerUrl,
          bridgeUrl: bridgeUrl ?? undefined,
          screenCount,
          overview,
          urlPath,
          openUrl,
        };
      },
    }),
  ];
}

/**
 * Mounted app-wide (not just the editor) so a Chrome-driven coding agent can
 * bootstrap a visual-edit design from any signed-in Design page — the home
 * dashboard included — without a separate hosted MCP connector or OAuth step.
 * The browser tab's own session is the credential.
 */
export function OpenVisualEditWebMcp() {
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  const resolveApproval = useCallback((approved: boolean) => {
    const pending = pendingApprovalRef.current;
    if (!pending) return;
    pendingApprovalRef.current = null;
    setPendingApproval(null);
    if (pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
    pending.resolve(approved);
  }, []);
  const requestApproval = useCallback(
    (request: AgentNativeWebMcpApprovalRequest, signal?: AbortSignal) => {
      if (signal?.aborted) return Promise.resolve(false);
      if (pendingApprovalRef.current) {
        // Reject overlapping calls instead of replacing the request shown in
        // the dialog with a different request's resolver.
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const abortHandler = () => {
          if (pendingApprovalRef.current?.abortHandler === abortHandler) {
            resolveApproval(false);
          }
        };
        const pending = { request, resolve, signal, abortHandler };
        signal?.addEventListener("abort", abortHandler, { once: true });
        pendingApprovalRef.current = pending;
        setPendingApproval(pending);
      });
    },
    [resolveApproval],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 1_000;
    let registration:
      | ReturnType<typeof createAgentNativeWebMcpRegistration>
      | undefined;
    const actions = createOpenVisualEditWebMcpActions();

    const scheduleRetry = () => {
      if (disposed || retryTimer !== undefined) return;
      const delay = retryDelayMs;
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        startRegistration();
      }, delay);
    };
    const startRegistration = () => {
      if (disposed) return;
      registration?.stop();
      const nextRegistration = createAgentNativeWebMcpRegistration({
        actions,
        approve: requestApproval,
      });
      registration = nextRegistration;
      const isCurrentRegistration = () =>
        !disposed && registration === nextRegistration;
      void nextRegistration.start().then(
        () => {
          if (!isCurrentRegistration()) return;
          if (!nextRegistration.supported) {
            scheduleRetry();
          } else {
            retryDelayMs = 1_000;
          }
        },
        () => {
          if (!isCurrentRegistration()) return;
          // WebMCP is progressive enhancement; retry while the model context
          // or the action manifest becomes available.
          scheduleRetry();
        },
      );
    };

    startRegistration();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      registration?.stop();
      resolveApproval(false);
    };
  }, [requestApproval, resolveApproval]);

  const approval = pendingApproval
    ? (pendingApproval.request.action.approval ??
      (typeof pendingApproval.request.action.requiresApproval === "object"
        ? pendingApproval.request.action.requiresApproval
        : undefined))
    : undefined;

  return (
    <AlertDialog
      open={pendingApproval !== null}
      onOpenChange={(open) => {
        if (!open) resolveApproval(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {approval?.title ?? pendingApproval?.request.action.title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {approval?.description ??
              pendingApproval?.request.action.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveApproval(false)}>
            {"Cancel" /* i18n-ignore stable WebMCP approval control */}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveApproval(true)}>
            {
              approval?.confirmLabel ??
                "Approve" /* i18n-ignore stable WebMCP approval control */
            }
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface PendingApproval {
  request: AgentNativeWebMcpApprovalRequest;
  resolve: (approved: boolean) => void;
  signal?: AbortSignal;
  abortHandler: () => void;
}
