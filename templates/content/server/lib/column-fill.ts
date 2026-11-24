import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import {
  getRequestOrgId,
  getTask,
  getThread,
  isAgentChatAiSetupReady,
  runWithRequestContext,
  spawnTask,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  accessFilter,
  assertAccess,
  currentAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { readPropertyGenerations } from "../../actions/_property-generations.js";
import { getDatabaseById, nanoid } from "../../actions/_property-utils.js";
import setDocumentProperty from "../../actions/set-document-property.js";
import {
  COLUMN_FILL_CONCURRENCY,
  COLUMN_FILL_MAX_CELLS,
  isColumnFillActive,
  isColumnFillCellSettled,
  isColumnFillPropertyType,
  type ColumnFill,
  type ColumnFillCellStatus,
  type ColumnFillStatus,
} from "../../shared/column-fill.js";
import {
  isEmptyPropertyValue,
  normalizePropertyValue,
  normalizePropertyValueWithOptions,
  parsePropertyOptions,
  parsePropertyValue,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../../shared/properties.js";
import { COLUMN_FILL_SCOPE_TYPE } from "../../shared/quiet-agent-runs.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

export const FILL_COLUMN_CELL_ACTION = "fill-column-cell";

const FILL_AGENT_ACTIONS = ["get-document", FILL_COLUMN_CELL_ACTION];

const UNSTARTED_CELL_TIMEOUT_MS = 2 * 60 * 1000;

const SWEEP_FILL_LIMIT = 20;

type FillRow = typeof schema.contentColumnFills.$inferSelect;
type CellRow = typeof schema.contentColumnFillCells.$inferSelect;
type PropertyDefinitionRow =
  typeof schema.documentPropertyDefinitions.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function cellScopeId(fillId: string, documentId: string, attempt: number) {
  return `${fillId}:${documentId}:${attempt}`;
}

async function canEditDocument(documentId: string): Promise<boolean> {
  try {
    await assertAccess("document", documentId, "editor");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

function alreadyFilling(): ActionContractError {
  return new ActionContractError("This column is already filling.", {
    errorCode: "COLUMN_FILL_ALREADY_RUNNING",
    statusCode: 409,
  });
}

function fillStopping(): ActionContractError {
  return new ActionContractError(
    "This fill is stopping. Try again once it has stopped.",
    { errorCode: "COLUMN_FILL_STOPPING", statusCode: 409 },
  );
}

async function cellIsEmpty(documentId: string, propertyId: string) {
  const row = firstRow(
    await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      ),
  );
  return !row || isEmptyPropertyValue(parsePropertyValue(row.valueJson));
}

function fillNotFound(): ActionContractError {
  return new ActionContractError("That fill doesn't exist.", {
    errorCode: "COLUMN_FILL_NOT_FOUND",
    statusCode: 404,
  });
}

function currentUserEmail(): string {
  const email = getRequestUserEmail();
  if (!email) {
    throw new ActionContractError("Sign in to fill a column with AI.", {
      errorCode: "AUTH_REQUIRED",
      statusCode: 401,
    });
  }
  return email;
}

function sameEmail(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

async function loadFill(fillId: string): Promise<FillRow | null> {
  const fill = firstRow(
    await getDb()
      .select()
      .from(schema.contentColumnFills)
      .where(eq(schema.contentColumnFills.id, fillId)),
  );
  return fill ?? null;
}

async function loadOwnFill(fillId: string): Promise<FillRow> {
  const fill = await loadFill(fillId);
  if (!fill || !sameEmail(fill.ownerEmail, currentUserEmail())) {
    throw fillNotFound();
  }
  await assertAccess("document", fill.databaseDocumentId, "editor");
  return fill;
}

async function loadFillProperty(
  databaseId: string,
  propertyId: string,
): Promise<PropertyDefinitionRow> {
  const definition = firstRow(
    await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId)),
  );
  if (
    !definition ||
    definition.databaseId !== databaseId ||
    definition.systemRole ||
    !isColumnFillPropertyType(definition.type as DocumentPropertyType)
  ) {
    throw new ActionContractError(
      "Fill with AI works on text, number, URL, select and multi-select columns.",
      { errorCode: "COLUMN_FILL_UNSUPPORTED_PROPERTY", statusCode: 400 },
    );
  }
  return definition;
}

function optionNames(definition: PropertyDefinitionRow): string[] {
  return (parsePropertyOptions(definition.optionsJson).options ?? []).map(
    (option) => option.name,
  );
}

export function columnFillValue(
  definition: Pick<PropertyDefinitionRow, "type" | "optionsJson">,
  value: unknown,
): DocumentPropertyValue {
  const type = definition.type as DocumentPropertyType;
  const options = parsePropertyOptions(definition.optionsJson);
  const refuse = (message: string) =>
    new ActionContractError(message, {
      errorCode: "COLUMN_FILL_INVALID_VALUE",
      statusCode: 400,
    });
  if (type === "select" || type === "multi_select") {
    const known = new Set((options.options ?? []).map((option) => option.id));
    const normalized = normalizePropertyValueWithOptions(type, value, options);
    const ids = Array.isArray(normalized)
      ? normalized
      : typeof normalized === "string"
        ? [normalized]
        : [];
    const names = (options.options ?? []).map((option) => option.name);
    const first = firstRow(ids);
    if (first === undefined || ids.some((id) => !known.has(id))) {
      throw refuse(
        names.length
          ? `Use only this column's options: ${names.join(", ")}. Don't invent new ones.`
          : "This column has no options to choose from.",
      );
    }
    return type === "select" ? first : ids;
  }
  const normalized = normalizePropertyValue(type, value);
  if (isEmptyPropertyValue(normalized)) {
    throw refuse("Send a value, or null if the page has nothing for it.");
  }
  if (type === "number" && typeof normalized !== "number") {
    throw refuse("This column takes a number.");
  }
  if (typeof normalized === "string") return normalized.trim();
  return normalized;
}

function typeGuidance(definition: PropertyDefinitionRow): string {
  const type = definition.type as DocumentPropertyType;
  const names = optionNames(definition);
  if (type === "number") return "The value is a number.";
  if (type === "url") return "The value is one full URL.";
  if (type === "select") {
    return `The value is exactly one of these options: ${names.join(", ")}. Never invent another option.`;
  }
  if (type === "multi_select") {
    return `The value is a list of options from: ${names.join(", ")}. Never invent another option.`;
  }
  return "The value is plain text.";
}

function cellTask(args: {
  fill: FillRow;
  definition: PropertyDefinitionRow;
  databaseTitle: string;
  documentId: string;
  pageTitle: string;
}) {
  const { fill, definition, documentId } = args;
  const pageTitle = args.pageTitle.trim() || "Untitled";
  const description = `Fill “${definition.name}” for “${pageTitle}”: ${fill.instruction}`;
  const instructions = [
    `You fill one cell of the Content collection “${args.databaseTitle.trim() || "Untitled"}”: the “${definition.name}” column for the row “${pageTitle}”.`,
    `The person's instruction for the column: ${fill.instruction}`,
    `1. Read the row's page with get-document (id "${documentId}"). Base the value on what the page says.`,
    `2. Call ${FILL_COLUMN_CELL_ACTION} once with fillId "${fill.id}", documentId "${documentId}" and the value. ${typeGuidance(definition)} If the page has nothing to base a value on, send value null with a short reason.`,
    "Change nothing else. Once the cell is saved, reply with one short sentence saying what you wrote.",
    `If the person asks for a change later in this chat, call ${FILL_COLUMN_CELL_ACTION} again with the same fillId and documentId.`,
  ].join("\n");
  return { description, instructions };
}

async function databaseTitle(fill: FillRow): Promise<string> {
  const page = firstRow(
    await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, fill.databaseDocumentId),
          accessFilter(schema.documents, schema.documentShares),
        ),
      ),
  );
  return page?.title ?? "";
}

async function setCell(
  cell: CellRow,
  values: Partial<CellRow>,
  onlyIf?: ColumnFillCellStatus,
) {
  await getDb()
    .update(schema.contentColumnFillCells)
    .set({ ...values, updatedAt: nowIso() })
    .where(
      and(
        eq(schema.contentColumnFillCells.fillId, cell.fillId),
        eq(schema.contentColumnFillCells.documentId, cell.documentId),
        eq(schema.contentColumnFillCells.attempt, cell.attempt),
        onlyIf ? eq(schema.contentColumnFillCells.status, onlyIf) : undefined,
      ),
    );
}

async function reconcileRunningCells(fill: FillRow) {
  const running = await getDb()
    .select()
    .from(schema.contentColumnFillCells)
    .where(
      and(
        eq(schema.contentColumnFillCells.fillId, fill.id),
        eq(schema.contentColumnFillCells.status, "running"),
      ),
    );
  for (const cell of running) {
    if (!cell.taskId) {
      if (Date.now() - Date.parse(cell.updatedAt) > UNSTARTED_CELL_TIMEOUT_MS) {
        await setCell(
          cell,
          { status: "failed", error: "The agent didn't start." },
          "running",
        );
      }
      continue;
    }
    const task = await getTask(cell.taskId, {
      ownerEmail: fill.ownerEmail,
      orgId: fill.orgId,
    });
    if (task?.status === "running") continue;
    const generations = await readPropertyGenerations(
      getDb(),
      [cell.documentId],
      { propertyIds: [fill.propertyId] },
    );
    if (
      generations.of(cell.documentId, fill.propertyId) !==
      (cell.baseGeneration ?? 0)
    ) {
      await setCell(cell, { status: "kept" }, "running");
      continue;
    }
    const error = !task
      ? "The agent's run is gone."
      : task.status === "errored"
        ? task.error?.trim() || "The agent stopped with an error."
        : "The agent finished without filling this cell.";
    await setCell(cell, { status: "failed", error }, "running");
  }
}

async function claimCells(fillId: string): Promise<{
  fill: FillRow;
  claimed: CellRow[];
  more: boolean;
} | null> {
  return getDb().transaction(async (tx) => {
    const fill = firstRow(
      await tx
        .select()
        .from(schema.contentColumnFills)
        .where(eq(schema.contentColumnFills.id, fillId))
        .for("update"),
    );
    if (!fill || !isColumnFillActive(fill.status as ColumnFillStatus)) {
      return null;
    }
    const cells = await tx
      .select()
      .from(schema.contentColumnFillCells)
      .where(eq(schema.contentColumnFillCells.fillId, fillId))
      .orderBy(asc(schema.contentColumnFillCells.position));
    const running = cells.filter((cell) => cell.status === "running").length;
    const waiting = cells.filter((cell) => cell.status === "waiting");
    const stamp = nowIso();
    if (fill.status === "stopping" || !waiting.length) {
      if (!running) {
        const status: ColumnFillStatus =
          fill.status === "stopping" ? "stopped" : "done";
        await tx
          .update(schema.contentColumnFills)
          .set({ status, updatedAt: stamp })
          .where(eq(schema.contentColumnFills.id, fillId));
        return { fill: { ...fill, status }, claimed: [], more: false };
      }
      return { fill, claimed: [], more: false };
    }
    const open = COLUMN_FILL_CONCURRENCY - running;
    if (open <= 0) return { fill, claimed: [], more: false };
    const generations = await readPropertyGenerations(
      tx as unknown as ReturnType<typeof getDb>,
      waiting.map((cell) => cell.documentId),
      { propertyIds: [fill.propertyId] },
    );
    const edited = (cell: CellRow) =>
      generations.of(cell.documentId, fill.propertyId) !==
      (cell.baseGeneration ?? 0);
    const kept = waiting.filter(edited);
    const claimed = waiting
      .filter((cell) => !edited(cell))
      .slice(0, open)
      .map((cell) => ({ ...cell, status: "running", updatedAt: stamp }));
    for (const { status, cells: changed } of [
      { status: "kept", cells: kept },
      { status: "running", cells: claimed },
    ]) {
      if (!changed.length) continue;
      await tx
        .update(schema.contentColumnFillCells)
        .set({ status, updatedAt: stamp })
        .where(
          and(
            eq(schema.contentColumnFillCells.fillId, fillId),
            inArray(
              schema.contentColumnFillCells.documentId,
              changed.map((cell) => cell.documentId),
            ),
          ),
        );
    }
    await tx
      .update(schema.contentColumnFills)
      .set({ updatedAt: stamp })
      .where(eq(schema.contentColumnFills.id, fillId));
    return { fill, claimed, more: true };
  });
}

async function cellTaskContext(fill: FillRow, cells: CellRow[]) {
  const definition = await loadFillProperty(fill.databaseId, fill.propertyId);
  const collectionTitle = await databaseTitle(fill);
  const pages = await getDb()
    .select({ id: schema.documents.id, title: schema.documents.title })
    .from(schema.documents)
    .where(
      and(
        inArray(
          schema.documents.id,
          cells.map((cell) => cell.documentId),
        ),
        accessFilter(schema.documents, schema.documentShares),
      ),
    );
  const titles = new Map(pages.map((page) => [page.id, page.title]));
  return { definition, collectionTitle, titles };
}

async function startCellAgents(fill: FillRow, cells: CellRow[]) {
  if (!cells.length) return;
  let context: Awaited<ReturnType<typeof cellTaskContext>>;
  try {
    context = await cellTaskContext(fill, cells);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "This column can't be filled.";
    for (const cell of cells) {
      await setCell(cell, { status: "failed", error: message }, "running");
    }
    return;
  }
  const { definition, collectionTitle, titles } = context;
  for (const cell of cells) {
    if (!(await canEditDocument(cell.documentId))) {
      await setCell(
        cell,
        { status: "failed", error: "You can no longer edit this row." },
        "running",
      );
      continue;
    }
    const { description, instructions } = cellTask({
      fill,
      definition,
      databaseTitle: collectionTitle,
      documentId: cell.documentId,
      pageTitle: titles.get(cell.documentId) ?? "",
    });
    try {
      const task = await spawnTask({
        description,
        instructions,
        ownerEmail: fill.ownerEmail,
        name: `Fill ${definition.name}`,
        scope: {
          type: COLUMN_FILL_SCOPE_TYPE,
          id: cellScopeId(fill.id, cell.documentId, cell.attempt),
          label: definition.name,
        },
        quiet: true,
        allowedActionNames: FILL_AGENT_ACTIONS,
        parentSourceAppId: "content",
        parentDelegationDepth: 0,
      });
      await getDb()
        .update(schema.contentColumnFillCells)
        .set({
          taskId: task.taskId,
          agentThreadId: task.threadId,
          runId: task.runId ?? null,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(schema.contentColumnFillCells.fillId, fill.id),
            eq(schema.contentColumnFillCells.documentId, cell.documentId),
            eq(schema.contentColumnFillCells.attempt, cell.attempt),
            isNull(schema.contentColumnFillCells.taskId),
          ),
        );
    } catch (error) {
      await setCell(
        cell,
        {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "The agent couldn't start.",
        },
        "running",
      );
    }
  }
}

interface SweepBudget {
  deadlineAt: number;
  signal?: AbortSignal;
}

function outOfTime(budget: SweepBudget | undefined): boolean {
  if (!budget) return false;
  return Boolean(budget.signal?.aborted) || Date.now() >= budget.deadlineAt;
}

export async function advanceColumnFill(
  fillId: string,
  budget?: SweepBudget,
): Promise<void> {
  const fill = await loadFill(fillId);
  if (!fill || !isColumnFillActive(fill.status as ColumnFillStatus)) return;
  await runWithRequestContext(
    {
      userEmail: fill.ownerEmail,
      ...(fill.orgId ? { orgId: fill.orgId } : {}),
    },
    async () => {
      if (
        fill.status === "running" &&
        !(await canEditDocument(fill.databaseDocumentId))
      ) {
        await requestStop(fill.id);
      }
      await reconcileRunningCells(fill);
      do {
        const result = await claimCells(fillId);
        if (!result?.more) return;
        await startCellAgents(result.fill, result.claimed);
      } while (!outOfTime(budget));
    },
  );
}

export async function readColumnFill(fillId: string): Promise<ColumnFill> {
  const fill = await loadFill(fillId);
  if (!fill) throw fillNotFound();
  const cells = await getDb()
    .select()
    .from(schema.contentColumnFillCells)
    .where(eq(schema.contentColumnFillCells.fillId, fillId))
    .orderBy(asc(schema.contentColumnFillCells.position));
  return toColumnFill(fill, cells);
}

function toColumnFill(fill: FillRow, cells: CellRow[]): ColumnFill {
  return {
    id: fill.id,
    databaseId: fill.databaseId,
    propertyId: fill.propertyId,
    instruction: fill.instruction,
    rewrite: fill.rewrite,
    status: fill.status as ColumnFillStatus,
    total: fill.total,
    settled: cells.filter((cell) =>
      isColumnFillCellSettled(cell.status as ColumnFillCellStatus),
    ).length,
    createdAt: fill.createdAt,
    updatedAt: fill.updatedAt,
    cells: cells.map((cell) => ({
      documentId: cell.documentId,
      status: cell.status as ColumnFillCellStatus,
      agentThreadId: cell.agentThreadId,
      error: cell.error,
    })),
  };
}

export async function startColumnFill(args: {
  databaseId: string;
  propertyId: string;
  instruction: string;
  rewrite: boolean;
  documentIds: string[];
}): Promise<ColumnFill> {
  const ownerEmail = currentUserEmail();
  const database = await getDatabaseById(args.databaseId);
  if (!database) {
    throw new ActionContractError("That collection doesn't exist.", {
      errorCode: "DATABASE_NOT_FOUND",
      statusCode: 404,
    });
  }
  await assertAccess("document", database.documentId, "editor");
  const definition = await loadFillProperty(database.id, args.propertyId);
  if (!(await isAgentChatAiSetupReady())) {
    throw new ActionContractError("Set up AI to fill cells.", {
      errorCode: "AI_SETUP_REQUIRED",
      statusCode: 403,
    });
  }
  const db = getDb();

  const active = firstRow(
    await db
      .select({ id: schema.contentColumnFills.id })
      .from(schema.contentColumnFills)
      .where(
        and(
          eq(schema.contentColumnFills.databaseId, database.id),
          eq(schema.contentColumnFills.propertyId, definition.id),
          inArray(schema.contentColumnFills.status, ["running", "stopping"]),
        ),
      ),
  );
  if (active) throw alreadyFilling();

  const requested = [...new Set(args.documentIds)];
  const rows = requested.length
    ? await db
        .select({ documentId: schema.contentDatabaseItems.documentId })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.documents,
          eq(schema.documents.id, schema.contentDatabaseItems.documentId),
        )
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, database.id),
            inArray(schema.contentDatabaseItems.documentId, requested),
            isNull(schema.documents.trashedAt),
            accessFilter(
              schema.documents,
              schema.documentShares,
              currentAccess(),
              "editor",
            ),
          ),
        )
    : [];
  const members = new Set(rows.map((row) => row.documentId));
  let documentIds = requested.filter((id) => members.has(id));
  const generations = await readPropertyGenerations(db, documentIds, {
    propertyIds: [definition.id],
  });
  const values = documentIds.length
    ? await db
        .select({
          documentId: schema.documentPropertyValues.documentId,
          valueJson: schema.documentPropertyValues.valueJson,
        })
        .from(schema.documentPropertyValues)
        .where(
          and(
            inArray(schema.documentPropertyValues.documentId, documentIds),
            eq(schema.documentPropertyValues.propertyId, definition.id),
          ),
        )
    : [];
  if (!args.rewrite) {
    const filled = new Set(
      values
        .filter(
          (value) => !isEmptyPropertyValue(parsePropertyValue(value.valueJson)),
        )
        .map((value) => value.documentId),
    );
    documentIds = documentIds.filter((id) => !filled.has(id));
  }
  if (!documentIds.length) {
    throw new ActionContractError(
      args.rewrite
        ? "There are no cells to fill in this view."
        : "There are no empty cells to fill in this view.",
      { errorCode: "COLUMN_FILL_NOTHING_TO_FILL", statusCode: 400 },
    );
  }
  if (documentIds.length > COLUMN_FILL_MAX_CELLS) {
    throw new ActionContractError(
      `Fill with AI fills up to ${COLUMN_FILL_MAX_CELLS} cells at a time. Filter the view to fewer rows.`,
      { errorCode: "COLUMN_FILL_TOO_MANY_CELLS", statusCode: 400 },
    );
  }

  const fillId = nanoid(16);
  const stamp = nowIso();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.contentColumnFills).values({
        id: fillId,
        ownerEmail,
        orgId: getRequestOrgId() ?? null,
        databaseId: database.id,
        databaseDocumentId: database.documentId,
        propertyId: definition.id,
        instruction: args.instruction.trim(),
        rewrite: args.rewrite,
        status: "running",
        total: documentIds.length,
        createdAt: stamp,
        updatedAt: stamp,
      });
      await tx.insert(schema.contentColumnFillCells).values(
        documentIds.map((documentId, position) => ({
          fillId,
          documentId,
          position,
          status: "waiting",
          baseGeneration: generations.of(documentId, definition.id),
          updatedAt: stamp,
        })),
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyFilling();
    throw error;
  }
  await advanceColumnFill(fillId);
  return readColumnFill(fillId);
}

async function requestStop(fillId: string) {
  const stamp = nowIso();
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.contentColumnFills)
      .set({ status: "stopping", updatedAt: stamp })
      .where(
        and(
          eq(schema.contentColumnFills.id, fillId),
          eq(schema.contentColumnFills.status, "running"),
        ),
      );
    await tx
      .update(schema.contentColumnFillCells)
      .set({ status: "skipped", updatedAt: stamp })
      .where(
        and(
          eq(schema.contentColumnFillCells.fillId, fillId),
          eq(schema.contentColumnFillCells.status, "waiting"),
        ),
      );
  });
}

export async function stopColumnFill(fillId: string): Promise<ColumnFill> {
  const fill = await loadOwnFill(fillId);
  if (fill.status === "running") await requestStop(fillId);
  await advanceColumnFill(fillId);
  return readColumnFill(fillId);
}

export async function retryColumnFillCell(args: {
  fillId: string;
  documentId: string;
}): Promise<ColumnFill> {
  const fill = await loadOwnFill(args.fillId);
  const cell = firstRow(
    await getDb()
      .select()
      .from(schema.contentColumnFillCells)
      .where(
        and(
          eq(schema.contentColumnFillCells.fillId, fill.id),
          eq(schema.contentColumnFillCells.documentId, args.documentId),
        ),
      ),
  );
  if (!cell) throw fillNotFound();
  if (cell.status === "failed") {
    const generations = await readPropertyGenerations(
      getDb(),
      [cell.documentId],
      { propertyIds: [fill.propertyId] },
    );
    const generation = generations.of(cell.documentId, fill.propertyId);
    const kept =
      generation !== (cell.baseGeneration ?? 0) &&
      !(await cellIsEmpty(cell.documentId, fill.propertyId));
    const stamp = nowIso();
    try {
      await getDb().transaction(async (tx) => {
        const current = firstRow(
          await tx
            .select({ status: schema.contentColumnFills.status })
            .from(schema.contentColumnFills)
            .where(eq(schema.contentColumnFills.id, fill.id))
            .for("update"),
        );
        if (current?.status === "stopping") throw fillStopping();
        const updated = await tx
          .update(schema.contentColumnFillCells)
          .set(
            kept
              ? { status: "kept", error: null, updatedAt: stamp }
              : {
                  status: "waiting",
                  error: null,
                  taskId: null,
                  agentThreadId: null,
                  runId: null,
                  attempt: cell.attempt + 1,
                  baseGeneration: generation,
                  updatedAt: stamp,
                },
          )
          .where(
            and(
              eq(schema.contentColumnFillCells.fillId, fill.id),
              eq(schema.contentColumnFillCells.documentId, cell.documentId),
              eq(schema.contentColumnFillCells.attempt, cell.attempt),
              eq(schema.contentColumnFillCells.status, "failed"),
            ),
          )
          .returning({ documentId: schema.contentColumnFillCells.documentId });
        if (kept || !updated.length) return;
        await tx
          .update(schema.contentColumnFills)
          .set({ status: "running", updatedAt: stamp })
          .where(eq(schema.contentColumnFills.id, fill.id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyFilling();
      throw error;
    }
  }
  await advanceColumnFill(fill.id);
  return readColumnFill(fill.id);
}

export async function fillColumnCell(
  args: {
    fillId: string;
    documentId: string;
    value: unknown;
    reason?: string | undefined;
  },
  ctx: ActionRunContext | undefined,
): Promise<{ status: ColumnFillCellStatus; message: string }> {
  const fill = await loadOwnFill(args.fillId);
  const generations = await readPropertyGenerations(
    getDb(),
    [args.documentId],
    { propertyIds: [fill.propertyId] },
  );
  const cell = firstRow(
    await getDb()
      .select()
      .from(schema.contentColumnFillCells)
      .where(
        and(
          eq(schema.contentColumnFillCells.fillId, fill.id),
          eq(schema.contentColumnFillCells.documentId, args.documentId),
        ),
      ),
  );
  if (!cell) throw fillNotFound();
  const status = cell.status as ColumnFillCellStatus;
  const thread = ctx?.threadId ? await getThread(ctx.threadId) : null;
  if (
    !ctx?.threadId ||
    thread?.scope?.type !== COLUMN_FILL_SCOPE_TYPE ||
    thread.scope.id !== cellScopeId(fill.id, cell.documentId, cell.attempt) ||
    (cell.agentThreadId && ctx.threadId !== cell.agentThreadId)
  ) {
    return {
      status,
      message: "This cell belongs to another run, so nothing was saved.",
    };
  }
  if (status === "waiting" || status === "skipped") {
    return {
      status,
      message:
        status === "waiting"
          ? "This cell's run hasn't started, so nothing was saved."
          : "This fill was stopped before this cell, so nothing was saved.",
    };
  }
  const followUp = Boolean(
    ctx.turnId &&
    cell.runId &&
    ctx.threadId === cell.agentThreadId &&
    ctx.turnId !== cell.runId,
  );
  const definition = await loadFillProperty(fill.databaseId, fill.propertyId);

  if (args.value === null || args.value === undefined) {
    if (followUp || status !== "running") {
      return { status, message: "Nothing was changed." };
    }
    const reason = args.reason?.trim();
    await setCell(
      cell,
      {
        status: "failed",
        error: reason
          ? `Nothing to fill from the page: ${reason}`
          : "Nothing to fill from the page.",
      },
      "running",
    );
    await advanceColumnFill(fill.id);
    return { status: "failed", message: "The cell was left empty." };
  }

  const keptMessage =
    "Someone edited this cell while you worked, so their value stays. Don't save it again.";
  if (!followUp && status === "kept") {
    return { status, message: keptMessage };
  }
  if (!followUp && status === "filled") {
    return {
      status,
      message: "This cell is already filled. Don't save it again.",
    };
  }

  const value = columnFillValue(definition, args.value);
  if (!(await canEditDocument(cell.documentId))) {
    const message = "You can no longer edit this row, so nothing was saved.";
    if (followUp || status !== "running") return { status, message };
    await setCell(
      cell,
      { status: "failed", error: "You can no longer edit this row." },
      "running",
    );
    await advanceColumnFill(fill.id);
    return { status: "failed", message };
  }
  try {
    await setDocumentProperty.run(
      {
        documentId: cell.documentId,
        databaseId: fill.databaseId,
        propertyId: fill.propertyId,
        value,
        expectedGeneration: followUp
          ? generations.of(cell.documentId, fill.propertyId)
          : (cell.baseGeneration ?? 0),
      },
      ctx,
    );
  } catch (error) {
    if (
      error instanceof ActionContractError &&
      error.errorCode === "PROPERTY_GENERATION_CONFLICT"
    ) {
      if (followUp) {
        return {
          status,
          message:
            "This cell changed while you were saving, so nothing was saved. Read the page again before saving.",
        };
      }
      await setCell(cell, { status: "kept" }, status);
      await advanceColumnFill(fill.id);
      return { status: "kept", message: keptMessage };
    }
    throw error;
  }
  await setCell(cell, { status: "filled", error: null });
  await advanceColumnFill(fill.id);
  return { status: "filled", message: "Saved." };
}

export async function listColumnFills(
  databaseId: string,
): Promise<ColumnFill[]> {
  const database = await getDatabaseById(databaseId);
  if (!database) return [];
  await assertAccess("document", database.documentId, "viewer");
  const ownerEmail = currentUserEmail();
  const owned = and(
    eq(schema.contentColumnFills.databaseId, database.id),
    sql`LOWER(${schema.contentColumnFills.ownerEmail}) = LOWER(${ownerEmail})`,
  );
  const active = await getDb()
    .select()
    .from(schema.contentColumnFills)
    .where(
      and(
        owned,
        inArray(schema.contentColumnFills.status, ["running", "stopping"]),
      ),
    );
  const recent = await getDb()
    .select()
    .from(schema.contentColumnFills)
    .where(owned)
    .orderBy(desc(schema.contentColumnFills.createdAt))
    .limit(50);
  const latest = new Map<string, FillRow>();
  for (const fill of [...active, ...recent]) {
    if (!latest.has(fill.propertyId)) latest.set(fill.propertyId, fill);
  }
  const result: ColumnFill[] = [];
  for (const fill of latest.values()) {
    result.push(await readColumnFill(fill.id));
  }
  return result;
}

async function activeFillIds(limit: number): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.contentColumnFills.id })
    .from(schema.contentColumnFills)
    .where(inArray(schema.contentColumnFills.status, ["running", "stopping"]))
    .orderBy(asc(schema.contentColumnFills.updatedAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

export async function sweepColumnFills(budget: SweepBudget): Promise<void> {
  for (const fillId of await activeFillIds(SWEEP_FILL_LIMIT)) {
    if (outOfTime(budget)) return;
    try {
      await advanceColumnFill(fillId, budget);
    } catch (error) {
      console.warn(`[column-fill] could not advance fill ${fillId}:`, error);
    }
  }
}

export async function nextColumnFillDueAt(): Promise<number | null> {
  return (await activeFillIds(1)).length ? Date.now() : null;
}
