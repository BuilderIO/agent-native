import { defineAction } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getServerAppBasePath } from "../server/lib/public-agent-context.js";

function clipsOrigin(): string {
  const raw = getRequestContext()?.requestOrigin || process.env.APP_URL;
  if (!raw) {
    throw new Error(
      "Clips needs an HTTPS APP_URL before it can prepare CRM evidence links.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "Clips needs a valid HTTPS APP_URL before it can prepare CRM evidence links.",
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      "Clips needs an HTTPS APP_URL before it can prepare CRM evidence links.",
    );
  }
  return url.origin;
}

export default defineAction({
  description:
    "Prepare one access-gated Clips recording as bounded CRM call evidence. Returns only an opaque recording id, durable HTTPS recording page, and optional capture time; never media, a transcript, or a temporary access token.",
  schema: z.object({
    recordingId: z.string().trim().min(1).max(256),
  }),
  readOnly: true,
  run: async ({ recordingId }) => {
    const access = await assertAccess("recording", recordingId, "viewer");
    const recording = access.resource as {
      id: string;
      createdAt?: string | null;
      archivedAt?: string | null;
      trashedAt?: string | null;
    };
    if (recording.archivedAt || recording.trashedAt) {
      throw new Error("Archived or trashed Clips cannot be attached to CRM.");
    }
    const sourceUrl = `${clipsOrigin()}${getServerAppBasePath()}/r/${encodeURIComponent(recording.id)}`;
    return {
      sourceApp: "clips" as const,
      artifactType: "call-evidence" as const,
      artifactId: recording.id,
      sourceUrl,
      ...(recording.createdAt ? { capturedAt: recording.createdAt } : {}),
    };
  },
});
