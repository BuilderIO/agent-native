import { Link, useParams } from "react-router-dom";
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Trash2,
  Tag,
  Plus,
  Settings,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLabels } from "@/hooks/use-emails";
import { useState } from "react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onCompose: () => void;
}

const systemNavItems = [
  { view: "inbox", label: "Inbox", icon: Inbox },
  { view: "starred", label: "Starred", icon: Star },
  { view: "sent", label: "Sent", icon: Send },
  { view: "drafts", label: "Drafts", icon: FileText },
  { view: "archive", label: "Archive", icon: Archive },
  { view: "trash", label: "Trash", icon: Trash2 },
];

export function Sidebar({ open, onClose, onCompose }: SidebarProps) {
  const { view = "inbox" } = useParams<{ view: string }>();
  const { data: labels = [] } = useLabels();
  const [labelsExpanded, setLabelsExpanded] = useState(true);

  const userLabels = labels.filter((l) => l.type === "user");

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex h-full w-56 flex-col border-r border-border bg-sidebar transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.236-8 4.882-8-4.882V6h16v2.236z" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">
            Mail
          </span>
        </div>

        {/* Compose button */}
        <div className="px-3 pb-3">
          <Button
            onClick={() => {
              onCompose();
              onClose();
            }}
            className="w-full justify-start gap-2 rounded-2xl font-medium"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            Compose
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {systemNavItems.map((item) => {
            const isActive = view === item.view;
            const label = labels.find((l) => l.id === item.view);
            return (
              <Link
                key={item.view}
                to={`/${item.view}`}
                onClick={onClose}
                className={cn(
                  "group flex items-center justify-between rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </span>
                {label?.unreadCount ? (
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {label.unreadCount}
                  </span>
                ) : null}
              </Link>
            );
          })}

          {/* Labels section */}
          {userLabels.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setLabelsExpanded(!labelsExpanded)}
                className="flex w-full items-center gap-1 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                {labelsExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Labels
              </button>

              {labelsExpanded && (
                <div className="mt-1 space-y-0.5">
                  {userLabels.map((label) => {
                    const isActive =
                      view === `label:${label.id}` || view === label.id;
                    return (
                      <Link
                        key={label.id}
                        to={`/label:${label.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "text-sidebar-foreground hover:bg-sidebar-accent",
                        )}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: label.color || "#6b7280" }}
                        />
                        {label.name}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Settings link */}
        <div className="border-t border-border p-2">
          <Link
            to="/settings"
            onClick={onClose}
            className="flex items-center gap-3 rounded-full px-3 py-1.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </aside>
    </>
  );
}
