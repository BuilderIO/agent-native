import type { ActionEntry } from "../../agent/production-agent.js";
import { registerStrictToolInput } from "../../agent/strict-tool-input.js";

const writeFields = ["path", "content", "scope", "mime", "visibility"] as const;

/** Optional write settings have no clear operation: blank padding means use the existing default. */
function resourceWriteArgs(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Resource write input must be an object.");
  }
  const args = input as Record<string, unknown>;
  if (
    Object.keys(args).some(
      (key) => !writeFields.includes(key as (typeof writeFields)[number]),
    )
  ) {
    throw new Error(
      "Resource write accepts only path, content, scope, mime and visibility.",
    );
  }
  if (
    typeof args.path !== "string" ||
    !args.path.trim() ||
    typeof args.content !== "string"
  ) {
    throw new Error(
      "Resource write requires a nonempty path and string content. Use an explicit empty string to clear content.",
    );
  }
  const result: Record<string, string> = {
    path: args.path,
    content: args.content,
  };
  for (const key of ["scope", "mime", "visibility"] as const) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !value.trim())
      throw new Error(
        `Resource write ${key} must be a nonempty string or omitted.`,
      );
    if (key === "scope" && !["personal", "shared", "workspace"].includes(value))
      throw new Error("Invalid resource write scope.");
    if (key === "visibility" && !["workspace", "agent_scratch"].includes(value))
      throw new Error("Invalid resource write visibility.");
    result[key] = value;
  }
  return { ...result, action: "write" };
}

/** A dedicated operation cannot confuse unrelated fields with intended content clears. */
export function createResourceWriteEntry(resources: ActionEntry): ActionEntry {
  const entry: ActionEntry = {
    ...resources,
    readOnly: false,
    tool: {
      description:
        "Create or replace a workspace resource file, including a user-requested skill at skills/<name>/SKILL.md. Prefer this dedicated operation for writing files. Uses the same permissions, visibility defaults and per-action shared-resource approval as resources. Omit unused optional fields; null or empty optional strings select existing defaults.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            minLength: 1,
            pattern: "\\S",
            description: "Resource path to create or replace.",
          },
          content: {
            type: "string",
            description:
              "Full file content. An explicit empty string clears the file; null is invalid.",
          },
          scope: {
            anyOf: [
              { type: "string", enum: ["personal", "shared", "workspace", ""] },
              { type: "null" },
            ],
            description:
              "Same scope rules as resources: personal by default, except LEARNINGS.md defaults to shared. Shared writes require per-action approval. Inherited workspace files are read-only.",
          },
          mime: {
            anyOf: [
              { type: "string", pattern: "\\S" },
              { type: "string", enum: [""] },
              { type: "null" },
            ],
            description:
              "Optional MIME type. Omit, null or empty infers it from the path extension.",
          },
          visibility: {
            anyOf: [
              { type: "string", enum: ["workspace", "agent_scratch", ""] },
              { type: "null" },
            ],
            description:
              "Use workspace for user-requested files. Defaults match resources, including durable skill and instruction paths.",
          },
        },
        required: ["path", "content"],
      },
    },
    planMode: { effect: "write" },
    needsApproval: (args) => {
      let normalized: Record<string, string>;
      try {
        normalized = resourceWriteArgs(args);
      } catch {
        return true;
      }
      const gate = resources.needsApproval;
      return typeof gate === "function" ? gate(normalized) : (gate ?? false);
    },
    allowPersistentApproval: false,
    run: (args, context) => resources.run(resourceWriteArgs(args), context),
  };
  // Required content must never be coerced from null/false/zero into an empty-file write.
  registerStrictToolInput(entry, (input) => {
    try {
      resourceWriteArgs(input);
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Invalid resource write input.";
    }
  });
  return entry;
}
