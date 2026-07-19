import type {
  PrivateVaultAuthorizedActionContext,
  PrivateVaultLocalActionRegistry,
} from "@agent-native/private-vault-broker";
import { z } from "zod";

import type {
  PrivateVaultContentMutations,
  UpdatePrivateDocumentInput,
} from "./content-document-mutations.js";
import type { PrivateVaultContentRegistry } from "./content-document-registry.js";

const opaqueIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const revisionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const optionalDocumentIdSchema = opaqueIdSchema.optional();

export class PrivateVaultContentActionRegistryError extends Error {
  constructor() {
    super("Private Content action unavailable");
    this.name = "PrivateVaultContentActionRegistryError";
  }
}

function resourceId(context: PrivateVaultAuthorizedActionContext): string {
  if (
    !(context.resourceId instanceof Uint8Array) ||
    context.resourceId.length !== 16
  )
    throw new PrivateVaultContentActionRegistryError();
  return Buffer.from(context.resourceId).toString("hex");
}

function requireResource(
  context: PrivateVaultAuthorizedActionContext,
  expected: string,
): void {
  if (resourceId(context) !== expected)
    throw new PrivateVaultContentActionRegistryError();
}

function documentResult<T extends { readonly id: string }>(document: T) {
  return Object.freeze({ ...document, urlPath: `/page/${document.id}` });
}

const createSchema = z
  .object({
    id: optionalDocumentIdSchema,
    title: z.string().max(16_384),
    content: z
      .string()
      .max(1024 * 1024)
      .optional(),
    description: z.string().max(131_072).optional(),
    parentId: opaqueIdSchema.nullish(),
    icon: z.string().max(256).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    id: optionalDocumentIdSchema,
    title: z.string().max(16_384).optional(),
    content: z
      .string()
      .max(1024 * 1024)
      .optional(),
    description: z.string().max(131_072).optional(),
    icon: z.string().max(256).nullable().optional(),
    isFavorite: z.boolean().optional(),
    loadedUpdatedAt: z.string().optional(),
    loadedContentWasEmpty: z.boolean().optional(),
    baseUpdatedAt: z.string().optional(),
  })
  .strict();

const textEditSchema = z
  .object({ find: z.string().min(1), replace: z.string().default("") })
  .strict();
const editSchema = z
  .object({
    id: optionalDocumentIdSchema,
    find: z.string().optional(),
    replace: z.string().optional(),
    edits: z.string().optional(),
  })
  .strict();

function parseEdits(input: z.infer<typeof editSchema>) {
  if (input.edits !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.edits);
    } catch {
      throw new PrivateVaultContentActionRegistryError();
    }
    return z.array(textEditSchema).min(1).max(100).parse(parsed);
  }
  if (!input.find) throw new PrivateVaultContentActionRegistryError();
  return [{ find: input.find, replace: input.replace ?? "" }];
}

export function createPrivateVaultContentActionRegistry(input: {
  readonly vaultId: string;
  readonly registry: Pick<
    PrivateVaultContentRegistry,
    "listDocuments" | "getDocument" | "searchDocuments" | "listDocumentVersions"
  >;
  readonly mutations: Pick<
    PrivateVaultContentMutations,
    | "createDocument"
    | "updateDocument"
    | "deleteDocument"
    | "restoreDocumentVersion"
  >;
}): PrivateVaultLocalActionRegistry {
  const vaultId = opaqueIdSchema.parse(input.vaultId);
  const exactDocument = (
    args: unknown,
    context: PrivateVaultAuthorizedActionContext,
  ) => {
    const { id } = z
      .object({ id: optionalDocumentIdSchema })
      .strict()
      .parse(args);
    if (!id) throw new PrivateVaultContentActionRegistryError();
    requireResource(context, id);
    return id;
  };

  return Object.freeze({
    "list-documents": {
      run: async (args, context) => {
        z.object({}).strict().parse(args);
        requireResource(context, vaultId);
        return (await input.registry.listDocuments(vaultId)).documents;
      },
    },
    "search-documents": {
      run: async (args, context) => {
        const parsed = z
          .object({
            query: z.string().max(16_384),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .strict()
          .parse(args);
        requireResource(context, vaultId);
        return input.registry.searchDocuments(
          vaultId,
          parsed.query,
          parsed.limit,
        );
      },
    },
    "get-document": {
      run: async (args, context) => {
        const id = exactDocument(args, context);
        return documentResult(await input.registry.getDocument(vaultId, id));
      },
    },
    "pull-document": {
      run: async (args, context) => {
        const parsed = z
          .object({
            id: optionalDocumentIdSchema,
            format: z.enum(["markdown", "text"]).default("markdown"),
          })
          .strict()
          .parse(args);
        if (!parsed.id) throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.id);
        const document = await input.registry.getDocument(vaultId, parsed.id);
        const content =
          parsed.format === "text"
            ? document.content
                .replace(/^#{1,6}\s+/gm, "")
                .replace(/[*_`~>]/g, "")
                .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
                .trim()
            : document.content;
        return {
          id: document.id,
          title: document.title,
          description: document.description ?? "",
          content,
          format: parsed.format,
          urlPath: `/page/${document.id}`,
        };
      },
    },
    "create-document": {
      run: async (args, context) => {
        const parsed = createSchema.parse(args);
        requireResource(context, vaultId);
        return documentResult(
          await input.mutations.createDocument(vaultId, {
            ...parsed,
            description: parsed.description ?? null,
            parentId: parsed.parentId ?? null,
            icon: parsed.icon ?? null,
          }),
        );
      },
    },
    "update-document": {
      run: async (args, context) => {
        const parsed = updateSchema.parse(args);
        if (!parsed.id) throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.id);
        const current = await input.registry.getDocument(vaultId, parsed.id);
        if (
          parsed.content !== undefined &&
          parsed.baseUpdatedAt !== undefined &&
          parsed.baseUpdatedAt !== current.updatedAt
        )
          throw new PrivateVaultContentActionRegistryError();
        const update: UpdatePrivateDocumentInput = {
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.content !== undefined ? { content: parsed.content } : {}),
          ...(parsed.description !== undefined
            ? { description: parsed.description }
            : {}),
          ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
          ...(parsed.isFavorite !== undefined
            ? { isFavorite: parsed.isFavorite }
            : {}),
        };
        return documentResult(
          await input.mutations.updateDocument(vaultId, parsed.id, update),
        );
      },
    },
    "edit-document": {
      run: async (args, context) => {
        const parsed = editSchema.parse(args);
        if (!parsed.id) throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.id);
        const edits = parseEdits(parsed);
        const document = await input.registry.getDocument(vaultId, parsed.id);
        let content = document.content;
        let applied = 0;
        const results: string[] = [];
        for (const edit of edits) {
          const index = content.indexOf(edit.find);
          if (index < 0) {
            results.push(`NOT FOUND: "${edit.find.slice(0, 60)}"`);
            continue;
          }
          content =
            content.slice(0, index) +
            edit.replace +
            content.slice(index + edit.find.length);
          applied += 1;
          results.push(
            `${edit.replace ? "replaced" : "deleted"}: "${edit.find.slice(0, 40)}"`,
          );
        }
        if (applied > 0)
          await input.mutations.updateDocument(vaultId, parsed.id, { content });
        return { applied, total: edits.length, results };
      },
    },
    "move-document": {
      run: async (args, context) => {
        const parsed = z
          .object({
            id: optionalDocumentIdSchema,
            parentId: opaqueIdSchema.nullable().optional(),
            position: z.number().int().nonnegative().optional(),
          })
          .strict()
          .parse(args);
        if (
          !parsed.id ||
          (parsed.parentId === undefined && parsed.position === undefined)
        )
          throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.id);
        return documentResult(
          await input.mutations.updateDocument(vaultId, parsed.id, {
            ...(parsed.parentId !== undefined
              ? { parentId: parsed.parentId }
              : {}),
            ...(parsed.position !== undefined
              ? { position: parsed.position }
              : {}),
          }),
        );
      },
    },
    "delete-document": {
      run: async (args, context) => {
        const id = exactDocument(args, context);
        return input.mutations.deleteDocument(vaultId, id);
      },
    },
    "list-document-versions": {
      run: async (args, context) => {
        const parsed = z
          .object({ documentId: optionalDocumentIdSchema })
          .strict()
          .parse(args);
        if (!parsed.documentId)
          throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.documentId);
        return input.registry.listDocumentVersions(vaultId, parsed.documentId);
      },
    },
    "restore-document-version": {
      run: async (args, context) => {
        const parsed = z
          .object({
            documentId: optionalDocumentIdSchema,
            versionId: revisionIdSchema.optional(),
          })
          .strict()
          .parse(args);
        if (!parsed.documentId || !parsed.versionId)
          throw new PrivateVaultContentActionRegistryError();
        requireResource(context, parsed.documentId);
        return documentResult(
          await input.mutations.restoreDocumentVersion(
            vaultId,
            parsed.documentId,
            parsed.versionId,
          ),
        );
      },
    },
  });
}
