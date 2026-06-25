import { agentNativePath } from "@agent-native/core/client";
import { IconExternalLink, IconTrash } from "@tabler/icons-react";
import { useRef, useState, type FormEvent } from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConnectedAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  source: "builtin" | "custom" | "workspace";
  resourceId?: string;
  path?: string;
  scope?: "shared" | "personal";
}

type AgentFormErrors = Partial<Record<"name" | "url" | "form", string>>;

function slugifyAgentName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateAgentForm(name: string, url: string): AgentFormErrors {
  const errors: AgentFormErrors = {};
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();

  if (!trimmedName) {
    errors.name = "Agent name is required.";
  } else if (!slugifyAgentName(trimmedName)) {
    errors.name = "Agent name must include at least one letter or number.";
  }

  if (!trimmedUrl) {
    errors.url = "Agent endpoint URL is required.";
  } else {
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors.url = "Use an http:// or https:// endpoint URL.";
      } else if (!parsed.hostname) {
        errors.url = "Enter a complete endpoint URL with a host.";
      } else if (parsed.username || parsed.password) {
        errors.url = "Do not include credentials in the endpoint URL.";
      }
    } catch {
      errors.url =
        "Enter a valid endpoint URL, such as https://app.example.com.";
    }
  }

  return errors;
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
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const customAgents = agents.filter((agent) => agent.source === "custom");
  const workspaceAgents = agents.filter(
    (agent) => agent.source === "workspace",
  );
  const builtinAgents = agents.filter((agent) => agent.source === "builtin");

  const handleAdd = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const nextErrors = validateAgentForm(trimmedName, trimmedUrl);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const id = slugifyAgentName(trimmedName);
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
      const res = await fetch(agentNativePath("/_agent-native/resources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `remote-agents/${id}.json`,
          content: agentJson,
          shared: true,
        }),
      });
      if (res.ok) {
        setName("");
        setUrl("");
        setDescription("");
        setErrors({});
        onRefresh();
        nameRef.current?.focus();
      } else {
        setErrors({
          form: `Could not add agent. Request failed with ${res.status}.`,
        });
      }
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : "Could not add agent. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (resourceId?: string) => {
    if (!resourceId) return;
    const res = await fetch(
      agentNativePath(`/_agent-native/resources/${resourceId}`),
      {
        method: "DELETE",
      },
    );
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
              {workspaceAgents.map((agent) => (
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
                    <div className="mt-1 text-xs text-muted-foreground">
                      <a
                        href={agent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {agent.url}
                        <IconExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
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
              {workspaceAgents.length === 0 && customAgents.length === 0 && (
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
          <form className="mt-4 space-y-3" onSubmit={handleAdd} noValidate>
            <div className="space-y-1.5">
              <Input
                ref={nameRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="Name"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "external-agent-name-error" : undefined
                }
              />
              {errors.name ? (
                <p
                  id="external-agent-name-error"
                  className="text-xs font-medium text-destructive"
                >
                  {errors.name}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Input
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setErrors((current) => ({ ...current, url: undefined }));
                }}
                placeholder="https://app.example.com"
                aria-invalid={Boolean(errors.url)}
                aria-describedby={
                  errors.url ? "external-agent-url-error" : undefined
                }
              />
              {errors.url ? (
                <p
                  id="external-agent-url-error"
                  className="text-xs font-medium text-destructive"
                >
                  {errors.url}
                </p>
              ) : null}
            </div>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
            />
            {errors.form ? (
              <p className="text-xs font-medium text-destructive">
                {errors.form}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Saving..." : "Add agent"}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
