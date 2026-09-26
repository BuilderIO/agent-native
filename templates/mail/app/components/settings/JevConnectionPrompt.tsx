import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import {
  BuilderConnectPopover,
  useBuilderConnectFlow,
} from "@agent-native/core/client/settings";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function JevConnectionPrompt({
  variant = "row",
  onConnected,
  disabled = false,
  showHeading = true,
}: {
  variant?: "row" | "trigger" | "menu-item";
  onConnected?: () => void;
  disabled?: boolean;
  showHeading?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const flow = useBuilderConnectFlow({
    trackingSource: "mail_jev_triage_setup",
    trackingFlow: "connect_jev",
    onConnected,
  });

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
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
    </div>
  );

  const dialogContent = (
    <DialogContent className="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{t("mail.aiFilter.connectJev")}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {t("mail.aiFilter.freeBuilderOrApiKey")}
      </p>
      {actions}
      {flow.error ? (
        <p className="text-xs text-destructive">{flow.error}</p>
      ) : null}
    </DialogContent>
  );

  if (variant === "menu-item") {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DropdownMenuItem
          onSelect={() => setOpen(true)}
          disabled={disabled || flow.connecting}
          className="justify-between"
        >
          {t("mail.sort.priority")}
          <span className="text-xs text-muted-foreground">
            {t("mail.aiFilter.connectJev")}
          </span>
        </DropdownMenuItem>
        {dialogContent}
      </Dialog>
    );
  }

  if (variant === "trigger") {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || flow.connecting}
            className="h-7 px-2 text-[11px]"
          >
            {t("mail.aiFilter.connectJev")}
          </Button>
        </DialogTrigger>
        {dialogContent}
      </Dialog>
    );
  }

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
      {actions}
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
