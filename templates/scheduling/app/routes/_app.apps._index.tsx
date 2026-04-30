import { useMemo, useState } from "react";
import { callAction } from "@/lib/api";
import { agentNativePath, useSendToAgentChat } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IconBrandGoogle,
  IconBrandZoom,
  IconBrandTeams,
  IconCalendar,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";

type Category = "all" | "calendars" | "video";

interface IntegrationCardData {
  kind: string;
  name: string;
  tagline: string;
  category: Exclude<Category, "all">;
  Icon: any;
  installed?: boolean;
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "calendars", label: "Calendars" },
  { id: "video", label: "Conferencing" },
];

// Only integrations that are actually wired up and installable right now.
// More sources are added by delegating to the agent (see the CTA at the
// bottom of the page) — the framework's standard "add a connector" pattern.
const INTEGRATIONS: IntegrationCardData[] = [
  {
    kind: "google_calendar",
    name: "Google Calendar",
    tagline: "Sync bookings with your Google Calendar.",
    category: "calendars",
    Icon: IconBrandGoogle,
  },
  {
    kind: "office365_calendar",
    name: "Outlook / Office 365",
    tagline: "Sync bookings with Outlook.",
    category: "calendars",
    Icon: IconCalendar,
  },
  {
    kind: "google_meet",
    name: "Google Meet",
    tagline: "Auto-generate Meet links on new bookings.",
    category: "video",
    Icon: IconBrandGoogle,
  },
  {
    kind: "zoom_video",
    name: "Zoom",
    tagline: "Auto-generate Zoom meeting URLs.",
    category: "video",
    Icon: IconBrandZoom,
  },
  {
    kind: "teams",
    name: "Microsoft Teams",
    tagline: "Create a Teams meeting per booking.",
    category: "video",
    Icon: IconBrandTeams,
  },
];

export default function IntegrationsPage() {
  const [filter, setFilter] = useState<Category>("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    return INTEGRATIONS.filter(
      (a) =>
        (filter === "all" || a.category === filter) &&
        (!q.trim() ||
          a.name.toLowerCase().includes(q.toLowerCase()) ||
          a.tagline.toLowerCase().includes(q.toLowerCase())),
    );
  }, [filter, q]);

  useSetHeaderActions(
    <div className="relative">
      <IconSearch className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search integrations"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        className="w-64 pl-9 h-8"
      />
    </div>,
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
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
          <IntegrationCard key={a.kind} integration={a} />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No integrations match your filter.
        </div>
      )}

      <div className="mt-8">
        <AddIntegrationCTA />
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
}: {
  integration: IntegrationCardData;
}) {
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      const redirectUri = `${location.origin}${agentNativePath(
        `/_agent-native/oauth/${integration.kind.replace(/_video$/, "")}/callback`,
      )}`;
      // Video providers go through connect-video; calendar providers go
      // through connect-calendar. The action shape is the same.
      const action =
        integration.category === "video" ? "connect-video" : "connect-calendar";
      const res = await callAction<{ authUrl?: string }>(action, {
        kind: integration.kind,
        redirectUri,
      });
      if (res?.authUrl) location.href = res.authUrl;
    } finally {
      setConnecting(false);
    }
  };

  const Icon = integration.Icon;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 hover:border-foreground/30">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{integration.name}</h3>
            {integration.installed && (
              <Badge variant="secondary" className="text-[10px]">
                Installed
              </Badge>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {integration.tagline}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between">
        <span className="text-[11px] capitalize text-muted-foreground">
          {integration.category}
        </span>
        {integration.installed ? (
          <Button size="sm" variant="ghost">
            Manage
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AddIntegrationCTA() {
  const [prompt, setPrompt] = useState("");
  const { send, isGenerating } = useSendToAgentChat();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    send({
      message: prompt.trim(),
      context:
        "The user wants to add a new integration to the scheduling app. " +
        "Help them add it by: creating a new provider in `@agent-native/scheduling/server/providers/` (if it's a calendar or video integration), " +
        "registering it from `server/plugins/scheduling.ts`, declaring any required secrets via `registerRequiredSecret(...)`, " +
        "adding an entry to `app/routes/_app.apps._index.tsx` so it shows up on the Integrations page, " +
        "and updating the relevant skill docs. Ask clarifying questions if you need to know which service or what capability they need.",
      submit: true,
    });

    setPrompt("");
  }

  return (
    <Card className="border-dashed bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconPlus className="h-4 w-4" />
          Add an integration
        </CardTitle>
        <CardDescription>
          Don't see the service you need? Describe it and the agent will add it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "Add Cronofy so we can sync with Exchange on-prem calendars"'
            className="min-h-[80px] resize-y"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (prompt.trim()) handleSubmit(e);
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!prompt.trim() || isGenerating}
            >
              {isGenerating ? "Sending…" : "Add integration"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
