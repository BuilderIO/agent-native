import type {
  BuilderArticleAutosaveReason,
  BuilderCmsWriteEffect,
  DocumentPropertyValue,
} from "../shared/api.js";
import type { BuilderCmsEntryLiveState } from "./_builder-cms-read-client.js";
import { readBuilderCmsUnpublishedChanges } from "./_builder-cms-unpublished-changes.js";

export const BUILDER_ARTICLE_AUTOSAVE_QUIET_MS = 3_000;

export const BUILDER_ARTICLE_AUTOSAVE_RECHECK_MS = 60_000;

export const BUILDER_ARTICLE_AUTOSAVE_NEW_ROW_WINDOW_MS = 10 * 60_000;

export const BUILDER_ARTICLE_AUTOSAVE_EFFECTS: readonly BuilderCmsWriteEffect[] =
  ["create_draft", "save_draft"];

export function builderArticleAutosaveAllowsEffect(
  effect: BuilderCmsWriteEffect,
) {
  return BUILDER_ARTICLE_AUTOSAVE_EFFECTS.includes(effect);
}

export function builderArticleAutosaveAllowsPublication(
  published: unknown,
  options: { entryExists: boolean },
) {
  return !options.entryExists || published === "draft";
}

export interface BuilderArticleAutosaveStop {
  errorCode: "builder_autosave_published" | "builder_autosave_editor_changes";
  reason: BuilderArticleAutosaveReason;
  message: string;
}

export function builderArticleAutosaveLiveStop(args: {
  liveState: BuilderCmsEntryLiveState;
  baselineValues: Record<string, DocumentPropertyValue> | undefined;
}): BuilderArticleAutosaveStop | null {
  if (!args.liveState.exists) return null;
  if (
    !builderArticleAutosaveAllowsPublication(args.liveState.published, {
      entryExists: true,
    })
  ) {
    return {
      errorCode: "builder_autosave_published",
      reason: "published",
      message:
        "This article is published in Builder, so its changes go through Review Builder update.",
    };
  }
  if (
    args.liveState.hasAutosaves === true &&
    readBuilderCmsUnpublishedChanges(args.baselineValues).state !== "pending"
  ) {
    return {
      errorCode: "builder_autosave_editor_changes",
      reason: "builder_editor_changes",
      message:
        "This article has unpublished changes saved in Builder's editor. Publish or discard them in Builder to carry on saving.",
    };
  }
  return null;
}
