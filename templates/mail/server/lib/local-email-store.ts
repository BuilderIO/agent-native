import {
  getUserSetting,
  putUserSetting,
  type StoreWriteOptions,
} from "@agent-native/core/settings";
import type { EmailMessage } from "@shared/types.js";

const localEmailMutationLocks = new Map<string, Promise<unknown>>();

/**
 * Serialize read-modify-write operations on an owner's synthetic mailbox.
 * Local mail is one JSON document, so every writer must participate to avoid
 * replacing a concurrent writer's newer snapshot.
 */
export function withLocalEmailMutationLock<T>(
  ownerEmail: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const key = ownerEmail.toLowerCase();
  const previous = localEmailMutationLocks.get(key) ?? Promise.resolve();
  const next = previous.then(mutate, mutate);
  localEmailMutationLocks.set(key, next);
  const cleanup = () => {
    if (localEmailMutationLocks.get(key) === next) {
      localEmailMutationLocks.delete(key);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

export async function readLocalEmails(
  ownerEmail: string,
): Promise<EmailMessage[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails as EmailMessage[];
  }
  return [];
}

export async function writeLocalEmails(
  ownerEmail: string,
  emails: EmailMessage[],
  options?: StoreWriteOptions,
): Promise<void> {
  await putUserSetting(ownerEmail, "local-emails", { emails }, options);
}
