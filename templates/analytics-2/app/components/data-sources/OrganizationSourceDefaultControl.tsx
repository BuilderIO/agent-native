import { useT } from "@agent-native/core/client/i18n";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";

import { OrganizationBigQueryDbtEditDialog } from "./OrganizationBigQueryDbtEditDialog";

export function OrganizationSourceDefaultControl({
  canManage,
  isDefault,
  name,
  onSelect,
  pending,
}: {
  canManage: boolean;
  isDefault: boolean;
  name: string;
  onSelect: () => void;
  pending: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <>
      {isDefault ? (
        <Badge variant="secondary">
          {t("sources.defaultConnection.marker")}
        </Badge>
      ) : null}
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`${t("sources.row.actions")}: ${name}`}
              disabled={pending}
              size="icon"
              type="button"
              variant="ghost"
            >
              <IconDots aria-hidden="true" size={16} stroke={1.8} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={pending} onSelect={onSelect}>
              {t(
                isDefault
                  ? "sources.defaultConnection.clear"
                  : "sources.defaultConnection.set",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => setEditing(true)}
            >
              {t("sources.row.edit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canManage && editing ? (
        <OrganizationBigQueryDbtEditDialog onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}
