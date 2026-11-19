import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { STANDALONE_TEST_ITEM_ID } from "@/lib/workflow-editor";

import type { NodeData } from "../../../../server/workflow-host/read-models.js";
import {
  canTestRequestOnItsOwn,
  liveOutputOf,
  type LiveTest,
} from "../api-request-test";
import { classifyReadError } from "../items/read-failure";
import { ReadErrorState } from "../items/read-support";
import type { ItemJourneyData } from "../items/read-types";
import { useWorkflowStrings } from "../workflow-strings";
import {
  cutsOf,
  failureOf,
  fieldsMissingOf,
  isCutByStep,
  listOf,
  readRecordedAnswer,
  standaloneResultOf,
  type AnswerCut,
  type AnswerCuts,
  type ApiRequestFailure,
  type LiveAnswer,
  type MissingFields,
  type RecordedAnswer,
  type StandaloneResult,
} from "./api-request-output";
import {
  includesText,
  rawTableOf,
  schemaOfValue,
  textOf,
} from "./node-data-model";
import { JsonBlock, JsonEntry } from "./NodeDataJson";
import { CountAndSearch, DataPane } from "./NodeDataPane";
import { SchemaView } from "./NodeDataSchema";
import { DataSkeleton, EmptyData } from "./NodeDataStates";
import { Cell } from "./NodeDataTable";
import { NodeDetailsOutputPane, RunMark } from "./NodeDetailsPanes";
import { useDataView, useDebouncedSearch } from "./use-node-data-view";

type OutputPaneProps = ComponentProps<typeof NodeDetailsOutputPane>;
type RunOf = NonNullable<NodeData["run"]>;
type StepOf = NonNullable<NodeData["step"]>;

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-md border-s-2 border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

/** The step cut the answer: what to do about it, then each place it was cut and how much was kept. */
function CutByStepNotice({ answer }: { answer: AnswerCuts }) {
  const ws = useWorkflowStrings();
  const sentence = (cut: AnswerCut) => {
    switch (cut.kind) {
      case "list":
        return ws.apiRequest.cutList(cut.path, cut.kept, cut.of);
      case "text":
        return ws.apiRequest.cutText(cut.path, cut.kept, cut.of);
      case "keys":
        return ws.apiRequest.cutKeys(cut.path, cut.count);
    }
  };
  return (
    <Notice>
      <p>{ws.apiRequest.truncatedNotice}</p>
      {answer.cuts.length > 0 ? (
        <ul className="list-disc ps-4 font-mono">
          {answer.cuts.map((cut) => (
            <li key={`${cut.kind}:${cut.path}`} className="break-words">
              {sentence(cut)}
            </li>
          ))}
        </ul>
      ) : null}
      {answer.omitted > 0 ? (
        <p>{ws.apiRequest.cutsMore(answer.omitted)}</p>
      ) : null}
    </Notice>
  );
}

/** The fields to keep that the answer had no value for, by the names they were typed with. */
function FieldsMissingNotice({ missing }: { missing: MissingFields }) {
  const ws = useWorkflowStrings();
  if (missing.names.length === 0 && missing.more === 0) return null;
  return (
    <Notice>
      <p className="break-words">
        {ws.apiRequest.fieldsMissing(missing.names.join(", "))}
      </p>
      {missing.more > 0 ? (
        <p>{ws.apiRequest.fieldsMissingMore(missing.more)}</p>
      ) : null}
    </Notice>
  );
}

/** A failure as the reference tool shows one: a plain heading from the code or status, and the code, status and message behind it. */
function ApiFailure({ failure }: { failure: ApiRequestFailure }) {
  const ws = useWorkflowStrings();
  // The cap's message says which parts were the largest and what to do, so it opens already.
  const [open, setOpen] = useState(failure.kind === "too_large");
  const Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <div role="alert" className="flex flex-col gap-2 py-3">
      <p className="text-sm font-medium text-destructive">
        {ws.apiRequest.heading[failure.kind]}
      </p>
      {failure.kind === "too_large" ? (
        <p className="text-sm text-muted-foreground">
          {ws.apiRequest.tooLargeHint}
        </p>
      ) : null}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="-ms-2">
            <Chevron aria-hidden />
            {ws.apiRequest.errorDetails}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">
              {ws.apiRequest.detailCode}
            </dt>
            <dd className="font-mono break-words">{failure.code}</dd>
            {failure.status !== null ? (
              <>
                <dt className="text-muted-foreground">
                  {ws.apiRequest.detailStatus}
                </dt>
                <dd className="font-mono">{failure.status}</dd>
              </>
            ) : null}
            {failure.message !== "" ? (
              <>
                <dt className="text-muted-foreground">
                  {ws.apiRequest.detailMessage}
                </dt>
                <dd className="break-words">{failure.message}</dd>
              </>
            ) : null}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The answer in the view the person chose: its fields, its rows, or the JSON itself. */
function RawAnswer({
  value,
  tableValue,
  view,
  query,
  onClear,
}: {
  value: unknown;
  /** What the table lays out: the answer's list when it is one, else the answer. */
  tableValue: unknown;
  view: "schema" | "table" | "json";
  query: string;
  onClear: () => void;
}) {
  const ws = useWorkflowStrings();
  if (view === "schema") {
    return (
      <SchemaView
        fields={schemaOfValue(value)}
        query={query}
        onClear={onClear}
      />
    );
  }
  if (view === "json") {
    return (
      <JsonBlock>
        <JsonEntry
          label={null}
          value={value}
          segments={[]}
          comma={false}
          copyable={false}
        />
      </JsonBlock>
    );
  }
  const table = rawTableOf(tableValue);
  const rows = table.rows.filter((row) => includesText(textOf(row), query));
  if (rows.length === 0) {
    return (
      <EmptyData
        title={ws.nodeData.noMatchingItems}
        action={
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            {ws.nodeData.clearSearch}
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {table.hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          {ws.nodeData.hiddenColumns}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="whitespace-nowrap border-b border-border px-3 py-2 text-start text-xs font-medium text-muted-foreground"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className="border-b border-border align-top last:border-b-0"
              >
                {table.columns.map((column) => (
                  <td key={column.key} className="max-w-64 px-3 py-2">
                    <Cell value={row[column.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What a step that ended badly says for itself, or a plain failure when the run recorded nothing more. */
function resultOf(
  status: StepOf["status"],
  recorded: StandaloneResult,
): StandaloneResult {
  if (
    recorded.kind !== "failed" &&
    (status === "failed" || status === "needs_check")
  ) {
    return { kind: "failed", failure: failureOf("lookup_failed", "") };
  }
  return recorded;
}

interface AnswerViewInput {
  answer: RecordedAnswer;
  /** The text a record held, whose end says whether the step cut it. */
  recordedText: string | null;
  view: "schema" | "table" | "json";
  draft: string;
  setDraft: (draft: string) => void;
  query: string;
  ws: ReturnType<typeof useWorkflowStrings>;
}

/** An answer's toolbar (count and search) and body: the views are the same for a record and for a test just run. */
function answerView({
  answer,
  recordedText,
  view,
  draft,
  setDraft,
  query,
  ws,
}: AnswerViewInput): { toolbar: ReactNode; body: ReactNode } {
  const value = answer.kind === "value" ? answer.value : undefined;
  const list = value === undefined ? null : listOf(value);
  let count = "";
  if (list !== null) {
    count =
      list.total !== null && list.total > list.entries.length
        ? ws.nodeData.ofTotal(list.entries.length, list.total)
        : ws.nodeData.count(list.entries.length);
  }
  const cutShort =
    answer.kind === "text"
      ? recordedText?.endsWith("…[cut]") === true
      : answer.cut;
  const toolbar =
    view === "json" ? (
      count === "" ? null : (
        <p className="text-xs tabular-nums text-muted-foreground">{count}</p>
      )
    ) : (
      <CountAndSearch
        count={count}
        truncated={false}
        draft={draft}
        onDraft={setDraft}
      />
    );
  const body = (
    <>
      {value !== undefined && isCutByStep(value) ? (
        <CutByStepNotice answer={cutsOf(value)} />
      ) : null}
      {value !== undefined ? (
        <FieldsMissingNotice missing={fieldsMissingOf(value)} />
      ) : null}
      {cutShort ? (
        <Notice>
          <p>{ws.apiRequest.cutNotice}</p>
        </Notice>
      ) : null}
      {answer.kind === "value" ? (
        <RawAnswer
          value={answer.value}
          tableValue={list === null ? answer.value : list.entries}
          view={view}
          query={query}
          onClear={() => setDraft("")}
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 font-mono text-xs leading-5">
          {answer.text}
        </pre>
      )}
    </>
  );
  return { toolbar, body };
}

function StandaloneOutput({
  factoryId,
  workflowId,
  node,
  data,
  run,
  step,
}: Pick<OutputPaneProps, "factoryId" | "workflowId" | "node"> & {
  data: NodeData;
  run: RunOf;
  step: StepOf;
}) {
  const ws = useWorkflowStrings();
  const [view, setView] = useDataView("output");
  const { draft, setDraft, query } = useDebouncedSearch();
  const running = step.status === "running";
  // The step's answer is in the record of the blank item a standalone test runs on, so each new run or ending reads it again.
  const journey = useActionQuery<ItemJourneyData>(
    "get-item-journey",
    {
      factoryId,
      workflowId,
      itemId: STANDALONE_TEST_ITEM_ID,
      limit: 100,
    },
    { enabled: !running, refetchOnMount: "always" },
  );

  let toolbar: ReactNode = null;
  let body: ReactNode;
  if (running || journey.isPending) {
    body = <DataSkeleton />;
  } else if (journey.isError) {
    body = (
      <ReadErrorState
        failure={classifyReadError(journey.error)}
        action="get-item-journey"
        onRetry={() => void journey.refetch()}
      />
    );
  } else {
    const result = resultOf(
      step.status,
      standaloneResultOf(journey.data, node.id, run.id),
    );
    if (result.kind === "failed") {
      body = <ApiFailure failure={result.failure} />;
    } else if (result.kind === "none") {
      body = <EmptyData title={ws.apiRequest.noOutputRecorded} />;
    } else {
      ({ toolbar, body } = answerView({
        answer: readRecordedAnswer(result.text),
        recordedText: result.text,
        view,
        draft,
        setDraft,
        query,
        ws,
      }));
    }
  }

  return (
    <DataPane
      title={ws.nodeDetails.outputTitle}
      mark={<RunMark step={step} run={data.run} />}
      view={view}
      onView={setView}
      toolbar={toolbar}
    >
      {body}
    </DataPane>
  );
}

/** What a test just run in this window answered: shown at once as a skeleton, then as the whole bounded response. */
function LiveOutput({ test }: { test: Exclude<LiveTest, { phase: "idle" }> }) {
  const ws = useWorkflowStrings();
  const [view, setView] = useDataView("output");
  const { draft, setDraft, query } = useDebouncedSearch();

  const shown = liveOutputOf(test);
  let mark: ReactNode = null;
  let toolbar: ReactNode = null;
  let body: ReactNode;
  switch (shown.kind) {
    case "skeleton":
      body = <DataSkeleton />;
      break;
    case "failure":
      body = <ApiFailure failure={shown.answer.failure} />;
      break;
    case "answer":
      mark = <LiveMark answer={shown.answer} />;
      ({ toolbar, body } = answerView({
        answer: { kind: "value", value: shown.answer.value, cut: false },
        recordedText: null,
        view,
        draft,
        setDraft,
        query,
        ws,
      }));
      break;
  }
  return (
    <DataPane
      title={ws.nodeDetails.outputTitle}
      mark={mark}
      view={view}
      onView={setView}
      toolbar={toolbar}
    >
      {body}
    </DataPane>
  );
}

/** The status and the time the request took, with what to know about keeping the answer in a tooltip. */
function LiveMark({
  answer,
}: {
  answer: Extract<LiveAnswer, { kind: "answer" }>;
}) {
  const ws = useWorkflowStrings();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-sm text-xs tabular-nums whitespace-nowrap text-muted-foreground"
        >
          {ws.apiRequest.liveMark(answer.status, answer.elapsedMs)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{ws.apiRequest.notStored}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The Output column of an API request. A step tested here shows the answer the
 * test just got, which lives in memory and nowhere else. Otherwise a step
 * tested on its own in a run answers from what the step recorded (a run has no
 * inbox item to list), and every other run of the step shows what the ordinary
 * Output column shows.
 */
export function ApiRequestOutputPane({
  liveTest,
  ...props
}: OutputPaneProps & { liveTest: LiveTest }) {
  const { node, catalog, data, loading, failure } = props;
  const standalone = canTestRequestOnItsOwn(node, catalog);
  if (standalone && liveTest.phase !== "idle") {
    return <LiveOutput test={liveTest} />;
  }
  if (
    !standalone ||
    loading ||
    failure !== null ||
    data?.run?.mode !== "test" ||
    !data.step
  ) {
    return <NodeDetailsOutputPane {...props} />;
  }
  return (
    <StandaloneOutput
      key={`${data.run.id}:${data.step.status}`}
      factoryId={props.factoryId}
      workflowId={props.workflowId}
      node={node}
      data={data}
      run={data.run}
      step={data.step}
    />
  );
}
