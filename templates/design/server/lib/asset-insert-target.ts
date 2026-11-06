/**
 * Which design screen an asset insert writes to.
 *
 * `insert-asset`, `insert-figma-library-asset` and `insert-design-native-asset`
 * each carried their own copy of this lookup, and each turned a failed
 * app-state read into `null`: the same value as "no screen is open". The
 * insert then landed on the first HTML screen and the agent reported success.
 * An explicit `fileId` that matched no HTML screen got the same silent
 * first-screen fallback. Both cases refuse here instead, so a caller can pass
 * the id it meant.
 */

import { fail } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";

export const ASSET_INSERT_TARGET_ERROR_CODES = {
  stateUnreadable: "asset_target_state_unreadable",
  screenInvalid: "asset_target_screen_invalid",
} as const;

interface AssetInsertTargetArgs {
  designId?: string | undefined;
  ownerId?: string | undefined;
  /** Screen ids the caller passed, most specific first. */
  fileIds: ReadonlyArray<string | undefined>;
}

export interface AssetInsertTarget {
  designId: string | undefined;
  explicitFileIds: string[];
  stateFileId: string | undefined;
  /** The editor's navigation or selection state could not be read. */
  stateUnreadable: boolean;
}

interface HtmlCandidate {
  id: string;
  fileType: string | null;
  filename: string | null;
}

type StateRead = { value: unknown; readable: boolean };

function stringFromState(state: unknown, key: string): string | undefined {
  if (!state || typeof state !== "object") return undefined;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function isHtmlFile(file: Omit<HtmlCandidate, "id">): boolean {
  return file.fileType === "html" || file.filename?.endsWith(".html") === true;
}

async function readState(key: string): Promise<StateRead> {
  try {
    return { value: await readAppStateForCurrentTab(key), readable: true };
  } catch {
    return { value: null, readable: false };
  }
}

function refuseUnreadableState(): never {
  fail(
    "Could not read which design screen is active. Pass designId and fileId " +
      "of the screen to insert into.",
    {
      errorCode: ASSET_INSERT_TARGET_ERROR_CODES.stateUnreadable,
      statusCode: 503,
    },
  );
}

export async function resolveAssetInsertTarget(
  args: AssetInsertTargetArgs,
): Promise<AssetInsertTarget> {
  const [navigation, selection] = await Promise.all([
    readState("navigation"),
    readState("design-selection"),
  ]);
  const navigationDesignId = stringFromState(navigation.value, "designId");
  const selectionDesignId = stringFromState(selection.value, "designId");
  const selectionOwnerId = stringFromState(selection.value, "ownerId");
  const selectionMatchesOwner =
    Boolean(args.ownerId) && selectionOwnerId === args.ownerId;
  const designId =
    args.designId ??
    (selectionMatchesOwner ? selectionDesignId : undefined) ??
    navigationDesignId;
  const stateUnreadable = !navigation.readable || !selection.readable;
  if (!designId && stateUnreadable) refuseUnreadableState();

  const canUseSelection =
    selectionMatchesOwner &&
    Boolean(designId) &&
    selectionDesignId === designId;
  const navigationActiveFileId =
    designId && navigationDesignId === designId
      ? stringFromState(navigation.value, "activeFileId")
      : undefined;
  return {
    designId,
    explicitFileIds: args.fileIds.filter(
      (id): id is string => typeof id === "string" && id !== "",
    ),
    stateFileId:
      (canUseSelection
        ? stringFromState(selection.value, "activeFileId")
        : undefined) ?? navigationActiveFileId,
    stateUnreadable,
  };
}

/**
 * A caller-supplied id that is not an HTML screen of this design is refused,
 * never replaced. With nothing supplied, the active screen from editor state
 * wins, then the first HTML screen. That last fallback is only a guess when
 * the editor state could not be read and the design has several screens.
 */
export function pickAssetInsertFile<T extends HtmlCandidate>(
  files: readonly T[],
  target: AssetInsertTarget,
): T | null {
  const htmlFiles = files.filter(isHtmlFile);
  if (target.explicitFileIds.length > 0) {
    for (const id of target.explicitFileIds) {
      const match = htmlFiles.find((file) => file.id === id);
      if (match) return match;
    }
    fail(
      `Screen not found or not an HTML screen in this design: ${target.explicitFileIds.join(", ")}. ` +
        "Pass the fileId of an HTML screen.",
      {
        errorCode: ASSET_INSERT_TARGET_ERROR_CODES.screenInvalid,
        statusCode: 404,
      },
    );
  }
  const active = htmlFiles.find((file) => file.id === target.stateFileId);
  if (active) return active;
  if (target.stateUnreadable && htmlFiles.length > 1) refuseUnreadableState();
  const first = htmlFiles.length > 0 ? htmlFiles[0] : undefined;
  return first ?? null;
}
