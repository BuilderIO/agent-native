import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

import type { Alias } from "../../shared/types.js";

export async function readAliases(email: string): Promise<Alias[]> {
  const data = await getUserSetting(email, "aliases");
  if (data && Array.isArray((data as { aliases?: unknown }).aliases)) {
    return (data as { aliases: Alias[] }).aliases;
  }
  return [];
}

export async function writeAliases(
  email: string,
  aliases: Alias[],
): Promise<void> {
  await putUserSetting(email, "aliases", { aliases });
}
