import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import {
  dataTableDetailsSchema,
  getDataTableDetailsSchema,
} from "@/lib/model/data-table-contracts";

import { dataBrowserHref } from "../workspace/DataPageAdapter.model";
import type { askToolLabel } from "./askToolLabel";

export function renderAskToolStepDetails(
  tool: Parameters<typeof askToolLabel>[1],
) {
  const name = tool.name.split("__").at(-1);
  if (
    name !== "get-data-table-details" &&
    name !== "get-notebook-table-reference"
  )
    return undefined;
  if (tool.status !== "completed") return undefined;
  const input = getDataTableDetailsSchema.safeParse(tool.input);
  if (!input.success) return undefined;
  return <TableDetails input={input.data} output={tool.output} />;
}

function TableDetails({
  input,
  output,
}: {
  input: { connectionId: string; tableId: string };
  output: unknown;
}) {
  const t = useT();
  let data = output;
  if (typeof output === "string") {
    try {
      data = JSON.parse(output);
    } catch {
      data = null;
    }
  }
  const result = dataTableDetailsSchema.safeParse(data);
  return (
    <div className="my-2 space-y-2">
      {result.success ? (
        <ul className="max-h-44 space-y-1 overflow-auto">
          {result.data.table.columns.map((column) => (
            <li key={column.name}>
              <span className="font-medium text-foreground">{column.name}</span>{" "}
              <code>{column.type}</code>
              {column.description ? <p>{column.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        to={dataBrowserHref(
          "all",
          { type: "table", id: input.tableId },
          input.connectionId,
        )}
        className="underline underline-offset-2"
      >
        {t("analytics.ask.openInDataBrowser")}
      </Link>
    </div>
  );
}
