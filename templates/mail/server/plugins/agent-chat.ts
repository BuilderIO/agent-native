import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  scripts: async () => {
    const { scriptRegistry } = await import("../../scripts/registry.js");
    return scriptRegistry;
  },
  mentionProviders: {
    emails: {
      label: "Emails",
      icon: "email",
      search: async (query: string) => {
        try {
          const { readAppState } =
            await import("@agent-native/core/application-state");
          const emailList = await readAppState("email-list");
          if (!emailList?.emails) return [];
          const emails = emailList.emails as Array<{
            id: string;
            threadId: string;
            from: string;
            subject: string;
            snippet: string;
            date: string;
          }>;
          const q = query.toLowerCase();
          const filtered = q
            ? emails.filter(
                (e) =>
                  e.subject?.toLowerCase().includes(q) ||
                  e.from?.toLowerCase().includes(q) ||
                  e.snippet?.toLowerCase().includes(q),
              )
            : emails;
          return filtered.slice(0, 15).map((e) => ({
            id: e.id,
            label: e.subject || "(no subject)",
            description: `${e.from} · ${e.date ? new Date(e.date).toLocaleDateString() : ""}`,
            icon: "email" as const,
            refType: "email",
            refId: e.id,
          }));
        } catch {
          return [];
        }
      },
    },
  },
  systemPrompt: `You are an AI email assistant. You can read, search, organize, compose, and manage the user's emails.

Available operations:
- List and search emails
- Read email content and threads
- Archive, trash, star, and mark emails as read/unread
- Compose and send emails
- Navigate the UI to specific views or threads

Always use view-screen first to understand what the user is looking at before taking action.
After any change (archive, trash, star, mark-read, send), run refresh-list to update the UI.

Be concise and helpful. When summarizing emails, include sender, subject, and a brief snippet.`,
});
