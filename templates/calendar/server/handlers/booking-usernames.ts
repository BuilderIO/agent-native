import { and, eq, gte } from "drizzle-orm";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import type { AvailabilityConfig } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const USERNAME_CHANGE_LIMIT = 3;
const USERNAME_CHANGE_WINDOW_DAYS = 30;
const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "app",
  "book",
  "booking",
  "bookings",
  "calendar",
  "login",
  "meet",
  "settings",
  "sign-in",
  "sign-up",
  "signup",
  "support",
  "www",
]);

export function normalizeBookingUsername(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, USERNAME_MAX_LENGTH)
    .replace(/-$/g, "");
}

export function validateBookingUsername(input: string): string {
  const username = normalizeBookingUsername(input);
  if (username.length < USERNAME_MIN_LENGTH) {
    throw new Error("Booking username must be at least 3 characters");
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw new Error("That booking username is reserved");
  }
  return username;
}

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0] || "user";
  const normalized = normalizeBookingUsername(local);
  if (normalized.length >= USERNAME_MIN_LENGTH) return normalized;
  return `user-${normalized || "booking"}`.slice(0, USERNAME_MAX_LENGTH);
}

async function findUsernameOwner(username: string): Promise<string | null> {
  const row = await getDb()
    .select({ ownerEmail: schema.bookingUsernames.ownerEmail })
    .from(schema.bookingUsernames)
    .where(eq(schema.bookingUsernames.username, username))
    .then((rows) => rows[0]);
  return row?.ownerEmail ?? null;
}

async function chooseAvailableUsername(
  base: string,
  ownerEmail: string,
): Promise<string> {
  const root = validateBookingUsername(base);
  const owner = await findUsernameOwner(root);
  if (!owner || owner === ownerEmail) return root;

  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${root.slice(
      0,
      USERNAME_MAX_LENGTH - suffix.length,
    )}${suffix}`;
    const candidateOwner = await findUsernameOwner(candidate);
    if (!candidateOwner || candidateOwner === ownerEmail) return candidate;
  }

  throw new Error("Could not find an available booking username");
}

async function getReservedUsername(ownerEmail: string): Promise<string | null> {
  const row = await getDb()
    .select({ username: schema.bookingUsernames.username })
    .from(schema.bookingUsernames)
    .where(eq(schema.bookingUsernames.ownerEmail, ownerEmail))
    .then((rows) => rows[0]);
  return row?.username ?? null;
}

async function getStoredAvailability(
  ownerEmail: string,
): Promise<AvailabilityConfig | null> {
  return (await getUserSetting(
    ownerEmail,
    "calendar-availability",
  )) as unknown as AvailabilityConfig | null;
}

async function syncAvailabilityUsername(
  ownerEmail: string,
  username: string,
): Promise<void> {
  const config = await getStoredAvailability(ownerEmail);
  if (!config || config.bookingUsername === username) return;
  await putUserSetting(ownerEmail, "calendar-availability", {
    ...(config as unknown as Record<string, unknown>),
    bookingUsername: username,
  });
}

export async function ensureBookingUsername(
  ownerEmail: string,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getReservedUsername(ownerEmail);
    if (existing) {
      await syncAvailabilityUsername(ownerEmail, existing);
      return existing;
    }

    const stored = await getStoredAvailability(ownerEmail);
    const preferred = stored?.bookingUsername || usernameFromEmail(ownerEmail);
    const username = await chooseAvailableUsername(preferred, ownerEmail);
    const now = new Date().toISOString();

    try {
      await getDb().insert(schema.bookingUsernames).values({
        username,
        ownerEmail,
        createdAt: now,
        updatedAt: now,
      });
      await syncAvailabilityUsername(ownerEmail, username);
      return username;
    } catch (error) {
      const existingAfterRace = await getReservedUsername(ownerEmail);
      if (existingAfterRace) {
        await syncAvailabilityUsername(ownerEmail, existingAfterRace);
        return existingAfterRace;
      }
      if (attempt === 2) throw error;
    }
  }

  throw new Error("Could not reserve a booking username");
}

export async function getBookingUsername(
  ownerEmail: string,
): Promise<string | null> {
  return getReservedUsername(ownerEmail);
}

export async function updateBookingUsername(
  ownerEmail: string,
  desiredUsername: string,
): Promise<string> {
  const username = validateBookingUsername(desiredUsername);
  const current = await getReservedUsername(ownerEmail);
  if (current === username) {
    await syncAvailabilityUsername(ownerEmail, username);
    return username;
  }

  const owner = await findUsernameOwner(username);
  if (owner && owner !== ownerEmail) {
    throw new Error("That booking username is already taken");
  }

  if (current) {
    const cutoff = new Date(
      Date.now() - USERNAME_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recentChanges = await getDb()
      .select({ id: schema.bookingUsernameChanges.id })
      .from(schema.bookingUsernameChanges)
      .where(
        and(
          eq(schema.bookingUsernameChanges.ownerEmail, ownerEmail),
          gte(schema.bookingUsernameChanges.createdAt, cutoff),
        ),
      );
    if (recentChanges.length >= USERNAME_CHANGE_LIMIT) {
      throw new Error(
        `Booking username can only be changed ${USERNAME_CHANGE_LIMIT} times every ${USERNAME_CHANGE_WINDOW_DAYS} days`,
      );
    }
  }

  const now = new Date().toISOString();
  await getDb().transaction(async (tx) => {
    if (current) {
      await tx
        .update(schema.bookingUsernames)
        .set({ username, updatedAt: now })
        .where(eq(schema.bookingUsernames.ownerEmail, ownerEmail));
    } else {
      await tx.insert(schema.bookingUsernames).values({
        username,
        ownerEmail,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx.insert(schema.bookingUsernameChanges).values({
      id: crypto.randomUUID(),
      ownerEmail,
      oldUsername: current,
      newUsername: username,
      createdAt: now,
    });
  });

  await syncAvailabilityUsername(ownerEmail, username);
  return username;
}
