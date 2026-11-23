import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { orgMembers } from "@agent-native/core/org";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireOwnedProject } from "../server/lib/project-action-access.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineAction({
  description:
    "Transfer a project the signed-in account owns to another workspace member.",
  schema: z
    .object({
      projectId: z.string().min(1),
      ownerEmail: z.string().trim().toLowerCase().regex(EMAIL).max(320),
    })
    .strict(),
  outputSchema: z.object({ id: z.string().min(1) }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId, ownerEmail }) => {
    const { scope, project } = await requireOwnedProject(projectId);
    if (ownerEmail === scope.ownerEmail) {
      fail("That account already owns this project.", {
        statusCode: 400,
        errorCode: "owner_unchanged",
      });
    }
    const member = await getDb()
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, scope.orgId),
          eq(orgMembers.email, ownerEmail),
        ),
      )
      .limit(1);
    if (member.length === 0) {
      fail("That account is not a member of this workspace.", {
        statusCode: 400,
        errorCode: "owner_not_member",
      });
    }
    await getDb()
      .update(schema.projects)
      .set({ ownerEmail, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.projects.id, project.id),
          eq(schema.projects.ownerEmail, scope.ownerEmail),
          eq(schema.projects.orgId, scope.orgId),
        ),
      );
    return { id: project.id };
  },
});
