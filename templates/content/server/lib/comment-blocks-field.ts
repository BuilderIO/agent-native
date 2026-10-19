import { fail } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";

import type { DocumentPropertyType } from "../../shared/api.js";
import {
  isBlocksPropertyType,
  isPrimaryBlocksField,
  parsePropertyOptions,
} from "../../shared/properties.js";
import { getDb, schema } from "../db/index.js";

/**
 * Where a comment thread sits among a Page's Blocks fields. A null `fieldId`
 * is the page body: the primary field, or a Page with no fields at all.
 */
export interface CommentBlocksFieldTarget {
  fieldId: string | null;
  fieldName: string | null;
}

export const BODY_COMMENT_FIELD: CommentBlocksFieldTarget = {
  fieldId: null,
  fieldName: null,
};

/**
 * The tab a new thread anchors in. `fieldId` must name a Blocks field of a
 * Collection the Page is a row of; the primary field is the body, stored as
 * null so body threads read the same before and after tabs had comments.
 */
export async function resolveCommentBlocksField(
  documentId: string,
  fieldId: string | null | undefined,
): Promise<CommentBlocksFieldTarget> {
  if (!fieldId) return BODY_COMMENT_FIELD;
  const [field] = await getDb()
    .select({
      id: schema.documentPropertyDefinitions.id,
      name: schema.documentPropertyDefinitions.name,
      type: schema.documentPropertyDefinitions.type,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .innerJoin(
      schema.contentDatabases,
      eq(
        schema.contentDatabases.id,
        schema.documentPropertyDefinitions.databaseId,
      ),
    )
    .innerJoin(
      schema.contentDatabaseItems,
      and(
        eq(schema.contentDatabaseItems.databaseId, schema.contentDatabases.id),
        eq(schema.contentDatabaseItems.documentId, documentId),
      ),
    )
    .where(
      and(
        eq(schema.documentPropertyDefinitions.id, fieldId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .limit(1);
  if (!field) {
    fail("That Blocks field isn't on this Page", {
      statusCode: 400,
      errorCode: "comment_field_not_found",
    });
  }
  if (!isBlocksPropertyType(field.type as DocumentPropertyType)) {
    fail(
      "fieldId must name a Blocks field; use propertyId to comment on a Property value",
      { statusCode: 400, errorCode: "comment_field_not_blocks" },
    );
  }
  if (isPrimaryBlocksField(parsePropertyOptions(field.optionsJson))) {
    return BODY_COMMENT_FIELD;
  }
  return { fieldId: field.id, fieldName: field.name };
}
