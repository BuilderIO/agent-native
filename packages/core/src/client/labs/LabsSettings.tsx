import { Switch } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconFlask } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import type { LabDefinition } from "../../labs/registry.js";
import { useT } from "../i18n.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { useActionMutation, useActionQuery } from "../use-action.js";
import type { LabValues } from "./use-lab.js";

export interface LabsSettingsProps {
  labs: readonly LabDefinition[];
  title?: string;
  intro?: string;
}

interface LabsSettingsState {
  /** The labs to list: every one passed until the server answers, then the ones it registered. */
  labs: readonly LabDefinition[];
  enabled: (lab: LabDefinition) => boolean;
  toggle: (lab: LabDefinition, enabled: boolean) => void;
  /** Switches wait for the server's answer; they can't save before it. */
  disabled: boolean;
  loadFailed: boolean;
  retry: () => void;
  /** The lab whose last change the server refused. */
  failedLab: LabDefinition | null;
}

function hasOwn(values: LabValues, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

/**
 * One source of truth for a labs list. Until `get-labs` answers (or when it
 * fails) each lab shows its `defaultEnabled`, which is what the server applies
 * to anyone who never chose. A lab the server didn't register is hidden once
 * it answers, because `set-lab` would refuse it.
 */
function useLabsSettingsState(
  labs: readonly LabDefinition[],
): LabsSettingsState {
  const valuesQuery = useActionQuery<LabValues>("get-labs" as never);
  const setLab = useActionMutation<
    { key: string; enabled: boolean; values: LabValues },
    { key: string; enabled: boolean }
  >("set-lab" as never);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const values = valuesQuery.data;

  const toggle = useCallback(
    (lab: LabDefinition, enabled: boolean) => {
      const key = lab.key;
      setFailedKey(null);
      setOverrides((current) => ({ ...current, [key]: enabled }));
      setLab.mutate(
        { key, enabled },
        {
          onError: () => {
            setFailedKey(key);
            setOverrides((current) => {
              if (current[key] !== enabled) return current;
              const next = { ...current };
              delete next[key];
              return next;
            });
          },
        },
      );
    },
    [setLab],
  );

  const visible = values ? labs.filter((lab) => hasOwn(values, lab.key)) : labs;
  return {
    labs: visible,
    enabled: (lab) =>
      overrides[lab.key] ??
      (values ? values[lab.key] === true : lab.defaultEnabled === true),
    toggle,
    disabled: !values || setLab.isPending,
    loadFailed: !values && valuesQuery.isError,
    retry: () => void valuesQuery.refetch(),
    failedLab: labs.find((lab) => lab.key === failedKey) ?? null,
  };
}

function LabRows({ state }: { state: LabsSettingsState }) {
  return (
    <>
      {state.labs.map((lab) => {
        const label = lab.displayName ?? lab.key;
        return (
          <SettingsRow
            key={lab.key}
            id={`lab-${lab.key}`}
            label={label}
            description={lab.description}
            control={
              <Switch
                checked={state.enabled(lab)}
                onChange={(next) => state.toggle(lab, next)}
                disabled={state.disabled}
                aria-label={label}
                className="shrink-0"
              />
            }
          />
        );
      })}
    </>
  );
}

function LabsProblems({ state }: { state: LabsSettingsState }) {
  const t = useT();
  if (state.loadFailed) {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-x-2 text-xs text-destructive"
      >
        {t("agentChat.settingsShell.appGroup.labsLoadError")}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={state.retry}
        >
          {t("agentChat.settingsShell.appGroup.retry")}
        </Button>
      </p>
    );
  }
  if (state.failedLab) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {t("agentChat.settingsShell.appGroup.labsSaveError", {
          lab: state.failedLab.displayName ?? state.failedLab.key,
        })}
      </p>
    );
  }
  return null;
}

export function LabsSettings({
  labs,
  title = "Labs",
  intro = "These new, unstable features may have bugs. Your feedback helps us improve them.",
}: LabsSettingsProps) {
  const state = useLabsSettingsState(labs);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <SettingsGroup title={title}>
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4 text-sm leading-6 text-muted-foreground sm:px-6">
          <IconFlask className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{intro}</p>
        </div>
        <LabRows state={state} />
      </SettingsGroup>
      <LabsProblems state={state} />
    </div>
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
      <LabsProblems state={state} />
    </div>
  );
}
