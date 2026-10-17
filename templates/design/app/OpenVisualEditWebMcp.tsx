import { callAction, useSession } from "@agent-native/core/client/hooks";
import { defineClientAction } from "@agent-native/core/client/host";
import {
  createAgentNativeWebMcpRegistration,
  type AgentNativeWebMcpApprovalRequest,
} from "@agent-native/core/client/webmcp";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

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

import {
  clearLocalhostBridgeFetchProxy,
  installLocalhostBridgeFetchProxy,
  persistLocalhostBridgeTransport,
  readPersistedLocalhostBridgeTransport,
} from "./localhost-bridge-proxy.js";

/** Safe browser-visible subset of the `open-visual-edit` action result. */
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
  embedStartUrl?: string;
};

export interface OpenVisualEditWebMcpInput {
  designId?: string;
  newDesign?: boolean;
  connectionId?: string;
  title?: string;
  description?: string;
  devServerUrl: string;
  bridgeUrl?: string;
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

const BOOTSTRAP_CACHE_TTL_MS = 4 * 60 * 1000;

function isCurrentVisualEditDesign(
  designId: string,
  pathname?: string,
): boolean {
  const currentPathname =
    pathname ??
    (typeof window === "undefined" ? undefined : window.location.pathname);
  if (!currentPathname) return false;
  const match = /\/visual-edit\/([^/]+)(?:\/|$)/.exec(currentPathname);
  if (!match) return false;
  return match[1] === encodeURIComponent(designId);
}

function withoutBridgeCredentials(
  input: OpenVisualEditWebMcpInput,
): OpenVisualEditWebMcpInput {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) => {
        if (
          key === "bridgeToken" ||
          key === "previewToken" ||
          key === "bridgeAttestation"
        ) {
          return [];
        }
        return [[key, visit(nested)]];
      }),
    );
  };

  return visit(input) as OpenVisualEditWebMcpInput;
}

export function createOpenVisualEditWebMcpActions(options?: {
  isAuthenticated?: boolean;
}) {
  const isAuthenticated = options?.isAuthenticated ?? false;
  type BootstrapCapability = { token: string };
  if (isAuthenticated) {
    clearLocalhostBridgeFetchProxy();
  } else {
    const persisted = readPersistedLocalhostBridgeTransport();
    if (persisted && isCurrentVisualEditDesign(persisted.designId)) {
      installLocalhostBridgeFetchProxy(persisted);
    } else {
      clearLocalhostBridgeFetchProxy();
    }
  }
  let bootstrapCapabilityPromise: Promise<BootstrapCapability> | undefined;
  let bootstrapCapabilityExpiresAt = 0;
  const clearBootstrapCapability = () => {
    bootstrapCapabilityPromise = undefined;
    bootstrapCapabilityExpiresAt = 0;
  };
  const getBootstrapCapability = async (
    signal?: AbortSignal,
  ): Promise<BootstrapCapability> => {
    if (
      bootstrapCapabilityPromise &&
      bootstrapCapabilityExpiresAt > Date.now() + 30_000
    ) {
      return bootstrapCapabilityPromise;
    }
    const capabilityPromise = callAction<{
      token?: string;
    }>("issue-visual-edit-bootstrap", {}, { signal }).then((result) => {
      if (!result?.token) {
        throw new Error("Visual-edit bootstrap did not return a capability.");
      }
      return { token: result.token };
    });
    bootstrapCapabilityPromise = capabilityPromise;
    bootstrapCapabilityExpiresAt = Date.now() + BOOTSTRAP_CACHE_TTL_MS;
    capabilityPromise.catch(() => {
      if (bootstrapCapabilityPromise === capabilityPromise) {
        clearBootstrapCapability();
      }
    });
    return capabilityPromise;
  };

  const isCapabilityAuthFailure = (error: unknown): boolean => {
    const status = (error as { status?: unknown } | null)?.status;
    return status === 401 || status === 403;
  };

  const runOpenVisualEdit = async (
    input: OpenVisualEditWebMcpInput,
    runtime: { signal?: AbortSignal },
  ) => {
    const safeInput = withoutBridgeCredentials(input);
    if (isAuthenticated) {
      return (await callAction("open-visual-edit", safeInput, {
        signal: runtime.signal,
      })) as OpenVisualEditActionResult;
    }
    const bootstrap = await getBootstrapCapability(runtime.signal);
    let result: OpenVisualEditActionResult;
    try {
      result = (await callAction("open-visual-edit", safeInput, {
        signal: runtime.signal,
        headers: {
          Authorization: `Bearer ${bootstrap.token}`,
          "X-Agent-Native-Embed-Target": "/visual-edit",
        },
      })) as OpenVisualEditActionResult;
    } catch (error) {
      if (isCapabilityAuthFailure(error)) clearBootstrapCapability();
      throw error;
    }
    return result;
  };

  return [
    defineClientAction<OpenVisualEditWebMcpInput, OpenVisualEditWebMcpResult>({
      name: "open-visual-edit",
      title: "Open visual edit", // i18n-ignore stable WebMCP tool title
      description: // i18n-ignore stable WebMCP tool description
        "Open or refresh a running localhost app in Design overview mode. Reuses the saved project for the same localhost connection when available; set newDesign to true to start a separate project. Works in a signed-in or signed-out Design tab when the target is loopback; the local bridge remains the only source access path.",
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
              "Existing Design project to update. When omitted, the saved visual-edit project for the same localhost connection is reused unless newDesign is true.",
          },
          newDesign: {
            type: "boolean",
            description:
              "Start a separate visual-edit project instead of reusing the saved project for this localhost connection.",
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
        required: ["devServerUrl"],
        additionalProperties: false,
      },
      run: async (input, runtime) => {
        const result = await runOpenVisualEdit(input, runtime);
        const relayUrl = !isAuthenticated ? result.bridgeUrl : undefined;
        if (relayUrl) {
          const transport = {
            designId: result.designId,
            connectionId: result.connectionId,
            bridgeUrl: relayUrl,
          };
          persistLocalhostBridgeTransport(transport);
          installLocalhostBridgeFetchProxy(transport);
        }
        // Browser callers receive only the connection identity and app URL.
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

export function OpenVisualEditWebMcp() {
  const { session, isLoading: sessionLoading } = useSession();
  const location = useLocation();
  const isAuthenticated = Boolean(session?.email);
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

  useLayoutEffect(() => {
    if (sessionLoading || isAuthenticated) {
      if (isAuthenticated) clearLocalhostBridgeFetchProxy();
      return;
    }
    const persisted = readPersistedLocalhostBridgeTransport();
    if (
      persisted &&
      isCurrentVisualEditDesign(persisted.designId, location.pathname)
    ) {
      installLocalhostBridgeFetchProxy(persisted);
    } else {
      clearLocalhostBridgeFetchProxy();
    }
  }, [isAuthenticated, location.pathname, sessionLoading]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 1_000;
    let registration:
      | ReturnType<typeof createAgentNativeWebMcpRegistration>
      | undefined;
    if (sessionLoading) return;
    const actions = createOpenVisualEditWebMcpActions({ isAuthenticated });

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
  }, [
    isAuthenticated,
    location.pathname,
    requestApproval,
    resolveApproval,
    sessionLoading,
  ]);

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
