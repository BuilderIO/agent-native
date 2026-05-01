/**
 * ConferencingSelector — choose how a booking's video meeting is set up.
 *
 * Renders a grid of options (no conferencing, Google Meet, Zoom, custom
 * link). Each option is fully styled with the consumer's shadcn
 * primitives. The Zoom option does NOT accept a pasted personal meeting
 * URL — the user connects their Zoom account via OAuth instead, and the
 * app auto-creates a meeting per booking. See `connect-video` action.
 *
 * Shadcn primitives expected in the consumer: button, input, label,
 * badge. Icons from `@tabler/icons-react`.
 *
 * Props:
 *   - `value`        — current conferencing config { type, url? }
 *   - `onChange`     — called with the next config (call instantly — the
 *                      caller owns persistence, typically optimistic)
 *   - `zoomStatus`   — 'connected' | 'disconnected' | 'not-configured'
 *                      drives the Connect Zoom button / installed chip
 *   - `onConnectZoom` — optional callback that starts the OAuth flow; if
 *                      omitted, the button is hidden (useful for preview)
 *   - `googleConnected` — whether Google Meet is available (depends on
 *                         Google Calendar credential)
 *   - `onConnectGoogle` — optional, same shape as onConnectZoom
 */
import { useId, type ComponentType } from "react";
import {
  IconBrandGoogle,
  IconBrandZoom,
  IconCheck,
  IconLink,
  IconVideo,
  IconVideoOff,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type ConferencingType = "none" | "google_meet" | "zoom" | "custom";

export interface ConferencingValue {
  type: ConferencingType;
  /** Used for `custom` — the meeting URL. Ignored for `zoom` (OAuth-created). */
  url?: string;
}

export type ProviderStatus = "connected" | "disconnected" | "not-configured";

export interface ConferencingSelectorProps {
  value: ConferencingValue;
  onChange: (next: ConferencingValue) => void;
  zoomStatus?: ProviderStatus;
  googleStatus?: ProviderStatus;
  onConnectZoom?: () => void;
  onConnectGoogle?: () => void;
  /** Hide the label above the grid (for use inside a card with its own title). */
  hideLabel?: boolean;
}

const OPTIONS: {
  type: ConferencingType;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  {
    type: "none",
    label: "No conferencing",
    description: "In-person or other",
    Icon: IconVideoOff,
  },
  {
    type: "google_meet",
    label: "Google Meet",
    description: "Auto-generate a Meet link",
    Icon: IconBrandGoogle,
  },
  {
    type: "zoom",
    label: "Zoom",
    description: "Auto-create a meeting per booking",
    Icon: IconBrandZoom,
  },
  {
    type: "custom",
    label: "Custom link",
    description: "Paste any meeting URL",
    Icon: IconLink,
  },
];

export function ConferencingSelector(props: ConferencingSelectorProps) {
  const id = useId();
  const {
    value,
    onChange,
    zoomStatus = "disconnected",
    googleStatus = "disconnected",
    onConnectZoom,
    onConnectGoogle,
    hideLabel,
  } = props;

  const statusFor = (type: ConferencingType): ProviderStatus => {
    if (type === "zoom") return zoomStatus;
    if (type === "google_meet") return googleStatus;
    return "connected";
  };
  const selectedOption =
    OPTIONS.find((opt) => opt.type === value.type) ?? OPTIONS[0];
  const selectedStatus = statusFor(selectedOption.type);
  const SelectedIcon = selectedOption.Icon;

  return (
    <div className="space-y-3">
      {!hideLabel && (
        <Label className="flex items-center gap-1.5">
          <IconVideo className="h-4 w-4" />
          Conferencing
        </Label>
      )}

      <Select
        value={value.type}
        onValueChange={(type) =>
          onChange({
            type: type as ConferencingType,
            url: type === "custom" ? value.url : undefined,
          })
        }
      >
        <SelectTrigger className="h-auto min-h-11 py-2">
          <div className="flex min-w-0 items-center gap-2 text-left">
            <SelectedIcon className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">
                  {selectedOption.label}
                </span>
                {selectedStatus === "connected" &&
                  selectedOption.type !== "none" &&
                  selectedOption.type !== "custom" && (
                    <Badge
                      variant="secondary"
                      className="h-5 gap-1 text-[10px] font-normal"
                    >
                      <IconCheck className="h-3 w-3" />
                      Connected
                    </Badge>
                  )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {selectedStatus === "not-configured"
                  ? `${selectedOption.label} is not configured on this server.`
                  : selectedOption.description}
              </p>
            </div>
          </div>
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((opt) => {
            const status = statusFor(opt.type);
            const isUnavailable = status === "not-configured";
            return (
              <SelectItem
                key={opt.type}
                value={opt.type}
                disabled={isUnavailable}
                className="py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <opt.Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{opt.label}</span>
                      {status === "connected" &&
                        opt.type !== "none" &&
                        opt.type !== "custom" && (
                          <span className="text-[10px] text-muted-foreground">
                            Connected
                          </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isUnavailable
                        ? `${opt.label} needs server OAuth credentials before it can be used.`
                        : opt.description}
                    </p>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Zoom: OAuth connect button */}
      {value.type === "zoom" && zoomStatus !== "connected" && onConnectZoom && (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Connect your Zoom account</p>
              <p className="text-xs text-muted-foreground">
                We'll create a real Zoom meeting for every booking — no need to
                paste a personal link.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={onConnectZoom}
              disabled={zoomStatus === "not-configured"}
            >
              <IconBrandZoom className="mr-1.5 h-4 w-4" />
              Connect Zoom
            </Button>
          </div>
          {zoomStatus === "not-configured" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Ask your admin to set <code>ZOOM_CLIENT_ID</code> and{" "}
              <code>ZOOM_CLIENT_SECRET</code> to enable Zoom OAuth.
            </p>
          )}
        </div>
      )}

      {/* Google Meet: connect calendar button */}
      {value.type === "google_meet" &&
        googleStatus !== "connected" &&
        onConnectGoogle && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Connect Google Calendar</p>
                <p className="text-xs text-muted-foreground">
                  Meet links are auto-generated when the calendar event is
                  created.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onConnectGoogle}
                disabled={googleStatus === "not-configured"}
              >
                <IconBrandGoogle className="mr-1.5 h-4 w-4" />
                Connect Google
              </Button>
            </div>
          </div>
        )}

      {/* Custom URL input */}
      {value.type === "custom" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-url`} className="text-xs">
            Meeting URL
          </Label>
          <Input
            id={`${id}-url`}
            type="url"
            value={value.url ?? ""}
            onChange={(e) =>
              onChange({ type: "custom", url: e.currentTarget.value })
            }
            placeholder="https://meet.example.com/room"
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}
