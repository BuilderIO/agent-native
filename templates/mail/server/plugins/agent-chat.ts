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
          const params = new URLSearchParams({ view: "inbox" });
          if (query) params.set("q", query);
          const port = process.env.PORT || "8080";
          const res = await fetch(
            `http://localhost:${port}/api/emails?${params.toString()}`,
          );
          if (!res.ok) return [];
          const emails = (await res.json()) as Array<{
            id: string;
            from: { name?: string; email: string };
            subject: string;
            date: string;
          }>;
          return emails.slice(0, 15).map((e) => ({
            id: e.id,
            label: e.subject || "(no subject)",
            description: `${e.from?.name || e.from?.email || ""} · ${e.date ? new Date(e.date).toLocaleDateString() : ""}`,
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

## Composing vs Replying

When the user asks to draft/email a specific person (e.g., "email my wife", "draft an email to Alice"):
- This is a NEW email — use manage-draft with --action=create and mode "compose", NOT "reply"
- Look up the recipient's email from AGENTS.md contacts or ask the user
- Do NOT reply to whatever thread is currently on screen

Only use mode "reply" when the user explicitly asks to reply to a specific email they're viewing (e.g., "reply to this", "respond to Alice's email").

## Code Changes (Production Only)

When running in production and the user asks to change, add, or modify anything in the UI or codebase — such as "add a button", "change the layout", "update the colors", "fix this bug", or any request that would require editing source files — use the \`request-code-change\` tool.

Do NOT attempt to edit files directly in production. Instead:
1. Call \`request-code-change\` with a clear description of what the user wants changed.
2. Share the Builder.io link returned by the tool so the user can track and accept the change.
3. Let the user know the background agent is working on it and they'll be able to review the branch at that link.

Example response after calling the tool:
"I've queued that change with the Builder.io agent. You can track and accept it here: https://builder.io/app/projects/..."`,
});
