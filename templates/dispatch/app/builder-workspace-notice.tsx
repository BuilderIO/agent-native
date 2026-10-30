import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { useEffect, useState } from "react";

export function BuilderWorkspaceNotice() {
  const { session, status } = useSession();
  const t = useT();
  const [hostname, setHostname] = useState("");
  useEffect(() => setHostname(window.location.hostname), []);
  const workspace =
    hostname === "beta.dispatch.agent-native.com"
      ? "https://beta.agent-workspace.builder.io"
      : hostname === "dispatch.agent-native.com"
        ? "https://agent-workspace.builder.io"
        : null;
  if (
    status !== "authenticated" ||
    !session?.email.trim().toLowerCase().endsWith("@builder.io") ||
    !workspace
  )
    return null;
  return (
    <div
      role="status"
      className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground"
    >
      {t("root.builderWorkspaceNotice")}{" "}
      <a className="font-medium underline" href={workspace}>
        {t("root.openBuilderWorkspace")}
      </a>
    </div>
  );
}
