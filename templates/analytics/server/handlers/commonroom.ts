import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireEnvKey } from "@agent-native/core/server";
import { getMemberByEmail, getMembers } from "../lib/commonroom";

export const handleCommonRoomMembers = defineEventHandler(async (event) => {
  const missing = requireEnvKey(event, "COMMONROOM_API_KEY", "Common Room");
  if (missing) return missing;
  try {
    const { email, query, limit: limitParam } = getQuery(event);
    if (email) {
      const member = await getMemberByEmail(email as string);
      return { member };
    } else {
      const result = await getMembers({
        query: query as string | undefined,
        limit: limitParam ? parseInt(limitParam as string) : 25,
      });
      return { members: result.items, total: result.items?.length ?? 0 };
    }
  } catch (err: any) {
    console.error("Common Room members error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
