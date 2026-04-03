/**
 * Core script: open-chat
 *
 * Open a chat thread in the UI as a new tab and focus it.
 * Writes a one-shot command to application-state that the UI picks up.
 *
 * Usage:
 *   pnpm action open-chat --id <thread-id>
 */

import { parseArgs, fail } from "../utils.js";
import { getThread } from "../../chat-threads/store.js";
import { writeAppState } from "../../application-state/script-helpers.js";

export default async function openChat(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action open-chat --id <thread-id>

Opens a chat thread in the UI as a new tab and focuses it.
Use search-chats to find the thread ID first.

Options:
  --id <thread-id>   The chat thread ID to open (required)
  --help             Show this help message

Examples:
  pnpm action open-chat --id thread-1712100000000-abc123`);
    return;
  }

  const threadId = parsed.id;
  if (!threadId) {
    fail(
      '--id is required. Use "pnpm action search-chats" to find thread IDs.',
    );
  }

  // Verify the thread exists
  const thread = await getThread(threadId);
  if (!thread) {
    fail(`Chat thread "${threadId}" not found.`);
  }

  // Write the open-chat command to application-state
  await writeAppState("chat-command", {
    command: "open-thread",
    threadId,
    timestamp: Date.now(),
  });

  const title = thread.title || thread.preview || "(untitled)";
  console.log(`Opening chat: ${title}`);
  console.log(`Thread ID: ${threadId}`);
}
