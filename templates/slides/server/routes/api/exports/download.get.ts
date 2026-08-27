import { verifyShortLivedToken } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  collectExpiredExportArtifacts,
  readExportArtifactBytes,
} from "../../../lib/export-artifacts.js";

const ARTIFACT_ID_PATTERN = /^export-[A-Za-z0-9_-]{8,}$/;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const artifactId = typeof query.artifact === "string" ? query.artifact : "";
  const token = typeof query.token === "string" ? query.token : "";

  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const verification = verifyShortLivedToken(token, artifactId);
  if (!verification.ok) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  await collectExpiredExportArtifacts();
  const artifact = await readExportArtifactBytes(artifactId);
  if (!artifact) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  setResponseHeader(event, "cache-control", "no-store");
  setResponseHeader(event, "referrer-policy", "no-referrer");
  setResponseHeader(event, "x-content-type-options", "nosniff");
  setResponseHeader(event, "content-type", artifact.mimeType);
  setResponseHeader(
    event,
    "content-disposition",
    `attachment; filename="${artifact.filename}"`,
  );
  return artifact.data;
});
