import { Switch } from "@agent-native/toolkit/design-system";
import { IconFlask } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import type { ExperimentDefinition } from "../../experiments/registry.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

interface ExperimentValues {
  [key: string]: boolean;
}

export interface ExperimentsSettingsProps {
  experiments: readonly ExperimentDefinition[];
  title?: string;
  intro?: string;
}

export function ExperimentsSettings({
  experiments,
  title = "Experiments",
  intro = "These new, unstable features may have bugs. Your feedback helps us improve them.",
}: ExperimentsSettingsProps) {
  const valuesQuery = useActionQuery<ExperimentValues>(
    "get-experiments" as never,
  );
  const setExperiment = useActionMutation<
    { key: string; enabled: boolean; values: ExperimentValues },
    { key: string; enabled: boolean }
  >("set-experiment" as never);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const toggle = useCallback(
    (key: string, enabled: boolean) => {
      setOverrides((current) => ({ ...current, [key]: enabled }));
      setExperiment.mutate(
        { key, enabled },
        {
          onError: () => {
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
    [setExperiment],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <SettingsGroup title={title}>
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4 text-sm leading-6 text-muted-foreground sm:px-6">
          <IconFlask className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{intro}</p>
        </div>
        {experiments.map((experiment) => {
          const enabled =
            overrides[experiment.key] ??
            valuesQuery.data?.[experiment.key] === true;
          const label = experiment.displayName ?? experiment.key;
          return (
            <SettingsRow
              key={experiment.key}
              id={`experiment-${experiment.key}`}
              label={label}
              description={experiment.description}
              control={
                <Switch
                  checked={enabled}
                  onChange={(next) => toggle(experiment.key, next)}
                  disabled={valuesQuery.isLoading || setExperiment.isPending}
                  aria-label={label}
                  className="shrink-0"
                />
              }
            />
          );
        })}
      </SettingsGroup>
    </div>
  );
}
