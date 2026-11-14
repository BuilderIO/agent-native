import { nextFreeName } from "@agent-native/core/free-name";
import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { withDesignSourceMutationTransaction } from "../source-workspace.js";

/**
 * Gives each file that shares its filename with an older file in the same
 * design the next free name, so the unique filename index can be created.
 * Rows like these came from inserts that raced before the index existed, and
 * a lookup by filename could only ever reach one of them. The oldest keeps
 * the name; nothing is deleted. Each design is repaired under its own lock,
 * so a create picking a free name at the same time can't pick the same one.
 * A call repairs at most `maxDesigns` designs, each committed on its own, so
 * a boot does bounded work and the next one picks up where it stopped.
 * Returns how many files were renamed and whether designs with shared names
 * remain.
 */
export async function renameLaterDuplicateDesignFilenames(
  maxDesigns = 50,
): Promise<{ renamed: number; remaining: boolean }> {
  const duplicated = await getDb()
    .selectDistinct({ designId: schema.designFiles.designId })
    .from(schema.designFiles)
    .groupBy(schema.designFiles.designId, schema.designFiles.filename)
    .having(sql`count(*) > 1`)
    .orderBy(asc(schema.designFiles.designId))
    .limit(maxDesigns + 1);

  let renamed = 0;
  for (const { designId } of duplicated.slice(0, maxDesigns)) {
    renamed += await withDesignSourceMutationTransaction(
      designId,
      async (tx) => {
        const files = await tx
          .select({
            id: schema.designFiles.id,
            filename: schema.designFiles.filename,
          })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.designId, designId))
          .orderBy(
            sql`${schema.designFiles.createdAt} asc nulls first`,
            asc(schema.designFiles.id),
          );
        const taken = new Set(files.map((file) => file.filename));
        const kept = new Set<string>();
        let count = 0;
        for (const file of files) {
          if (!kept.has(file.filename)) {
            kept.add(file.filename);
            continue;
          }
          const filename = nextFreeName(file.filename, taken);
          taken.add(filename);
          await tx
            .update(schema.designFiles)
            .set({ filename })
            .where(
              and(
                eq(schema.designFiles.id, file.id),
                eq(schema.designFiles.designId, designId),
              ),
            );
          count += 1;
        }
        return count;
      },
    );
  }
  return { renamed, remaining: duplicated.length > maxDesigns };
}
