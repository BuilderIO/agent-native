import {
  attachmentFailureToError,
  deleteAttachment,
  mintAttachmentRef,
  resolveAttachment,
  unwrapAttachment,
} from "@agent-native/core/private-blob";

import {
  figmaReferencePayloadSchema,
  type FigmaReferencePayload,
} from "../../shared/figma-reference.js";

/**
 * Decoded frames are stored once as an attachment so the agent can place them
 * by ref; retyping tens of kilobytes of HTML through a model truncates it.
 */
export async function mintFigmaReference(
  payload: FigmaReferencePayload,
  ownerEmail: string,
): Promise<string> {
  // Every minting path (clipboard and .fig) is held to the same bounds.
  const bounded = figmaReferencePayloadSchema.parse(payload);
  const minted = await mintAttachmentRef({
    data: Buffer.from(JSON.stringify(bounded), "utf8"),
    filename: "figma-reference.json",
    mimeType: "application/json",
    ownerEmail,
    metadata: { resourceType: "figma-reference", appId: "design" },
  });
  if (minted.status !== "ok") throw attachmentFailureToError(minted, "save");
  return minted.ref;
}

export async function openFigmaReference(
  ref: string,
  ownerEmail: string,
): Promise<FigmaReferencePayload> {
  const file = unwrapAttachment(await resolveAttachment(ref, { ownerEmail }));
  return figmaReferencePayloadSchema.parse(
    JSON.parse(Buffer.from(file.data).toString("utf8")),
  );
}

/** Deletes an attachment the user dropped from the prompt before sending it. */
export async function discardFigmaReference(
  ref: string,
  ownerEmail: string,
): Promise<boolean> {
  const result = await deleteAttachment(ref, { ownerEmail });
  if (result.status !== "ok") throw attachmentFailureToError(result);
  return result.deleted;
}
