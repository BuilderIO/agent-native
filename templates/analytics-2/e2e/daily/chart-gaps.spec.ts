import { projectDocumentSchema } from "../../app/lib/model/contracts";
import { expect, test, uniqueName } from "./fixtures";

const source = `SELECT v.day, v.base, v.upper
FROM (VALUES ('a', 2, NULL), ('b', 3, 1), ('c', 4, 2),
             ('d', 5, NULL), ('e', 6, 0), ('f', 7, 4), ('g', 8, NULL))
  AS v(day, base, upper)
CROSS JOIN (SELECT 1 FROM orders LIMIT 1) sample`;

test("report A2-ASK84-LINE-GAPS", async ({ daily }, info) => {
  const project = await daily.createProject(uniqueName("QA chart gaps"));
  try {
    const add = async (kind: "sql" | "chart") => {
      const result = await daily.action<{
        project: unknown;
        createdCellId: string;
      }>("add-project-cell", { projectId: project.id, kind });
      const cell = projectDocumentSchema
        .parse(result.project)
        .cells.find((item) => item.id === result.createdCellId);
      if (!cell) throw new Error(`Added ${kind} cell missing`);
      return cell;
    };
    const sql = await add("sql");
    if (sql.contents.kind !== "sql") throw new Error("SQL cell missing");
    await daily.action("save-project-cell", {
      projectId: project.id,
      cellId: sql.id,
      expectedUpdatedAt: sql.updatedAt,
      contents: {
        ...sql.contents,
        source,
        dataConnectionId: "builtin-sample-data",
        resultVariable: "gap_data",
      },
    });
    const run = await daily.action<{ status: string }>("run-project-cell", {
      projectId: project.id,
      cellId: sql.id,
    });
    expect(run.status).toBe("complete");
    const ids: string[] = [];
    for (const mark of ["line", "area"] as const) {
      const cell = await add("chart");
      if (cell.contents.kind !== "chart") throw new Error("Chart cell missing");
      ids.push(cell.id);
      await daily.action("save-project-cell", {
        projectId: project.id,
        cellId: cell.id,
        expectedUpdatedAt: cell.updatedAt,
        contents: {
          ...cell.contents,
          dataframe: "gap_data",
          chartSpec: {
            mark,
            xField: "day",
            yField: mark === "line" ? "upper" : "base",
            ...(mark === "area"
              ? { yFields: ["base", "upper"], stacked: true }
              : {}),
            seriesField: null,
            title: `Gap ${mark}`,
            legend: true,
            colors: mark === "line" ? ["#cc3300"] : ["#0066cc", "#cc3300"],
            seriesLabels: { base: "Base", upper: "Upper" },
          },
        },
      });
    }
    const read = await daily.action<{
      project: unknown;
      outputs: Record<string, { output: unknown }>;
    }>("get-project", { projectId: project.id }, "GET");
    expect(read.outputs[sql.id]?.output).toMatchObject({
      type: "table",
      rows: [
        ["a", 2, null],
        ["b", 3, 1],
        ["c", 4, 2],
        ["d", 5, null],
        ["e", 6, 0],
        ["f", 7, 4],
        ["g", 8, null],
      ],
    });
    const saved = projectDocumentSchema.parse(read.project);
    expect(
      saved.cells.find((cell) => cell.id === sql.id)?.contents,
    ).toMatchObject({ source, resultVariable: "gap_data" });
    for (const [index, mark] of ["line", "area"].entries()) {
      expect(
        saved.cells.find((cell) => cell.id === ids[index])?.contents,
      ).toMatchObject({
        dataframe: "gap_data",
        chartSpec: { mark, legend: true },
      });
    }
    await daily.action("publish-project", { projectId: project.id });
    await daily.open(`/app/${encodeURIComponent(project.id)}/latest`);
    for (const phase of ["published", "reload"]) {
      if (phase === "reload") await daily.reload();
      const line = daily.page.locator(".nb-chart-mark-line");
      const area = daily.page.locator(".nb-chart-mark-area");
      await expect(line).toBeVisible();
      await expect(area).toBeVisible();
      await expect(line.locator(".nb-chart-line")).toHaveCount(2);
      await expect(area.locator(".nb-chart-area")).toHaveCount(3);
      await expect(area.locator(".nb-chart-line")).toHaveCount(3);
      const geometry = await area.locator("svg").evaluate((svg) => {
        const points = (element: Element) =>
          (element.getAttribute("points") ?? "").split(" ");
        return {
          lines: [...svg.querySelectorAll(".nb-chart-line")].map(points),
          fills: [...svg.querySelectorAll(".nb-chart-area")].map(points),
        };
      });
      expect(geometry.lines.map((points) => points.length)).toEqual([7, 2, 2]);
      expect(geometry.fills.map((points) => points.length)).toEqual([14, 4, 4]);
      expect(geometry.fills[1]?.slice(2)).toEqual([
        geometry.lines[0]?.[2],
        geometry.lines[0]?.[1],
      ]);
      expect(geometry.fills[2]?.slice(2)).toEqual([
        geometry.lines[0]?.[5],
        geometry.lines[0]?.[4],
      ]);
      const linePoints = await line
        .locator(".nb-chart-line")
        .evaluateAll((elements) =>
          elements.map((el) => (el.getAttribute("points") ?? "").split(" ")),
        );
      expect(linePoints.map((points) => points.length)).toEqual([2, 2]);
      await expect(line.locator(".nb-chart-caption").last()).toContainText(
        "Upper",
      );
      await expect(area.locator(".nb-chart-caption").last()).toContainText(
        "Base",
      );
      await expect(area.locator(".nb-chart-caption").last()).toContainText(
        "Upper",
      );
      expect(
        await line
          .locator(".nb-chart-line")
          .first()
          .evaluate((el) => getComputedStyle(el).stroke),
      ).toBe("rgb(204, 51, 0)");
      expect(
        await area
          .locator(".nb-chart-line")
          .nth(0)
          .evaluate((el) => getComputedStyle(el).stroke),
      ).toBe("rgb(0, 102, 204)");
      expect(
        await area
          .locator(".nb-chart-line")
          .nth(1)
          .evaluate((el) => getComputedStyle(el).stroke),
      ).toBe("rgb(204, 51, 0)");
      await daily.page.screenshot({
        path: info.outputPath(`chart-gaps-${phase}.png`),
        fullPage: true,
      });
      await daily.check();
    }
  } finally {
    await daily.open("/home");
    await daily.cleanupProject(project.id);
    const absent = await daily.context.request.get(
      `${daily.server.base}/_agent-native/actions/get-project`,
      { params: { projectId: project.id } },
    );
    expect(absent.status()).toBe(404);
  }
});
