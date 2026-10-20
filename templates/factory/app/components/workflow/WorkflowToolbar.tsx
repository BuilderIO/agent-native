import {
  IconAlertTriangle,
  IconArrowLeft,
  IconClipboardCopy,
  IconDeviceFloppy,
  IconDots,
  IconFlask,
  IconHistory,
  IconLoader2,
  IconMessageCircle,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { ProblemRow } from "./workflow-problems";
import { useWorkflowStrings } from "./workflow-strings";

interface WorkflowToolbarProps {
  workflowName: string;
  /** The Workflows list, for the back arrow. */
  backHref: string;

  dirty: boolean;
  saving: boolean;
  onSave: () => void;

  problems: ProblemRow[];
  problemsOpen: boolean;
  onProblemsOpenChange: (open: boolean) => void;
  onJumpToProblem: (problem: ProblemRow) => void;

  testing: boolean;
  /** Saves first when there are unsaved edits, so the test runs what is on the canvas. */
  onTestRun: () => void;
  /** A real run of the saved workflow; offered only while it is switched on. */
  onRunNow: () => void;

  enabled: boolean;
  enabledPending: boolean;
  onEnabledChange: (enabled: boolean) => void;

  /** What still needs connecting, composed in by the page; nothing when all is connected. */
  connections: ReactNode;
  /** The run picker, composed in by the page. */
  runPicker: ReactNode;
  onOpenVersions: () => void;
  onAskAgent: () => void;
  /** Copies the diagnostics bundle; the page owns the request and the fallback dialog. */
  onCopyDiagnostics: () => void;
  diagnosticsPending: boolean;
}

function IconTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** One slim row over the canvas: where you are, what is unsaved, and what you can do with the workflow. */
export function WorkflowToolbar({
  workflowName,
  backHref,
  dirty,
  saving,
  onSave,
  problems,
  problemsOpen,
  onProblemsOpenChange,
  onJumpToProblem,
  testing,
  onTestRun,
  onRunNow,
  enabled,
  enabledPending,
  onEnabledChange,
  connections,
  runPicker,
  onOpenVersions,
  onAskAgent,
  onCopyDiagnostics,
  diagnosticsPending,
}: WorkflowToolbarProps) {
  const ws = useWorkflowStrings();

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-border bg-background px-2 py-1.5 sm:px-3">
        <IconTooltip label={ws.page.backToWorkflows}>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
          >
            <Link to={backHref} aria-label={ws.page.backToWorkflows}>
              <IconArrowLeft />
            </Link>
          </Button>
        </IconTooltip>

        <h1 className="min-w-0 max-w-[40ch] truncate text-sm font-medium sm:text-base">
          {workflowName}
        </h1>
        {dirty ? (
          <span
            role="img"
            aria-label={ws.toolbar.unsavedMark}
            title={ws.toolbar.unsavedMark}
            className="size-1.5 shrink-0 rounded-full bg-foreground"
          />
        ) : null}

        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {connections}

          {problems.length > 0 ? (
            <Popover open={problemsOpen} onOpenChange={onProblemsOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <IconAlertTriangle />
                  {ws.toolbar.problems(problems.length)}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="max-h-80 w-80 overflow-y-auto p-1"
                aria-label={ws.toolbar.problemsListName}
              >
                <ul className="flex flex-col">
                  {problems.map((problem) => {
                    const jumpable = problem.nodeId || problem.edgeId;
                    const body = (
                      <>
                        <span className="block text-sm">
                          {problem.sentence}
                        </span>
                        {problem.where ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {problem.where}
                          </span>
                        ) : null}
                      </>
                    );
                    return (
                      <li key={problem.key}>
                        {jumpable ? (
                          <button
                            type="button"
                            title={ws.toolbar.jumpToProblem}
                            className="w-full rounded-sm px-2 py-1.5 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => onJumpToProblem(problem)}
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="px-2 py-1.5">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}

          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? (
              <IconLoader2 className="animate-spin" />
            ) : (
              <IconDeviceFloppy />
            )}
            {saving ? ws.toolbar.saving : ws.toolbar.save}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing || saving}
            aria-label={dirty ? ws.toolbar.saveAndTest : ws.toolbar.testRun}
            onClick={onTestRun}
          >
            {testing ? <IconLoader2 className="animate-spin" /> : <IconFlask />}
            <span className="hidden lg:inline">
              {testing
                ? ws.toolbar.testing
                : dirty
                  ? ws.toolbar.saveAndTest
                  : ws.toolbar.testRun}
            </span>
          </Button>

          {runPicker}

          <div className="flex items-center gap-2 px-1.5">
            <Switch
              id="workflow-enabled"
              checked={enabled}
              disabled={enabledPending}
              aria-label={enabled ? ws.toolbar.turnOff : ws.toolbar.turnOn}
              onCheckedChange={onEnabledChange}
            />
            <Label htmlFor="workflow-enabled" className="text-sm font-normal">
              {ws.toolbar.enabled}
            </Label>
          </div>

          <IconTooltip label={ws.toolbar.versions}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={ws.toolbar.versions}
              onClick={onOpenVersions}
            >
              <IconHistory />
              <span className="hidden lg:inline">{ws.toolbar.versions}</span>
            </Button>
          </IconTooltip>

          <IconTooltip label={ws.toolbar.askAgent}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={ws.toolbar.askAgent}
              onClick={onAskAgent}
            >
              <IconMessageCircle />
              <span className="hidden lg:inline">{ws.toolbar.askAgent}</span>
            </Button>
          </IconTooltip>

          {/* Not modal: a dialog opened from a modal menu can leave the page without pointer events. */}
          <DropdownMenu modal={false}>
            <IconTooltip label={ws.toolbar.moreActions}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={ws.toolbar.moreActions}
                >
                  <IconDots />
                </Button>
              </DropdownMenuTrigger>
            </IconTooltip>
            <DropdownMenuContent align="end">
              {enabled ? (
                dirty ? (
                  <IconTooltip label={ws.toolbar.runNowSaveFirst}>
                    {/* A disabled item takes no hover, so the span carries the tooltip. */}
                    <span className="block">
                      <DropdownMenuItem disabled>
                        <IconPlayerPlay />
                        {ws.toolbar.runNow}
                      </DropdownMenuItem>
                    </span>
                  </IconTooltip>
                ) : (
                  <DropdownMenuItem disabled={testing} onSelect={onRunNow}>
                    <IconPlayerPlay />
                    {ws.toolbar.runNow}
                  </DropdownMenuItem>
                )
              ) : null}
              <DropdownMenuItem
                disabled={diagnosticsPending}
                onSelect={onCopyDiagnostics}
              >
                <IconClipboardCopy />
                {ws.diagnostics.copy}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </TooltipProvider>
  );
}
