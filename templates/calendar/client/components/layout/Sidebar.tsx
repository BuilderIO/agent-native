import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, Clock, Users, Settings, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useGoogleAuthStatus, useGoogleAuthUrl } from "@/hooks/use-google-auth";

const navItems = [
  { path: "/", label: "Calendar", icon: CalendarDays },
  { path: "/availability", label: "Availability", icon: Clock },
  { path: "/bookings", label: "Bookings", icon: Users },
  { path: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function GoogleConnectSidebarButton() {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);
    }
  }, [authUrl.data]);

  return (
    <div className="border-t border-border p-3">
      <div className="rounded-lg bg-primary/10 p-3">
        <p className="mb-1 text-xs font-semibold text-foreground">
          Connect Google Calendar
        </p>
        <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Sync your events and manage everything in one place.
        </p>
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs font-semibold"
          onClick={() => setWantAuthUrl(true)}
          disabled={authUrl.isLoading || authUrl.isFetching}
        >
          <ExternalLink className="h-3 w-3" />
          {authUrl.isLoading ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const googleStatus = useGoogleAuthStatus();
  const isConnected = googleStatus.data?.connected ?? false;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-60 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <span className="text-base font-semibold tracking-tight">
            Calendar
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-2.5">
          {navItems.map((item) => {
            const isActive =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Google status / connect CTA */}
        {!googleStatus.isLoading && !isConnected && (
          <GoogleConnectSidebarButton />
        )}

        {isConnected && googleStatus.data?.email && (
          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="truncate text-xs text-muted-foreground">
                {googleStatus.data.email}
              </p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
