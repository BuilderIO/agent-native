import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useMemo } from "react";
import { getIdToken } from "@/lib/auth";

export type Workspace = "primary" | "secondary";

async function apiFetch<T>(path: string): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, {
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// -- Types --

export interface SlackChannel {
  id: string;
  name: string;
  topic: { value: string };
  purpose: { value: string };
  num_members: number;
  is_archived: boolean;
}

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: { name: string; count: number }[];
  files?: { name: string; mimetype: string; url_private: string }[];
  icons?: { image_48?: string; image_72?: string };
  channel_name?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    image_48: string;
    image_72: string;
  };
}

export interface SlackTeamInfo {
  id: string;
  name: string;
  domain: string;
  icon?: { image_68?: string };
}

// -- Hooks --

export function useSlackTeam(workspace: Workspace) {
  return useQuery<SlackTeamInfo>({
    queryKey: ["slack-team", workspace],
    queryFn: async () => {
      const data = await apiFetch<{ team: SlackTeamInfo }>(
        `/api/slack/team?workspace=${workspace}`
      );
      return data.team;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useSlackChannels(workspace: Workspace) {
  return useQuery<SlackChannel[]>({
    queryKey: ["slack-channels", workspace],
    queryFn: async () => {
      const data = await apiFetch<{ channels: SlackChannel[] }>(
        `/api/slack/channels?workspace=${workspace}`
      );
      return data.channels;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// -- Paginated multi-channel history --

interface MultiHistoryPage {
  messages: SlackMessage[];
  users: Record<string, SlackUser>;
  has_more: boolean;
  next_cursors: Record<string, string>;
}

const PAGE_SIZE = 20;

export function useSlackPaginatedHistory(
  workspace: Workspace,
  channelIds: string[],
  channelNames: string[]
) {
  // Stack of cursor states for prev/next navigation
  // Each entry is the cursors object used to fetch that page
  const [cursorStack, setCursorStack] = useState<
    Record<string, string>[]
  >([{}]); // start with empty cursors (first page)
  const [currentPageIdx, setCurrentPageIdx] = useState(0);

  const currentCursors = cursorStack[currentPageIdx] || {};
  const sortedIds = [...channelIds].sort().join(",");
  const sortedNames = [...channelNames].sort().join(",");

  const query = useQuery<MultiHistoryPage>({
    queryKey: [
      "slack-multi-history",
      workspace,
      sortedIds,
      PAGE_SIZE,
      JSON.stringify(currentCursors),
    ],
    queryFn: async () => {
      if (channelIds.length === 0) {
        return { messages: [], users: {}, has_more: false, next_cursors: {} };
      }
      const params = new URLSearchParams({
        workspace,
        channels: channelIds.join(","),
        names: channelNames.join(","),
        pageSize: String(PAGE_SIZE),
      });
      if (Object.keys(currentCursors).length > 0) {
        params.set("cursors", JSON.stringify(currentCursors));
      }
      return apiFetch<MultiHistoryPage>(
        `/api/slack/multi-history?${params.toString()}`
      );
    },
    enabled: channelIds.length > 0,
    staleTime: 60 * 1000,
  });

  const goNextPage = useCallback(() => {
    if (!query.data?.has_more || !query.data?.next_cursors) return;
    const nextCursors = query.data.next_cursors;
    const nextIdx = currentPageIdx + 1;
    setCursorStack((prev) => {
      const stack = prev.slice(0, nextIdx);
      stack.push(nextCursors);
      return stack;
    });
    setCurrentPageIdx(nextIdx);
  }, [query.data, currentPageIdx]);

  const goPrevPage = useCallback(() => {
    if (currentPageIdx <= 0) return;
    setCurrentPageIdx((prev) => prev - 1);
  }, [currentPageIdx]);

  const resetPagination = useCallback(() => {
    setCursorStack([{}]);
    setCurrentPageIdx(0);
  }, []);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    page: currentPageIdx,
    hasNextPage: !!query.data?.has_more,
    hasPrevPage: currentPageIdx > 0,
    goNextPage,
    goPrevPage,
    resetPagination,
  };
}

// -- Search --

export interface SearchResponse {
  messages: SlackMessage[];
  users: Record<string, SlackUser>;
  total: number;
}

export function useSlackSearch(workspace: Workspace, query: string) {
  return useQuery<SearchResponse>({
    queryKey: ["slack-search", workspace, query],
    queryFn: () =>
      apiFetch<SearchResponse>(
        `/api/slack/search?workspace=${workspace}&query=${encodeURIComponent(query)}`
      ),
    enabled: query.length >= 2,
    staleTime: 60 * 1000,
  });
}
