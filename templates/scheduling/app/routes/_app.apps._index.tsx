import { useMemo, useState } from "react";
import { callAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  IconBrandGoogle,
  IconBrandZoom,
  IconBrandTeams,
  IconCalendar,
  IconCreditCard,
  IconMessage,
  IconSearch,
  IconVideo,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type Category =
  | "all"
  | "calendars"
  | "video"
  | "payments"
  | "crm"
  | "messaging";

interface AppCardData {
  kind: string;
  name: string;
  tagline: string;
  category: Exclude<Category, "all">;
  Icon: any;
  installable: boolean;
  installed?: boolean;
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "calendars", label: "Calendars" },
  { id: "video", label: "Conferencing" },
  { id: "payments", label: "Payments" },
  { id: "crm", label: "CRM" },
  { id: "messaging", label: "Messaging" },
];

const APPS: AppCardData[] = [
  {
    kind: "google_calendar",
    name: "Google Calendar",
    tagline: "Sync bookings with your Google Calendar.",
    category: "calendars",
    Icon: IconBrandGoogle,
    installable: true,
  },
  {
    kind: "office365_calendar",
    name: "Outlook / Office 365",
    tagline: "Sync bookings with Outlook.",
    category: "calendars",
    Icon: IconCalendar,
    installable: true,
  },
  {
    kind: "apple_calendar",
    name: "Apple Calendar",
    tagline: "Two-way sync with iCloud.",
    category: "calendars",
    Icon: IconCalendar,
    installable: false,
  },
  {
    kind: "cal_video",
    name: "Cal Video",
    tagline: "Free, built-in video conferencing.",
    category: "video",
    Icon: IconVideo,
    installable: true,
    installed: true,
  },
  {
    kind: "google_meet",
    name: "Google Meet",
    tagline: "Auto-generate Meet links.",
    category: "video",
    Icon: IconBrandGoogle,
    installable: true,
  },
  {
    kind: "zoom_video",
    name: "Zoom",
    tagline: "Auto-generate Zoom meeting URLs.",
    category: "video",
    Icon: IconBrandZoom,
    installable: true,
  },
  {
    kind: "teams",
    name: "Microsoft Teams",
    tagline: "Create a Teams meeting per booking.",
    category: "video",
    Icon: IconBrandTeams,
    installable: true,
  },
  {
    kind: "stripe",
    name: "Stripe",
    tagline: "Collect payment when someone books.",
    category: "payments",
    Icon: IconCreditCard,
    installable: false,
  },
  {
    kind: "hubspot",
    name: "HubSpot",
    tagline: "Send booking data to your CRM.",
    category: "crm",
    Icon: IconCalendar,
    installable: false,
  },
  {
    kind: "slack",
    name: "Slack",
    tagline: "Post notifications to a channel.",
    category: "messaging",
    Icon: IconMessage,
    installable: false,
  },
];

export default function AppsPage() {
  const [filter, setFilter] = useState<Category>("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    return APPS.filter(
      (a) =>
        (filter === "all" || a.category === filter) &&
        (!q.trim() ||
          a.name.toLowerCase().includes(q.toLowerCase()) ||
          a.tagline.toLowerCase().includes(q.toLowerCase())),
    );
  }, [filter, q]);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">App Store</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Discover apps to connect with your Scheduling account.
          </p>
        </div>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search apps"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            className="w-64 pl-9"
          />
        </div>
      </header>

      <nav className="mb-5 flex flex-wrap items-center gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filter === c.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {c.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((a) => (
          <AppCard key={a.kind} app={a} />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No apps match your filter.
        </div>
      )}
    </div>
  );
}

function AppCard({ app }: { app: AppCardData }) {
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    if (!app.installable) return;
    setConnecting(true);
    try {
      const redirectUri = `${location.origin}/_agent-native/oauth/${app.kind}/callback`;
      const res = await callAction("connect-calendar", {
        kind: app.kind,
        redirectUri,
      });
      if (res?.authUrl) location.href = res.authUrl;
    } finally {
      setConnecting(false);
    }
  };

  const Icon = app.Icon;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 hover:border-foreground/30">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{app.name}</h3>
            {app.installed && (
              <Badge variant="secondary" className="text-[10px]">
                Installed
              </Badge>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {app.tagline}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between">
        <span className="text-[11px] capitalize text-muted-foreground">
          {app.category}
        </span>
        {app.installed ? (
          <Button size="sm" variant="ghost">
            Manage
          </Button>
        ) : app.installable ? (
          <Button
            size="sm"
            variant="outline"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            Coming soon
          </Button>
        )}
      </div>
    </div>
  );
}
