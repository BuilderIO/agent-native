import { Extension } from "@tiptap/core";

export const RUN_ID_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
] as const;

export const RunId = Extension.create({
  name: "runId",

  addGlobalAttributes() {
    return [
      {
        types: [...RUN_ID_NODE_TYPES],
        attributes: {
          runId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-run-id"),
            renderHTML: (attributes) => {
              const runId = (attributes as { runId?: string | null }).runId;
              if (!runId) return {};
              return { "data-run-id": runId };
            },
          },
        },
      },
    ];
  },
});
