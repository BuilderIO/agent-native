import { fail } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { createDesignSystemAuthoringService } from "@agent-native/core/server/design-system-authoring";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  assertDesignSystemAccess,
  resolveDesignSystemAccess,
} from "./design-system-dsi-access.js";

export const designSystemAuthoring = createDesignSystemAuthoringService({
  ownerApp: "design",
  runtime: "builder",
  async readSourceEvidence(id, sourceId) {
    const action = await import("../../actions/read-design-system-source.js");
    return action.default.run({ id, sourceId });
  },
  async read(id, write) {
    const access = write
      ? await assertDesignSystemAccess(id, "editor")
      : await resolveDesignSystemAccess(id);
    if (!access)
      return fail("Design system not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    return {
      row: {
        id: access.resource.id,
        title: access.resource.title,
        data: access.resource.data,
      },
      canEdit: ["owner", "admin", "editor"].includes(access.role),
    };
  },
  async insert(row) {
    await assertBuilderDsiAccess();
    await getDb()
      .insert(schema.designSystems)
      .values(row)
      .onConflictDoNothing({ target: schema.designSystems.id });
  },
  async compareAndSwap(row, data, updatedAt) {
    await assertBuilderDsiAccess();
    const written = await getDb()
      .update(schema.designSystems)
      .set({ data, updatedAt })
      .where(
        and(
          eq(schema.designSystems.id, row.id),
          eq(schema.designSystems.data, row.data),
          accessFilter(schema.designSystems, schema.designSystemShares),
        ),
      )
      .returning({ id: schema.designSystems.id });
    return written.length === 1;
  },
});
