import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { writeDataEndorsed } from "../server/model/data-endorsed.js";
import {
  createProject,
  listProjects,
  updateProject,
} from "../server/model/projects-store.js";
import {
  QA_KEYSCREEN_EMAIL,
  QA_KEYSCREEN_ENDORSED,
  planKeyscreenInventory,
} from "../shared/qa-keyscreen-fixture.js";

export default defineAction({
  description:
    "QA only: make the QA account's Home projects and endorsed Data catalog match the original workspace's key-screen fixture. Archives other active projects. Refuses any other signed-in user.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    created: z.array(z.string()),
    archived: z.number().int().nonnegative(),
    endorsed: z.number().int().nonnegative(),
  }),
  agentTool: false,
  mcpTool: false,
  uiOnly: true,
  http: { method: "POST" },
  audit: { recordInputs: false },
  persistInBrowser: false,
  run: async () => {
    if (getRequestUserEmail()?.trim().toLowerCase() !== QA_KEYSCREEN_EMAIL)
      fail("This seed action is only available to the QA test identity.", {
        errorCode: "qa_only",
        statusCode: 403,
      });
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    const plan = planKeyscreenInventory(await listProjects(scope));
    for (const title of [...plan.create].reverse())
      await createProject({ ...scope, title });
    for (const projectId of plan.archive)
      await updateProject({ ...scope, projectId, archived: true });
    await writeDataEndorsed(QA_KEYSCREEN_ENDORSED);
    return {
      created: plan.create,
      archived: plan.archive.length,
      endorsed: QA_KEYSCREEN_ENDORSED.length,
    };
  },
});
