import {
  getBetterAuthInternalAdapter,
  getBetterAuthSync,
} from "../server/better-auth-instance.js";
import { getUserSetting, putUserSetting } from "../settings/user-settings.js";
import { isGoogleProfileImageUrl } from "../shared/google-profile-image.js";
import {
  normalizeUserProfileName,
  resolveUserProfileName,
  USER_PROFILE_SETTING_KEY,
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
  user: { name?: string | null; image?: string | null },
): UserProfile {
  const image = isGoogleProfileImageUrl(user.image)
    ? user.image.trim()
    : undefined;
  return {
    email,
    name: normalizeUserProfileName(user.name, email),
    ...(image ? { image } : {}),
  };
}

async function profileFromAuthUserWithStoredName(
  email: string,
  user: { name?: string | null; image?: string | null },
): Promise<UserProfile> {
  const profile = profileFromAuthUser(email, user);
  const storedResult = (
    await Promise.allSettled([getStoredUserProfile(email)])
  )[0];
  if (storedResult.status !== "fulfilled") return profile;

  return {
    ...profile,
    name: normalizeUserProfileName(
      resolveUserProfileName(email, storedResult.value.name, user.name),
      email,
    ),
  };
}

async function getStoredUserProfile(email: string): Promise<UserProfile> {
  const stored = await getUserSetting(email, USER_PROFILE_SETTING_KEY);
  const storedName = typeof stored?.name === "string" ? stored.name : null;
  const name = resolveUserProfileName(email, storedName);

  return {
    email,
    name: normalizeUserProfileName(name, email),
  };
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

  if (adapter?.listUsers) {
    try {
      const users = await adapter.listUsers(
        uniqueEmails.length,
        undefined,
        undefined,
        [
          {
            field: "email",
            operator: "in",
            value: uniqueEmails,
            mode: "insensitive",
          },
        ],
      );
      const userProfiles = await Promise.all(
        users.map(async (user) => {
          const email = user.email.trim().toLowerCase();
          return email
            ? ([
                email,
                await profileFromAuthUserWithStoredName(email, user),
              ] as const)
            : null;
        }),
      );
      for (const entry of userProfiles) {
        if (entry) profiles.set(...entry);
      }
      batchLookupSucceeded = true;
    } catch {
      // coercion-ok: older or custom adapters use the established per-user fallback.
      // Fall back to the single-profile path for older/custom adapters.
    }
  }

  const missingEmails = uniqueEmails.filter((email) => !profiles.has(email));
  const results = await Promise.allSettled(
    missingEmails.map(
      async (email) =>
        [
          email,
          batchLookupSucceeded
            ? await getStoredUserProfile(email)
            : await getUserProfile(email),
        ] as const,
    ),
  );
  for (const result of results) {
    if (result.status === "fulfilled") profiles.set(...result.value);
  }
  return profiles;
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
