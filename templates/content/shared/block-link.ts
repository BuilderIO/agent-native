export const BLOCK_LINK_PARAM = "block";
export const BLOCK_LINK_FULL_SCREEN_PARAM = "full";

export function contentBlockLinkPath(
  documentId: string,
  blockId: string | null,
  options?: { fullScreen?: boolean },
): string {
  const params = new URLSearchParams();
  if (blockId) params.set(BLOCK_LINK_PARAM, blockId);
  if (options?.fullScreen) params.set(BLOCK_LINK_FULL_SCREEN_PARAM, "1");
  const search = params.toString();
  return `/page/${encodeURIComponent(documentId)}${search ? `?${search}` : ""}`;
}

export interface FullScreenBlockLink {
  pagePath: string;
  blockId: string | null;
}

export function readFullScreenBlockLink(
  href: unknown,
): FullScreenBlockLink | null {
  if (typeof href !== "string") return null;
  const address = href.replace(/&amp;/g, "&");
  if (!URL.canParse(address)) return null;
  const { pathname, search } = new URL(address);
  const [pagePath] = /\/page\/[^/]+$/.exec(pathname) ?? [];
  const { blockId, fullScreen } = readBlockLink(search);
  return pagePath && fullScreen ? { pagePath, blockId } : null;
}

export function readBlockLink(search: string): {
  blockId: string | null;
  fullScreen: boolean;
} {
  const params = new URLSearchParams(search);
  return {
    blockId: params.get(BLOCK_LINK_PARAM),
    fullScreen: params.has(BLOCK_LINK_FULL_SCREEN_PARAM),
  };
}

export function withoutBlockLink(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(BLOCK_LINK_PARAM);
  params.delete(BLOCK_LINK_FULL_SCREEN_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
