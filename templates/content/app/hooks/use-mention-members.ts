import { agentNativePath } from "@agent-native/core/client";
import { useQuery } from "@tanstack/react-query";

export interface MentionMember {
  email: string;
  name: string | null;
}

/**
 * Organization members available to @mention in a comment. Backed by the
 * framework's `/_agent-native/org/members` endpoint (the same source the share
 * dialog uses). Cached for a minute — the member list changes rarely.
 */
export function useMentionMembers() {
  return useQuery<MentionMember[]>({
    queryKey: ["mention-members"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/org/members"));
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data?.members) ? data.members : [];
      return list
        .map((m: any) => ({
          email: typeof m?.email === "string" ? m.email : "",
          name: typeof m?.name === "string" ? m.name : null,
        }))
        .filter((m: MentionMember) => m.email);
    },
    staleTime: 60_000,
  });
}
