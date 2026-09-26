import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleOff,
  IconCopy,
  IconServer,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { toast } from "sonner";

import type {
  InfrastructureStatus,
  InfrastructureVariable,
} from "../../../server/infrastructure-status.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useFormatters, useT } from "../../i18n.js";
import {
  DATABASE_PROVIDER_LABELS,
  DATABASE_PROVIDER_LOGOS,
  HOSTING_PLATFORM_LOGOS,
  appAddress,
  variablesSummary,
} from "./infra-page-state.js";
import { BrandLogo } from "./logos.js";

const K = "agentChat.settingsInfra.";
const CODE_MARK = "⁣code⁣";

export type EnvironmentDialogId = "database" | "hosting" | "variables";

type Translate = ReturnType<typeof useT>;

/** A translated sentence with one identifier set in code. */
function withCode(
  t: Translate,
  key: string,
  code: string,
  options: Record<string, unknown> = {},
): ReactNode {
  const parts = t(key, { ...options, key: CODE_MARK }).split(CODE_MARK);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <Code>{code}</Code> : null}
    </Fragment>
  ));
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

function CommandLine({ command }: { command: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/40 py-1 ps-3 pe-1">
      <code className="min-w-0 truncate font-mono text-xs text-foreground">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label={t(`${K}copy`)}
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => toast.success(t(`${K}copied`)),
            () => toast.error(t(`${K}copyFailed`)),
          );
        }}
      >
        <IconCopy aria-hidden />
      </Button>
    </div>
  );
}

/** A status line in a dialog's card: an icon, a label, and a detail. */
function StatusItem({
  icon,
  label,
  detail,
  mono = false,
}: {
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {detail ? (
          <div
            className={
              mono
                ? "mt-0.5 break-all font-mono text-xs text-muted-foreground"
                : "mt-0.5 text-xs leading-5 text-muted-foreground"
            }
          >
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ItemCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
      {children}
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal space-y-1.5 ps-5 text-sm leading-6 text-muted-foreground">
      {children}
    </ol>
  );
}

export function EnvironmentDialog({
  open,
  status,
  hostLabel,
  onOpenChange,
}: {
  open: EnvironmentDialogId | null;
  status: InfrastructureStatus;
  hostLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const title =
    open === "database"
      ? t("agentChat.settingsShell.search.database")
      : open === "hosting"
        ? t("agentChat.settingsShell.search.hosting")
        : t(`${K}environment`);
  return (
    <Dialog open={open !== null} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          className="max-w-lg"
          closeLabel={t(`${K}close`)}
          aria-describedby={undefined}
          data-environment-dialog={open}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {open === "database" ? (
              <DatabaseBody status={status} />
            ) : open === "hosting" ? (
              <HostingBody status={status} hostLabel={hostLabel} />
            ) : (
              <VariablesBody status={status} />
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t(`${K}close`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function DatabaseBody({ status }: { status: InfrastructureStatus }) {
  const t = useT();
  const { database } = status;
  const name = database.provider
    ? DATABASE_PROVIDER_LABELS[database.provider]
    : null;
  const label = database.local
    ? `${t(`${K}dbLocal`)} · ${name}`
    : database.configured && name
      ? `${t(`${K}dbConnected`)} · ${name}`
      : t(`${K}notSet`);
  return (
    <>
      <ItemCard>
        <StatusItem
          icon={
            database.provider ? (
              <BrandLogo
                logoId={DATABASE_PROVIDER_LOGOS[database.provider]}
                fallback={IconCircleCheck}
                size="sm"
              />
            ) : (
              <IconCircleOff aria-hidden />
            )
          }
          label={label}
          detail={database.host ?? database.sourceKey ?? undefined}
          mono
        />
      </ItemCard>
      <p className="text-sm leading-6 text-muted-foreground">
        {t(`${K}dbIntro`)}
      </p>
      <Steps>
        <li>{t(`${K}dbStep1`)}</li>
        <li>{withCode(t, `${K}dbStep2`, "DATABASE_URL")}</li>
        <li>{t(`${K}dbStep3`)}</li>
      </Steps>
      {database.appDatabaseKey ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {withCode(t, `${K}dbOwn`, database.appDatabaseKey)}
        </p>
      ) : null}
    </>
  );
}

function HostingBody({
  status,
  hostLabel,
}: {
  status: InfrastructureStatus;
  hostLabel: string;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { hosting } = status;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const secretKey = status.workspace ? "A2A_SECRET" : "BETTER_AUTH_SECRET";
  return (
    <>
      {hosting.apps.length > 0 ? (
        <ItemCard>
          {hosting.apps.map((app) => (
            <StatusItem
              key={app.id}
              icon={
                <BrandLogo
                  logoId={HOSTING_PLATFORM_LOGOS[hosting.platform]}
                  fallback={IconServer}
                  size="sm"
                />
              }
              label={`${app.name} · ${hostLabel}`}
              detail={appAddress(app, hosting.gatewayUrl, origin)}
              mono
            />
          ))}
        </ItemCard>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        {status.workspace ? t(`${K}hostIntroWorkspace`) : t(`${K}hostIntro`)}
      </p>
      <Steps>
        <li>{withCode(t, `${K}hostStep1`, "NITRO_PRESET")}</li>
        <li>
          {t(`${K}hostStep2`, {
            keys: formatters.formatList(["DATABASE_URL", secretKey]),
          })}
        </li>
        <li>{t(`${K}hostStep3`)}</li>
      </Steps>
      <CommandLine command="npx agent-native deploy --preset vercel" />
    </>
  );
}

function variableNote(
  t: Translate,
  variable: InfrastructureVariable,
  workspace: boolean,
): string {
  if (variable.weak) return t(`${K}varWeak`);
  switch (variable.key) {
    case "DATABASE_URL":
      return t(`${K}varDatabaseUrl`);
    case "A2A_SECRET":
      return t(`${K}varA2a`);
    case "BETTER_AUTH_SECRET":
      return t(`${K}varBetterAuth`);
    case "APP_URL":
      return t(`${K}varAppUrl`);
    case "SECRETS_ENCRYPTION_KEY":
      return workspace ? t(`${K}varEncryption`) : t(`${K}varEncryptionSingle`);
  }
}

function VariableItem({
  variable,
  workspace,
}: {
  variable: InfrastructureVariable;
  workspace: boolean;
}) {
  const t = useT();
  const stateLabel = variable.weak
    ? t(`${K}varWeakLabel`)
    : variable.set
      ? t(`${K}set`)
      : t(`${K}notSet`);
  const icon = variable.weak ? (
    <IconAlertTriangle className="text-destructive" aria-label={stateLabel} />
  ) : variable.set ? (
    <IconCircleCheck aria-label={stateLabel} />
  ) : (
    <IconCircleOff aria-label={stateLabel} />
  );
  return (
    <div data-variable={variable.key} data-variable-set={String(variable.set)}>
      <StatusItem
        icon={icon}
        label={<span className="font-mono text-[13px]">{variable.key}</span>}
        detail={variableNote(t, variable, workspace)}
      />
    </div>
  );
}

function VariablesBody({ status }: { status: InfrastructureStatus }) {
  const t = useT();
  const { required, optional } = variablesSummary(status.variables);
  const section = (title: string, items: InfrastructureVariable[]) =>
    items.length ? (
      <div className="grid gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <ItemCard>
          {items.map((variable) => (
            <VariableItem
              key={variable.key}
              variable={variable}
              workspace={status.workspace}
            />
          ))}
        </ItemCard>
      </div>
    ) : null;
  return (
    <>
      <p className="text-sm leading-6 text-muted-foreground">
        {t(`${K}envIntro`)}
      </p>
      {section(t(`${K}required`), required)}
      {section(t(`${K}optional`), optional)}
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          {t(`${K}generateSecret`)}
        </p>
        <CommandLine command="openssl rand -hex 32" />
      </div>
    </>
  );
}
