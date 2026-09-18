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
 * `embedStartUrl` and bridge credentials are intentionally omitted from the
 * result. A caller may provide a locally generated bridge token as input when
 * it starts a fresh bridge, but the page never returns that credential.
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

type OpenVisualEditActionResult = OpenVisualEditWebMcpResult & {
  /** Same-origin only; never return this from the page-local tool. */
  embedStartUrl?: string;
};

export interface OpenVisualEditWebMcpInput {
  designId?: string;
  connectionId?: string;
  title?: string;
  description?: string;
  devServerUrl: string;
  bridgeUrl?: string;
  bridgeToken?: string;
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

interface VisualEditBridgeAttestation {
  previewToken: string;
  manifest: {
    source: unknown;
    sourceType: unknown;
    localOnly: unknown;
    devServerUrl: unknown;
    bridgeUrl: unknown;
    rootPath: unknown;
  };
}

const PREVIEW_TOKEN_DOMAIN = "agent-native-design-preview-v1\0";

async function derivePreviewToken(bridgeToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${PREVIEW_TOKEN_DOMAIN}${bridgeToken}`,
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readVisualEditBridgeAttestation(
  input: OpenVisualEditWebMcpInput,
  signal?: AbortSignal,
): Promise<VisualEditBridgeAttestation | undefined> {
  const bridgeToken = input.bridgeToken?.trim();
  if (!bridgeToken) return undefined;

  const bridgeUrl = input.bridgeUrl ?? "http://127.0.0.1:7331";
  let manifestUrl: URL;
  try {
    manifestUrl = new URL("/manifest.json", bridgeUrl);
    manifestUrl.searchParams.set(
      "previewToken",
      await derivePreviewToken(bridgeToken),
    );
  } catch {
    throw new Error(
      `The local visual-edit bridge URL "${bridgeUrl}" is invalid. Use the loopback URL printed by \`agent-native design connect\` and retry.`,
    );
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(manifestUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `The local visual-edit bridge rejected its preview credential (${response.status}). Restart the bridge with the supplied token and retry.`,
      );
    }
    const manifest = (await response.json()) as unknown;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error(
        "The local visual-edit bridge returned an invalid preview manifest. Restart `agent-native design connect` and retry.",
      );
    }
    return {
      previewToken: manifestUrl.searchParams.get("previewToken") ?? "",
      manifest: manifest as VisualEditBridgeAttestation["manifest"],
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.message.includes("rejected its")) {
      throw error;
    }
    throw new Error(
      `The local visual-edit bridge at ${bridgeUrl} is not reachable. Start \`agent-native design connect\` and retry.`,
    );
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function createOpenVisualEditWebMcpActions() {
  let bootstrapTokenPromise: Promise<string> | undefined;
  const getBootstrapToken = async (signal?: AbortSignal): Promise<string> => {
    if (!bootstrapTokenPromise) {
      bootstrapTokenPromise = callAction<{ token?: string }>(
        "issue-visual-edit-bootstrap",
        {},
        { signal },
      ).then((result) => {
        if (!result?.token) {
          throw new Error("Visual-edit bootstrap did not return a capability.");
        }
        return result.token;
      });
      bootstrapTokenPromise.catch(() => {
        bootstrapTokenPromise = undefined;
      });
    }
    return bootstrapTokenPromise;
  };

  return [
    defineClientAction<OpenVisualEditWebMcpInput, OpenVisualEditWebMcpResult>({
      name: "open-visual-edit",
      title: "Open visual edit", // i18n-ignore stable WebMCP tool title
      description: // i18n-ignore stable WebMCP tool description
        "Open or refresh a running localhost app in Design overview mode. Works in a signed-in or signed-out Design tab when the target is loopback; the local bridge remains the only source access path.",
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
          bridgeToken: {
            type: "string",
            description:
              "Optional token already supplied to a fresh local bridge. Never request this from the page; pass only a token generated by the local host.",
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
        required: ["devServerUrl"],
        additionalProperties: false,
      },
      run: async (input, runtime) => {
        const bootstrapToken = await getBootstrapToken(runtime.signal);
        const bridgeAttestation = await readVisualEditBridgeAttestation(
          input,
          runtime.signal,
        );
        const actionInput = bridgeAttestation
          ? { ...input, bridgeAttestation }
          : input;
        const result = (await callAction("open-visual-edit", actionInput, {
          signal: runtime.signal,
          headers: {
            Authorization: `Bearer ${bootstrapToken}`,
            "X-Agent-Native-Embed-Target": "/visual-edit",
          },
        })) as OpenVisualEditActionResult;
        // The same-origin page transport invokes this call, but cannot start a
        // local process. A host may pass a token it used to start that process;
        // do not expose bridge credentials in the result.
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
          embedStartUrl,
        } = result;
        if (input.navigate !== false && embedStartUrl) {
          window.location.replace(
            new URL(embedStartUrl, window.location.href).toString(),
          );
        }
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
 * Mounted app-wide (not just the editor) so a browser-driven coding agent can
 * bootstrap a visual-edit design from the hosted Design page — signed in or
 * signed out — without a separate hosted MCP connector or OAuth step.
 * Anonymous calls are limited server-side to loopback, public visual-edit
 * resources.
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
