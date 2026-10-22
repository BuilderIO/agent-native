import type { OperationDefinitionInput } from "../operations.js";

export const notionOperations: OperationDefinitionInput[] = [
  {
    // The parent is a page, and nothing else is a valid property on a page
    // child. `markdown` takes the whole body and is the only way to send text
    // past a block's 2,000-character limit without chunking.
    id: "notion.createPage",
    provider: "notion",
    label: "Notion: create a page",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "parentPageId",
        type: "string",
        required: true,
        target: true,
        label: "Parent page",
      },
      { name: "title", type: "string", required: true, label: "Title" },
      { name: "body", type: "text", label: "Content (markdown)" },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/pages",
      bodyTemplate: {
        parent: { page_id: "{parentPageId}" },
        properties: { title: { title: [{ text: { content: "{title}" } }] } },
        markdown: "{body}",
      },
    },
    receipt: { externalRef: "id", url: "url" },
    credential: { provider: "notion" },
  },
];
