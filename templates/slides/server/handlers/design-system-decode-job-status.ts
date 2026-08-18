import {
  FeatureNotConfiguredError,
  fetchBuilderDesignSystemDecodeJobStatus,
  getSession,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { withSlidesRequestContext } from "./request-auth-context.js";

/**
 * Reads a Builder design-system decode job's status. The UI polls this after
 * `/api/index-design-system-sources` returns a jobId, until the `.fig` decode
 * job leaves `pending` and exposes a `branchUrl` (or reports an `error`).
 */
export const designSystemDecodeJobStatus = defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const jobId = getQuery(event).jobId;
  if (typeof jobId !== "string" || !jobId.trim()) {
    setResponseStatus(event, 400);
    return { error: "jobId is required." };
  }

  try {
    return await withSlidesRequestContext(event, () =>
      fetchBuilderDesignSystemDecodeJobStatus(jobId.trim()),
    );
  } catch (err) {
    if (err instanceof FeatureNotConfiguredError) {
      setResponseStatus(event, 412);
      return {
        error: err.message,
        builderConnectUrl:
          err.builderConnectUrl ?? "/_agent-native/builder/connect",
      };
    }
    setResponseStatus(event, 502);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to read decode job status.",
    };
  }
});
