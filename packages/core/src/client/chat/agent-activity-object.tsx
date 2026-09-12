import type { MouseEventHandler } from "react";

import { cn } from "../utils.js";

export type AgentActivityObjectKind = "file" | "line" | "data" | "url";

export interface AgentActivityObjectReference {
  kind: AgentActivityObjectKind;
  label: string;
  href?: string;
  title?: string;
  mono?: boolean;
  onOpen?: () => void;
}

export interface AgentActivityObjectProps {
  object: AgentActivityObjectReference;
  className?: string;
}

export function AgentActivityObject({
  object,
  className,
}: AgentActivityObjectProps) {
  const classes = cn(
    "min-w-0 truncate text-right text-muted-foreground/70",
    object.mono && "font-mono",
    (object.href || object.onOpen) &&
      "underline decoration-border underline-offset-2 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
    className,
  );
  const title = object.title ?? object.label;

  if (object.href) {
    return (
      <a
        data-agent-activity-object={object.kind}
        className={classes}
        href={object.href}
        title={title}
        onClick={(event) => event.stopPropagation()}
      >
        {object.label}
      </a>
    );
  }

  if (object.onOpen) {
    const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
      event.stopPropagation();
      object.onOpen?.();
    };
    return (
      <button
        data-agent-activity-object={object.kind}
        type="button"
        className={classes}
        title={title}
        onClick={handleClick}
      >
        {object.label}
      </button>
    );
  }

  return (
    <span
      data-agent-activity-object={object.kind}
      className={classes}
      title={title}
    >
      {object.label}
    </span>
  );
}
