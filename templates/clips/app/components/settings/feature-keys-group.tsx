import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import {
  KeyValueDialog,
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
  type ApiKeysListing,
  type KeyValueDialogMode,
} from "@agent-native/core/client/settings";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { LoadFailedRow } from "./load-failed-row";

/**
 * Keys that power one Clips feature, shown with that feature for owners and
 * admins. Add and Manage open the API keys dialog here, at the key's
 * registered scope.
 */
export function FeatureKeysGroup({
  id,
  title,
  keys,
}: {
  id: string;
  title: string;
  keys: readonly string[];
}) {
  const t = useT();
  const org = useOrg();
  const [dialog, setDialog] = useState<KeyValueDialogMode | null>(null);
  const listing = useActionQuery<ApiKeysListing>("list-api-keys", undefined, {
    retry: false,
  });

  if (listing.isError) {
    return (
      <SettingsGroup id={id} title={title}>
        <LoadFailedRow onRetry={() => void listing.refetch()} />
      </SettingsGroup>
    );
  }
  if (!listing.data) {
    return (
      <SettingsGroup id={id} title={title}>
        {keys.map((name) => (
          <SettingsLoadingRow key={name} />
        ))}
      </SettingsGroup>
    );
  }

  const data = listing.data;
  const rows = keys.flatMap((name) => {
    const saved =
      data.keys.find((entry) => entry.name === name && entry.scope === "org") ??
      data.keys.find((entry) => entry.name === name);
    const addable = data.addable.find((entry) => entry.name === name);
    if (!saved && !addable) return [];
    return [{ name, saved, label: saved?.label ?? addable?.label ?? name }];
  });
  if (rows.length === 0) return null;

  return (
    <SettingsGroup id={id} title={title}>
      {rows.map(({ name, saved, label }) => (
        <SettingsRow
          key={name}
          id={`key-${name}`}
          label={label}
          description={
            saved ? (
              saved.masked ? (
                <span className="font-mono">{saved.masked}</span>
              ) : (
                t("clipsSettings.keySaved")
              )
            ) : (
              t("clipsSettings.keyNotSaved")
            )
          }
          control={
            // Vault-synced and managed keys can't be replaced from here.
            saved && !saved.canReplace ? null : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setDialog(
                    saved
                      ? { mode: "replace", entry: saved }
                      : { mode: "add", initialName: name, forService: true },
                  )
                }
              >
                {saved ? t("clipsSettings.manage") : t("clipsSettings.add")}
              </Button>
            )
          }
        />
      ))}
      {dialog ? (
        <KeyValueDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          dialog={dialog}
          listing={data}
          orgName={org.data?.orgName ?? ""}
        />
      ) : null}
    </SettingsGroup>
  );
}
