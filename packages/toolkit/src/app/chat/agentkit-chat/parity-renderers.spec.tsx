import { describe, expect, it } from "vitest";

import { agentKitFileChangeParts } from "./parity-renderers.js";

describe("agentKitFileChangeParts", () => {
  it("keeps structured edits for the matching message only", () => {
    const parts = agentKitFileChangeParts(
      [
        {
          id: "edit-1",
          name: "edit_file",
          messageId: "message-1",
          status: "completed",
          input: { filePath: "src/app.ts" },
          metadata: {
            toolKind: "edit",
            filePath: "src/app.ts",
            oldText: "before",
            newText: "after",
          },
        },
        {
          id: "read-1",
          name: "read_file",
          messageId: "message-1",
          status: "completed",
          metadata: { toolKind: "read" },
        },
        {
          id: "edit-2",
          name: "edit_file",
          messageId: "message-2",
          status: "completed",
          metadata: { toolKind: "edit", filePath: "other.ts" },
        },
      ],
      "message-1",
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "edit-1",
      structuredMeta: {
        toolKind: "edit",
        filePath: "src/app.ts",
        oldText: "before",
        newText: "after",
      },
    });
  });

  it("uses the run id when a tool event has no message id", () => {
    expect(
      agentKitFileChangeParts(
        [
          {
            id: "write-1",
            name: "write_file",
            runId: "run-1",
            status: "completed",
            metadata: { toolKind: "write", filePath: "README.md" },
          },
        ],
        "message-1",
        "run-1",
      ),
    ).toHaveLength(1);
  });
});
