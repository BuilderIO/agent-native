import { defineEventHandler } from "h3";
import { readBody } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const email = session.email;
  const body = (await readBody(event)) as { engine?: string; model?: string };

  const existing =
    ((await getUserSetting(email, "automation-settings")) as any) || {};
  const updated = {
    ...existing,
    ...(body.engine ? { engine: body.engine } : {}),
    ...(body.model ? { model: body.model } : {}),
  };
  await putUserSetting(email, "automation-settings", updated as any);

  return { success: true, engine: updated.engine, model: updated.model };
});
