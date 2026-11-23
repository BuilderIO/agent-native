import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import type { Cell } from "@/lib/model/contracts";

import { ProjectGraphView } from "./ProjectGraphView";

it("lists a cell with no inputs as having no upstream and never as its own dependency", () => {
  const cells = [
    {
      id: "c1",
      contents: {
        kind: "sql",
        source: "select 1",
        resultVariable: "orders",
        order: "a",
      },
    },
    {
      id: "c2",
      contents: { kind: "sql", source: "select * from orders", order: "b" },
    },
  ] as unknown as Cell[];
  const html = renderToStaticMarkup(
    <ProjectGraphView
      cells={cells}
      titles={
        new Map([
          ["c1", "Orders"],
          ["c2", "Rollup"],
        ])
      }
    />,
  );
  const rows = html.split("<li").slice(1);
  expect(rows[0]).toContain("No upstream cells");
  expect(rows[1]).toContain("Depends on Orders");
  expect(rows[1]).not.toContain("Rollup, ");
  expect(rows[1]).not.toContain("Orders, Rollup");
});
