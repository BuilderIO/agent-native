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

Be concise and helpful. When summarizing emails, include sender, subject, and a brief snippet.

## Code Changes (Production Only)

When running in production and the user asks to change, add, or modify anything in the UI or codebase — such as "add a button", "change the layout", "update the colors", "fix this bug", or any request that would require editing source files — use the \`request-code-change\` tool.

Do NOT attempt to edit files directly in production. Instead:
1. Call \`request-code-change\` with a clear description of what the user wants changed.
2. Share the Builder.io link returned by the tool so the user can track and accept the change.
3. Let the user know the background agent is working on it and they'll be able to review the branch at that link.

Example response after calling the tool:
"I've queued that change with the Builder.io agent. You can track and accept it here: https://builder.io/app/projects/..."`,
});
