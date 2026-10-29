import { IconSparkles } from "@tabler/icons-react";

import {
  ClaudeCodeLogo,
  ClaudeLogo,
  CodexLogo,
} from "../../sharing/AgentDestinationLogos.js";
import type { ReviewAgentKind } from "./review-agent.js";

export function ReviewAgentMark({
  kind,
  className,
}: {
  kind: ReviewAgentKind;
  className?: string | undefined;
}) {
  // The logo components declare `className?: string`, so an absent value is
  // omitted instead of forwarded as `undefined` (exactOptionalPropertyTypes).
  const logoProps = className === undefined ? {} : { className };
  switch (kind) {
    case "claude":
      return <ClaudeLogo {...logoProps} />;
    case "claude-code":
      return <ClaudeCodeLogo {...logoProps} />;
    case "codex":
      return <CodexLogo {...logoProps} />;
    case "agent":
      return <IconSparkles aria-hidden="true" className={className} />;
  }
}
