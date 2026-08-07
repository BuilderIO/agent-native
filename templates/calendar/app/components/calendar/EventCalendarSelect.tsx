import { useT } from "@agent-native/core/client/i18n";
import { IconCalendarTime } from "@tabler/icons-react";
import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import { defaultColorForAccount } from "@/lib/calendar-view-preferences";
import { shouldShowEventAccountSelector } from "@/lib/event-account-selection";

const EMPTY_CONNECTED_ACCOUNTS: Array<{ email: string }> = [];

export function EventCalendarSelect({
  accountEmail,
  onAccountChange,
  disabled = false,
}: {
  accountEmail?: string;
  onAccountChange: (accountEmail: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const googleStatus = useGoogleAuthStatus();
  const connectedAccounts =
    googleStatus.data?.accounts ?? EMPTY_CONNECTED_ACCOUNTS;
  const connectedAccountEmails = useMemo(
    () => connectedAccounts.map((account) => account.email),
    [connectedAccounts],
  );
  const { prefs: viewPrefs } = useViewPreferences();

  if (!shouldShowEventAccountSelector(connectedAccounts) || !accountEmail) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <IconCalendarTime className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Select
        value={accountEmail}
        onValueChange={onAccountChange}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={t("navigation.calendar")}
          className="h-8 flex-1 text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {connectedAccounts.map((account) => (
              <SelectItem key={account.email} value={account.email}>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        viewPrefs.accountColors[account.email] ??
                        viewPrefs.singleColor ??
                        defaultColorForAccount(
                          account.email,
                          connectedAccountEmails,
                        ),
                    }}
                  />
                  <span className="truncate">{account.email}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
