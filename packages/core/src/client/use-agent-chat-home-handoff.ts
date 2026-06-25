import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { appBasePath } from "./api-path.js";
import {
  consumeAgentChatHomeHandoff,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
} from "./chat-view-transition.js";

export interface UseAgentChatHomeHandoffOptions {
  /** Namespace shared by the full-page chat and AgentSidebar surfaces. */
  storageKey?: string | null;
  /** The current destination path that receives the sidebar handoff. */
  activePath: string;
  /** Disable consumption without changing hook call order. */
  enabled?: boolean;
}

export interface UseAgentChatHomeHandoffLinksOptions {
  /** Namespace shared by the full-page chat and AgentSidebar surfaces. */
  storageKey?: string | null;
  /** Router-local path for the full-page chat route. Defaults to "/". */
  chatPath?: string;
  /**
   * Matches every router-local pathname owned by the full-page chat surface.
   * Defaults to an exact match against `chatPath`. Pass this to cover deep
   * links such as `/chat/:threadId`.
   */
  isChatPath?: (pathname: string) => boolean;
  /** Disable link interception without changing hook call order. */
  enabled?: boolean;
}

function stripBasePath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  let result = path;
  for (let i = 0; i < 4; i += 1) {
    if (result === basePath) return "/";
    if (result.startsWith(`${basePath}/`)) {
      result = result.slice(basePath.length) || "/";
      continue;
    }
    if (
      result.startsWith(`${basePath}?`) ||
      result.startsWith(`${basePath}#`)
    ) {
      result = `/${result.slice(basePath.length)}`;
      continue;
    }
    break;
  }
  return result;
}

function pathnameFromLocalPath(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}

function isFrameworkOrApiPath(pathname: string): boolean {
  return (
    pathname === "/_agent-native" ||
    pathname.startsWith("/_agent-native/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

function isStaticAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,12}$/.test(lastSegment);
}

function localPathFromAnchor(anchor: HTMLAnchorElement): string | null {
  if (!anchor.href) return null;
  try {
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return null;
    return stripBasePath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

function shouldHandleAnchorClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  return true;
}

/**
 * Returns true for the route that has just received a full-page-chat handoff.
 * Pass the result to `AgentSidebar openOnChatRunning`.
 */
export function useAgentChatHomeHandoff({
  storageKey,
  activePath,
  enabled = true,
}: UseAgentChatHomeHandoffOptions): boolean {
  const [handoffPath, setHandoffPath] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHandoffPath(null);
      return;
    }
    if (consumeAgentChatHomeHandoff(storageKey)) {
      setHandoffPath(activePath);
    }
  }, [activePath, enabled, storageKey]);

  return enabled && handoffPath === activePath;
}

/**
 * Intercepts ordinary in-app links clicked from a full-page chat route so the
 * page chat can morph into the destination AgentSidebar and keep its thread.
 */
export function useAgentChatHomeHandoffLinks({
  storageKey,
  chatPath = "/",
  isChatPath,
  enabled = true,
}: UseAgentChatHomeHandoffLinksOptions): void {
  const location = useLocation();
  const navigate = useNavigate();
  const matchesChatPathRef = useRef<(pathname: string) => boolean>(() => false);
  matchesChatPathRef.current =
    isChatPath ?? ((pathname: string) => pathname === chatPath);

  useEffect(() => {
    const matchesChatPath = (pathname: string) =>
      matchesChatPathRef.current(pathname);
    if (!enabled || !matchesChatPath(stripBasePath(location.pathname))) return;
    if (typeof document === "undefined") return;

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!shouldHandleAnchorClick(event, anchor)) return;
      if (anchor.closest(".agent-panel-root")) return;

      const path = localPathFromAnchor(anchor);
      const pathname = path ? pathnameFromLocalPath(path) : "";
      if (
        !path ||
        matchesChatPath(pathname) ||
        isFrameworkOrApiPath(pathname) ||
        isStaticAssetPath(pathname)
      ) {
        return;
      }

      event.preventDefault();
      markAgentChatHomeHandoff(storageKey);
      navigateWithAgentChatViewTransition(navigate, path);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled, location.pathname, navigate, storageKey]);
}
