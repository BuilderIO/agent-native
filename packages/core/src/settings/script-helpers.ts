import { getRequestContext } from "../server/request-context.js";
import {
  getSetting,
  putSetting,
  deleteSetting,
  type StoreWriteOptions,
  SettingsEventScopeError,
} from "./store.js";

function scriptSettingsScope(options?: StoreWriteOptions): StoreWriteOptions {
  if (options) return options;
  const owner = getRequestContext()?.userEmail;
  if (!owner) throw new SettingsEventScopeError();
  return { owner };
}

export async function readSetting(
  key: string,
): Promise<Record<string, unknown> | null> {
  return getSetting(key);
}

export async function writeSetting(
  key: string,
  value: Record<string, unknown>,
  options?: StoreWriteOptions,
): Promise<void> {
  return putSetting(key, value, scriptSettingsScope(options));
}

export async function removeSetting(
  key: string,
  options?: StoreWriteOptions,
): Promise<boolean> {
  return deleteSetting(key, scriptSettingsScope(options));
}
