import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";

import "./context-studio.css";

type SetupStep =
  | "connect"
  | "endorse"
  | "improve"
  | "reference"
  | "extend"
  | "govern";

const STEPS: readonly {
  step: SetupStep;
  action: string;
  label: string;
  description: string;
  to?: string;
}[] = [
  {
    step: "connect",
    action: "Connect",
    label: "the analytics agent to your data",
    description:
      "Every workspace needs at least one data connection, but most have a couple. The agent will automatically select the most relevant available data connection for a request.",
    to: "/home/data",
  },
  {
    step: "endorse",
    action: "Endorse",
    label: "your data to set agent boundaries",
    description:
      "Endorsements are the agent's primary way of understanding what data to use. By endorsing your most trusted tables, columns and dashboards, you make sure the agent answers from the best data.",
    to: "/home/data",
  },
  {
    step: "improve",
    action: "Improve",
    label: "accuracy with guides",
    description:
      "The easiest way to add important business knowledge to your workspace is with guides. The agent reads guides to learn about your company, objectives, data structures and more.",
  },
  {
    step: "reference",
    action: "Reference",
    label: "repos to ground the agent in your code",
    description:
      "Reference repositories let the agent read from your existing code. Connecting a repository can give the agent access to models or source code as a source of truth.",
  },
  {
    step: "extend",
    action: "Extend",
    label: "the agent with MCP connections",
    description:
      "MCP connections let the agent reach external tools and data. The agent can use them to run searches, access external databases, or trigger actions in other tools.",
    to: "/context-studio/connections",
  },
  {
    step: "govern",
    action: "Govern",
    label: "with semantic models",
    description:
      "Semantic models are the most rigorous governance tool available for the agent. They can deterministically produce the same SQL queries in response to questions.",
  },
];

/** The DOM id / URL hash fragment for a section, as the original names it. */
export function contextSetupSectionId(step: SetupStep): string {
  return `context-setup-${step}`;
}

export function ContextSetupView() {
  const t = useT();
  const location = useLocation();
  const setup = useActionQuery("get-workspace-context-setup", {}, { retry: 1 });
  const { data, isPending, isLoading } = setup;
  const isError = setup.isError && data === undefined;
  const isInitialLoading =
    !isError && data === undefined && (isPending || isLoading);
  const completed = new Set(data?.completedSteps ?? []);
  const done = STEPS.filter((entry) => completed.has(entry.step)).length;

  useEffect(() => {
    if (!location.hash.startsWith("#context-setup-")) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView?.({ block: "start" });
  }, [location.hash, isInitialLoading]);

  return (
    <div className="context-studio-content">
      <h1 className="context-studio-title">{t("context.setup.heading")}</h1>
      <p className="context-studio-description">{t("context.setup.intro")}</p>
      {isError ? (
        <div
          className="context-setup-status flex flex-wrap items-center gap-3 text-destructive"
          role="alert"
        >
          <span>{t("error.genericDetails")}</span>
          <button
            type="button"
            className="context-setup-link"
            onClick={() => void setup.refetch()}
          >
            {t("error.retry")}
          </button>
        </div>
      ) : isInitialLoading ? (
        <p className="context-setup-status" role="status">
          {t("workspaceFrame.loading")}
        </p>
      ) : (
        <p className="context-setup-status" role="status">
          {done} of {STEPS.length} complete
        </p>
      )}
      <ol className="context-setup-sections">
        {STEPS.map((entry) => {
          const isComplete = completed.has(entry.step);
          return (
            <li
              className="context-setup-section"
              id={contextSetupSectionId(entry.step)}
              key={entry.step}
            >
              <h2 className="context-setup-heading">
                <span className="context-setup-action">{entry.action}</span>{" "}
                {entry.label}
              </h2>
              <p className="context-setup-description">{entry.description}</p>
              {setup.data !== undefined ? (
                <p className="context-setup-state">
                  {isComplete ? "Done" : "Not started"}
                </p>
              ) : null}
              {entry.to === undefined ? null : (
                <Link className="context-setup-link" to={entry.to}>
                  {entry.action} {"→"}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
