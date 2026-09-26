import {
  getBetterAuthInternalAdapter,
  getBetterAuthSync,
} from "../server/better-auth-instance.js";
import {
  getUserSetting,
  getUserSettings,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { isGoogleProfileImageUrl } from "../shared/google-profile-image.js";
import {
  normalizeOnboardingRole,
  normalizeUserProfileName,
  resolveUserProfileName,
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

function profileFromAuthUser(
  email: string,
  user: {
    name?: string | null;
    image?: string | null;
    onboardingRole?: unknown;
  },
): UserProfile {
  const image = isGoogleProfileImageUrl(user.image)
    ? user.image.trim()
    : undefined;
  const onboardingRole = normalizeOnboardingRole(
    typeof user.onboardingRole === "string" ? user.onboardingRole : null,
  );
  return {
    email,
    name: normalizeUserProfileName(user.name, email),
    ...(image ? { image } : {}),
    onboardingRole,
  };
}

function storedProfileFrom(
  email: string,
  stored: Record<string, unknown> | null,
): UserProfile {
  const storedName = typeof stored?.name === "string" ? stored.name : null;
  const name = resolveUserProfileName(email, storedName);
  const onboardingRole = normalizeOnboardingRole(
    typeof stored?.onboardingRole === "string" ? stored.onboardingRole : null,
  );

  return {
    email,
    name: normalizeUserProfileName(name, email),
    onboardingRole,
  };
}

function profileFromAuthUserAndStoredProfile(
  email: string,
  user: {
    name?: string | null;
    image?: string | null;
    onboardingRole?: unknown;
  },
  storedProfile: UserProfile,
): UserProfile {
  const profile = profileFromAuthUser(email, user);
  return {
    ...profile,
    name: normalizeUserProfileName(
      resolveUserProfileName(email, storedProfile.name, user.name),
      email,
    ),
    onboardingRole:
      profile.onboardingRole ?? storedProfile.onboardingRole ?? null,
  };
}

async function profileFromAuthUserWithStoredName(
  email: string,
  user: {
    name?: string | null;
    image?: string | null;
    onboardingRole?: unknown;
  },
): Promise<UserProfile> {
  const profile = profileFromAuthUser(email, user);
  const storedResult = (
    await Promise.allSettled([getStoredUserProfile(email)])
  )[0];
  if (storedResult.status !== "fulfilled") return profile;

  return profileFromAuthUserAndStoredProfile(email, user, storedResult.value);
}

async function getStoredUserProfile(email: string): Promise<UserProfile> {
  const stored = await getUserSetting(email, USER_PROFILE_SETTING_KEY);
  return storedProfileFrom(email, stored);
}

let didWarnUserProfilesListUsersFailed = false;
let didWarnUserProfilesStoredNameBatchFailed = false;

async function updateFallbackUserProfile(
  email: string,
  updates: Record<string, unknown>,
): Promise<void> {
  await mutateUserSetting(email, USER_PROFILE_SETTING_KEY, (current) => ({
    ...(current ?? {}),
    ...updates,
  }));
}

export async function getUserProfile(email: string): Promise<UserProfile> {
  const authUser = await getAuthUser(email);
  if (authUser) return profileFromAuthUserWithStoredName(email, authUser.user);
  return getStoredUserProfile(email);
}

export async function getUserProfiles(
  emails: readonly string[],
): Promise<Map<string, UserProfile>> {
  const uniqueEmails = Array.from(
    new Set(
      emails
        .map((email) => email.trim())
        .filter(Boolean)
        .map((email) => email.toLowerCase()),
    ),
  );
  if (uniqueEmails.length === 0) return new Map();

  const adapter = getBetterAuthSync()
    ? await getBetterAuthInternalAdapter().catch(() => undefined)
    : undefined;
  const profiles = new Map<string, UserProfile>();
  let batchLookupSucceeded = false;
  let storedProfiles: Map<string, Record<string, unknown> | null> | null = null;

  if (adapter?.listUsers) {
    const [usersResult, storedResult] = await Promise.allSettled([
      adapter.listUsers(uniqueEmails.length, undefined, undefined, [
        {
          field: "email",
          operator: "in",
          value: uniqueEmails,
          mode: "insensitive",
        },
      ]),
      getUserSettings(uniqueEmails, USER_PROFILE_SETTING_KEY),
    ]);

    if (storedResult.status === "fulfilled") {
      storedProfiles = storedResult.value;
    } else if (!didWarnUserProfilesStoredNameBatchFailed) {
      didWarnUserProfilesStoredNameBatchFailed = true;
      console.warn(
        "[user-profile] batched stored-name read failed; degrading to auth-only names for this call",
        storedResult.reason,
      );
    }

    if (usersResult.status === "fulfilled") {
      batchLookupSucceeded = true;
      const rosterEntries = await Promise.all(
        usersResult.value.map(async (user) => {
          const email = user.email.trim().toLowerCase();
          if (!email) return null;
          const profile = storedProfiles
            ? profileFromAuthUserAndStoredProfile(
                email,
                user,
                storedProfileFrom(email, storedProfiles.get(email) ?? null),
              )
            : await profileFromAuthUserWithStoredName(email, user);
          return [email, profile] as const;
        }),
      );
      for (const entry of rosterEntries) {
        if (entry) profiles.set(...entry);
      }
    } else if (!didWarnUserProfilesListUsersFailed) {
      didWarnUserProfilesListUsersFailed = true;
      // coercion-ok: older or custom adapters use the established per-user
      console.warn(
        "[user-profile] batched listUsers failed; falling back to per-email lookups",
        usersResult.reason,
      );
    }
  }

  const missingEmails = uniqueEmails.filter((email) => !profiles.has(email));
  if (batchLookupSucceeded && storedProfiles) {
    for (const email of missingEmails) {
      profiles.set(
        email,
        storedProfileFrom(email, storedProfiles.get(email) ?? null),
      );
    }
  } else if (batchLookupSucceeded) {
    const results = await Promise.allSettled(
      missingEmails.map(
        async (email) => [email, await getStoredUserProfile(email)] as const,
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") profiles.set(...result.value);
    }
  } else {
    const results = await Promise.allSettled(
      missingEmails.map(
        async (email) => [email, await getUserProfile(email)] as const,
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") profiles.set(...result.value);
    }
  }
  return profiles;
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
    if (authUser?.user.id && adapter?.updateUser) {
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
    } else {
      await updateFallbackUserProfile(email, {
        name: normalizedName,
        onboardingRole: normalizedOnboardingRole,
      });
    }
    return {
      email,
      name: normalizedName,
      onboardingRole: normalizedOnboardingRole,
    };
  } else if (authUser?.user.id && adapter?.updateUser) {
    await adapter.updateUser(authUser.user.id, { name: normalizedName });
  } else {
    await updateFallbackUserProfile(email, {
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
    await updateFallbackUserProfile(email, {
      onboardingRole: normalizedOnboardingRole,
    });
    return normalizedOnboardingRole;
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
