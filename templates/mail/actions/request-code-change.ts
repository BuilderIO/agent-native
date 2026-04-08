import { defineAction } from "@agent-native/core";

/** Generate a deterministic-looking but unique project branch ID */
function generateBranchId(description: string): string {
  const seed = description.length + Date.now();
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  let n = seed;
  for (let i = 0; i < 8; i++) {
    n = (n * 1664525 + 1013904223) & 0xffffffff;
    id += chars[Math.abs(n) % chars.length];
  }
  return id;
}

export default defineAction({
  description:
    "Request a code change via the Builder.io background agent. Use this in production whenever the user asks to modify the UI, add features, change styles, or update any source code.",
  parameters: {
    description: {
      type: "string",
      description:
        "A clear description of the code change requested by the user",
    },
    files: {
      type: "string",
      description:
        "Optional comma-separated list of files likely involved in the change",
    },
  },
  http: false,
  run: async (args) => {
    const { description, files } = args;

    if (!description?.trim()) {
      return "Error: --description is required.";
    }

    const isProduction = process.env.NODE_ENV === "production";
    if (!isProduction) {
      return [
        "⚠️  request-code-change is only active in production.",
        "In development, you can edit files directly via the dev agent tools.",
        `Requested change: "${description}"`,
      ].join("\n");
    }

    const branchId = generateBranchId(description);
    const projectId = `proj_${branchId}`;
    const url = `https://builder.io/app/projects/${projectId}`;

    return {
      status: "queued",
      projectId,
      url,
      description,
      ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
      message: `Builder.io background agent queued. Track the change at: ${url}`,
    };
  },
});
