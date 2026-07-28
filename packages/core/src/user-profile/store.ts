import {
  getBetterAuthInternalAdapter,
  getBetterAuthSync,
} from "../server/better-auth-instance.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import {
  normalizeUserProfileName,
  USER_PROFILE_SETTING_KEY,
  type UserProfile,
} from "./shared.js";

async function getAuthUser(email: string) {
  if (!getBetterAuthSync()) return null;
  const adapter = await getBetterAuthInternalAdapter().catch(() => undefined);
  if (!adapter) return null;
  return adapter.findUserByEmail(email, { includeAccounts: false });
}

export async function getUserProfile(email: string): Promise<UserProfile> {
  const stored = await getUserSetting(email, USER_PROFILE_SETTING_KEY);
  const authUser = await getAuthUser(email);
  const authName = authUser?.user.name;
  const storedName = typeof stored?.name === "string" ? stored.name : null;

  return {
    email,
    name: normalizeUserProfileName(storedName ?? authName, email),
  };
}

export async function updateUserProfile(
  email: string,
  name: string,
): Promise<UserProfile> {
  const normalizedName = normalizeUserProfileName(name, email);
  const authUser = await getAuthUser(email);
  const adapter = authUser
    ? await getBetterAuthInternalAdapter().catch(() => undefined)
    : undefined;

  if (authUser?.user.id && adapter?.updateUser) {
    await adapter.updateUser(authUser.user.id, { name: normalizedName });
  } else {
    await putUserSetting(email, USER_PROFILE_SETTING_KEY, {
      name: normalizedName,
    });
  }

  return { email, name: normalizedName };
}
