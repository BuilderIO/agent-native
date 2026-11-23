import { useT } from "@agent-native/core/client/i18n";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Switch } from "@agent-native/toolkit/ui/switch";
import type { ReactNode } from "react";

/**
 * Metadata-only dbt block. Purity: every edit leaves through onConfigChange or
 * onTokenChange; the token stays in password state and never in config.
 */ export type BigQueryDbtVersion = "current" | "legacy";

export type BigQueryDbtConfig = {
  hasDbtMetadata?: boolean;
  dbtVersion?: string;
  dbtAccountId?: string;
  dbtProjectId?: string;
  dbtEnvironmentId?: string;
  dbtCloudHostname?: string;
};

function FieldRow({
  children,
  htmlFor,
  label,
  required,
}: {
  children: ReactNode;
  htmlFor?: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)] items-start gap-4">
      <Label
        className="pt-2 text-sm font-normal text-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-4"
        htmlFor={htmlFor}
      >
        {label}
        {required ? " *" : null}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function BigQueryDbtFields({
  config,
  onConfigChange,
  token,
  onTokenChange,
  tokenConfigured,
  disabled = false,
}: {
  config: BigQueryDbtConfig;
  onConfigChange: (nextConfig: BigQueryDbtConfig) => void;
  token: string;
  onTokenChange: (value: string) => void;
  tokenConfigured: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const enabled = config.hasDbtMetadata === true;
  const version: BigQueryDbtVersion | undefined =
    config.dbtVersion === "current" || config.dbtVersion === "legacy"
      ? config.dbtVersion
      : undefined;
  // A blank token means "keep the one on file", which is only safe once the
  // workspace has one; the root action decides that, not this component.
  const tokenRequired = !tokenConfigured;

  // Disabled fields also refuse programmatic edits, so the component's
  // contract does not depend on the browser suppressing the events.
  const updateConfig = (patch: Partial<BigQueryDbtConfig>) => {
    if (disabled) return;
    onConfigChange({ ...config, ...patch });
  };
  const updateToken = (value: string) => {
    if (disabled) return;
    onTokenChange(value);
  };

  const tokenField = (
    <FieldRow
      htmlFor="bigquery-dbt-token"
      label={t("sources.addConnection.bigquery.serviceToken")}
      required={tokenRequired}
    >
      <Input
        autoComplete="off"
        disabled={disabled}
        id="bigquery-dbt-token"
        onChange={(event) => updateToken(event.target.value)}
        required={tokenRequired}
        spellCheck={false}
        type="password"
        value={token}
      />
    </FieldRow>
  );

  const environmentField = (required: boolean, label: string): ReactNode => (
    <FieldRow
      htmlFor="bigquery-dbt-environment-id"
      label={label}
      required={required}
    >
      <Input
        autoCapitalize="none"
        autoComplete="off"
        disabled={disabled}
        id="bigquery-dbt-environment-id"
        onChange={(event) =>
          updateConfig({ dbtEnvironmentId: event.target.value })
        }
        required={required}
        spellCheck={false}
        value={config.dbtEnvironmentId ?? ""}
      />
    </FieldRow>
  );

  return (
    <div className="space-y-4">
      <GroupHeading>
        {t("sources.addConnection.bigquery.integrations")}
      </GroupHeading>

      <div className="flex items-center gap-2">
        <Switch
          aria-label={t("sources.addConnection.bigquery.dbt")}
          checked={enabled}
          disabled={disabled}
          id="bigquery-dbt-enabled"
          onCheckedChange={(checked) =>
            updateConfig({ hasDbtMetadata: checked })
          }
        />
        <Label
          className="text-sm font-normal text-foreground"
          htmlFor="bigquery-dbt-enabled"
        >
          {t("sources.addConnection.bigquery.dbt")}
        </Label>
        <a
          className="text-sm underline underline-offset-2"
          href="https://docs.getdbt.com/docs/dbt-cloud-apis/discovery-api"
          rel="noreferrer"
          target="_blank"
        >
          {t("sources.addConnection.learnMore")}
        </a>
      </div>

      {enabled ? (
        <>
          <FieldRow
            htmlFor="bigquery-dbt-version"
            label={t("sources.addConnection.bigquery.version")}
            required
          >
            <Select
              disabled={disabled}
              onValueChange={(nextValue) =>
                updateConfig({ dbtVersion: nextValue })
              }
              {...(version ? { value: version } : {})}
            >
              <SelectTrigger
                aria-label={t("sources.addConnection.bigquery.version")}
                id="bigquery-dbt-version"
              >
                <SelectValue
                  placeholder={t("sources.addConnection.bigquery.select")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">
                  {t("sources.addConnection.bigquery.versionCurrent")}
                </SelectItem>
                <SelectItem value="legacy">
                  {t("sources.addConnection.bigquery.versionLegacy")}
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {version === "current" ? (
            <>
              <FieldRow
                htmlFor="bigquery-dbt-access-url"
                label={t("sources.addConnection.bigquery.accessUrl")}
                required
              >
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={disabled}
                  id="bigquery-dbt-access-url"
                  onChange={(event) =>
                    updateConfig({ dbtCloudHostname: event.target.value })
                  }
                  required
                  spellCheck={false}
                  value={config.dbtCloudHostname ?? ""}
                />
              </FieldRow>
              {environmentField(
                true,
                t("sources.addConnection.bigquery.environmentId"),
              )}
              {tokenField}
            </>
          ) : null}

          {version === "legacy" ? (
            <>
              <FieldRow
                htmlFor="bigquery-dbt-account-id"
                label={t("sources.addConnection.bigquery.accountId")}
                required
              >
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={disabled}
                  id="bigquery-dbt-account-id"
                  onChange={(event) =>
                    updateConfig({ dbtAccountId: event.target.value })
                  }
                  required
                  spellCheck={false}
                  value={config.dbtAccountId ?? ""}
                />
              </FieldRow>
              <FieldRow
                htmlFor="bigquery-dbt-project-id"
                label={t("sources.addConnection.bigquery.projectId")}
                required
              >
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={disabled}
                  id="bigquery-dbt-project-id"
                  onChange={(event) =>
                    updateConfig({ dbtProjectId: event.target.value })
                  }
                  required
                  spellCheck={false}
                  value={config.dbtProjectId ?? ""}
                />
              </FieldRow>
              {tokenField}
              {environmentField(
                false,
                t("sources.addConnection.bigquery.environmentIdOptional"),
              )}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
