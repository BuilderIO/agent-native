import type { OperationDefinitionInput } from "../operations.js";

export const contentOperations: OperationDefinitionInput[] = [
  {
    id: "content.upsertRow",
    provider: "content",
    label: "Content: add or update a row",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "collection",
        type: "string",
        required: true,
        target: true,
        label: "Collection",
        description:
          "The Content collection's link (its page link or open link) or page ID. It needs a unique key column. The step writes as the workflow's owner, through their own Content connection.",
      },
      {
        name: "key",
        type: "string",
        required: true,
        label: "Key",
        description:
          "The row's value in the collection's unique key column. A row with this key is updated; otherwise one is added. A key can't be changed later, so use a stable ID.",
      },
      {
        name: "title",
        type: "string",
        label: "Title",
        description:
          "The row's title. Left out, a new row is untitled and an existing one keeps its title.",
      },
      {
        name: "values",
        type: "json",
        label: "Values",
        description:
          'Object of column name to value, such as {"Status": "Done", "Owner": "Ada"}. Only these columns change; the key column is set from Key.',
      },
    ],
    implementation: {
      type: "action",
      action: "upsert-content-row",
      argMap: {
        collection: "collection",
        key: "key",
        title: "title",
        values: "values",
      },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "outcome",
        type: "string",
        description:
          "created, updated, or unchanged when the row already held these values.",
      },
      {
        name: "documentId",
        type: "string",
        description: "The row's page ID; the same value is externalRef.",
      },
      {
        name: "itemId",
        type: "string",
        description: "The row's ID in the collection.",
      },
      {
        name: "url",
        type: "string",
        nullable: true,
        description:
          "A link to the row's page, when the collection was given as a link.",
      },
    ],
    receipt: { externalRef: "documentId", url: "url" },
    credential: { provider: "content" },
  },
];
