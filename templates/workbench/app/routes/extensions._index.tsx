import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLayoutGrid, IconPlus } from "@tabler/icons-react";
import {
  agentNativePath,
  focusAgentChat,
  sendToAgentChat,
} from "@agent-native/core/client";
import { toast } from "sonner";
import { RoomHeader } from "@/components/room-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  ToolCard,
  type ToolCardData,
  type ToolVisibility,
} from "@/components/tools/tool-card";
import { ToolCardSkeleton, ToolsGrid } from "@/components/tools/tools-grid";
import { ToolPitchBanner } from "@/components/tools/tool-pitch-banner";
import { ToolActionsMenu } from "@/components/tools/tool-actions-menu";

export function meta() {
  return [
    { title: "Workbench — Custom Tools" },
    {
      name: "description",
      content:
        "Customize Workbench with sandboxed mini-apps — no fork, no PR, no deploy.",
    },
  ];
}

/**
 * Server row shape from `GET /_agent-native/extensions`. Only the fields we
 * actually render are listed here; the endpoint returns more (icon, etc.)
 * but they aren't surfaced on the Workbench card today.
 */
interface ExtensionRow {
  id: string;
  name: string;
  description?: string | null;
  ownerEmail?: string | null;
  visibility?: ToolVisibility;
  /** False when the current user is not the owner — DELETE then falls back
   *  to a per-user hide, see `delete-extension` helper. */
  canDelete?: boolean | null;
}

const EXTENSIONS_QUERY_KEY = ["extensions"] as const;
const CUSTOM_TOOLS_QUERY_KEY = ["list-custom-tools"] as const;

const SCAFFOLD_PROMPT_PREFIX = "Build me a Custom Tool that ";

/**
 * The Custom Tools room. Wraps the framework's existing extensions system
 * with Workbench's room chrome — see `templates/workbench/PRD.md` §8.4.
 *
 * Reads from the framework's `GET /_agent-native/extensions` (filtered by
 * ownership + sharing on the server, so no scoping work happens here).
 * Deletes optimistically via the shared `delete-extension` action.
 * Creating a tool delegates to the agent — there is no manual editor for
 * extensions, per the `extensions` skill.
 */
export default function ToolsIndex() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ExtensionRow[]>({
    queryKey: EXTENSIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/extensions"));
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? (body as ExtensionRow[]) : [];
    },
  });

  // The root layout also invalidates `list-custom-tools` from the dbSync
  // hook, so we keep that keyspace in lockstep with `extensions`. Mirror
  // here on first paint so the polled sync picks up the latest count.
  useEffect(() => {
    if (data) {
      queryClient.setQueryData(CUSTOM_TOOLS_QUERY_KEY, data);
    }
  }, [data, queryClient]);

  // Note the user's current view so the agent's `<context>` knows we're on
  // the Custom Tools room — same pattern used by the rest of Workbench.
  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "extensions" }),
    }).catch(() => {});
  }, []);

  const tools = useMemo<ToolCardData[]>(() => {
    if (!data) return [];
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      ownerEmail: row.ownerEmail ?? null,
      visibility: row.visibility ?? "private",
      // `canDelete === false` is the framework's signal that the viewer is
      // not the owner — i.e. it's shared with them.
      sharedWithMe: row.canDelete === false,
    }));
  }, [data]);

  const count = tools.length;

  const openCreatePrompt = () => {
    // Seed the agent with a scaffold prompt instead of submitting one
    // automatically — capturing the user's input is the whole value.
    sendToAgentChat({
      message: SCAFFOLD_PROMPT_PREFIX,
      context: [
        "The user is on the Custom Tools room in Workbench and clicked '+ New tool'.",
        "Treat the user's next message as the description of a sandboxed Alpine.js extension to build via the `create-extension` action. The new tool will show up in this same /extensions room.",
        "Don't ask whether to use Builder or modify React source — there is no source code involved.",
      ].join("\n"),
      submit: false,
      openSidebar: true,
    });
    // Make sure focus actually lands in the composer for fast typing.
    focusAgentChat();
  };

  const handleDelete = async (tool: ToolCardData) => {
    // Lazy-import the framework helper so the route module stays free of the
    // helper at first paint — it's only used on action.
    const { deleteOrHideExtension, invalidateExtensionRemoval } =
      await import("@agent-native/core/client/extensions");

    const previous =
      queryClient.getQueryData<ExtensionRow[]>(EXTENSIONS_QUERY_KEY);
    queryClient.setQueryData<ExtensionRow[]>(EXTENSIONS_QUERY_KEY, (rows) =>
      (rows ?? []).filter((r) => r.id !== tool.id),
    );
    queryClient.setQueryData<ExtensionRow[]>(CUSTOM_TOOLS_QUERY_KEY, (rows) =>
      (rows ?? []).filter((r) => r.id !== tool.id),
    );

    try {
      const result = await deleteOrHideExtension({
        id: tool.id,
        // The grid card carries `sharedWithMe` as a derived flag — map back
        // to the framework's `canDelete` so the helper picks the right
        // endpoint (DELETE vs /hide).
        canDelete: !tool.sharedWithMe,
      });
      // The framework helper types its QueryClient against the core
      // package's own resolved @tanstack/query-core version. pnpm may
      // resolve a different sibling here, so cast through unknown to
      // bridge the structurally-identical-but-#privately-branded types.
      invalidateExtensionRemoval(
        queryClient as unknown as Parameters<
          typeof invalidateExtensionRemoval
        >[0],
        tool.id,
      );
      toast.success(
        result.mode === "hidden"
          ? `Removed "${tool.name}" from your list`
          : `Deleted "${tool.name}"`,
      );
    } catch (err) {
      // Roll back the optimistic remove.
      if (previous) {
        queryClient.setQueryData(EXTENSIONS_QUERY_KEY, previous);
        queryClient.setQueryData(CUSTOM_TOOLS_QUERY_KEY, previous);
      }
      const message =
        err instanceof Error ? err.message : "Could not delete tool";
      toast.error(message);
      throw err;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <RoomHeader
        title={
          isLoading
            ? "Custom Tools"
            : count === 0
              ? "Custom Tools"
              : `Custom Tools · ${count} ${count === 1 ? "tool" : "tools"}`
        }
        subtitle="Sandboxed mini-apps the agent builds for you. Persistent to your org, scoped per user, shareable."
        right={
          <Button
            size="sm"
            onClick={openCreatePrompt}
            className="cursor-pointer"
          >
            <IconPlus size={16} aria-hidden />
            New tool
          </Button>
        }
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
          {isLoading ? (
            <ToolsGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <ToolCardSkeleton key={i} />
              ))}
            </ToolsGrid>
          ) : count === 0 ? (
            <EmptyState
              icon={IconLayoutGrid}
              title="No custom tools yet"
              description="Ask the agent to build one — Linear sprint kanban, slowest endpoints from Datadog, flaky tests this week, anything you can describe."
              action={
                <Button onClick={openCreatePrompt} className="cursor-pointer">
                  <IconPlus size={16} aria-hidden />
                  New tool
                </Button>
              }
            />
          ) : (
            <ToolsGrid>
              {tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  menu={
                    <ToolActionsMenu
                      tool={{
                        id: tool.id,
                        name: tool.name,
                        canDelete: !tool.sharedWithMe,
                      }}
                      onDelete={() => handleDelete(tool)}
                      variant="compact"
                    />
                  }
                />
              ))}
            </ToolsGrid>
          )}

          <ToolPitchBanner onAskAgent={openCreatePrompt} />
        </div>
      </div>
    </div>
  );
}
