import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
  useSettingsShell,
} from "@agent-native/core/client/settings";

import { Button } from "@/components/ui/button";

import { LoadFailedRow } from "./load-failed-row";

interface ApiKeyRow {
  name: string;
  label?: string;
  scope: "user" | "org";
  storedScope: string;
  masked?: string;
}

interface ApiKeysListing {
  keys: ApiKeyRow[];
  addable: { name: string; label: string }[];
}

// The row ids Settings › API keys gives each key: a bare `secrets:NAME` for
// the caller's own row (and for a key nobody saved, which opens its Add
// dialog there), otherwise one that carries the row's scope.
function apiKeysAnchor(name: string, saved: ApiKeyRow | undefined): string {
  if (!saved || (saved.scope === "user" && saved.storedScope === "user")) {
    return `secrets:${name}`;
  }
  return `secrets:${saved.scope}-${saved.storedScope}:${name}`;
}

/**
 * Keys that power one Clips feature, shown with that feature for owners and
 * admins. Values are added and replaced on Settings › API keys, which the
 * row opens at that key.
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
  const { navigate } = useSettingsShell();
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                navigate("api-keys", null, {
                  anchor: apiKeysAnchor(name, saved),
                })
              }
            >
              {saved ? t("clipsSettings.manage") : t("clipsSettings.add")}
            </Button>
          }
        />
      ))}
    </SettingsGroup>
  );
}
