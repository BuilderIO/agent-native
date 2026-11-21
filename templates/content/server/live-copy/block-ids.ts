import { createBoundedTaskRunner } from "@agent-native/core/collab";

import type { EditorBlockIds } from "../../shared/block-identity-ids.js";
import { CONTENT_BLOCK_IDS_TASK } from "./task-names.js";
import source from "./tasks.ts?bounded-task";

const runner = createBoundedTaskRunner({ source });

export async function liveCopyBlockIds(
  state: Uint8Array,
): Promise<EditorBlockIds | null> {
  if (state.length === 0) return null;
  const ids = await runner.run<unknown>(CONTENT_BLOCK_IDS_TASK, { state });
  if (ids === null) return null;
  if (isEditorBlockIds(ids)) return ids;
  throw new TypeError(
    `${CONTENT_BLOCK_IDS_TASK} answered ${JSON.stringify(ids)}`,
  );
}

function isEditorBlockIds(value: unknown): value is EditorBlockIds {
  if (typeof value !== "object" || value === null) return false;
  if (!("shape" in value) || typeof value.shape !== "string") return false;
  if (!("idsByPath" in value)) return false;
  const { idsByPath } = value;
  return (
    typeof idsByPath === "object" &&
    idsByPath !== null &&
    Object.values(idsByPath).every((id) => typeof id === "string")
  );
}
