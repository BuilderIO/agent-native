import { Link, useLocation, useNavigate } from "react-router";
import {
  FileText,
  Plus,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useForms, useCreateForm } from "@/hooks/use-forms";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  published: "bg-green-500/10 text-green-600 dark:text-green-400",
  closed: "bg-red-500/10 text-red-600 dark:text-red-400",
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
    <div className="flex h-screen w-64 flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        <Link to="/forms" className="flex items-center gap-2 font-semibold text-sidebar-foreground">
          <LayoutDashboard className="h-5 w-5" />
          <span>Forms</span>
        </Link>
      </div>

      {/* New form button */}
      <div className="px-3 py-3">
        <Button
          onClick={handleCreate}
          className="w-full justify-start gap-2"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          New Form
        </Button>
      </div>

      {/* Forms list */}
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1 pb-4">
          {forms.map((form) => {
            const isActive =
              location.pathname === `/forms/${form.id}` ||
              location.pathname === `/forms/${form.id}/responses`;
            return (
              <Link
                key={form.id}
                to={`/forms/${form.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{form.title}</span>
                <Badge
                  variant="secondary"
                  className={cn("text-[10px] px-1.5 py-0", statusColors[form.status])}
                >
                  {form.status}
                </Badge>
              </Link>
            );
          })}

          {forms.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No forms yet. Create your first form above.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
