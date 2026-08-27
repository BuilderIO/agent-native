import {
  getBetterAuthInternalAdapter,
  getBetterAuthSync,
} from "../server/better-auth-instance.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import {
  normalizeOnboardingRole,
  normalizeUserProfileName,
  USER_PROFILE_SETTING_KEY,
  type OnboardingRole,
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
  const authRole = normalizeOnboardingRole(
    typeof authUser?.user.onboardingRole === "string"
      ? authUser.user.onboardingRole
      : null,
  );
  const storedRole = normalizeOnboardingRole(
    typeof stored?.onboardingRole === "string" ? stored.onboardingRole : null,
  );

  return {
    email,
    name: normalizeUserProfileName(storedName ?? authName, email),
    onboardingRole: authRole ?? storedRole,
  };
}

export async function updateUserProfile(
  email: string,
  name: string,
  onboardingRole?: OnboardingRole | null,
): Promise<UserProfile> {
  const normalizedName = normalizeUserProfileName(name, email);
  const normalizedOnboardingRole =
    onboardingRole === undefined
      ? undefined
      : normalizeOnboardingRole(onboardingRole);
  const authUser = await getAuthUser(email);
  const adapter = authUser
    ? await getBetterAuthInternalAdapter().catch(() => undefined)
    : undefined;

  if (normalizedOnboardingRole !== undefined) {
    if (!authUser?.user.id || !adapter?.updateUser) {
      throw new Error(
        "Cannot save onboarding role because the Better Auth user row is unavailable.",
      );
    }
    await adapter.updateUser(authUser.user.id, {
      name: normalizedName,
      onboardingRole: normalizedOnboardingRole,
    });
    const saved = await getAuthUser(email);
    const savedRole = normalizeOnboardingRole(
      typeof saved?.user.onboardingRole === "string"
        ? saved.user.onboardingRole
        : null,
    );
    if (savedRole !== normalizedOnboardingRole) {
      throw new Error(
        "Failed to save onboarding role on the Better Auth user row.",
      );
    }
    return {
      email,
      name: normalizedName,
      onboardingRole: normalizedOnboardingRole,
    };
  } else if (authUser?.user.id && adapter?.updateUser) {
    await adapter.updateUser(authUser.user.id, { name: normalizedName });
  } else {
    await putUserSetting(email, USER_PROFILE_SETTING_KEY, {
      name: normalizedName,
    });
  }

  const profile = await getUserProfile(email);
  return { ...profile, name: normalizedName };
}

export async function updateUserOnboardingRole(
  email: string,
  onboardingRole: OnboardingRole,
): Promise<OnboardingRole> {
  const normalizedOnboardingRole = normalizeOnboardingRole(onboardingRole);
  if (!normalizedOnboardingRole) {
    throw new Error("Cannot save an empty onboarding role.");
  }

  const authUser = await getAuthUser(email);
  const adapter = authUser
    ? await getBetterAuthInternalAdapter().catch(() => undefined)
    : undefined;
  if (!authUser?.user.id || !adapter?.updateUser) {
    throw new Error(
      "Cannot save onboarding role because the Better Auth user row is unavailable.",
    );
  }

  await adapter.updateUser(authUser.user.id, {
    onboardingRole: normalizedOnboardingRole,
  });
  const saved = await getAuthUser(email);
  const savedRole = normalizeOnboardingRole(
    typeof saved?.user.onboardingRole === "string"
      ? saved.user.onboardingRole
      : null,
  );
  if (savedRole !== normalizedOnboardingRole) {
    throw new Error(
      "Failed to save onboarding role on the Better Auth user row.",
    );
  }
  return normalizedOnboardingRole;
}
