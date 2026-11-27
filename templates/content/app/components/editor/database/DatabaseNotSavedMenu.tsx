import {
  IconArrowBackUp,
  IconChevronDown,
  IconUsers,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

import { dbText } from "./text";

export function DatabaseNotSavedMenu({
  pending,
  onReset,
  onSaveForEveryone,
}: {
  pending: boolean;
  onReset: () => void;
  onSaveForEveryone: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-database-blue/40 bg-database-blue/10 px-2 text-xs font-medium text-database-blue hover:bg-database-blue/15 disabled:opacity-60"
        >
          {pending ? <Spinner className="size-3" /> : null}
          {dbText("notSaved")}
          <IconChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {dbText("notSavedNote")}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onReset}>
          <IconArrowBackUp className="size-4" />
          {dbText("resetToSavedView")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSaveForEveryone}>
          <IconUsers className="size-4" />
          {dbText("saveForEveryone")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
