import { IconArrowUpRight, IconPlugConnectedX } from "@tabler/icons-react";

import {
  BUILDER_CONNECT_PROVIDER,
  type ConnectRequiredCard,
} from "../../../shared/connect-required.js";
import { useT } from "../../i18n.js";
import { BuilderConnectCta } from "../run-recovery.js";

function ConnectAction({ card }: { card: ConnectRequiredCard }) {
  const t = useT();
  if (card.provider === BUILDER_CONNECT_PROVIDER) {
    return <BuilderConnectCta variant="compact" reconnect />;
  }
  const href = card.connectUrl ?? card.settingsPath;
  if (!href) return null;
  return (
    <a
      href={href}
      className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-foreground px-3 text-[11px] font-medium text-background no-underline hover:opacity-90 hover:no-underline"
    >
      {t("agentChat.widget.connectProvider", { provider: card.providerLabel })}
      <IconArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  );
}

export function ConnectRequiredWidget({ card }: { card: ConnectRequiredCard }) {
  return (
    <div className="my-1.5 flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <IconPlugConnectedX className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{card.providerLabel}</div>
        <p className="text-xs leading-snug text-muted-foreground">
          {card.reason}
        </p>
      </div>
      <ConnectAction card={card} />
    </div>
  );
}
