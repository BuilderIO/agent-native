import { getAppStatus, type AppStatus } from "@agent-native/core/shared";

import { Badge } from "../../ui/badge";

const BADGE_CLASS =
  "ml-[4px] shrink-0 overflow-hidden rounded-[6px] px-[6px] py-0.5 font-[family-name:var(--b-font-sans)] text-[10px] uppercase leading-none tracking-[0.08em]";

export function AppStatusBadge({
  appId,
  status,
}: {
  appId?: string;
  status?: AppStatus;
}) {
  return <Badge className={BADGE_CLASS}>{status ?? getAppStatus(appId)}</Badge>;
}
