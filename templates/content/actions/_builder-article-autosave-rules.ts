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
  errorCode:
    | "builder_autosave_published"
    | "builder_autosave_editor_changes"
    | "builder_autosave_unconfirmed";
  reason: BuilderArticleAutosaveReason;
  message: string;
}

export const BUILDER_ARTICLE_AUTOSAVE_UNSETTLED_EXECUTION_STATES: readonly string[] =
  ["running", "reconciliation_required", "response_received"];

export const BUILDER_ARTICLE_AUTOSAVE_UNCONFIRMED_STOP: BuilderArticleAutosaveStop =
  {
    errorCode: "builder_autosave_unconfirmed",
    reason: "unconfirmed_save",
    message:
      "Content can't confirm the last save reached Builder, so it won't send it again. Settle it with Review Builder update.",
  };

export function builderArticleAutosaveExecutionUnsettled(state: string) {
  return BUILDER_ARTICLE_AUTOSAVE_UNSETTLED_EXECUTION_STATES.includes(state);
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
        "Builder's editor is saving changes to this draft. Content tries again shortly.",
    };
  }
  return null;
}
