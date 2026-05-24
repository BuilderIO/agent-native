import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { isExistingDirectory } from "../server/lib/code-workspace.js";

/**
 * Register a local filesystem workspace for the Code Room.
 *
 * Validates the path exists AND is a directory before insert. Tilde
 * (`~`) is expanded to the OS home directory for the convenience of CLI
 * users — every other path is resolved as-is (relative paths get
 * resolved against the server's cwd, which is the only sane interpretation
 * for a local dev workflow).
 *
 * Per-user only: identical `(ownerEmail, path)` rows are idempotent —
 * we return the existing row instead of creating a duplicate.
 */
export default defineAction({
  description:
    "Register a local filesystem directory as a Workbench Code Room " +
    "workspace. Validates the path exists + is a directory. Idempotent — " +
    "returns the existing row if the same path is already registered.",
  schema: z.object({
    label: z.string().min(1).max(120),
    path: z.string().min(1),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to add a code workspace.");
    }
    const orgId = getRequestOrgId() ?? null;

    const expanded = expandTilde(args.path);
    const absolutePath = path.resolve(expanded);

    const exists = await isExistingDirectory(absolutePath);
    if (!exists) {
      throw new Error(
        `Path doesn't exist or isn't a directory: ${absolutePath}`,
      );
    }

    const db = getDb();

    // Idempotent: same (ownerEmail, path) -> return existing row.
    const existing = await db
      .select({
        id: schema.workbenchCodeWorkspaces.id,
        label: schema.workbenchCodeWorkspaces.label,
        path: schema.workbenchCodeWorkspaces.path,
        isDefault: schema.workbenchCodeWorkspaces.isDefault,
        addedAt: schema.workbenchCodeWorkspaces.addedAt,
      })
      .from(schema.workbenchCodeWorkspaces)
      .where(
        and(
          eq(schema.workbenchCodeWorkspaces.ownerEmail, ownerEmail),
          eq(schema.workbenchCodeWorkspaces.path, absolutePath),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        ok: true,
        workspace: {
          ...existing[0],
          isDefault: Boolean(existing[0].isDefault),
        },
        alreadyAdded: true,
      };
    }

    const row = {
      id: nanoid(),
      label: args.label.trim(),
      path: absolutePath,
      isDefault: 0,
      addedAt: new Date().toISOString(),
      ownerEmail,
      orgId: orgId ?? undefined,
      visibility: "private" as const,
    };

    await db.insert(schema.workbenchCodeWorkspaces).values(row);

    return {
      ok: true,
      workspace: {
        id: row.id,
        label: row.label,
        path: row.path,
        isDefault: false,
        addedAt: row.addedAt,
      },
      alreadyAdded: false,
    };
  },
});

function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}
