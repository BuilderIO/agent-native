import {
  builderDesignSystemUrl,
  builderProjectBranchUrl,
  fetchBuilderDesignSystemRecord,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

export const designSystemBuilderLink = defineEventHandler(async (event) => {
  // coercion-ok: an errored session lookup is treated as "no session" and
  // rejected below with 401, not silently accepted.
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const id = getQuery(event).id;
  if (typeof id !== "string" || !id.trim()) {
    setResponseStatus(event, 400);
    return { error: "id is required." };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const access = await resolveAccess("design-system", id);
      if (!access) {
        setResponseStatus(event, 404);
        return { error: "Design system not found" };
      }

      let parsed: Record<string, unknown>;
      try {
        const json = JSON.parse(access.resource.data);
        if (!json || typeof json !== "object" || Array.isArray(json)) {
          throw new Error();
        }
        parsed = json as Record<string, unknown>;
      } catch {
        setResponseStatus(event, 502);
        return { error: "Design system data is invalid" };
      }

      if (parsed.source !== "builder") {
        setResponseStatus(event, 400);
        return { error: "This design system is not Builder-backed." };
      }
      const builderDesignSystemId = parsed.builderDesignSystemId;
      if (typeof builderDesignSystemId !== "string") {
        setResponseStatus(event, 502);
        return { error: "Missing Builder design system id." };
      }

      const cachedProjectId =
        typeof parsed.builderProjectId === "string"
          ? parsed.builderProjectId
          : undefined;
      const record = await fetchBuilderDesignSystemRecord(
        builderDesignSystemId,
      );
      const builderUrl =
        builderProjectBranchUrl(
          record?.projectId ?? cachedProjectId,
          record?.branchName,
        ) ?? builderDesignSystemUrl(builderDesignSystemId);

      return { builderUrl };
    },
  );
});
