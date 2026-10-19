import { SLIDES_2_APP_ID } from "./app-state-tabs";

const APP_STORAGE_PREFIX = `${SLIDES_2_APP_ID}:`;

export function appStorageKey(key: string): string {
  return key.startsWith(APP_STORAGE_PREFIX)
    ? key
    : `${APP_STORAGE_PREFIX}${key}`;
}
