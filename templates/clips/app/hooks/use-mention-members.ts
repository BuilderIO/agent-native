import { useActionQuery } from "@agent-native/core/client/hooks";

export interface MentionMember {
  email: string;
  name: string | null;
}

type MentionMembersResponse = { members: MentionMember[] };

export function useMentionMembers(
  recordingId?: string,
  enabled = true,
): { data: MentionMember[] } {
  const query = useActionQuery<MentionMembersResponse>(
    "list-recording-mention-members",
    recordingId ? { recordingId } : undefined,
    {
      enabled: enabled && Boolean(recordingId),
      retry: false,
      staleTime: 60_000,
    },
  );
  return { data: query.data?.members ?? [] };
}
