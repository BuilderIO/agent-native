import { ActionContractError } from "@agent-native/core/action";
import { getSession } from "@agent-native/core/server";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import {
  DESIGN_SYSTEM_SOURCE_MAX_BYTES,
  storeDesignSystemSourceUpload,
} from "@agent-native/core/server/design-system-authoring";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  createError,
  defineEventHandler,
  getRequestHeader,
  readMultipartFormData,
  setResponseStatus,
} from "h3";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const contentLength = Number(getRequestHeader(event, "content-length"));
  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > DESIGN_SYSTEM_SOURCE_MAX_BYTES + 65536
  ) {
    throw createError({
      statusCode: 413,
      statusMessage: "Source upload exceeds the 20 MiB limit",
    });
  }
  const parts = await readMultipartFormData(event);
  const files = parts?.filter((part) => part.name === "file");
  if (files?.length !== 1 || !files[0].filename)
    throw createError({
      statusCode: 400,
      statusMessage: "Supply exactly one file part",
    });
  try {
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      async () => {
        await assertBuilderDsiAccess();
        return storeDesignSystemSourceUpload({
          name: files[0].filename!,
          data: files[0].data,
        });
      },
    );
  } catch (error) {
    if (!(error instanceof ActionContractError)) throw error;
    setResponseStatus(event, error.statusCode);
    return { error: error.message, errorCode: error.errorCode };
  }
});
