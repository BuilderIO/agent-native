import { useState } from "react";
import { agentNativePath } from "@agent-native/core/client";
import { toast } from "sonner";
import { IconPlus, IconTrash, IconFolder } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Workspace {
  id: string;
  label: string;
  path: string;
}

interface CodeSettingsPanelProps {
  workspaces: Workspace[];
  onWorkspaceAdded: () => void;
  onWorkspaceRemoved: (id: string) => void;
}

/**
 * Settings panel for the Code Room — lives inside the sidebar when the
 * user clicks the gear icon on the activity bar. The panel doesn't
 * touch the top-level `/settings` route; we keep workspace management
 * scoped to the Code Room so it stays close to where it's used.
 */
export function CodeSettingsPanel({
  workspaces,
  onWorkspaceAdded,
  onWorkspaceRemoved,
}: CodeSettingsPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Workspaces
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
        <AddWorkspaceForm onAdded={onWorkspaceAdded} />
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Registered
          </div>
          {workspaces.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              No workspaces yet. Add one above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <WorkspaceRow
                    workspace={w}
                    onRemoved={() => onWorkspaceRemoved(w.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function AddWorkspaceForm({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!label.trim() || !path.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/add-code-workspace"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim(), path: path.trim() }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Add failed (${res.status})`);
      }
      const result = await res.json();
      toast.success(
        result.alreadyAdded
          ? `"${label}" already registered`
          : `Added "${label}"`,
      );
      setLabel("");
      setPath("");
      onAdded();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add workspace.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      <div className="space-y-1">
        <Label htmlFor="code-ws-label" className="text-[11px]">
          Label
        </Label>
        <Input
          id="code-ws-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. acme-monorepo"
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="code-ws-path" className="text-[11px]">
          Absolute path
        </Label>
        <Input
          id="code-ws-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/projects/acme-monorepo"
          className="h-7 font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Tilde (~) expands to your home dir.
        </p>
      </div>
      <Button
        size="sm"
        className="w-full cursor-pointer"
        onClick={() => void submit()}
        disabled={!label.trim() || !path.trim() || submitting}
      >
        <IconPlus size={12} aria-hidden />
        {submitting ? "Adding…" : "Add workspace"}
      </Button>
    </div>
  );
}

function WorkspaceRow({
  workspace,
  onRemoved,
}: {
  workspace: Workspace;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/remove-code-workspace"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: workspace.id }),
        },
      );
      if (!res.ok) throw new Error(`Remove failed (${res.status})`);
      toast.success(`Removed "${workspace.label}"`);
      onRemoved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove workspace.",
      );
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="flex items-start gap-2">
        <IconFolder
          size={14}
          aria-hidden
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{workspace.label}</p>
          <p
            className="truncate font-mono text-[10px] text-muted-foreground"
            title={workspace.path}
          >
            {workspace.path}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 cursor-pointer"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${workspace.label}`}
        >
          <IconTrash size={12} aria-hidden />
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes <span className="font-mono">{workspace.label}</span> from
              the Code Room. The files on disk are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              disabled={removing}
              className="cursor-pointer"
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
