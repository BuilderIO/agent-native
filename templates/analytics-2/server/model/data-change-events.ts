import { AsyncLocalStorage } from "node:async_hooks";

import {
  getSettingsEmitter,
  publishUserSettingChange,
} from "@agent-native/core/settings";

type Changes = {
  org: Set<string>;
  user: Map<string, { email: string; key: string }>;
};
const pending = new AsyncLocalStorage<Changes>();

export function noteOrgDataChange(orgId: string, key: string): void {
  pending.getStore()?.org.add(`o:${orgId}:${key}`);
}
export function noteUserDataChange(email: string, key: string): void {
  pending
    .getStore()
    ?.user.set(`${email.trim().toLowerCase()}:${key}`, { email, key });
}

/** Publish only after the outer app transaction succeeds, once per exact key. */
export async function afterDataCommit<T>(run: () => Promise<T>): Promise<T> {
  if (pending.getStore()) return run();
  const changes: Changes = { org: new Set(), user: new Map() };
  const result = await pending.run(changes, run);
  for (const key of changes.org) {
    // Observer failure cannot turn an already committed save into a rollback.
    try {
      getSettingsEmitter().emit("settings", {
        source: "settings",
        type: "change",
        key,
      });
    } catch {}
  }
  for (const { email, key } of changes.user.values()) {
    try {
      publishUserSettingChange(email, key);
    } catch {}
  }
  return result;
}
