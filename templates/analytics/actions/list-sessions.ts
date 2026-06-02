import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { desc, eq, or, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List recent Knowledge Q&A sessions for the current user.",
  schema: z.object({ limit: z.number().optional() }),
  http: { method: "GET" },
  run: async ({ limit = 50 }) => {
    const db = getDb();
    const userEmail = getRequestUserEmail() ?? null;

    const rows = await db
      .select({
        id: schema.askSessions.id,
        question: schema.askSessions.question,
        answer: schema.askSessions.answer,
        sourcesJson: schema.askSessions.sourcesJson,
        status: schema.askSessions.status,
        createdAt: schema.askSessions.createdAt,
        updatedAt: schema.askSessions.updatedAt,
        userEmail: schema.askSessions.userEmail,
      })
      .from(schema.askSessions)
      .where(
        userEmail
          ? or(
              eq(schema.askSessions.userEmail, userEmail),
              isNull(schema.askSessions.userEmail),
            )
          : undefined,
      )
      .orderBy(desc(schema.askSessions.createdAt))
      .limit(limit);

    // Deduplicate: for each unique question, keep only the most recent
    // answered session. Show pending/error sessions only if no answered
    // version exists for that question.
    const byQuestion = new Map<
      string,
      (typeof rows)[number] & { isDuplicate?: boolean }
    >();
    for (const row of rows) {
      const key = row.question.trim().toLowerCase();
      const existing = byQuestion.get(key);
      if (!existing) {
        byQuestion.set(key, row);
      } else {
        // Prefer answered over non-answered; otherwise keep more recent
        const existingDone = existing.status === "done";
        const rowDone = row.status === "done";
        if (!existingDone && rowDone) {
          byQuestion.set(key, row);
        }
        // existing already wins (it's more recent or already answered)
      }
    }

    const sessions = [...byQuestion.values()].map((row) => ({
      id: row.id,
      question: row.question,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
      // Short answer preview for the list (strip markdown, 100 chars)
      preview: row.answer
        ? row.answer
            .replace(/#+\s/g, "")
            .replace(/\*\*/g, "")
            .replace(/\*/g, "")
            .replace(/`/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/\n+/g, " ")
            .trim()
            .slice(0, 100)
        : null,
      sourceCount: (() => {
        try {
          return JSON.parse(row.sourcesJson ?? "[]").length;
        } catch {
          return 0;
        }
      })(),
    }));

    // Re-sort: answered first, then by most recent
    sessions.sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return -1;
      if (a.status !== "done" && b.status === "done") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return { sessions };
  },
});
