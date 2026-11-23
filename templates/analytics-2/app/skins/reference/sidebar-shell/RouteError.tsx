import type { AppShellPartProps } from "@agent-native/toolkit/app-shell/sidebar-shell";
import { Link } from "react-router";

import { ContentSlot } from "./ContentSlot";
import { group, required, visible } from "./entry";

export function RouteError({ model }: AppShellPartProps) {
  const messages = visible(model.regions).filter(
    (region) =>
      region.subPart === "app-shell.skeleton" &&
      region.containerId === "route-error",
  );
  const message = messages[0];
  if (messages.length !== 1 || !message)
    throw new Error("Expected one route error region");
  if (message.state?.status !== "error")
    throw new Error("Route error requires an error read state");
  const entries = message.actions ?? [];
  const home = required(entries, "error-home");
  if (home.effect?.kind !== "navigate")
    throw new Error("Route recovery requires a destination");
  const statuses = group(entries, "error-status");
  const stacks = group(entries, "error-stack");
  return (
    <main className="flex items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <div className="flex flex-col items-center text-center max-w-md">
        {statuses.map((status) => (
          <span
            key={status.id}
            className="text-7xl font-bold tracking-tight text-muted-foreground/40"
          >
            {status.label}
          </span>
        ))}
        <h1 className="mt-3 text-2xl font-semibold">{message.title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          {message.state.message}
        </p>
        <Link
          to={home.effect.to}
          state={home.effect.state}
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer"
        >
          {home.label}
        </Link>
        {visible(model.regions)
          .filter((region) => region.subPart === "app-shell.overlays")
          .map((region) => (
            <ContentSlot key={region.id} owner={region.content} />
          ))}
        {stacks.map((stack) => (
          <pre
            key={stack.id}
            className="mt-6 w-full text-left text-xs overflow-auto p-4 bg-muted rounded"
          >
            <code>{stack.label}</code>
          </pre>
        ))}
      </div>
    </main>
  );
}
