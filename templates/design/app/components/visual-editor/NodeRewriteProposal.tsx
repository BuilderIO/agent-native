import {
  callAction,
  useActionMutation,
  useChangeVersion,
  useT,
} from "@agent-native/core/client";
import {
  isNodeRewriteProposal,
  type NodeHtmlPreviewBridgeMessage,
  type NodeRewriteProposal,
  type NodeRewriteTarget,
} from "@shared/node-rewrite";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import {
  formatNodeRepromptSubmission,
  NODE_REPROMPT_PRESENTED_EVENT,
  NODE_REPROMPT_RESOLVED_EVENT,
} from "@/lib/node-reprompt";

import type { IframeNodeHtmlPreviewAppliedPayload } from "../design/design-canvas/iframe-events";

interface NodeRewriteProposalProps {
  designId: string;
  fileId: string;
  canvasSelector: string;
  active?: boolean;
  proposalSnapshot?: NodeRewriteProposal | null;
}

function escapeSelectorValue(value: string): string {
  const escape = globalThis.CSS?.escape;
  return escape ? escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function findProposalElement(
  iframe: HTMLIFrameElement,
  proposalId: string,
  target: NodeRewriteTarget,
): Element | null {
  try {
    const document = iframe.contentDocument;
    if (!document) return null;
    const marked = document.querySelector(
      `[data-agent-native-node-rewrite-proposal="${escapeSelectorValue(proposalId)}"]`,
    );
    if (marked) return marked;
    if (target.nodeId) {
      const id = escapeSelectorValue(target.nodeId);
      const byId = document.querySelector(
        `[data-agent-native-node-id="${id}"],[data-code-layer-id="${id}"],[data-layer-id="${id}"],[data-builder-id="${id}"],#${id}`,
      );
      if (byId) return byId;
    }
    return target.selector ? document.querySelector(target.selector) : null;
  } catch {
    return null;
  }
}

interface ProposalAnchor {
  centerX: number;
  top: number;
  bottom: number;
}

interface ProposalPopoverSize {
  width: number;
  height: number;
}

const PROPOSAL_POPOVER_GAP = 8;
const PROPOSAL_POPOVER_MARGIN = 12;
const DEFAULT_PROPOSAL_POPOVER_SIZE = { width: 320, height: 176 };

export function placeNodeRewritePopover(
  anchor: ProposalAnchor,
  popover: ProposalPopoverSize,
  viewport: ProposalPopoverSize,
): { left: number; top: number; side: "above" | "below" | "clamped" } {
  const maxLeft = Math.max(
    PROPOSAL_POPOVER_MARGIN,
    viewport.width - popover.width - PROPOSAL_POPOVER_MARGIN,
  );
  const left = Math.min(
    maxLeft,
    Math.max(PROPOSAL_POPOVER_MARGIN, anchor.centerX - popover.width / 2),
  );
  const belowTop = anchor.bottom + PROPOSAL_POPOVER_GAP;
  if (belowTop + popover.height <= viewport.height - PROPOSAL_POPOVER_MARGIN) {
    return { left, top: belowTop, side: "below" };
  }
  const aboveTop = anchor.top - PROPOSAL_POPOVER_GAP - popover.height;
  if (aboveTop >= PROPOSAL_POPOVER_MARGIN) {
    return { left, top: aboveTop, side: "above" };
  }
  return {
    left,
    top: Math.max(
      PROPOSAL_POPOVER_MARGIN,
      Math.min(
        belowTop,
        viewport.height - popover.height - PROPOSAL_POPOVER_MARGIN,
      ),
    ),
    side: "clamped",
  };
}

function proposalAnchor(
  canvas: HTMLElement,
  proposal: NodeRewriteProposal,
): ProposalAnchor | null {
  const iframe = canvas.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  );
  if (!iframe) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const element = findProposalElement(
    iframe,
    proposal.proposalId,
    proposal.resolvedTarget,
  );
  if (!element) {
    return {
      centerX: iframeRect.left + iframeRect.width / 2,
      top: iframeRect.top + 16,
      bottom: iframeRect.top + 16,
    };
  }
  const rect = element.getBoundingClientRect();
  const scaleX = iframeRect.width / Math.max(1, iframe.clientWidth);
  const scaleY = iframeRect.height / Math.max(1, iframe.clientHeight);
  return {
    centerX: iframeRect.left + (rect.left + rect.width / 2) * scaleX,
    top: iframeRect.top + rect.top * scaleY,
    bottom: iframeRect.top + (rect.top + rect.height) * scaleY,
  };
}

export function NodeRewriteProposal({
  designId,
  fileId,
  canvasSelector,
  active = true,
  proposalSnapshot,
}: NodeRewriteProposalProps) {
  const t = useT();
  const appStateVersion = useChangeVersion("app-state");
  const resolveMutation = useActionMutation("resolve-node-rewrite");
  const [proposal, setProposal] = useState<NodeRewriteProposal | null>(null);
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;
  const [chosenIndex, setChosenIndex] = useState(0);
  const [previewReadyProposalId, setPreviewReadyProposalId] = useState<
    string | null
  >(null);
  const [refinement, setRefinement] = useState("");
  const [refining, setRefining] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const proposalPopoverRef = useRef<HTMLDivElement | null>(null);
  const [proposalPopoverSize, setProposalPopoverSize] = useState(
    DEFAULT_PROPOSAL_POPOVER_SIZE,
  );
  const getCanvas = useCallback(
    () => document.querySelector<HTMLElement>(canvasSelector), // i18n-ignore DOM query
    [canvasSelector],
  );

  const postToPreview = useCallback(
    (message: NodeHtmlPreviewBridgeMessage) => {
      const iframe = getCanvas()?.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      if (!iframe?.contentWindow) return false;
      iframe.contentWindow.postMessage(message, "*");
      return true;
    },
    [getCanvas],
  );

  const restorePreview = useCallback(
    (current: NodeRewriteProposal) => {
      postToPreview({
        type: "node-html-preview",
        proposalId: current.proposalId,
        target: current.resolvedTarget,
        operation: "restore",
      });
    },
    [postToPreview],
  );

  const syncProposal = useCallback(
    (value: unknown) => {
      if (
        isNodeRewriteProposal(value) &&
        value.designId === designId &&
        value.fileId === fileId
      ) {
        const previous = proposalRef.current;
        if (previous?.proposalId !== value.proposalId) {
          setPreviewReadyProposalId(null);
        }
        if (
          previous?.proposalId === value.proposalId &&
          previous.chosenIndex === value.chosenIndex &&
          previous.variants[value.chosenIndex]?.html ===
            value.variants[value.chosenIndex]?.html
        ) {
          return;
        }
        setProposal(value);
        setChosenIndex(
          Math.min(value.variants.length - 1, Math.max(0, value.chosenIndex)),
        );
        return;
      }
      const previous = proposalRef.current;
      if (previous) {
        restorePreview(previous);
        window.dispatchEvent(
          new CustomEvent(NODE_REPROMPT_RESOLVED_EVENT, {
            detail: { repromptId: previous.repromptId, fileId },
          }),
        );
      }
      setProposal(null);
    },
    [designId, fileId, restorePreview],
  );

  useEffect(() => {
    if (!active) return;
    if (proposalSnapshot !== undefined) {
      syncProposal(proposalSnapshot);
    }
  }, [active, appStateVersion, proposalSnapshot, syncProposal]);

  useEffect(() => {
    if (!active || !proposal) return;
    const canvas = getCanvas();
    const iframe = canvas?.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    if (!iframe?.contentWindow) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | IframeNodeHtmlPreviewAppliedPayload
        | undefined;
      if (
        event.source !== iframe.contentWindow ||
        data?.type !== "agent-native:node-html-preview-applied" ||
        data.proposalId !== proposal.proposalId
      ) {
        return;
      }
      setPreviewReadyProposalId(proposal.proposalId);
      setLayoutTick((value) => value + 1);
      window.dispatchEvent(
        new CustomEvent(NODE_REPROMPT_PRESENTED_EVENT, {
          detail: { repromptId: proposal.repromptId, fileId },
        }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active, fileId, getCanvas, proposal]);

  useEffect(() => {
    if (!active || !proposal) return;
    const variant = proposal.variants[chosenIndex];
    if (!variant) return;
    let cancelled = false;
    let retryFrame: number | null = null;
    let retryCount = 0;
    const sendPreview = () => {
      if (cancelled) return;
      const sent = postToPreview({
        type: "node-html-preview",
        proposalId: proposal.proposalId,
        target: proposal.resolvedTarget,
        html: variant.html,
        operation: "preview",
      });
      if (!sent && retryCount < 120) {
        retryCount += 1;
        retryFrame = window.requestAnimationFrame(sendPreview);
      }
    };
    sendPreview();
    const frame = window.requestAnimationFrame(() =>
      setLayoutTick((value) => value + 1),
    );
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (retryFrame !== null) window.cancelAnimationFrame(retryFrame);
    };
  }, [active, chosenIndex, postToPreview, proposal]);

  useEffect(() => {
    if (!active || !proposal) return;
    const canvas = getCanvas();
    if (!canvas) return;
    const bump = () => setLayoutTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(canvas);
    const iframe = canvas.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    if (iframe) observer.observe(iframe);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [active, getCanvas, proposal]);

  useLayoutEffect(() => {
    const element = proposalPopoverRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setProposalPopoverSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewReadyProposalId, proposal?.proposalId]);

  const chooseVariant = useCallback(
    (index: number) => {
      if (!proposal || index === chosenIndex) return;
      setChosenIndex(index);
    },
    [chosenIndex, proposal],
  );

  const resolve = useCallback(
    async (resolution: "accept" | "reject") => {
      if (!proposal || refining || resolveMutation.isPending) return;
      if (resolution === "reject") restorePreview(proposal);
      try {
        await resolveMutation.mutateAsync({
          proposalId: proposal.proposalId,
          resolution,
          ...(resolution === "accept" ? { variantIndex: chosenIndex } : {}),
        });
        window.dispatchEvent(
          new CustomEvent(NODE_REPROMPT_RESOLVED_EVENT, {
            detail: { repromptId: proposal.repromptId, fileId },
          }),
        );
        setProposal(null);
      } catch (error) {
        if (resolution === "reject") {
          const variant = proposal.variants[chosenIndex];
          if (variant) {
            postToPreview({
              type: "node-html-preview",
              proposalId: proposal.proposalId,
              target: proposal.resolvedTarget,
              html: variant.html,
              operation: "preview",
            });
          }
        }
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("designEditor.nodeRewrite.resolveFailed"),
        );
      }
    },
    [
      chosenIndex,
      fileId,
      postToPreview,
      proposal,
      refining,
      resolveMutation,
      restorePreview,
      t,
    ],
  );

  const submitRefinement = useCallback(async () => {
    const instruction = refinement.trim();
    if (!proposal || !instruction || refining || resolveMutation.isPending)
      return;
    const repromptId = crypto.randomUUID();
    const pending = {
      repromptId,
      designId,
      fileId,
      target: proposal.target,
      baseVersionHash: proposal.baseVersionHash,
      instruction,
      createdAt: new Date().toISOString(),
      priorProposalId: proposal.proposalId,
      priorRepromptId: proposal.repromptId,
    };
    setRefining(true);
    try {
      await callAction("begin-node-rewrite-request", pending);
      const submission = formatNodeRepromptSubmission({
        ...pending,
        priorProposalId: proposal.proposalId,
        subtreeHtml: proposal.variants[chosenIndex]?.html,
      });
      const delivery = await sendToDesignAgentChatAndConfirm(
        {
          ...submission,
          submit: true,
          openSidebar: true,
        },
        { timeoutMs: 10_000 },
      );
      if (!delivery.delivered) {
        throw new Error(delivery.reason ?? "Reprompt was not delivered.");
      }
      setRefinement("");
      toast.success(t("designEditor.nodeRewrite.refinementSent"));
    } catch (error) {
      await callAction("cancel-node-rewrite-request", {
        designId,
        fileId,
        repromptId,
      }).catch(() => {});
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("designEditor.nodeRewrite.refinementFailed"),
      );
    } finally {
      setRefining(false);
    }
  }, [
    chosenIndex,
    designId,
    fileId,
    proposal,
    refinement,
    refining,
    resolveMutation.isPending,
    t,
  ]);

  if (!active || !proposal) {
    return null;
  }
  void layoutTick;
  const canvas = getCanvas();
  const anchor = canvas ? proposalAnchor(canvas, proposal) : null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const position = placeNodeRewritePopover(
    anchor ?? {
      centerX: viewport.width / 2,
      top: viewport.height / 2,
      bottom: viewport.height / 2,
    },
    proposalPopoverSize,
    viewport,
  );
  const busy = resolveMutation.isPending || refining;

  return createPortal(
    <div
      ref={proposalPopoverRef}
      data-node-rewrite-proposal={proposal.proposalId}
      data-side={position.side}
      className="fixed z-[265] max-h-[calc(100vh-1.5rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-xl"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">
            {t("designEditor.nodeRewrite.previewTitle")}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {proposal.variants[chosenIndex]?.summary}
          </p>
        </div>
        {proposal.variants.length > 1 ? (
          <TooltipProvider delayDuration={300}>
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
              aria-label={t("designEditor.nodeRewrite.variants")}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    disabled={busy || chosenIndex === 0}
                    onClick={() => chooseVariant(chosenIndex - 1)}
                    aria-label={t("designEditor.nodeRewrite.previousCandidate")}
                  >
                    <IconChevronLeft className="size-3.5 rtl:rotate-180" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("designEditor.nodeRewrite.previousCandidate")}
                </TooltipContent>
              </Tooltip>
              <span className="min-w-12 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
                {t("designEditor.nodeRewrite.candidatePosition", {
                  current: chosenIndex + 1,
                  total: proposal.variants.length,
                })}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    disabled={
                      busy || chosenIndex === proposal.variants.length - 1
                    }
                    onClick={() => chooseVariant(chosenIndex + 1)}
                    aria-label={t("designEditor.nodeRewrite.nextCandidate")}
                  >
                    <IconChevronRight className="size-3.5 rtl:rotate-180" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("designEditor.nodeRewrite.nextCandidate")}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Input
          value={refinement}
          onChange={(event) => setRefinement(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && refinement.trim()) {
              event.preventDefault();
              void submitRefinement();
            }
          }}
          disabled={busy}
          placeholder={t("designEditor.nodeRewrite.refinePlaceholder")}
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 shrink-0"
          disabled={!refinement.trim() || busy}
          onClick={() => void submitRefinement()}
          aria-label={t("designEditor.nodeRewrite.refine")}
        >
          {refining ? (
            <Spinner className="size-3.5" />
          ) : (
            <IconRefresh className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          <IconX className="size-3.5" />
          {t("designEditor.nodeRewrite.reject")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 px-3 text-xs"
          disabled={busy}
          onClick={() => void resolve("accept")}
        >
          {resolveMutation.isPending ? (
            <Spinner className="size-3.5" />
          ) : (
            <IconCheck className="size-3.5" />
          )}
          {t("designEditor.nodeRewrite.accept")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
