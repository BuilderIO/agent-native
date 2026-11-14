import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { type ReactNode, type RefObject } from "react";

import type { ContentPanelLayout } from "@/components/layout/content-layout";
import { cn } from "@/lib/utils";

import type { DocumentPagePanelTab } from "./document-page-panel-state";
import { DOCUMENT_PAGE_PANEL_ID } from "./DocumentPanelTabs";

/**
 * The one panel for Agent, Discussion and Info, under the page header. It sits
 * in the row beside the page's column: docked it takes a column of its own,
 * and otherwise it covers the page. The page never animates its width, so the
 * text rewraps once while the panel, opaque, slides over the gap.
 */
export function DocumentPagePanel({
  open,
  tab,
  layout,
  pageEditorOwner,
  panelRef,
  spacerRef,
  headingRef,
  agentSlotRef,
  agentHeadSlotRef,
  panelId = DOCUMENT_PAGE_PANEL_ID,
  onClose,
  children,
}: {
  open: boolean;
  /** What the panel shows, kept while it slides away. */
  tab: DocumentPagePanelTab | null;
  layout: ContentPanelLayout;
  pageEditorOwner: string;
  panelRef: RefObject<HTMLElement | null>;
  spacerRef: RefObject<HTMLDivElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  agentSlotRef?: RefObject<HTMLDivElement | null> | undefined;
  /** Where the agent puts its chat picker, New chat and Chat history. */
  agentHeadSlotRef?: RefObject<HTMLDivElement | null> | undefined;
  panelId?: string | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { mode, width } = layout;
  const title =
    tab === "agent"
      ? t("navigation.agent")
      : tab === "info"
        ? t("editor.toolbar.info")
        : t("comments.discussion");
  // The agent's chat picker stands in for the title, which stays for screen
  // readers and as the place a key puts focus.
  const agentHead = tab === "agent" && Boolean(agentHeadSlotRef);

  return (
    <>
      <div
        ref={spacerRef}
        aria-hidden="true"
        className="col-start-2 row-start-2 print:hidden"
        style={{ width: open && mode === "dock" ? width : 0 }}
      />
      {mode === "over" ? (
        <div
          aria-hidden="true"
          className={cn(
            "col-span-2 col-start-1 row-start-2 z-30 bg-black/[0.07] transition-opacity duration-[220ms] motion-reduce:transition-none print:hidden dark:bg-black/30",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          data-document-panel-shade
          onClick={onClose}
        />
      ) : null}
      <aside
        ref={panelRef}
        id={panelId}
        role="tabpanel"
        aria-label={title}
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        // Opening, it shows at once so a key can focus it; closing, it stays
        // visible until it has slid away.
        className={cn(
          "col-span-2 col-start-1 row-start-2 z-40 flex min-h-0 min-w-0 flex-col justify-self-end overflow-hidden bg-background transition-[translate,visibility] ease-[var(--ease-drawer)] motion-reduce:transition-none print:hidden",
          mode === "sheet"
            ? "mt-1.5 w-full rounded-t-[14px] shadow-[0_-1px_0_hsl(var(--border)),0_-10px_30px_rgba(0,0,0,0.1)] [transition-duration:260ms,0s]"
            : "max-w-full border-s border-border [transition-duration:220ms,0s]",
          mode === "over" && "shadow-[-10px_0_28px_rgba(0,0,0,0.09)]",
          open
            ? "translate-x-0 translate-y-0"
            : cn(
                "invisible",
                mode === "sheet"
                  ? "translate-y-[102%] [transition-delay:0s,260ms]"
                  : "translate-x-full [transition-delay:0s,220ms]",
              ),
        )}
        style={mode === "sheet" ? undefined : { width }}
        data-document-page-panel={mode}
        data-document-utility-panel
        data-page-editor-owner={pageEditorOwner}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pe-2 ps-4">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className={cn(
              "min-w-0 truncate text-sm font-semibold outline-none",
              agentHead && "sr-only",
            )}
          >
            {title}
          </h2>
          {agentHeadSlotRef ? (
            <div
              ref={agentHeadSlotRef}
              className={cn(
                "-ms-1.5 min-w-0 flex-1 items-center",
                agentHead ? "flex" : "hidden",
              )}
              data-document-panel-agent-head
            />
          ) : null}
          <button
            type="button"
            className="ms-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("editor.toolbar.closeUtilityPanel")}
            onClick={onClose}
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        </div>
        {agentSlotRef ? (
          <div
            ref={agentSlotRef}
            className={cn(
              "min-h-0 flex-1 flex-col",
              tab === "agent" ? "flex" : "hidden",
            )}
            data-document-panel-agent
          />
        ) : null}
        {tab && tab !== "agent" ? children : null}
      </aside>
    </>
  );
}
