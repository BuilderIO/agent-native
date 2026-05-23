import { useEffect, useState } from "react";
import { agentNativePath } from "@agent-native/core/client";
import { toast } from "sonner";
import { IconLoader2 } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreatePrDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId: string;
  currentBranch: string | null;
  onCreated: (result: {
    prUrl?: string;
    prNumber?: number;
    owner?: string;
    repo?: string;
  }) => void;
}

/**
 * "Commit + push + open PR" dialog used by the Source Control panel.
 *
 * Defaults the branch field to the current branch so a one-step flow on
 * the user's existing feature branch is the fast path. If they want a
 * fresh branch, they edit the field and we create + checkout it on
 * submit.
 */
export function CreatePrDialog({
  open,
  onOpenChange,
  workspaceId,
  currentBranch,
  onCreated,
}: CreatePrDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);

  // Default branchName to current branch on open.
  useEffect(() => {
    if (open) {
      setBranchName(currentBranch ?? "");
    }
  }, [open, currentBranch]);

  async function submit() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/create-pr-from-changes"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            title: title.trim(),
            body: body.trim() || undefined,
            baseBranch: baseBranch.trim() || "main",
            branchName: branchName.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `PR creation failed (${res.status})`);
      }
      const result = await res.json();
      if (result.ok === false && result.connected === false) {
        toast.error(result.message || "GitHub isn't connected to Workbench.", {
          action: result.connectUrl
            ? {
                label: "Connect",
                onClick: () => window.open(result.connectUrl, "_blank"),
              }
            : undefined,
        });
        return;
      }
      onCreated(result);
      setTitle("");
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open PR.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create pull request</DialogTitle>
          <DialogDescription>
            Commits your changes, pushes the branch, and opens a PR via the
            shared GitHub integration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pr-title">Title</Label>
            <Input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A short summary…"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-body">Description</Label>
            <textarea
              id="pr-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Optional. Markdown is fine."
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pr-branch">Branch</Label>
              <Input
                id="pr-branch"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feature-x"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pr-base">Base</Label>
              <Input
                id="pr-base"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            New branch names trigger a checkout. Same as current branch ={" "}
            <span className="font-mono">{currentBranch ?? "(none)"}</span>{" "}
            commits in place.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="cursor-pointer"
            onClick={() => void submit()}
            disabled={!title.trim() || submitting}
          >
            {submitting ? (
              <IconLoader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            {submitting ? "Creating…" : "Create PR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
