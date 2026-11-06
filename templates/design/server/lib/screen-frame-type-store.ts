import { assertAccess } from "@agent-native/core/sharing";

import { parseDesignDataBlob } from "../../shared/full-app.js";
import {
  resolveScreenFrameType,
  storedScreenFrameType,
  withScreenFrameTypeLayout,
  withStoredScreenFrameType,
  type StoredScreenFrameType,
} from "../../shared/screen-frame-type.js";
import { mutateDesignData } from "./design-data-mutation.js";

/**
 * Stores a screen's frame type in `screenMetadata`. With `onlyIfAbsent` it is
 * the lazy backfill for legacy marker screens: it reads first so a screen that
 * already has a stored type costs no write.
 */
export async function persistScreenFrameType({
  designId,
  fileId,
  frameType,
  onlyIfAbsent = false,
}: {
  designId: string;
  fileId: string;
  frameType: StoredScreenFrameType;
  onlyIfAbsent?: boolean;
}): Promise<void> {
  const settled = (data: unknown) => {
    const stored = storedScreenFrameType(data, fileId);
    return onlyIfAbsent ? stored !== undefined : stored === frameType;
  };
  const access = await assertAccess("design", designId, "editor");
  if (settled(parseDesignDataBlob(access.resource.data))) return;
  await mutateDesignData({
    designId,
    mutate: (current) =>
      settled(current)
        ? current
        : withStoredScreenFrameType(current, fileId, frameType),
    isApplied: settled,
  });
}

/**
 * Applies an explicit frame type change, with the layout the new type implies.
 * `content` is the screen's HTML before the change, which decides the previous
 * type of a legacy screen with no stored type.
 */
export async function changeScreenFrameType({
  designId,
  fileId,
  frameType,
  content,
}: {
  designId: string;
  fileId: string;
  frameType: StoredScreenFrameType;
  content: string | null;
}): Promise<void> {
  const settled = (data: unknown) =>
    storedScreenFrameType(data, fileId) === frameType;
  const access = await assertAccess("design", designId, "editor");
  if (settled(parseDesignDataBlob(access.resource.data))) return;
  await mutateDesignData({
    designId,
    mutate: (current) =>
      settled(current)
        ? current
        : withScreenFrameTypeLayout(
            current,
            fileId,
            frameType,
            resolveScreenFrameType({ designData: current, fileId, content }),
          ),
    isApplied: settled,
  });
}
