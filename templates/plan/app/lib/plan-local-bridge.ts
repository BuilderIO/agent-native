import { appPath } from "@agent-native/core/client";
import { mimeTypeFromFilename } from "@shared/plan-assets";
import type { PlanBlock, PlanContent } from "@shared/plan-content";
import type { PlanBundle, PlanKind } from "@shared/types";

import type { PlanCommentInput } from "@/hooks/use-plans";
import type { PlanMdxFolder } from "@/lib/desktop-plan-files";

import { parsePlanMdxFolder } from "../../server/plan-mdx";

export type LocalPlanBundle = PlanBundle & {
  localOnly: true;
  slug: string;
  folder: string;
  repoPath?: string | null;
  suggestedRepoPath?: string;
  path?: string;
  url?: string;
  html?: string;
  mdx?: PlanMdxFolder;
};
export type PlanBundleWithHtml =
  | (PlanBundle & { html?: string })
  | LocalPlanBundle;
export type PlanCommentItem = PlanBundle["comments"][number];

type LocalPlanBridgePayload = {
  ok?: boolean;
  version?: number;
  source?: string;
  localOnly?: boolean;
  slug?: string;
  dir?: string;
  title?: string;
  brief?: string;
  kind?: PlanKind;
  updatedAt?: string;
  files?: string[];
  mdx?: PlanMdxFolder;
  comments?: PlanCommentItem[];
  error?: string;
};

type LocalPlanBridgeCommentUpdate = {
  comments?: PlanCommentInput[];
  deletedCommentIds?: string[];
};

export type LocalNetworkAccessPermissionState =
  | "checking"
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export class LocalPlanBridgePermissionError extends Error {
  readonly permissionState: "prompt" | "denied";

  constructor(permissionState: "prompt" | "denied") {
    super(
      permissionState === "denied"
        ? "Local network access is blocked for this site. Open your browser's site settings for Plan, allow local network access, then retry."
        : "Plan needs permission to connect to the local plan on this computer. Allow local network access in your browser, then retry.",
    );
    this.name = "LocalPlanBridgePermissionError";
    this.permissionState = permissionState;
  }
}

export async function localNetworkAccessPermissionState(): Promise<
  Exclude<LocalNetworkAccessPermissionState, "checking">
> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  try {
    // Chrome 145 split this permission into local-network and
    // loopback-network, but keeps the Chrome 142 alias working for queries.
    const status = await navigator.permissions.query({
      name: "local-network-access",
    } as unknown as PermissionDescriptor);
    if (
      status.state === "granted" ||
      status.state === "denied" ||
      status.state === "prompt"
    ) {
      return status.state;
    }
  } catch {
    // Browsers without Local Network Access expose Permissions but reject the
    // Chrome-specific permission name. Fall through to the legacy fetch path.
  }
  return "unsupported";
}

function assertLocalBridgeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Local plan bridge URL is invalid.");
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol !== "http:") {
    throw new Error("Local plan bridge must use HTTP on localhost.");
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("Local plan bridge must point to localhost.");
  }
  if (!url.port) {
    throw new Error("Local plan bridge must use an explicit localhost port.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Local plan bridge URL contains unsupported credentials.");
  }
  if (url.pathname !== "/local-plan.json") {
    throw new Error("Local plan bridge must point to /local-plan.json.");
  }
  const params = Array.from(url.searchParams.keys());
  if (
    params.length !== 1 ||
    params[0] !== "token" ||
    !url.searchParams.get("token")?.trim()
  ) {
    throw new Error("Local plan bridge URL is missing its access token.");
  }
  return url.toString();
}

function localPlanBridgeCommentsUrl(value: string): string {
  const url = new URL(assertLocalBridgeUrl(value));
  url.pathname = "/local-plan-comments.json";
  return url.toString();
}

const LOCAL_PLAN_BRIDGE_MAX_RETRIES = 5;

export function shouldRetryLocalPlanBridgeBundle(
  failureCount: number,
  error: unknown,
) {
  if (error instanceof LocalPlanBridgePermissionError) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("Local plan bridge URL") ||
    message.includes("Local plan bridge must") ||
    message.includes("Local plan bridge response was not")
  ) {
    return false;
  }
  return failureCount < LOCAL_PLAN_BRIDGE_MAX_RETRIES;
}

export function localPlanBridgeRetryDelay(attemptIndex: number) {
  return Math.min(500 * 2 ** attemptIndex, 2_500);
}

export function shouldShowLocalPlanLoadError(input: {
  localPlanMode: boolean;
  hasBundle: boolean;
  hasBridgeUrl: boolean;
  bridgeFetchEnabled: boolean;
  error: unknown;
  loading: boolean;
  fetching: boolean;
  permissionState: LocalNetworkAccessPermissionState;
}): boolean {
  if (!input.localPlanMode || input.hasBundle) return false;
  if (input.hasBridgeUrl && !input.bridgeFetchEnabled) return false;
  if (
    input.error instanceof LocalPlanBridgePermissionError &&
    (input.permissionState === "granted" ||
      input.permissionState === "unsupported")
  ) {
    return false;
  }
  return Boolean(input.error) || (!input.loading && !input.fetching);
}

/**
 * Decide whether the hosted-plan render should surface the retryable load
 * error card instead of the initial skeleton.
 *
 * A React Query read can be *paused* (browser offline, or the tab blurred
 * during a retry backoff): in that state it never errors and never resolves,
 * so `isError`/`isLoading`/`isFetching` are all false and `data` stays
 * undefined. Without treating that as an error-like state the page sits on the
 * initial skeleton forever until a manual refresh — exactly the "wasn't
 * loading the content until I do another refresh" report. Surfacing the
 * retry card lets the user recover; React Query also auto-resumes the paused
 * fetch when the network/tab returns, which clears the card on its own.
 */
export function shouldShowPlanLoadError(input: {
  hasSelectedId: boolean;
  localPlanMode: boolean;
  hasBundle: boolean;
  planQueryInitialPending: boolean;
  planQueryError: boolean;
  planQueryPaused: boolean;
  accessStatusInitialPending: boolean;
  accessStatusPaused: boolean;
  accessDenied: boolean;
}): boolean {
  if (!input.hasSelectedId || input.localPlanMode || input.hasBundle) {
    return false;
  }
  if (input.planQueryError) return true;
  if (!input.accessStatusInitialPending && input.accessDenied) return true;
  // While the first read is actively in flight, keep showing the skeleton.
  // Background refetches must not hide a settled access/error card.
  if (input.planQueryInitialPending || input.accessStatusInitialPending) {
    return false;
  }
  // Paused/stalled read that will never settle on its own input.
  if (input.planQueryPaused || input.accessStatusPaused) return true;
  return false;
}

export function localPlanRoutePath(
  slug: string,
  repoPath?: string | null,
): string {
  const base = appPath(`/local-plans/${encodeURIComponent(slug)}`);
  if (!repoPath) return base;
  const params = new URLSearchParams({ path: repoPath });
  return `${base}?${params.toString()}`;
}

export function localPlanRouteUrl(
  slug: string,
  repoPath?: string | null,
): string {
  const path = localPlanRoutePath(slug, repoPath);
  return typeof window === "undefined"
    ? path
    : `${window.location.origin}${path}`;
}

function localPlanAssetDataUrl(
  url: string | undefined,
  assets: Record<string, string> | undefined,
): string | undefined {
  if (!url || !assets) return url;
  const match = url.match(/^(?:\.\/)?assets\/(.+)$/);
  const filename = match?.[1];
  if (!filename) return url;
  const base64 = assets[filename];
  if (!base64) return url;
  const mime = mimeTypeFromFilename(filename);
  if (!mime) return url;
  return `data:${mime};base64,${base64}`;
}

function inlineLocalPlanAssets(
  content: PlanContent,
  assets: Record<string, string> | undefined,
): PlanContent {
  if (!assets || Object.keys(assets).length === 0) return content;
  const rewriteBlocks = (blocks: PlanBlock[]): PlanBlock[] =>
    blocks.map((block): PlanBlock => {
      if (block.type === "image") {
        return {
          ...block,
          data: {
            ...block.data,
            url: localPlanAssetDataUrl(block.data.url, assets),
            assetId: undefined,
          },
        };
      }
      if (block.type === "tabs") {
        return {
          ...block,
          data: {
            ...block.data,
            tabs: block.data.tabs.map((tab) => ({
              ...tab,
              blocks: rewriteBlocks(tab.blocks),
            })),
          },
        };
      }
      if (block.type === "columns") {
        return {
          ...block,
          data: {
            ...block.data,
            columns: block.data.columns.map((column) => ({
              ...column,
              blocks: rewriteBlocks(column.blocks),
            })),
          },
        };
      }
      return block;
    });
  return { ...content, blocks: rewriteBlocks(content.blocks) };
}

function countLocalPlanBlocks(blocks: PlanBlock[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const visitBlocks = (items: PlanBlock[]) => {
    for (const block of items) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) visitBlocks(tab.blocks);
      } else if (block.type === "columns") {
        for (const column of block.data.columns) visitBlocks(column.blocks);
      }
    }
  };
  visitBlocks(blocks);
  return counts;
}

export function localPlanBridgeQueryKey(slug: string, bridgeUrl: string) {
  return ["local-plan-bridge", slug, bridgeUrl] as const;
}

// Merge folder comments.json onto a read-only bridge bundle (which serves none);
// the bundle's own comments win so optimistic/just-written ones aren't clobbered.
export function mergeLocalBridgeComments(
  bundle: LocalPlanBundle | undefined,
  folderComments: LocalPlanBundle["comments"] | undefined,
): LocalPlanBundle | undefined {
  if (!bundle) return bundle;
  const comments =
    bundle.comments.length > 0 ? bundle.comments : (folderComments ?? []);
  if (comments === bundle.comments) return bundle;
  return {
    ...bundle,
    comments,
    summary: {
      ...bundle.summary,
      commentCount: comments.length,
      openCommentCount: comments.filter((c) => c.status === "open").length,
    },
  };
}

async function localPlanBridgePayloadToBundle(
  payload: LocalPlanBridgePayload,
  fallbackSlug: string,
): Promise<LocalPlanBundle> {
  if (
    payload.source !== "agent-native-local-bridge" ||
    !payload.mdx?.["plan.mdx"]
  ) {
    throw new Error("Local plan bridge response was not a Plan MDX folder.");
  }

  const rawContent = await parsePlanMdxFolder(payload.mdx, {
    // The bridge is a read-only preview surface. Keep valid blocks visible when
    // locally authored MDX contains a malformed block; verify/import remain
    // strict and still reject the same source.
    salvageInvalidBlocks: true,
  });
  const content = inlineLocalPlanAssets(rawContent, payload.mdx["assets/"]);
  const now = payload.updatedAt || new Date().toISOString();
  const slug = payload.slug || fallbackSlug || "local-plan";
  const kind = payload.kind === "recap" ? "recap" : "plan";
  const title = content.title || payload.title || slug;
  const brief = content.brief || payload.brief || "";
  const url = localPlanRouteUrl(slug);
  const comments = (payload.comments ?? []).filter(
    (comment) => !comment.deletedAt,
  );
  const bundle: LocalPlanBundle = {
    plan: {
      id: `local-${slug}`,
      title,
      brief,
      kind,
      status: "review",
      source: "imported",
      repoPath: payload.dir ?? null,
      currentFocus: "local-files preview",
      html: null,
      markdown: payload.mdx["plan.mdx"],
      content,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
    },
    access: {
      role: "viewer",
      ownerEmail: null,
      orgId: null,
      visibility: "private",
    },
    sections: [],
    comments,
    events: [],
    summary: {
      sectionCounts: countLocalPlanBlocks(content.blocks),
      commentCount: comments.length,
      openCommentCount: comments.filter((comment) => comment.status === "open")
        .length,
    },
    localOnly: true,
    slug,
    folder: payload.dir ?? slug,
    path: `/local-plans/${encodeURIComponent(slug)}`,
    url,
    mdx: payload.mdx,
  };
  return bundle;
}

export async function fetchLocalPlanBridgeBundle(
  bridgeUrl: string,
  fallbackSlug: string,
): Promise<LocalPlanBundle> {
  const safeUrl = assertLocalBridgeUrl(bridgeUrl);
  let response: Response;
  try {
    response = await fetch(safeUrl, { cache: "no-store" });
  } catch (error) {
    const permissionState = await localNetworkAccessPermissionState();
    if (permissionState === "prompt" || permissionState === "denied") {
      throw new LocalPlanBridgePermissionError(permissionState);
    }
    throw error;
  }
  const payload = (await response
    .json()
    .catch(() => null)) as LocalPlanBridgePayload | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload?.error ||
        `Local plan bridge returned ${response.status || "an error"}.`,
    );
  }
  return localPlanBridgePayloadToBundle(payload, fallbackSlug);
}

export async function updateLocalPlanBridgeComments(
  bridgeUrl: string,
  fallbackSlug: string,
  update: LocalPlanBridgeCommentUpdate,
): Promise<LocalPlanBundle> {
  const response = await fetch(localPlanBridgeCommentsUrl(bridgeUrl), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  const payload = (await response
    .json()
    .catch(() => null)) as LocalPlanBridgePayload | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload?.error ||
        `Local plan bridge returned ${response.status || "an error"}.`,
    );
  }
  return localPlanBridgePayloadToBundle(payload, fallbackSlug);
}
