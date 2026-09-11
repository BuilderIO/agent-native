import { Switch } from "@agent-native/toolkit/design-system";
import { IconFlask } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import type { LabDefinition } from "../../labs/registry.js";
import { SettingsGroup, SettingsRow } from "../settings/SettingsRow.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

interface LabValues {
  [key: string]: boolean;
}

export interface LabsSettingsProps {
  labs: readonly LabDefinition[];
  title?: string;
  intro?: string;
}

export function LabsSettings({
  labs,
  title = "Labs",
  intro = "These new, unstable features may have bugs. Your feedback helps us improve them.",
}: LabsSettingsProps) {
  const valuesQuery = useActionQuery<LabValues>(
    "get-labs" as never,
  );
  const setLab = useActionMutation<
    { key: string; enabled: boolean; values: LabValues },
    { key: string; enabled: boolean }
  >("set-lab" as never);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const toggle = useCallback(
    (key: string, enabled: boolean) => {
      setOverrides((current) => ({ ...current, [key]: enabled }));
      setLab.mutate(
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
    [setLab],
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <SettingsGroup title={title}>
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4 text-sm leading-6 text-muted-foreground sm:px-6">
          <IconFlask className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{intro}</p>
        </div>
        {labs.map((lab) => {
          const enabled =
            overrides[lab.key] ??
            valuesQuery.data?.[lab.key] === true;
          const label = lab.displayName ?? lab.key;
          return (
            <SettingsRow
              key={lab.key}
              id={`lab-${lab.key}`}
              label={label}
              description={lab.description}
              control={
                <Switch
                  checked={enabled}
                  onChange={(next) => toggle(lab.key, next)}
                  disabled={valuesQuery.isLoading || setLab.isPending}
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
