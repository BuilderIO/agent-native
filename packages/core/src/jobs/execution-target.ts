import { parseJobResource } from "./frontmatter.js";

export const EXECUTION_TARGET_FIELDS = {
  executionHostId: "execution_host_id",
  executionEngine: "execution_engine",
  executionCwd: "execution_cwd",
} as const;

export function setsExecutionTarget(
  args: Record<string, unknown>,
  style: "camel" | "snake",
): boolean {
  return Object.entries(EXECUTION_TARGET_FIELDS).some(([camel, snake]) => {
    const value = args[style === "camel" ? camel : snake];
    if (value === undefined || value === null) return false;
    return typeof value !== "string" || value.trim() !== "";
  });
}

export function resourceTargetsHost(content: string): boolean {
  try {
    return Boolean(parseJobResource(content).meta.executionHostId?.trim());
  } catch {
    // coercion-ok: an unparseable job asks for approval
    return true;
  }
}
