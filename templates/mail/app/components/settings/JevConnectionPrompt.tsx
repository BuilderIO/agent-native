import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
  type BuilderConnectFlow,
} from "@agent-native/toolkit/app/settings";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

function useJevConnectFlow(onConnected?: () => void) {
  return useBuilderConnectFlow({
    trackingSource: "mail_jev_triage_setup",
    trackingFlow: "connect_jev",
    onConnected: () => onConnected?.(),
  });
}

function JevConnectActions({ flow }: { flow: BuilderConnectFlow }) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
      <BuilderConnectPopover flow={flow}>
        <Button
          type="button"
          disabled={flow.connecting}
          aria-busy={flow.connecting}
          className="h-8 px-3 text-xs"
        >
          {flow.connecting
            ? t("mail.accounts.connecting")
            : t("mail.aiFilter.connectBuilder")}
        </Button>
      </BuilderConnectPopover>
      <Link
        to={buildSettingsRoute("keys:secrets:JEV_API_KEY")}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("mail.aiFilter.addJevApiKey")}
      </Link>
      <Link
        to={buildSettingsRoute("keys:secrets:OPENAI_API_KEY")}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("mail.aiFilter.addOpenAiApiKey")}
      </Link>
    </div>
  );
}

export function JevConnectionMenuItem({
  onSelect,
  disabled = false,
}: {
  onSelect: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className="justify-between gap-4"
    >
      {t("mail.sort.priority")}
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {t("mail.aiFilter.connectJev")}
      </span>
    </DropdownMenuItem>
  );
}

export function JevConnectionDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}) {
  const t = useT();
  const flow = useJevConnectFlow(onConnected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("mail.aiFilter.connectJev")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("mail.aiFilter.freeBuilderOrApiKey")}
        </p>
        <JevConnectActions flow={flow} />
        {flow.error ? (
          <p className="text-xs text-destructive">{flow.error}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function JevConnectionPrompt({
  onConnected,
  showHeading = true,
}: {
  onConnected?: () => void;
  showHeading?: boolean;
}) {
  const t = useT();
  const flow = useJevConnectFlow(onConnected);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {showHeading ? (
          <p className="text-sm font-medium text-foreground">
            {t("mail.aiFilter.connectJevToRunTriage")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("mail.aiFilter.freeBuilderOrApiKey")}
        </p>
      </div>
      <JevConnectActions flow={flow} />
      {flow.error ? (
        <p className="basis-full text-xs text-destructive">{flow.error}</p>
      ) : null}
    </div>
  );
}

export function JevAvailabilityError({
  onRetry,
  retrying = false,
  showMessage = true,
}: {
  onRetry: () => void;
  retrying?: boolean;
  showMessage?: boolean;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
    >
      {showMessage ? (
        <p className="text-sm text-muted-foreground">
          {t("mail.aiFilter.jevAvailabilityFailed")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={retrying}
        aria-busy={retrying}
        onClick={onRetry}
      >
        {t("mail.error.tryAgain")}
      </Button>
    </div>
  );
}
