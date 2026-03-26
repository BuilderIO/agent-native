import { Link, useLocation, useNavigate } from "react-router";
import { FileText, Plus, LayoutDashboard, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useForms, useCreateForm } from "@/hooks/use-forms";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft: "bg-amber-600/10 text-amber-600 dark:text-amber-400",
  published: "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400",
  closed: "bg-destructive/10 text-destructive",
};

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: forms = [] } = useForms();
  const createForm = useCreateForm();

  function handleCreate() {
    createForm.mutate(
      { title: "Untitled Form" },
      {
        onSuccess: (form) => navigate(`/forms/${form.id}`),
      },
    );
  }

  return (
    <aside className="flex h-screen w-72 flex-col border-r border-border bg-card/95">
      <div className="border-b border-border px-4 py-4">
        <Link
          to="/forms"
          className="flex items-center gap-3 text-foreground transition-colors hover:text-foreground/90"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40 shadow-sm">
            <LayoutDashboard className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Workspace
            </p>
            <h2 className="truncate text-base font-semibold tracking-tight">
              Forms
            </h2>
          </div>
        </Link>
      </div>

      <div className="border-b border-border px-4 py-4">
        <Button
          onClick={handleCreate}
          className="h-10 w-full justify-start gap-2.5 rounded-xl"
        >
          <Plus className="h-4 w-4" />
          New Form
        </Button>
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            All Forms
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Recent drafts and published forms
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1.5 pb-4">
          {forms.map((form) => {
            const isActive =
              location.pathname === `/forms/${form.id}` ||
              location.pathname === `/forms/${form.id}/responses`;
            return (
              <Link
                key={form.id}
                to={`/forms/${form.id}`}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all",
                  isActive
                    ? "border-primary/20 bg-primary/8 text-foreground shadow-sm"
                    : "border-transparent text-foreground/72 hover:border-border hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                    isActive
                      ? "border-primary/20 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {form.title || "Untitled Form"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    /f/{form.slug}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    statusColors[form.status],
                  )}
                >
                  {form.status}
                </Badge>
                <ArrowRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-opacity",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground/50 opacity-0 group-hover:opacity-100",
                  )}
                />
              </Link>
            );
          })}

          {forms.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                No forms yet
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create your first form to start collecting responses.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <div>
          <p className="text-xs font-medium text-foreground">Appearance</p>
          <p className="text-[11px] text-muted-foreground">Theme</p>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
