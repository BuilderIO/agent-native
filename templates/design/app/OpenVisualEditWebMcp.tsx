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
 * `embedStartUrl` and bridge credentials are intentionally omitted: they are
 * capabilities meant for a headless CLI caller, while this tool already runs
 * with the browser's own real session.
 */
export interface OpenVisualEditWebMcpResult {
  designId: string;
  connectionId: string;
  createdDesign: boolean;
  publicReadOnly: boolean;
  devServerUrl: string;
  bridgeUrl?: string;
  rootPath?: string;
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
  bridgeUrl?: string;
  rootPath?: string;
  name?: string;
  routeManifest?: unknown;
  capabilities?: unknown;
  bridgeToken?: string;
  previewToken?: string;
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
        "Open or refresh a running localhost app in Design overview mode, using this browser tab's own signed-in session (no separate account login or MCP connector needed). Registers the local bridge, creates or reuses a design, places URL-backed screens, and navigates this session to the canvas. Same arguments as the open-visual-edit CLI action.",
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
              "Local bridge URL printed by agent-native design connect.",
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
          bridgeToken: {
            type: "string",
            description:
              "Optional bridge token to store on the connection. Omit it and the server mints one for the local bridge.",
          },
          previewToken: { type: "string" },
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
        required: ["devServerUrl"],
        additionalProperties: false,
      },
      run: async (input) => {
        const result = await callAction("open-visual-edit", input);
        // The browser session already authorizes this call. Do not expose the
        // bridge credentials that the headless CLI needs to start a process.
        const {
          designId,
          connectionId,
          createdDesign,
          publicReadOnly,
          devServerUrl,
          bridgeUrl,
          rootPath,
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
          rootPath: rootPath ?? undefined,
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
    pending.resolve(approved);
  }, []);
  const requestApproval = useCallback(
    (request: AgentNativeWebMcpApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        pendingApprovalRef.current?.resolve(false);
        const pending = { request, resolve };
        pendingApprovalRef.current = pending;
        setPendingApproval(pending);
      }),
    [],
  );

  useEffect(() => {
    const registration = createAgentNativeWebMcpRegistration({
      actions: createOpenVisualEditWebMcpActions(),
      approve: requestApproval,
    });
    void registration.start().catch(() => {
      // WebMCP is progressive enhancement; the MCP-connector/CLI path remains available.
    });
    return () => {
      registration.stop();
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
}
