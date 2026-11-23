import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconChartBar,
  IconFileText,
  IconPlus,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

export function AgentPane({
  agentPane,
  agentComposer,
  onClose,
  onLearnMore,
  onAddContext,
  onSubmitPrompt,
  fullPage = false,
}: {
  /** The Agent view: the conversation fills the page instead of a side pane. */
  fullPage?: boolean;
  agentPane: ReactNode | undefined;
  agentComposer: ReactNode | undefined;
  onClose?: (() => void) | undefined;
  onLearnMore?: (() => void) | undefined;
  onAddContext?: (() => void) | undefined;
  onSubmitPrompt?: ((prompt: string) => Promise<void> | void) | undefined;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  return (
    <aside
      className={`nb-agent-pane${fullPage ? " is-full-page" : ""}`}
      aria-label={t("analytics.ask.agentTab")}
    >
      {onClose != null && (
        <button
          type="button"
          className="nb-icon-button nb-agent-close"
          aria-label={t("analytics.ask.closeAgent")}
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      )}
      <div className="nb-agent-thread-column">
        {agentPane != null ? (
          <div className="nb-agent-slot">{agentPane}</div>
        ) : (
          <div className="nb-agent-empty">
            <div
              className="nb-agent-illustration"
              aria-hidden="true"
              data-asset-rewrite="notebook-agent-illustration"
            >
              <span className="nb-agent-illustration-card is-one">
                <IconFileText size={18} />
              </span>
              <span className="nb-agent-illustration-card is-two">
                <IconChartBar size={18} />
              </span>
              <span className="nb-agent-illustration-card is-three">
                <IconTable size={18} />
              </span>
            </div>
            <h2>{t("analytics.ask.title")}</h2>
            <p>
              {t("analytics.ask.emptySummary")}
              <button
                type="button"
                className="nb-inline-link"
                disabled={onLearnMore == null}
                onClick={onLearnMore}
              >
                {t("analytics.catalog.learnMore")}
              </button>
            </p>
          </div>
        )}

        {agentComposer != null ? (
          <div className="nb-agent-composer-slot">{agentComposer}</div>
        ) : (
          <div className="nb-agent-composer">
            <div className="nb-agent-suggestion">
              <span>{t("analytics.ask.contextBannerMessage")}</span>
              {onAddContext != null ? (
                <button
                  type="button"
                  className="nb-agent-context-button"
                  onClick={onAddContext}
                >
                  {t("analytics.ask.contextBannerAction")}
                  <IconArrowUpRight size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <form
              className="nb-agent-composer-frame"
              onSubmit={(event) => {
                event.preventDefault();
                if (onSubmitPrompt == null || draft.trim() === "") return;
                void onSubmitPrompt(draft.trim());
                setDraft("");
              }}
            >
              <textarea
                value={draft}
                placeholder={t("analytics.ask.paneComposerPlaceholder")}
                aria-label={t("analytics.ask.paneComposerLabel")}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="nb-agent-composer-footer">
                {onAddContext != null ? (
                  <button
                    type="button"
                    className="nb-icon-button"
                    aria-label={t("analytics.ask.addContextAndOptions")}
                    onClick={onAddContext}
                  >
                    <IconPlus size={16} aria-hidden="true" />
                  </button>
                ) : null}
                <div className="nb-agent-composer-actions">
                  <button
                    type="submit"
                    className="nb-agent-ask-button"
                    disabled={onSubmitPrompt == null || draft.trim() === ""}
                  >
                    {t("analytics.ask.approvalMode.ask.button")}
                  </button>
                  <span className="nb-agent-model-label">
                    {t("analytics.ask.defaultChoice")}
                  </span>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
