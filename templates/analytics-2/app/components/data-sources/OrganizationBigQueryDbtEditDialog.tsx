import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconLoader2 } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { BigQueryDbtFields, type BigQueryDbtConfig } from "./BigQueryDbtFields";

type DbtConfig = {
  hasDbtMetadata: boolean;
  dbtVersion: "current" | "legacy";
  dbtAccountId?: string;
  dbtProjectId?: string;
  dbtEnvironmentId?: string;
  dbtCloudHostname?: string;
};
type SavedView = {
  config: DbtConfig | null;
  revision: number | null;
  dbtEnabled: boolean;
  tokenConfigured: boolean;
  editOrgId: string;
};
type Readback = {
  data: SavedView | undefined;
  isError: boolean;
  error: unknown;
};

/** A refused dbt save carries its own reason; an unconfirmed one does not. */
export function dbtRefusalMessage(failure: unknown): string | undefined {
  if (!failure || typeof failure !== "object") return undefined;
  const { errorCode, message } = failure as {
    errorCode?: unknown;
    message?: unknown;
  };
  return typeof errorCode === "string" &&
    (errorCode.startsWith("dbt_") || errorCode.startsWith("data_dbt_")) &&
    typeof message === "string" &&
    message.trim()
    ? message
    : undefined;
}

function SettingsForm({
  initial,
  onBusyChange,
  onCancel,
  onSaved,
  readback,
}: {
  initial: SavedView;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
  readback: () => Promise<Readback>;
}) {
  const t = useT();
  const [config, setConfig] = useState<BigQueryDbtConfig>(() => {
    const saved: BigQueryDbtConfig = initial.config
      ? { ...initial.config }
      : { hasDbtMetadata: false, dbtCloudHostname: "cloud.getdbt.com" };
    if (!initial.dbtEnabled) delete saved.dbtVersion;
    return saved;
  });
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const save = useActionMutation<
    undefined,
    {
      dbt: DbtConfig;
      dbtToken?: string;
      expectedRevision: number;
      expectedOrgId: string;
    }
  >("save-organization-bigquery-dbt-settings", {
    privateInputs: true,
    uiOnly: true,
    retry: false,
    retryUiCapability: false,
  });
  const versionSelected =
    config.dbtVersion === "current" || config.dbtVersion === "legacy";
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(undefined);
    const dbt: DbtConfig = {
      hasDbtMetadata: config.hasDbtMetadata === true,
      dbtVersion: config.dbtVersion === "legacy" ? "legacy" : "current",
    };
    for (const key of [
      "dbtAccountId",
      "dbtProjectId",
      "dbtEnvironmentId",
      "dbtCloudHostname",
    ] as const) {
      const value = config[key]?.trim();
      if (value) dbt[key] = value;
    }
    const expectedRevision = initial.revision ?? 0;
    const nextToken = token.trim();
    try {
      await save.mutateAsync({
        dbt,
        expectedRevision,
        expectedOrgId: initial.editOrgId,
        ...(nextToken ? { dbtToken: nextToken } : {}),
      });
      const result = await readback();
      const stored = result.data;
      if (
        result.isError ||
        result.error ||
        !stored ||
        stored.editOrgId !== initial.editOrgId ||
        stored.revision !== expectedRevision + 1 ||
        stored.dbtEnabled !== dbt.hasDbtMetadata ||
        !stored.config ||
        stored.config.hasDbtMetadata !== dbt.hasDbtMetadata ||
        stored.config.dbtVersion !== dbt.dbtVersion ||
        (dbt.hasDbtMetadata && !stored.tokenConfigured) ||
        (
          [
            "dbtAccountId",
            "dbtProjectId",
            "dbtEnvironmentId",
            "dbtCloudHostname",
          ] as const
        ).some((key) => stored.config?.[key] !== dbt[key])
      )
        throw new Error("Unconfirmed dbt settings save");
      setToken("");
      onSaved();
    } catch (failure) {
      setError(
        dbtRefusalMessage(failure) ??
          t("sources.addConnection.bigquery.saveNotConfirmed"),
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="min-h-0 overflow-auto p-5">
        <BigQueryDbtFields
          config={config}
          disabled={saving}
          onConfigChange={setConfig}
          onTokenChange={setToken}
          token={token}
          tokenConfigured={initial.tokenConfigured}
        />
        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
        <Button
          disabled={saving}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          {t("sources.editConnection.cancel")}
        </Button>
        <Button
          aria-busy={saving}
          disabled={
            saving || (config.hasDbtMetadata === true && !versionSelected)
          }
          type="submit"
        >
          {saving ? (
            <IconLoader2
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
              size={16}
              stroke={1.8}
            />
          ) : null}
          {t("sources.editConnection.update")}
        </Button>
      </div>
    </form>
  );
}

export function OrganizationBigQueryDbtEditDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [initial, setInitial] = useState<SavedView | null>(null);
  const initialized = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const query = useActionQuery<SavedView>(
    "get-organization-bigquery-dbt",
    {
      forEdit: true,
    },
    {
      refetchOnMount: "always",
      batchRefetches: false,
      onServerResult: (view) => {
        if (initialized.current) return;
        if (typeof view.editOrgId !== "string" || !view.editOrgId.trim()) {
          setLoadError(true);
          return;
        }
        initialized.current = true;
        setInitial(view);
      },
    },
  );
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[700px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>{t("sources.editConnection.title")}</DialogTitle>
        </DialogHeader>
        {initial ? (
          <SettingsForm
            initial={initial}
            onBusyChange={setBusy}
            onCancel={close}
            onSaved={onClose}
            readback={() => query.refetch()}
          />
        ) : query.isError || loadError ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-destructive" role="alert">
              {t("sources.addConnection.bigquery.dbtLoadError")}
            </p>
            <Button
              onClick={() => {
                setLoadError(false);
                void query.refetch();
              }}
              type="button"
              variant="outline"
            >
              {t("sources.retry")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
