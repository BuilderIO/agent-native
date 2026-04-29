import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { format } from "date-fns";
import {
  IconPlus,
  IconDots,
  IconTrash,
  IconCopy,
  IconExternalLink,
  IconChartBar,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { VisibilityBadge } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useForms,
  useCreateForm,
  useDeleteForm,
  useUpdateForm,
} from "@/hooks/use-forms";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft:
    "bg-amber-600/10 text-amber-600 dark:text-amber-400 border-amber-600/20",
  published:
    "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/20",
  closed: "bg-destructive/10 text-destructive border-destructive/20",
};

export function FormsListPage() {
  const navigate = useNavigate();
  const { data: forms = [], isLoading, error, refetch } = useForms();
  const createForm = useCreateForm();
  const deleteForm = useDeleteForm();
  const updateForm = useUpdateForm();
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  function handleCreate() {
    createForm.mutate(
      { title: "Untitled Form" },
      { onSuccess: (form) => navigate(`/forms/${form.id}`) },
    );
  }

  const headerActions = useMemo(
    () => (
      <Button onClick={handleCreate} className="gap-2 shrink-0 cursor-pointer">
        <IconPlus className="h-4 w-4" />
        <span className="hidden sm:inline">New Form</span>
        <span className="sm:hidden">New</span>
      </Button>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useSetHeaderActions(headerActions);

  function handleDuplicate(form: (typeof forms)[0]) {
    createForm.mutate(
      {
        title: `${form.title} (copy)`,
        description: form.description,
        fields: form.fields,
        settings: form.settings,
      },
      {
        onSuccess: (newForm) => {
          toast.success("Form duplicated");
          navigate(`/forms/${newForm.id}`);
        },
      },
    );
  }

  function handleDelete(id: string) {
    deleteForm.mutate(
      { id },
      {
        onSuccess: () => toast.success("Form deleted"),
      },
    );
  }

  function handleTogglePublish(form: (typeof forms)[0]) {
    const newStatus = form.status === "published" ? "draft" : "published";
    if (newStatus === "published" && isLocal) {
      setShowCloudUpgrade(true);
      return;
    }
    updateForm.mutate(
      { id: form.id, status: newStatus },
      {
        onSuccess: () =>
          toast.success(
            newStatus === "published" ? "Form published" : "Form unpublished",
          ),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 max-w-5xl mx-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border border-border rounded-xl p-4 sm:p-5 bg-card"
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-14 rounded-full" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-10" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !forms?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Failed to load forms</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      {forms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-xl">
          <h3 className="font-medium mb-1">No forms yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first form to get started
          </p>
          <Button onClick={handleCreate} size="sm" className="gap-2">
            <IconPlus className="h-4 w-4" />
            Create Form
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <div
              key={form.id}
              className="group relative border border-border rounded-xl p-4 sm:p-5 hover:border-primary/30 cursor-pointer bg-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/forms/${form.id}`)}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  e.target === e.currentTarget
                ) {
                  e.preventDefault();
                  navigate(`/forms/${form.id}`);
                }
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-medium truncate">{form.title}</h3>
                    <VisibilityBadge
                      visibility={(form as any).visibility}
                      className="shrink-0"
                    />
                  </div>
                  {form.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {form.description}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    asChild
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 w-10 sm:h-8 sm:w-8 p-0 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                      aria-label="Form actions"
                    >
                      <IconDots className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/forms/${form.id}/responses`);
                      }}
                    >
                      <IconChartBar className="h-4 w-4 mr-2" />
                      View Responses
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePublish(form);
                      }}
                    >
                      <IconExternalLink className="h-4 w-4 mr-2" />
                      {form.status === "published" ? "Unpublish" : "Publish"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicate(form);
                      }}
                    >
                      <IconCopy className="h-4 w-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(form.id);
                      }}
                    >
                      <IconTrash className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] shrink-0",
                    statusColors[form.status],
                  )}
                >
                  {form.status}
                </Badge>
                <div className="flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">
                    {form.responseCount ?? 0} responses
                  </span>
                  <span className="whitespace-nowrap">
                    {format(new Date(form.createdAt), "MMM d")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCloudUpgrade && (
        <CloudUpgrade
          title="Publish Form"
          description="To publish forms publicly, connect a cloud database so submissions can be received from anywhere."
          onClose={() => setShowCloudUpgrade(false)}
        />
      )}
    </div>
  );
}
