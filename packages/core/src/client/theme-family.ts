import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getThemeFamilyUrlOverride,
  isThemeFamily,
  resolveThemeFamilyConfig,
  THEME_FAMILY_ATTRIBUTE,
  THEME_FAMILY_STATUS_ATTRIBUTE,
  themeFamilyAppStateKey,
  themeFamilyStorageKey,
  type ThemeFamily,
} from "../appearance/theme-family.js";
import {
  injectedAgentNativeAppId,
  injectedAgentNativeConfig,
} from "./app-config.js";
import { readClientAppState } from "./application-state.js";
import { useActionMutation, useActionQuery } from "./use-action.js";
import { useChangeVersion } from "./use-change-version.js";

export {
  DEFAULT_THEME_FAMILY,
  isThemeFamily,
  THEME_FAMILY_APP_STATE_KEY,
  THEME_FAMILY_ATTRIBUTE,
  THEME_FAMILY_STORAGE_KEY,
  themeFamilyAppStateKey,
  themeFamilyStorageKey,
  type ThemeFamily,
} from "../appearance/theme-family.js";

export const THEME_FAMILY_CHANGE_EVENT = "agent-native:theme-family-change";

export type ThemeFamilyStorageStatus =
  | "valid"
  | "missing"
  | "invalid"
  | "unreadable";

export type StoredThemeFamily =
  | { status: "valid"; family: ThemeFamily }
  | { status: "missing" }
  | { status: "invalid"; value: string }
  | { status: "unreadable"; error: Error };

export interface ThemeFamilyApplyResult {
  family: ThemeFamily;
  storageStatus: "saved" | "unavailable";
}

export interface ThemeFamilyPreference {
  family: ThemeFamily;
  source: "default" | "user-setting";
  appId: string | null;
}

const familySnapshots = new Map<string, ThemeFamily>();

function resolvedAppId(appId?: string | null): string | undefined {
  if (appId !== undefined) return appId ?? undefined;
  return injectedAgentNativeAppId() ?? undefined;
}

function scopeKey(appId?: string | null): string {
  return themeFamilyStorageKey(resolvedAppId(appId));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function readStoredThemeFamily(
  appId?: string | null,
): StoredThemeFamily {
  if (typeof window === "undefined") return { status: "missing" };

  let value: string | null;
  try {
    value = window.localStorage.getItem(
      themeFamilyStorageKey(resolvedAppId(appId)),
    );
  } catch (error) {
    return { status: "unreadable", error: asError(error) };
  }

  if (value === null) return { status: "missing" };
  if (isThemeFamily(value)) return { status: "valid", family: value };
  return { status: "invalid", value };
}

function getFamilySnapshot(
  appId: string | null | undefined,
  families: readonly ThemeFamily[],
  defaultFamily: ThemeFamily,
): ThemeFamily {
  const family = familySnapshots.get(scopeKey(appId));
  return family && families.includes(family) ? family : defaultFamily;
}

function subscribe(
  onChange: () => void,
  appId: string | null | undefined,
  families: readonly ThemeFamily[],
  defaultFamily: ThemeFamily,
  forcedFamily: ThemeFamily | null,
): () => void {
  if (typeof window === "undefined" || forcedFamily) return () => {};

  const refreshFromStorage = () => {
    const stored = readStoredThemeFamily(appId);
    const key = scopeKey(appId);
    if (stored.status === "valid" && families.includes(stored.family)) {
      familySnapshots.set(key, stored.family);
      window.document.documentElement.setAttribute(
        THEME_FAMILY_ATTRIBUTE,
        stored.family,
      );
      window.document.documentElement.removeAttribute(
        THEME_FAMILY_STATUS_ATTRIBUTE,
      );
    } else {
      familySnapshots.set(key, defaultFamily);
      window.document.documentElement.setAttribute(
        THEME_FAMILY_ATTRIBUTE,
        defaultFamily,
      );
      if (stored.status === "invalid") {
        window.document.documentElement.setAttribute(
          THEME_FAMILY_STATUS_ATTRIBUTE,
          "invalid",
        );
      } else {
        window.document.documentElement.removeAttribute(
          THEME_FAMILY_STATUS_ATTRIBUTE,
        );
      }
    }
    onChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === scopeKey(appId)) {
      refreshFromStorage();
    }
  };
  const onFamilyChange = (event: Event) => {
    const storageKey = (event as CustomEvent<{ storageKey?: unknown }>).detail
      ?.storageKey;
    if (storageKey === scopeKey(appId)) refreshFromStorage();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_FAMILY_CHANGE_EVENT, onFamilyChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_FAMILY_CHANGE_EVENT, onFamilyChange);
  };
}

export function applyThemeFamily(
  family: ThemeFamily,
  appId?: string | null,
): ThemeFamilyApplyResult {
  if (!isThemeFamily(family)) {
    throw new TypeError(`Unknown theme family: ${String(family)}`);
  }

  const storageAppId = resolvedAppId(appId);
  const key = themeFamilyStorageKey(storageAppId);
  familySnapshots.set(key, family);
  if (typeof window === "undefined") {
    return { family, storageStatus: "unavailable" };
  }

  const root = window.document.documentElement;
  root.setAttribute(THEME_FAMILY_ATTRIBUTE, family);
  try {
    window.localStorage.setItem(key, family);
    root.removeAttribute(THEME_FAMILY_STATUS_ATTRIBUTE);
    window.dispatchEvent(
      new CustomEvent(THEME_FAMILY_CHANGE_EVENT, {
        detail: { storageKey: key },
      }),
    );
    return { family, storageStatus: "saved" };
  } catch {
    root.setAttribute(THEME_FAMILY_STATUS_ATTRIBUTE, "unreadable");
    window.dispatchEvent(
      new CustomEvent(THEME_FAMILY_CHANGE_EVENT, {
        detail: { storageKey: key },
      }),
    );
    return { family, storageStatus: "unavailable" };
  }
}

function storageStatusForApply(
  result: ThemeFamilyApplyResult,
): ThemeFamilyStorageStatus {
  return result.storageStatus === "saved" ? "valid" : "unreadable";
}

function errorForState(value: unknown): Error {
  return new Error(
    `The open app's theme-family state is invalid: ${JSON.stringify(value)}`,
  );
}

export interface ThemeFamilyHook {
  family: ThemeFamily;
  status: "loading" | "success" | "error";
  error?: Error;
  storageStatus: ThemeFamilyStorageStatus;
  isForcedByUrl: boolean;
  setFamily: (family: ThemeFamily) => Promise<ThemeFamily>;
}

type SetThemeFamilyInput = { family: ThemeFamily };
type SetThemeFamilyResult = { family: ThemeFamily; appId: string | null };

export function useThemeFamily(): ThemeFamilyHook {
  const runtimeAppId = injectedAgentNativeAppId();
  const configuredThemeFamily = injectedAgentNativeConfig().themeFamily;
  const { families, defaultFamily } = useMemo(
    () => resolveThemeFamilyConfig(configuredThemeFamily),
    [configuredThemeFamily],
  );
  const urlOverride =
    typeof window === "undefined"
      ? null
      : getThemeFamilyUrlOverride(window.location.search, families);
  const query = useActionQuery<ThemeFamilyPreference>(
    "get-theme-family" as never,
    undefined,
    { retry: false, queryKeyScope: ["theme-family", runtimeAppId] },
  );
  const mutation = useActionMutation<SetThemeFamilyResult, SetThemeFamilyInput>(
    "set-theme-family" as never,
    { skipActionQueryInvalidation: true },
  );
  const appId = query.data === undefined ? runtimeAppId : query.data.appId;
  const appStateKey = themeFamilyAppStateKey(appId ?? undefined);
  const appStateVersion = useChangeVersion(`app-state:${appStateKey}`);
  const [storageStatus, setStorageStatus] = useState<ThemeFamilyStorageStatus>(
    () => readStoredThemeFamily(appId).status,
  );
  const [mutationError, setMutationError] = useState<Error>();
  const mutationPending = useRef(false);
  const family = useSyncExternalStore(
    (onChange) =>
      subscribe(onChange, appId, families, defaultFamily, urlOverride),
    () => urlOverride ?? getFamilySnapshot(appId, families, defaultFamily),
    () => defaultFamily,
  );

  useEffect(() => {
    if (urlOverride) {
      window.document.documentElement.setAttribute(
        THEME_FAMILY_ATTRIBUTE,
        urlOverride,
      );
      window.document.documentElement.removeAttribute(
        THEME_FAMILY_STATUS_ATTRIBUTE,
      );
      setMutationError(undefined);
      return;
    }
    if (mutationPending.current) return;
    if (query.data === undefined) return;
    if (!isThemeFamily(query.data?.family)) {
      setMutationError(errorForState(query.data));
      return;
    }
    const persistedFamily =
      query.data.source === "default" ? defaultFamily : query.data.family;
    const selectedFamily =
      isThemeFamily(persistedFamily) && families.includes(persistedFamily)
        ? persistedFamily
        : defaultFamily;
    const applied = applyThemeFamily(selectedFamily, query.data.appId);
    setStorageStatus(storageStatusForApply(applied));
    setMutationError(undefined);
  }, [defaultFamily, families, mutationPending, query.data, urlOverride]);

  useEffect(() => {
    if (urlOverride || appStateVersion === 0) return;
    let current = true;
    void readClientAppState<{ family?: unknown }>(appStateKey)
      .then((state) => {
        if (!current || state === null) return;
        if (!isThemeFamily(state.family)) {
          setMutationError(errorForState(state));
          return;
        }
        const selectedFamily = families.includes(state.family)
          ? state.family
          : defaultFamily;
        const applied = applyThemeFamily(selectedFamily, appId);
        setStorageStatus(storageStatusForApply(applied));
        setMutationError(undefined);
      })
      .catch((error: unknown) => {
        if (current) setMutationError(asError(error));
      });
    return () => {
      current = false;
    };
  }, [
    appId,
    appStateKey,
    appStateVersion,
    defaultFamily,
    families,
    urlOverride,
  ]);

  const setFamily = useCallback(
    async (nextFamily: ThemeFamily): Promise<ThemeFamily> => {
      if (urlOverride) {
        throw new Error("The theme family is pinned by the URL parameter.");
      }
      if (!isThemeFamily(nextFamily)) {
        throw new TypeError(`Unknown theme family: ${String(nextFamily)}`);
      }
      if (!families.includes(nextFamily)) {
        throw new TypeError(
          `Theme family is not enabled for this app: ${nextFamily}`,
        );
      }

      const previousAppId = appId;
      const previousFamily = getFamilySnapshot(
        previousAppId,
        families,
        defaultFamily,
      );
      mutationPending.current = true;
      const optimistic = applyThemeFamily(nextFamily, previousAppId);
      setStorageStatus(storageStatusForApply(optimistic));
      setMutationError(undefined);
      try {
        const result = await mutation.mutateAsync({ family: nextFamily });
        if (
          !isThemeFamily(result?.family) ||
          !families.includes(result.family)
        ) {
          throw errorForState(result);
        }
        if (result.appId !== null && typeof result.appId !== "string") {
          throw errorForState(result);
        }
        if (result.family !== nextFamily) {
          throw new Error(
            "The saved theme family did not match the selection.",
          );
        }
        mutationPending.current = false;
        const applied = applyThemeFamily(result.family, result.appId);
        setStorageStatus(storageStatusForApply(applied));
        return result.family;
      } catch (error) {
        const normalized = asError(error);
        let reconciledFamily = previousFamily;
        let reconciledAppId = previousAppId;
        let reconciliationError: Error | undefined;
        try {
          const refreshed = await query.refetch();
          const data = refreshed.data;
          if (refreshed.isError) {
            reconciliationError = asError(refreshed.error);
          } else if (
            !data ||
            !isThemeFamily(data.family) ||
            (data.appId !== null && typeof data.appId !== "string")
          ) {
            reconciliationError = errorForState(data);
          } else {
            reconciledFamily = families.includes(data.family)
              ? data.family
              : defaultFamily;
            reconciledAppId = data.appId;
          }
        } catch (refreshError) {
          reconciliationError = asError(refreshError);
        }
        mutationPending.current = false;
        const reconciled = applyThemeFamily(reconciledFamily, reconciledAppId);
        setStorageStatus(storageStatusForApply(reconciled));
        const failure = reconciliationError
          ? new AggregateError(
              [normalized, reconciliationError],
              "The theme family update failed and its saved value could not be reloaded.",
            )
          : normalized;
        setMutationError(failure);
        throw failure;
      }
    },
    [appId, defaultFamily, families, mutation, urlOverride],
  );

  const error = urlOverride
    ? undefined
    : (mutationError ?? (query.isError ? asError(query.error) : undefined));
  const status = urlOverride
    ? "success"
    : error
      ? "error"
      : query.isSuccess
        ? "success"
        : "loading";

  return {
    family,
    status,
    error,
    storageStatus,
    isForcedByUrl: urlOverride !== null,
    setFamily,
  };
}
