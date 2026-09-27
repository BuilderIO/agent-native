import { currentAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { directDocumentAccessSql } from "../../actions/_document-access.js";
import { getDb, schema } from "../db/index.js";

export type DocumentContextPathEntry = {
  id: string;
  kind: "page" | "database";
  title: string;
  description: string;
};

async function canReadContextDocument(
  documentId: string,
  directlyGranted: boolean,
) {
  return (
    directlyGranted ||
    Boolean(
      await resolveAccess("document", documentId, undefined, {
        skipResourceBody: true,
      }),
    )
  );
}

function ancestorChain(
  document: Pick<typeof schema.documents.$inferSelect, "id" | "parentId">,
) {
  const db = getDb();
  const ancestor = {
    id: sql<string>`context_ancestors.id`,
    ownerEmail: sql<string>`context_ancestors.owner_email`,
    visibility: sql<string>`context_ancestors.visibility`,
  };
  // Loads the whole parent chain in one statement. Access is still decided
  // per row, nearest first, and the walk stops at the first unreadable one.
  return db
    .select({
      id: ancestor.id,
      title: sql<string>`context_ancestors.title`,
      description: sql<string>`context_ancestors.description`,
      databaseId: sql<string | null>`context_ancestors.database_id`,
      databaseTitle: sql<string | null>`context_ancestors.database_title`,
      directlyGranted: directDocumentAccessSql(ancestor, currentAccess()),
    })
    .from(
      sql`(
        with recursive chain(id, parent_id, depth, visited) as (
          select ${schema.documents.id}, ${schema.documents.parentId}, 1,
            array[${document.id}::text, ${schema.documents.id}]
          from ${schema.documents}
          where ${schema.documents.id} = ${document.parentId}
          union all
          select ${schema.documents.id}, ${schema.documents.parentId}, chain.depth + 1,
            chain.visited || ${schema.documents.id}
          from chain
          join ${schema.documents} on ${schema.documents.id} = chain.parent_id
          where not ${schema.documents.id} = any(chain.visited)
        )
        select chain.depth, ${schema.documents.id} as id,
          ${schema.documents.title} as title,
          ${schema.documents.description} as description,
          ${schema.documents.ownerEmail} as owner_email,
          ${schema.documents.visibility} as visibility,
          context_database.id as database_id,
          context_database.title as database_title
        from chain
        join ${schema.documents} on ${schema.documents.id} = chain.id
        left join lateral (
          select ${schema.contentDatabases.id} as id,
            ${schema.contentDatabases.title} as title
          from ${schema.contentDatabases}
          where ${schema.contentDatabases.documentId} = chain.id
            and ${schema.contentDatabases.deletedAt} is null
          limit 1
        ) as context_database on true
      ) as context_ancestors`,
    )
    .orderBy(sql`context_ancestors.depth`);
}

export async function getDocumentContextPath(
  document: Pick<typeof schema.documents.$inferSelect, "id" | "parentId">,
  options: { databaseId?: string } = {},
): Promise<DocumentContextPathEntry[]> {
  const db = getDb();
  const membershipClauses = [
    eq(schema.contentDatabaseItems.documentId, document.id),
    isNull(schema.contentDatabases.deletedAt),
  ];
  if (options.databaseId) {
    membershipClauses.push(
      eq(schema.contentDatabaseItems.databaseId, options.databaseId),
    );
  }
  const [ancestors, [membership], [backingDatabase]] = await Promise.all([
    document.parentId ? ancestorChain(document) : Promise.resolve([]),
    db
      .select({
        database: schema.contentDatabases,
        databaseDocumentDescription: schema.documents.description,
        databaseDocumentDirectlyGranted: directDocumentAccessSql(
          schema.documents,
          currentAccess(),
        ),
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .leftJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabases.documentId),
      )
      .where(and(...membershipClauses))
      .orderBy(
        sql`CASE WHEN ${schema.contentDatabases.systemRole} IS NULL THEN 0 ELSE 1 END`,
        asc(schema.contentDatabases.id),
      ),
    db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.documentId, document.id),
          isNull(schema.contentDatabases.deletedAt),
        ),
      ),
  ]);

  const path: DocumentContextPathEntry[] = [];
  for (const ancestor of ancestors) {
    if (!(await canReadContextDocument(ancestor.id, ancestor.directlyGranted)))
      break;
    path.unshift({
      id: ancestor.databaseId ?? ancestor.id,
      kind: ancestor.databaseId ? "database" : "page",
      title: ancestor.databaseTitle ?? ancestor.title,
      description: ancestor.description,
    });
  }

  if (
    membership &&
    !(membership.database.systemRole && backingDatabase) &&
    !path.some((entry) => entry.id === membership.database.id)
  ) {
    // The column is NOT NULL, so null means the database document is gone.
    const description = membership.databaseDocumentDescription;
    if (
      description === null ||
      !(await canReadContextDocument(
        membership.database.documentId,
        membership.databaseDocumentDirectlyGranted === true,
      ))
    )
      return path;
    path.push({
      id: membership.database.id,
      kind: "database",
      title: membership.database.title,
      description,
    });
  }
  return path;
}
