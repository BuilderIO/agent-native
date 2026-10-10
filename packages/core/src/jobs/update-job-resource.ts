import {
  resourceGetByPath,
  resourcePutIfCurrent,
  type Resource,
} from "../resources/store.js";
import {
  patchJobFrontmatterFields,
  replaceJobResourceBody,
  type JobFrontmatterPatch,
} from "./frontmatter.js";

export interface JobResourceEdit {
  /** The snapshot the edit was computed from. */
  resource: Resource;
  /**
   * Fields for the file the current attempt writes from. Called per attempt so
   * derived and reset fields follow the file the edit actually lands on
   * instead of reusing the first snapshot's decisions.
   */
  fields: (baseContent: string) => JobFrontmatterPatch;
  /** Replaces the instructions body when provided. */
  body?: string;
  /**
   * Re-checks the editor's permission against a retry's file before it is
   * written. The first attempt already ran the caller's authorization.
   */
  revalidate?: (base: Resource) => Promise<boolean>;
  /** Compare-and-swap attempts before the edit reports a conflict. */
  attempts?: number;
}

export type JobResourceEditResult =
  | { ok: true; resource: Resource; replacedContent: string }
  | {
      ok: false;
      reason: "missing" | "replaced" | "conflict" | "unauthorized";
    };

/**
 * Applies an owner's edit without reverting execution state a scheduler or
 * runner wrote after this edit was read. The first write is a compare-and-swap
 * against the exact snapshot the edit was built from; a conflict re-checks
 * permission, re-applies the edit to the latest content, and retries, so the
 * other writer's run state (and the completed run's outcome) survives while the
 * user's fields still land. Reports `missing` when the file is gone, `replaced`
 * when a different resource now owns the path, `unauthorized` when the editor
 * lost permission over the retry's file, and `conflict` when it kept changing.
 */
export async function applyJobResourceEdit(
  input: JobResourceEdit,
): Promise<JobResourceEditResult> {
  const attempts = Math.max(1, input.attempts ?? 3);
  let base = input.resource;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && input.revalidate && !(await input.revalidate(base))) {
      return { ok: false, reason: "unauthorized" };
    }
    const fields = input.fields(base.content);
    let content = patchJobFrontmatterFields(base.content, fields);
    if (input.body !== undefined) {
      content = replaceJobResourceBody(content, input.body);
    }
    const written = await resourcePutIfCurrent({
      owner: base.owner,
      path: base.path,
      content,
      expectedId: base.id,
      expectedUpdatedAt: base.updatedAt,
      expectedContent: base.content,
    });
    if (written) {
      return { ok: true, resource: written, replacedContent: base.content };
    }
    const latest = await resourceGetByPath(base.owner, base.path);
    if (!latest) return { ok: false, reason: "missing" };
    if (latest.id !== base.id) return { ok: false, reason: "replaced" };
    base = latest;
  }
  return { ok: false, reason: "conflict" };
}
