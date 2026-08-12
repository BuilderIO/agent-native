import { IconPlus, IconSettings } from "@tabler/icons-react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const APP_ROW_ACTION_CLASS =
  "size-7 rounded-md p-0 text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground";

export function AppRowSettings({
  name,
  addAppLabel = "Add app",
  onAddApp,
}: {
  name: string;
  addAppLabel?: string;
  onAddApp: () => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Settings for ${name}`}
              className={APP_ROW_ACTION_CLASS}
            >
              <IconSettings size={15} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>App settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={onAddApp}>
          <IconPlus size={14} className="mr-2" />
          {addAppLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
