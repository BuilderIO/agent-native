import {
  FeatureNotConfiguredError,
  getSession,
  startBuilderDesignSystemIndex,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

const MAX_FIG_BYTES = 200 * 1024 * 1024;

/**
 * Builder-indexing endpoint: accepts a `.fig` upload (multipart field `file`)
 * and starts Builder's design-system indexing pipeline. The app does not decode
 * Figma files locally; Builder owns extraction, generated docs, and the
 * asynchronous indexing job.
 */
export const importFigmaSystem = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch {
    setResponseStatus(event, 413);
    return { error: "Upload too large or malformed." };
  }
  const part = parts?.find(
    (p) => (p.name === "file" || p.name === "fig") && p.data,
  );
  if (!part) {
    setResponseStatus(event, 400);
    return {
      error: "No .fig file uploaded (expected multipart field 'file').",
    };
  }
  if (part.data.length > MAX_FIG_BYTES) {
    setResponseStatus(event, 413);
    return {
      error: `File too large (max ${Math.round(MAX_FIG_BYTES / 1024 / 1024)} MB).`,
    };
  }

  const suggestedTitle =
    (part.filename || "Imported brand")
      .replace(/\.fig$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Imported brand";

  try {
    return await startBuilderDesignSystemIndex({
      projectName: suggestedTitle,
      files: [
        {
          name: part.filename || "brand.fig",
          data: part.data,
          mimeType: "application/octet-stream",
        },
      ],
    });
  } catch (err) {
    if (err instanceof FeatureNotConfiguredError) {
      setResponseStatus(event, 412);
      return {
        error:
          err.message ||
          "Connect Builder.io before indexing a design system from Figma.",
        builderConnectUrl:
          err.builderConnectUrl ?? "/_agent-native/builder/connect",
      };
    }
    setResponseStatus(event, 502);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Builder design-system indexing failed.",
    };
  }
});
