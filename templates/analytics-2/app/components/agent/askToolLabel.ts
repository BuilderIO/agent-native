import type { useT } from "@agent-native/core/client/i18n";
import type { AgentChatSurfaceProps } from "@agent-native/toolkit/app/chat";
import { z } from "zod";

type Tool = Parameters<
  NonNullable<AgentChatSurfaceProps["resolveToolStepLabel"]>
>[0];
const toolInput = z.object({
  kind: z.string().optional(),
  name: z.string().optional(),
  query: z.string().optional(),
  search: z.string().optional(),
  title: z.string().optional(),
});

export function askToolLabel(t: ReturnType<typeof useT>, tool: Tool) {
  if (tool.status === "failed" || tool.status === "cancelled") return undefined;
  const complete = tool.status === "completed";
  const input = toolInput.safeParse(tool.input).data;
  const search = input?.search ?? input?.query;
  switch (tool.name.split("__").at(-1)) {
    case undefined:
      return undefined;
    case "list-data-connections": {
      if (!complete) return t("analytics.ask.trace.listingConnections");
      const result = z
        .object({ connections: z.array(z.unknown()) })
        .safeParse(tool.output);
      return result.success
        ? t("analytics.ask.trace.listedConnections", {
            count: result.data.connections.length,
          })
        : undefined;
    }
    case "query-dbt-semantic-metrics":
    case "list-dbt-semantic-metrics":
      return complete && search
        ? t("analytics.ask.trace.searchedModels", { query: search })
        : undefined;
    case "get-data-browser-catalog":
    case "list-connection-datasets":
      return complete && search
        ? t("analytics.ask.trace.searchedTables", { query: search })
        : t("analytics.ask.trace.searchingTables");
    case "get-data-table-details":
    case "get-notebook-table-reference":
      return complete
        ? t("analytics.ask.trace.viewedTable", { count: 1 })
        : t("analytics.ask.trace.viewingTable");
    case "validate-data-sql-formatting":
      return t("analytics.ask.trace.validatingSql");
    case "add-project-cell":
      if (input?.kind === "sql" && input.name)
        return t(
          complete
            ? "analytics.ask.trace.createdCell"
            : "analytics.ask.trace.creatingSql",
          { name: input.name },
        );
      if (input?.kind === "chart")
        return complete && input.name
          ? t("analytics.ask.trace.createdChart", { title: input.name })
          : t("analytics.ask.trace.creatingChart");
      break;
    case "render-data-widget":
      if (input?.title)
        return t(
          complete
            ? "analytics.ask.trace.createdChart"
            : "analytics.ask.trace.creatingChart",
          { title: input.title },
        );
      break;
  }
  return undefined;
}
