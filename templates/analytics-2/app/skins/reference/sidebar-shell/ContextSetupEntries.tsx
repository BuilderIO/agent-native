import type {
  NavigationEntry,
  ShellActionEffect,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { IconCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import { EntryIcon, invoke } from "./entry";

export function ContextSetupEntry({
  entry,
  effects,
}: {
  entry: NavigationEntry;
  effects: readonly ShellActionEffect[];
}) {
  if (entry.effect?.kind !== "navigate")
    throw new Error(`Expected setup destination: ${entry.id}`);
  const header = entry.containerId === "context-setup-header";
  const complete = entry.metadata?.completed === true;
  const current = entry.metadata?.current === true;
  return (
    <Link
      to={entry.effect.to}
      className={
        header
          ? "ws-context-header"
          : [
              "ws-context-step",
              complete ? "is-complete" : "",
              current ? "is-current" : "",
            ]
              .filter(Boolean)
              .join(" ")
      }
      onClick={() => {
        for (const action of entry.trailingActions ?? [])
          invoke(action.effect, effects);
      }}
    >
      {header ? (
        <EntryIcon entry={entry} hidden />
      ) : complete ? (
        <span className="ws-context-step-status is-complete">
          <IconCheck size={16} aria-hidden="true" />
        </span>
      ) : (
        <span
          className={[
            "ws-context-step-status",
            current ? "is-current-icon" : "is-incomplete",
          ].join(" ")}
        >
          {current ? <EntryIcon entry={entry} /> : null}
        </span>
      )}
      <span {...(header ? {} : { className: "ws-context-step-label" })}>
        {entry.label}
      </span>
    </Link>
  );
}
