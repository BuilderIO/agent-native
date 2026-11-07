import { HUBSPOT_EMAIL_FRAME_TYPE } from "../../shared/hubspot-email.js";
import { persistScreenFrameType } from "./screen-frame-type-store.js";

/**
 * Thrown by a source writer, before it writes anything, when it finds the
 * legacy email marker on a screen whose type is not stored yet.
 */
export class LegacyEmailFrameTypeNotStoredError extends Error {
  constructor(readonly fileId: string) {
    super(
      `Screen "${fileId}" has a legacy HubSpot email marker and no stored frame type.`,
    );
    this.name = "LegacyEmailFrameTypeNotStoredError";
  }
}

function backfillLegacyEmailFrameType(args: {
  designId: string;
  fileId: string;
}): Promise<void> {
  return persistScreenFrameType({
    ...args,
    frameType: HUBSPOT_EMAIL_FRAME_TYPE,
    onlyIfAbsent: true,
  });
}

/**
 * Runs a source write so every legacy email screen it touches has its type
 * stored before the write commits. An edit that removes the marker leaves
 * nothing to recover the type from, so storing it afterwards could lose it.
 * `markedFileIds` are the screens whose loaded content has the marker; a
 * marker found only in live content makes `write` throw
 * LegacyEmailFrameTypeNotStoredError, and the write runs again once it is
 * stored.
 */
export async function writeWithLegacyEmailFrameTypes<T>({
  designId,
  markedFileIds,
  write,
}: {
  designId: string;
  markedFileIds: Iterable<string>;
  write: (storedFileIds: ReadonlySet<string>) => Promise<T>;
}): Promise<T> {
  const stored = new Set<string>();
  for (const fileId of markedFileIds) {
    await backfillLegacyEmailFrameType({ designId, fileId });
    stored.add(fileId);
  }
  for (;;) {
    try {
      return await write(stored);
    } catch (error) {
      if (
        !(error instanceof LegacyEmailFrameTypeNotStoredError) ||
        stored.has(error.fileId)
      ) {
        throw error;
      }
      await backfillLegacyEmailFrameType({ designId, fileId: error.fileId });
      stored.add(error.fileId);
    }
  }
}
