import { droppedJobFrontmatterKeys } from "./frontmatter.js";

export interface JobFileWrite {
  owner: string;
  orgId: string | null;
  path: string;
  before: string;
  after: string;
  writer: string;
}

const CALLER_FRAMES = 6;
const SUMMARY_KEYS = 12;

// Only the function name and `file:line` of each frame: enough to tell
// `runCreate` from the scheduler without recording server directory layout.
function callerFrames(): string[] {
  const frames = new Error().stack?.split("\n").slice(1) ?? [];
  return frames
    .map((frame) => frame.trim().replace(/^at\s+/, ""))
    .filter(
      (frame) =>
        !frame.includes("frontmatter-loss") &&
        !frame.includes("resources/store") &&
        !frame.includes("node:internal"),
    )
    .slice(0, CALLER_FRAMES)
    .map((frame) =>
      frame.replace(/\(?[^\s()]*[\\/]([^\\/\s():]+:\d+):\d+\)?/, "($1)"),
    );
}

/**
 * A write that removes editor-owned frontmatter fields from a job file is
 * recorded with who wrote it. Several callers have rebuilt a whole job file
 * from the fields they know and silently dropped the rest, and the job keeps
 * running, so the loss shows up days later as a missing channel or name.
 * Never throws: this runs on the scheduler's write path, and a recording
 * failure must not fail the write that triggered it.
 */
export async function noteJobFrontmatterWrite(
  write: JobFileWrite,
): Promise<void> {
  try {
    if (!write.path.startsWith("jobs/")) return;
    const dropped = droppedJobFrontmatterKeys(write.before, write.after);
    if (dropped.length === 0) return;

    const callers = callerFrames();
    console.warn(
      `[recurring-jobs] "${write.path}" lost frontmatter fields (${dropped.join(", ")}) in ${write.writer}`,
      callers,
    );
    const [{ recordOrgAdminAuditEvent }, requestContext] = await Promise.all([
      import("../audit/org-admin.js"),
      import("../server/request-context.js"),
    ]);
    const run = requestContext.getRequestRunContext();
    const userEmail = requestContext.getRequestUserEmail();
    const listed = dropped.slice(0, SUMMARY_KEYS).join(", ");
    await recordOrgAdminAuditEvent({
      action: "job-fields-dropped",
      targetType: "job-file",
      targetId: write.path,
      summary: `Job file ${write.path} lost ${dropped.length} frontmatter field(s): ${listed}${dropped.length > SUMMARY_KEYS ? ", ..." : ""}`,
      userEmail,
      orgId: write.orgId,
      caller: run?.threadId ? "tool" : userEmail ? "http" : "automation",
      threadId: run?.threadId,
      runId: run?.runId,
      args: {
        path: write.path,
        owner: write.owner,
        writer: write.writer,
        droppedKeys: dropped,
        callers,
      },
    });
  } catch (error) {
    console.error(
      `[recurring-jobs] could not check or record lost fields for "${write.path}":`,
      error,
    );
  }
}
