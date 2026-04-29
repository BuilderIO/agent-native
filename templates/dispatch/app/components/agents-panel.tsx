import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { IconExternalLink, IconTrash } from "@tabler/icons-react";

export interface ConnectedAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  source: "builtin" | "custom";
  resourceId?: string;
  path?: string;
  scope?: "shared" | "personal";
}

export function AgentsPanel({
  agents,
  onRefresh,
}: {
  agents: ConnectedAgent[];
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const customAgents = agents.filter((agent) => agent.source === "custom");
  const builtinAgents = agents.filter((agent) => agent.source === "builtin");

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;

    const id = trimmedName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const agentJson = JSON.stringify(
      {
        id,
        name: trimmedName,
        description: description.trim() || undefined,
        url: trimmedUrl,
        color: "#6B7280",
      },
      null,
      2,
    );

    setSaving(true);
    try {
      const res = await fetch("/_agent-native/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `agents/${id}.json`,
          content: agentJson,
          shared: true,
        }),
      });
      if (res.ok) {
        setName("");
        setUrl("");
        setDescription("");
        onRefresh();
        nameRef.current?.focus();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (resourceId?: string) => {
    if (!resourceId) return;
    const res = await fetch(`/_agent-native/resources/${resourceId}`, {
      method: "DELETE",
    });
    if (res.ok) onRefresh();
  };

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">
              Available by default
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {builtinAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                  <span>{agent.name}</span>
                </div>
              ))}
              {builtinAgents.length === 0 && (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No default agents detected.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-foreground">
              Added in this workspace
            </div>
            <div className="mt-2 space-y-2">
              {customAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {agent.name}
                    </div>
                    {agent.description ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {agent.description}
                      </div>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <a
                        href={agent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {agent.url}
                        <IconExternalLink className="h-3 w-3" />
                      </a>
                      <span>·</span>
                      <span>{agent.scope || "shared"}</span>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this agent?</AlertDialogTitle>
                        <AlertDialogDescription>
                          “{agent.name}” will be removed from the workspace. Any
                          jobs or chats that delegate to it will stop working.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(agent.resourceId)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
              {customAgents.length === 0 && (
                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No extra agents added yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="text-sm font-medium text-foreground">
            Add external agent
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Add another A2A-compatible app by saving its agent endpoint here.
          </p>
          <div className="mt-4 space-y-3">
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://app.example.com"
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            <Button
              className="w-full"
              onClick={handleAdd}
              disabled={!name.trim() || !url.trim() || saving}
            >
              {saving ? "Saving..." : "Add agent"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
