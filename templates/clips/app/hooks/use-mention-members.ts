import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery } from "@tanstack/react-query";

export interface MentionMember {
  email: string;
  name: string | null;
}

export function useMentionMembers(enabled = true) {
  return useQuery<MentionMember[]>({
    queryKey: ["clips-comment-mention-members"],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(
        agentNativePath("/_agent-native/org/members"),
      );
      if (!response.ok) return [];
      const data = await response.json();
      const members = Array.isArray(data?.members) ? data.members : [];
      return members
        .map((member: any) => ({
          email: typeof member?.email === "string" ? member.email : "",
          name: typeof member?.name === "string" ? member.name : null,
        }))
        .filter((member: MentionMember) => member.email);
    },
  });
}
