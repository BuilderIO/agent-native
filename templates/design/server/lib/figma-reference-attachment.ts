import {
  attachmentFailureToError,
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
  const minted = await mintAttachmentRef({
    data: Buffer.from(JSON.stringify(payload), "utf8"),
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
