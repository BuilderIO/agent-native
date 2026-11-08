import { callAction } from "@agent-native/core/client/hooks";
import { composerSourceReferenceSchema } from "@agent-native/core/shared";

import { parseGoogleSlidesReferenceUrl } from "../../shared/google-docs";

export async function readGoogleSlidesContext(
  url: string,
  failureMessage: string,
  signal?: AbortSignal,
) {
  const reference = parseGoogleSlidesReferenceUrl(url);
  if (!reference) throw new Error(failureMessage);
  const parsed = composerSourceReferenceSchema.safeParse(
    await callAction(
      "read-google-slides-context",
      { presentationUrl: reference.url },
      { method: "GET", ...(signal ? { signal } : {}) },
    ),
  );
  if (!parsed.success || parsed.data.id !== reference.id)
    throw new Error(failureMessage);
  return { ...parsed.data, url: reference.url };
}
