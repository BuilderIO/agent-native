import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  fetchAppModelDefault,
  resetAppModelDefault,
  saveAppModelDefault,
  type AppModelDefaultState,
} from "../../app-model-default.js";
import { useT } from "../../i18n.js";
import { useChangeVersions } from "../../use-change-version.js";
import { friendlyModelName } from "../SettingsPanel.js";
import { SettingsRow } from "../SettingsRow.js";
import { ReadOnlySettingValue } from "./ReadOnlySettingValue.js";

const USE_DEFAULT = "__default__";
const QUERY_KEY = ["agent-native", "app-model-default"] as const;

function optionValue(engine: string, model: string): string {
  return `${engine}::${model}`;
}

function parseOption(value: string): { engine: string; model: string } | null {
  const separator = value.indexOf("::");
  if (separator < 1) return null;
  return {
    engine: value.slice(0, separator),
    model: value.slice(separator + 2),
  };
}

interface ModelGroup {
  engine: string;
  label: string;
  models: string[];
}

function providerLabel(engine: { name: string; label: string }): string {
  return engine.name === "builder" ? "Builder.io" : engine.label || engine.name;
}

/**
 * Providers the app can default to: the configured ones, plus whatever the
 * saved default names, so a value set before a key was removed still shows.
 */
function modelGroups(state: AppModelDefaultState): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const engine of state.engines) {
    const selected = engine.name === state.engine ? state.model : null;
    const usable =
      engine.configured &&
      engine.packageInstalled !== false &&
      // Anthropic is listed twice (native and AI SDK); offer one.
      engine.name !== "ai-sdk:anthropic";
    if (!usable && !selected) continue;
    const models = engine.supportedModels.length
      ? [...engine.supportedModels]
      : [engine.defaultModel];
    if (selected && !models.includes(selected)) models.unshift(selected);
    groups.push({ engine: engine.name, label: providerLabel(engine), models });
  }
  return groups;
}

function orgDefaultModelName(state: AppModelDefaultState): string | null {
  const orgDefault = state.orgDefault;
  if (!orgDefault) return null;
  const model =
    orgDefault.model ??
    state.engines.find((engine) => engine.name === orgDefault.engine)
      ?.defaultModel;
  return model ? friendlyModelName(model) : null;
}

/**
 * Agent › Default model on the app's General page: the model new chats in
 * this app use, over the organization's default. Owners and admins change
 * it; everyone else sees the value. The agent sets the same value with
 * `manage-agent-engine` (`set-app-default`, `reset-app-default`).
 */
export function AppDefaultModelRow({ appName }: { appName: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  // The agent changes this through an action, not this route.
  const version = useChangeVersions(["settings", "action"]);
  const query = useQuery({
    queryKey: [...QUERY_KEY, version],
    queryFn: fetchAppModelDefault,
    placeholderData: (previous) => previous,
  });
  const [pending, setPending] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (value: string) => {
      const selection = parseOption(value);
      return selection
        ? saveAppModelDefault(selection)
        : resetAppModelDefault();
    },
    onMutate: (value) => setPending(value),
    onSuccess: (next) => {
      queryClient.setQueriesData({ queryKey: QUERY_KEY }, next);
    },
    onSettled: () => setPending(null),
  });
  const state = query.data;
  const groups = useMemo(() => (state ? modelGroups(state) : []), [state]);
  const label = t("agentChat.settingsShell.appGroup.defaultModel");

  if (!state) {
    if (query.isError) {
      return (
        <SettingsRow
          id="app-models"
          label={label}
          description={t(
            "agentChat.settingsShell.appGroup.defaultModelLoadError",
          )}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t("agentChat.settingsShell.appGroup.retry")}
            </Button>
          }
        />
      );
    }
    // SettingsRow's shape; its description is a <p>, which can't hold a
    // Skeleton's <div>.
    return (
      <div
        id="app-models"
        role="status"
        aria-busy="true"
        aria-label={label}
        className="agent-native-settings-row px-5 py-4 sm:px-6"
      >
        <div className="agent-native-settings-row__layout flex flex-col gap-3">
          <div className="agent-native-settings-row__main flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <Skeleton className="h-3.5 w-72 max-w-full" />
          </div>
          <div className="agent-native-settings-row__control max-w-full shrink-0">
            <Skeleton className="h-8 w-64" />
          </div>
        </div>
      </div>
    );
  }

  const saved =
    state.source !== "default" && state.engine && state.model
      ? optionValue(state.engine, state.model)
      : USE_DEFAULT;
  const value = pending ?? saved;
  const selected = parseOption(value);
  const selectedLabel = selected
    ? friendlyModelName(selected.model)
    : t("agentChat.settingsShell.appGroup.useDefault");
  const orgDefault = orgDefaultModelName(state);
  const description = orgDefault
    ? t("agentChat.settingsShell.appGroup.defaultModelDescription", {
        app: appName,
        model: orgDefault,
      })
    : t("agentChat.settingsShell.appGroup.defaultModelDescriptionUnset", {
        app: appName,
      });

  return (
    <SettingsRow
      id="app-models"
      label={label}
      description={
        <>
          {description}
          {mutation.isError ? (
            <span role="alert" className="block text-destructive">
              {t("agentChat.settingsShell.appGroup.defaultModelSaveError")}
            </span>
          ) : null}
        </>
      }
      control={
        state.canUpdate ? (
          <Select
            value={value}
            onValueChange={(next) => {
              if (next !== value) mutation.mutate(next);
            }}
          >
            <SelectTrigger size="sm" className="w-64" aria-label={label}>
              <SelectValue>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={USE_DEFAULT}>
                  {t("agentChat.settingsShell.appGroup.useDefault")}
                </SelectItem>
              </SelectGroup>
              {groups.length > 0 ? <SelectSeparator /> : null}
              {groups.map((group) => (
                <SelectGroup key={group.engine}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.models.map((model) => (
                    <SelectItem
                      key={model}
                      value={optionValue(group.engine, model)}
                    >
                      {friendlyModelName(model)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <ReadOnlySettingValue
            value={selectedLabel}
            reason={t("agentChat.settingsShell.appGroup.adminOnly")}
          />
        )
      }
    />
  );
}
