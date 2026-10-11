import { agentNativePath } from "@agent-native/core/client/api-path";
import { normalizeOrgMembers } from "@agent-native/core/client/sharing";
import { useQuery } from "@tanstack/react-query";

export interface MentionMember {
  email: string;
  name: string | null;
  role?: string | null;
}

export function useMentionMembers() {
  return useQuery<MentionMember[]>({
    queryKey: ["mention-members"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/org/members"));
      // A failed load must stay an error: an empty list reads as "nobody to
      // mention" and is cached as if it were true.
      if (!res.ok) throw new Error(`Could not load people (${res.status})`);
      const data = await res.json();
      return normalizeOrgMembers(data?.members).map((member) => ({
        email: member.email,
        name: member.name ?? null,
        role: member.role ?? null,
      }));
    },
    staleTime: 60_000,
  });
}
