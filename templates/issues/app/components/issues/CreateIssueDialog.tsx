import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProjects } from "@/hooks/use-projects";
import { useCreateIssue } from "@/hooks/use-issues";
import { markdownToAdf } from "@/lib/adf-client";
import { toast } from "sonner";

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectKey?: string;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  defaultProjectKey,
}: CreateIssueDialogProps) {
  const { data: projectsData } = useProjects();
  const createIssue = useCreateIssue();
  const [projectKey, setProjectKey] = useState(defaultProjectKey || "");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [priority, setPriority] = useState("Medium");

  const projects = projectsData?.values || [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectKey || !summary.trim()) return;

    const body: Record<string, unknown> = {
      fields: {
        project: { key: projectKey },
        summary: summary.trim(),
        issuetype: { name: issueType },
        priority: { name: priority },
        ...(description.trim()
          ? { description: markdownToAdf(description) }
          : {}),
      },
    };

    createIssue.mutate(body, {
      onSuccess: (data: any) => {
        toast.success(`Created ${data.key}`);
        onOpenChange(false);
        setSummary("");
        setDescription("");
      },
      onError: (error: any) => {
        toast.error(`Failed to create issue: ${error.message}`);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Issue</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Project
            </label>
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select project...</option>
              {projects.map((p: any) => (
                <option key={p.key} value={p.key}>
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Type + Priority */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Type
              </label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="Story">Story</option>
                <option value="Epic">Epic</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="Highest">Highest</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
                <option value="Lowest">Lowest</option>
              </select>
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Summary
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Issue title"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Description (markdown)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue..."
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              rows={4}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!projectKey || !summary.trim() || createIssue.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {createIssue.isPending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
