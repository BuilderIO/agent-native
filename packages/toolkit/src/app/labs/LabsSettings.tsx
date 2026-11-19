import { useT } from "@agent-native/core/client/i18n";
import type { LabStates } from "@agent-native/core/client/labs/use-lab";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/use-action";
import type { LabDefinition } from "@agent-native/core/labs/registry";
import { Switch } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";

export interface LabsSettingsProps {
  labs: readonly LabDefinition[];
  title?: string;
  intro?: string;
}

interface LabsSettingsState {
  /** The labs to list: every one passed until the server answers, then the ones it registered. */
  labs: readonly LabDefinition[];
  enabled: (lab: LabDefinition) => boolean;
  mixed: (lab: LabDefinition) => boolean;
  hasError: (lab: LabDefinition) => boolean;
  /** The host product decides it, so the user's choice wouldn't apply. */
  hostDecided: (lab: LabDefinition) => boolean;
  /** The user saved a choice, so the lab no longer follows its default. */
  chosen: (lab: LabDefinition) => boolean;
  /** `null` clears the saved choice. */
  toggle: (lab: LabDefinition, enabled: boolean | null) => void;
  /** Switches wait for the server's answer; they can't save before it. */
  disabled: boolean;
  loadFailed: boolean;
  retry: () => void;
  showAll: boolean;
  showAllReady: boolean;
  toggleShowAll: (enabled: boolean) => void;
  /** The lab whose last change the server refused. */
  failedLab: LabDefinition | null;
}

function hasOwn(values: LabStates, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

/**
 * One source of truth for a labs list. Until `get-lab-states` answers (or when it
 * fails) each lab shows its `defaultEnabled`, which is what the server applies
 * to anyone who never chose. A lab the server didn't register is hidden once
 * it answers, because `set-lab` would refuse it.
 */
function useLabsSettingsState(
  labs: readonly LabDefinition[],
): LabsSettingsState {
  const valuesQuery = useActionQuery<LabStates>("get-lab-states" as never);
  const setLab = useActionMutation<
    { key: string; enabled: boolean; states: LabStates },
    { key: string; enabled: boolean | null }
  >("set-lab" as never);
  const showAllQuery = useActionQuery<{ enabled: boolean }>(
    "get-labs-show-all" as never,
  );
  const setShowAll = useActionMutation<
    { enabled: boolean; states: LabStates },
    { enabled: boolean }
  >("set-labs-show-all" as never);
  const [showAllOverride, setShowAllOverride] = useState<boolean | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [failedKey, setFailedKey] = useState<string | null>(null);
  // What the server applies can differ from the choice, so a save shows the
  // states set-lab answers with. They stay until a later read lands, so a
  // read after the save that fails can't put the row back on stale data.
  const [answered, setAnswered] = useState<LabStates | null>(null);
  const readAt = valuesQuery.dataUpdatedAt;
  useEffect(() => {
    setAnswered(null);
  }, [readAt]);
  const values = answered ?? valuesQuery.data;

  const toggle = useCallback(
    (lab: LabDefinition, enabled: boolean | null) => {
      const key = lab.key;
      setFailedKey(null);
      if (enabled !== null) {
        setOverrides((current) => ({ ...current, [key]: enabled }));
      }
      const dropOverride = () =>
        setOverrides((current) => {
          if (current[key] !== enabled) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      setLab.mutate(
        { key, enabled },
        {
          onSuccess: (result) => {
            window.dispatchEvent(
              new CustomEvent("agent-engine:configured-changed"),
            );
            setAnswered(result.states);
            dropOverride();
          },
          onError: () => {
            setFailedKey(key);
            dropOverride();
            // Use default can fail after part of it was saved, so the row
            // shows what the server has now rather than what it had.
            void valuesQuery.refetch();
          },
        },
      );
    },
    [setLab, valuesQuery.refetch],
  );

  const toggleShowAll = useCallback(
    (enabled: boolean) => {
      setFailedKey(null);
      setShowAllOverride(enabled);
      setShowAll.mutate(
        { enabled },
        {
          onSuccess: (result) => {
            window.dispatchEvent(
              new CustomEvent("agent-engine:configured-changed"),
            );
            setAnswered(result.states);
            void showAllQuery.refetch();
            setShowAllOverride(null);
          },
          onError: () => {
            setShowAllOverride(null);
            void valuesQuery.refetch();
          },
        },
      );
    },
    [setShowAll, showAllQuery.refetch, valuesQuery.refetch],
  );

  const visible = values ? labs.filter((lab) => hasOwn(values, lab.key)) : labs;
  return {
    labs: visible,
    enabled: (lab) => {
      const override = overrides[lab.key];
      if (override !== undefined) return override;
      const state = values?.[lab.key];
      return state
        ? !("error" in state) && state.enabled
        : !values && lab.defaultEnabled === true;
    },
    mixed: (lab) => {
      const state = values?.[lab.key];
      return (
        overrides[lab.key] === undefined &&
        state !== undefined &&
        !("error" in state) &&
        state.mixed
      );
    },
    hasError: (lab) => {
      const state = values?.[lab.key];
      return state !== undefined && "error" in state;
    },
    hostDecided: (lab) => {
      const state = values?.[lab.key];
      return (
        state !== undefined && !("error" in state) && state.source === "host"
      );
    },
    chosen: (lab) => {
      const state = values?.[lab.key];
      return (
        !Object.hasOwn(overrides, lab.key) &&
        state !== undefined &&
        !("error" in state) &&
        state.source === "choice"
      );
    },
    toggle,
    showAll: showAllOverride ?? showAllQuery.data?.enabled === true,
    showAllReady: showAllQuery.data !== undefined,
    toggleShowAll,
    disabled: !values || setLab.isPending || setShowAll.isPending,
    loadFailed: !values && valuesQuery.isError,
    retry: () => void valuesQuery.refetch(),
    failedLab: labs.find((lab) => lab.key === failedKey) ?? null,
  };
}

/**
 * A row's controls are disabled until the server answers, which drops keyboard
 * focus, and Use default goes away once it's saved. When the save ends, focus
 * goes back to the row's switch, or its first button when it has none, so
 * someone using the keyboard keeps their place.
 */
function useRefocusAfterSave(saving: boolean): (key: string) => void {
  const pendingKey = useRef<string | null>(null);
  useEffect(() => {
    if (saving) return;
    const key = pendingKey.current;
    pendingKey.current = null;
    if (key === null) return;
    const row = document.getElementById(`lab-${key}`);
    const active = document.activeElement;
    if (!row) return;
    if (active && active !== document.body && !row.contains(active)) return;
    (
      row.querySelector<HTMLElement>('[role="switch"]:not(:disabled)') ??
      row.querySelector<HTMLElement>("button:not(:disabled)")
    )?.focus();
  }, [saving]);
  return useCallback((key: string) => {
    pendingKey.current = key;
  }, []);
}

function LabRows({ state }: { state: LabsSettingsState }) {
  const t = useT();
  const refocusAfterSave = useRefocusAfterSave(state.disabled);
  const save = (lab: LabDefinition, enabled: boolean | null) => {
    refocusAfterSave(lab.key);
    state.toggle(lab, enabled);
  };
  return (
    <>
      {state.loadFailed ? (
        <SettingsRow
          label={t("agentChat.settingsShell.appGroup.labsLoadError")}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={state.retry}
            >
              {t("agentChat.settingsShell.appGroup.retry")}
            </Button>
          }
        />
      ) : null}
      {state.labs.length > 0 ? (
        <SettingsRow
          id="labs-show-all"
          label={t("agentChat.settingsShell.appGroup.labsShowAll")}
          control={
            <Switch
              checked={state.showAll}
              onChange={state.toggleShowAll}
              disabled={state.disabled || !state.showAllReady}
              aria-label={t("agentChat.settingsShell.appGroup.labsShowAll")}
            />
          }
        />
      ) : null}
      {state.labs.map((lab) => {
        const label = lab.displayNameKey
          ? t(lab.displayNameKey)
          : (lab.displayName ?? lab.key);
        const description = lab.descriptionKey
          ? t(lab.descriptionKey)
          : lab.description;
        const failed = state.failedLab?.key === lab.key;
        const unreadable = state.hasError(lab);
        const mixed = state.mixed(lab);
        const hostDecided = state.hostDecided(lab);
        return (
          <SettingsRow
            key={lab.key}
            id={`lab-${lab.key}`}
            label={label}
            description={
              failed ? (
                <span role="alert" className="text-destructive">
                  {t("agentChat.settingsShell.appGroup.labsSaveError", {
                    lab: label,
                  })}
                </span>
              ) : unreadable ? (
                <span role="alert" className="text-destructive">
                  {t("agentChat.settingsShell.appGroup.labsReadError")}
                </span>
              ) : mixed ? (
                (lab.inheritedMixedDescription ?? description)
              ) : hostDecided ? (
                <>
                  {description ? (
                    <span className="block">{description}</span>
                  ) : null}
                  <span className="block">
                    {t("agentChat.settingsShell.appGroup.labsHostDecided")}
                  </span>
                </>
              ) : (
                description
              )
            }
            control={
              unreadable || mixed ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state.disabled}
                    onClick={() => save(lab, true)}
                    aria-label={`${label}: ${t("agentChat.settingsShell.channels.state.on")}`}
                  >
                    {t("agentChat.settingsShell.channels.state.on")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state.disabled}
                    onClick={() => save(lab, false)}
                    aria-label={`${label}: ${t("agentChat.settingsShell.channels.state.off")}`}
                  >
                    {t("agentChat.settingsShell.channels.state.off")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {state.chosen(lab) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={state.disabled}
                      onClick={() => save(lab, null)}
                      aria-label={`${label}: ${t("agentChat.settingsShell.appGroup.labsUseDefault")}`}
                    >
                      {t("agentChat.settingsShell.appGroup.labsUseDefault")}
                    </Button>
                  ) : null}
                  <Switch
                    checked={state.enabled(lab)}
                    onChange={(next) => save(lab, next)}
                    disabled={state.disabled || hostDecided}
                    aria-label={label}
                  />
                </div>
              )
            }
          />
        );
      })}
    </>
  );
}

export function LabsSettings({
  labs,
  title = "Labs",
  intro = "These new, unstable features may have bugs. Your feedback helps us improve them.",
}: LabsSettingsProps) {
  const state = useLabsSettingsState(labs);
  return (
    <SettingsGroup title={title} description={intro}>
      <LabRows state={state} />
    </SettingsGroup>
  );
}

export interface LabsSettingsGroupProps {
  labs: readonly LabDefinition[];
  /** The group title: the app's name. */
  title: string;
}

/** The redesigned Labs page: one group named after the app, and a footnote. */
export function LabsSettingsGroup({ labs, title }: LabsSettingsGroupProps) {
  const t = useT();
  const state = useLabsSettingsState(labs);
  return (
    <div className="flex flex-col gap-2.5">
      <SettingsGroup id="labs" title={title}>
        <LabRows state={state} />
      </SettingsGroup>
      <p className="px-0.5 text-xs text-muted-foreground">
        {t("agentChat.settingsShell.appGroup.labsFootnote")}
      </p>
    </div>
  );
}
