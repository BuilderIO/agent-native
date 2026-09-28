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
  challenge: string;
  signature: string;
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
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:7331";
const BOOTSTRAP_CACHE_TTL_MS = 4 * 60 * 1000;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

export function normalizeBrowserBridgeUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The local visual-edit bridge URL must use http(s).");
  }
  if (
    parsed.username ||
    parsed.password ||
    !isLoopbackHostname(parsed.hostname) ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "The local visual-edit bridge URL must be an http(s) localhost or loopback origin without a path or credentials.",
    );
  }
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

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
  challenge: string,
  signal?: AbortSignal,
): Promise<VisualEditBridgeAttestation | undefined> {
  const bridgeToken = input.bridgeToken?.trim();
  if (!bridgeToken) return undefined;

  let bridgeUrl: string;
  try {
    bridgeUrl = normalizeBrowserBridgeUrl(
      input.bridgeUrl ?? DEFAULT_BRIDGE_URL,
    );
  } catch {
    throw new Error(
      `The local visual-edit bridge URL "${input.bridgeUrl ?? DEFAULT_BRIDGE_URL}" is invalid. Use the loopback URL printed by \`agent-native design connect\` and retry.`,
    );
  }
  let manifestUrl: URL;
  try {
    manifestUrl = new URL("/manifest.json", bridgeUrl);
    manifestUrl.searchParams.set(
      "previewToken",
      await derivePreviewToken(bridgeToken),
    );
    manifestUrl.searchParams.set("attestationChallenge", challenge);
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
    const attestation = (manifest as { attestation?: unknown }).attestation;
    const attestationFields =
      attestation &&
      typeof attestation === "object" &&
      !Array.isArray(attestation)
        ? (attestation as { challenge?: unknown; signature?: unknown })
        : undefined;
    if (
      !attestationFields ||
      typeof attestationFields.challenge !== "string" ||
      typeof attestationFields.signature !== "string"
    ) {
      throw new Error(
        "The local visual-edit bridge returned no valid bootstrap attestation. Restart `agent-native design connect` and retry.",
      );
    }
    return {
      challenge: attestationFields.challenge,
      signature: attestationFields.signature,
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

export function createOpenVisualEditWebMcpActions(options?: {
  isAuthenticated?: boolean;
}) {
  const isAuthenticated = options?.isAuthenticated ?? false;
  type BootstrapCapability = { token: string; challenge: string };
  let sessionBridgeToken: string | undefined;
  let sessionBridgeUrl: string | undefined;
  const onBridgeTokenRejected = () => {
    sessionBridgeToken = undefined;
    sessionBridgeUrl = undefined;
  };
  if (isAuthenticated) {
    clearLocalhostBridgeFetchProxy();
  } else {
    const persisted = readPersistedLocalhostBridgeTransport();
    if (persisted && isCurrentVisualEditDesign(persisted.designId)) {
      sessionBridgeToken = persisted.bridgeToken;
      sessionBridgeUrl = persisted.bridgeUrl;
      installLocalhostBridgeFetchProxy(persisted, { onBridgeTokenRejected });
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
      challenge?: string;
    }>("issue-visual-edit-bootstrap", {}, { signal }).then((result) => {
      if (!result?.token || !result.challenge) {
        throw new Error("Visual-edit bootstrap did not return a capability.");
      }
      return { token: result.token, challenge: result.challenge };
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
    if (isAuthenticated) {
      return (await callAction("open-visual-edit", input, {
        signal: runtime.signal,
      })) as OpenVisualEditActionResult;
    }
    const effectiveInput =
      !input.bridgeToken?.trim() && sessionBridgeToken
        ? {
            ...input,
            bridgeToken: sessionBridgeToken,
            bridgeUrl: input.bridgeUrl ?? sessionBridgeUrl,
          }
        : input;
    const nextBridgeToken = effectiveInput.bridgeToken?.trim();
    if (nextBridgeToken) {
      if (nextBridgeToken !== sessionBridgeToken) {
        sessionBridgeUrl = effectiveInput.bridgeUrl;
      } else if (effectiveInput.bridgeUrl) {
        sessionBridgeUrl = effectiveInput.bridgeUrl;
      }
      sessionBridgeToken = nextBridgeToken;
    }
    const bootstrap = await getBootstrapCapability(runtime.signal);
    const bridgeAttestation = await readVisualEditBridgeAttestation(
      effectiveInput,
      bootstrap.challenge,
      runtime.signal,
    );
    const actionInput = bridgeAttestation
      ? { ...effectiveInput, bridgeAttestation }
      : effectiveInput;
    let result: OpenVisualEditActionResult;
    try {
      result = (await callAction("open-visual-edit", actionInput, {
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
        const result = await runOpenVisualEdit(input, runtime);
        const relayToken = !isAuthenticated ? sessionBridgeToken : undefined;
        const relayUrl = !isAuthenticated
          ? (result.bridgeUrl ?? sessionBridgeUrl)
          : undefined;
        if (relayToken && relayUrl) {
          const transport = {
            designId: result.designId,
            connectionId: result.connectionId,
            bridgeUrl: relayUrl,
            bridgeToken: relayToken,
          };
          persistLocalhostBridgeTransport(transport);
          installLocalhostBridgeFetchProxy(transport, {
            onBridgeTokenRejected,
          });
        }
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
