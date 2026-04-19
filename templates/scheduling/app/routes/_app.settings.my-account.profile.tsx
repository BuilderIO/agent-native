import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/api";
import { toast } from "sonner";
import {
  IconBell,
  IconBrush,
  IconCode,
  IconKey,
  IconUser,
} from "@tabler/icons-react";

const SETTINGS_NAV = [
  {
    group: "My Account",
    items: [
      { to: "/settings/my-account/profile", label: "Profile", icon: IconUser },
      {
        to: "/settings/my-account/general",
        label: "General",
        icon: IconBrush,
        disabled: true,
      },
      {
        to: "/settings/my-account/calendars",
        label: "Calendars",
        icon: IconBell,
        disabled: true,
      },
      {
        to: "/settings/my-account/password",
        label: "Password",
        icon: IconKey,
        disabled: true,
      },
    ],
  },
  {
    group: "Developer",
    items: [
      {
        to: "/settings/developer/api-keys",
        label: "API keys",
        icon: IconCode,
        disabled: true,
      },
      {
        to: "/settings/developer/webhooks",
        label: "Webhooks",
        icon: IconCode,
        disabled: true,
      },
    ],
  },
];

export default function ProfileSettings() {
  const [form, setForm] = useState({
    name: "",
    username: "",
    bio: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeFormat: "12h",
    weekStart: "Sunday",
    language: "en",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await callAction("update-profile", form);
      toast.success("Profile saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const initials =
    form.name
      ?.split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="mx-auto grid max-w-6xl gap-8 p-6 lg:grid-cols-[220px_1fr] lg:p-8">
      <aside className="space-y-6">
        {SETTINGS_NAV.map((group) => (
          <div key={group.group}>
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.group}
            </h3>
            <nav className="flex flex-col gap-0.5">
              {group.items.map((it) => {
                const Icon = it.icon;
                if (it.disabled) {
                  return (
                    <span
                      key={it.to}
                      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60"
                    >
                      <Icon className="h-4 w-4" />
                      {it.label}
                    </span>
                  );
                }
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        isActive
                          ? "bg-accent font-medium"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {it.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>

      <main className="min-w-0 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage settings for your account.
          </p>
        </header>

        <Section
          label="Avatar"
          description="Upload a picture for your profile."
        >
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <Button variant="outline" size="sm" disabled>
                Upload avatar
              </Button>
              <span className="text-xs text-muted-foreground">
                PNG or JPG up to 3MB.
              </span>
            </div>
          </div>
        </Section>

        <Separator />

        <Section label="Full name">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            placeholder="Jane Smith"
          />
        </Section>

        <Section
          label="Username"
          description="This is your public URL for your booking page."
        >
          <div className="flex rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
            <span className="flex items-center rounded-l-md bg-muted px-3 text-xs text-muted-foreground">
              yourdomain.com/
            </span>
            <Input
              value={form.username}
              onChange={(e) =>
                setForm({ ...form, username: e.currentTarget.value })
              }
              className="border-0 rounded-l-none focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="jane"
            />
          </div>
        </Section>

        <Section label="About">
          <Textarea
            rows={3}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.currentTarget.value })}
            placeholder="A short bio shown on your booking page."
          />
        </Section>

        <Separator />

        <Section label="Timezone">
          <Input
            value={form.timezone}
            onChange={(e) =>
              setForm({ ...form, timezone: e.currentTarget.value })
            }
          />
        </Section>

        <Section label="Time format">
          <Select
            value={form.timeFormat}
            onValueChange={(v) => setForm({ ...form, timeFormat: v })}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12h">12-hour (1:30 PM)</SelectItem>
              <SelectItem value="24h">24-hour (13:30)</SelectItem>
            </SelectContent>
          </Select>
        </Section>

        <Section label="Week starts on">
          <Select
            value={form.weekStart}
            onValueChange={(v) => setForm({ ...form, weekStart: v })}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section label="Language">
          <Select
            value={form.language}
            onValueChange={(v) => setForm({ ...form, language: v })}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="pt">Português</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
            </SelectContent>
          </Select>
        </Section>

        <div className="flex justify-end pt-4">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Update"}
          </Button>
        </div>
      </main>
    </div>
  );
}

function Section({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[200px_1fr] md:gap-6">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
