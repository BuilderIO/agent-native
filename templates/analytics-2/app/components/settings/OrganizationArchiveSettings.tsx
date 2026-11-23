import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  SettingsRowDefinition,
  SettingsSectionDefinition,
} from "@agent-native/toolkit/app/settings";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_ARCHIVE_CADENCE_DAYS,
  MAX_ARCHIVE_CADENCE_DAYS,
  MIN_ARCHIVE_CADENCE_DAYS,
  type ArchiveSettings,
} from "@/lib/model/archive-settings-contracts";
import { AppSettingsSections } from "@/skins/app-settings-sections";

type Rule = "noEditArchiveCadence" | "noViewArchiveCadence";

function useArchiveSections(): {
  sections: SettingsSectionDefinition[];
  unreadable: boolean;
  retry: () => void;
} {
  const t = useT();
  const label = (key: string) => t(`analytics.organizationArchive.${key}`);
  const queryClient = useQueryClient();
  const shell = useActionQuery("get-workspace-bootstrap", {}, { retry: 1 });
  const isAdmin = shell.data?.features.isAdmin === true;
  const query = useActionQuery("get-organization-archive-settings", {});
  const [error, setError] = useState("");
  const loading = query.isLoading;
  const unreadable = query.isError || (!loading && !query.data);
  const server: ArchiveSettings = {
    noEditArchiveCadence: query.data?.noEditArchiveCadence ?? null,
    noViewArchiveCadence: query.data?.noViewArchiveCadence ?? null,
  };
  const [draft, setDraft] = useState<ArchiveSettings | null>(null);
  const current = draft ?? server;
  const latestRef = useRef<ArchiveSettings>(current);
  const dirtyRef = useRef(false);
  const flushRef = useRef<Promise<void> | null>(null);
  if (!dirtyRef.current && flushRef.current === null) {
    latestRef.current = server;
  }

  const flush = (): Promise<void> => {
    if (flushRef.current) return flushRef.current;
    const run = (async () => {
      try {
        while (dirtyRef.current) {
          dirtyRef.current = false;
          const payload = { ...latestRef.current };
          await callAction("save-organization-archive-settings", payload);
        }
        await queryClient.invalidateQueries({ queryKey: ["action"] });
        if (!dirtyRef.current) setDraft(null);
      } catch {
        dirtyRef.current = false;
        latestRef.current = server;
        setDraft(null);
        setError(label("saveError"));
      } finally {
        flushRef.current = null;
        if (dirtyRef.current) void flush();
      }
    })();
    flushRef.current = run;
    return run;
  };

  const save = async (rule: Rule, days: number | null) => {
    if (unreadable) return;
    setError("");
    const next: ArchiveSettings = { ...latestRef.current, [rule]: days };
    latestRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    await flush();
  };

  const rows = (
    rule: Rule,
    kind: "edited" | "viewed",
  ): SettingsRowDefinition[] => {
    const days = current[rule];
    return [
      {
        id: `settings.organization.archive.${kind}`,
        kind: "toggle",
        label: label(`${kind}Label`),
        condition: { disabled: loading || unreadable || !isAdmin },
        binding: {
          value: days !== null,
          ...(isAdmin
            ? {
                set: (on: boolean) =>
                  save(rule, on ? DEFAULT_ARCHIVE_CADENCE_DAYS : null),
              }
            : {}),
          actionName: "save-organization-archive-settings",
        },
      },
      {
        id: `settings.organization.archive.${kind}-days`,
        kind: "number",
        label: label(`${kind}Days`),
        labelHidden: true,
        min: MIN_ARCHIVE_CADENCE_DAYS,
        max: MAX_ARCHIVE_CADENCE_DAYS,
        step: 1,
        condition: {
          visible: days !== null,
          disabled: loading || unreadable || !isAdmin,
        },
        binding: {
          value: days,
          commit: "blur",
          ...(isAdmin
            ? {
                set: (value: number | null) => {
                  if (
                    value === null ||
                    !Number.isInteger(value) ||
                    value < MIN_ARCHIVE_CADENCE_DAYS ||
                    value > MAX_ARCHIVE_CADENCE_DAYS
                  ) {
                    setError(label("invalidCadence"));
                    return;
                  }
                  return save(rule, value);
                },
              }
            : {}),
          actionName: "save-organization-archive-settings",
        },
      },
    ];
  };

  const archiveRows = [
    ...rows("noEditArchiveCadence", "edited"),
    ...rows("noViewArchiveCadence", "viewed"),
  ];
  const first = archiveRows[0];
  if (first && error) archiveRows[0] = { ...first, error };
  return {
    sections: [{ id: "archive-settings", rows: archiveRows }],
    unreadable,
    retry: () => void query.refetch(),
  };
}

export function OrganizationArchiveSettings() {
  const t = useT();
  const { sections, unreadable, retry } = useArchiveSections();
  const title = t("analytics.organizationArchive.title");
  return (
    <section id="settings-organization-auto-archive" aria-label={title}>
      <h2 className="ws-labels-title">{title}</h2>
      <p className="ws-labels-description">
        {t("analytics.organizationArchive.description")}
      </p>
      {unreadable ? (
        <div className="space-y-2 py-2">
          <p role="alert">{t("analytics.organizationCatalog.loadError")}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            {t("analytics.organizationCatalog.retry")}
          </Button>
        </div>
      ) : (
        <AppSettingsSections sections={sections} hints={{ frame: "catalog" }} />
      )}
    </section>
  );
}
