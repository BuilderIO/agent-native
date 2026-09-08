import {
  IconChevronDown,
  IconDeviceDesktop,
  IconWindow,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useRowMenu } from "./useRowMenu";

export type CaptureSource = "full-screen" | "window" | "region";

const LABELS: Record<CaptureSource, string> = {
  "full-screen": "Full screen",
  window: "Window",
  region: "Region",
};

export interface RecentCaptureWindow {
  id: string;
  label: string;
}

export function hasRecentCaptureWindows(
  recentWindows: RecentCaptureWindow[],
): boolean {
  return recentWindows.length > 0;
}

export function SourceRow({
  value,
  onChange,
  includeRegion = false,
  recentWindows = [],
  onChooseWindow,
}: {
  value: CaptureSource;
  onChange: (v: CaptureSource) => void;
  includeRegion?: boolean;
  recentWindows?: RecentCaptureWindow[];
  onChooseWindow?: () => void;
}) {
  const { open, onOpenChange } = useRowMenu();
  const currentWindowLabel =
    recentWindows.find((window) => window.id === value)?.label ?? LABELS[value];

  return (
    <div className="row row-on">
      <span className="row-icon" aria-hidden>
        <IconDeviceDesktop size={20} stroke={1.75} />
      </span>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="row-button"
            aria-label={`Choose capture source: ${currentWindowLabel}`}
          >
            <span className="row-label">{currentWindowLabel}</span>
            <span className="row-flex" aria-hidden />
            <IconChevronDown
              className="row-chev"
              size={16}
              stroke={1.75}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          data-popover-resize-overlay="true"
          className="recorder-menu w-[216px] rounded-[10px]"
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(nextValue) => {
              onChange(
                nextValue === "full-screen" || nextValue === "region"
                  ? nextValue
                  : "window",
              );
            }}
          >
            <DropdownMenuRadioItem value="full-screen">
              Full screen
            </DropdownMenuRadioItem>
            {includeRegion ? (
              <DropdownMenuRadioItem value="region">
                Region
              </DropdownMenuRadioItem>
            ) : null}
            {hasRecentCaptureWindows(recentWindows) ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Windows</DropdownMenuLabel>
                {recentWindows.map((window) => (
                  <DropdownMenuRadioItem key={window.id} value={window.id}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <IconWindow size={14} stroke={1.75} aria-hidden />
                      <span className="truncate">{window.label}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </>
            ) : null}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              onChange("window");
              onChooseWindow?.();
            }}
          >
            Choose window…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
