import { assertAccess } from "@agent-native/core/sharing";

import { parseDesignDataBlob } from "../../shared/full-app.js";
import { HUBSPOT_EMAIL_FRAME_TYPE } from "../../shared/hubspot-email.js";
import {
  storedScreenFrameType,
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
 * Stores "hubspot-email" for a legacy marker screen that has no stored type.
 * Source writers call it before writing when the content they loaded has the
 * marker: an edit that removes the marker leaves nothing to recover the type
 * from, so the type must be stored before the edit commits.
 */
export function backfillLegacyEmailFrameType(args: {
  designId: string;
  fileId: string;
}): Promise<void> {
  return persistScreenFrameType({
    ...args,
    frameType: HUBSPOT_EMAIL_FRAME_TYPE,
    onlyIfAbsent: true,
  });
}
