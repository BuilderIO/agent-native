import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";

import { noticeSchema, noticeMdx, type NoticeData } from "./notice.config";

export type { NoticeData };

const NOTICE_ICON = {
  info: IconInfoCircle,
  decision: IconBulb,
  risk: IconAlertOctagon,
  warning: IconAlertTriangle,
  success: IconCircleCheck,
} as const;

export function NoticeBlock({ data, ctx }: BlockReadProps<NoticeData>) {
  const Icon = NOTICE_ICON[data.tone] ?? IconInfoCircle;
  return (
    <div className="docs-notice" data-tone={data.tone}>
      <Icon className="docs-notice-icon" aria-hidden="true" />
      <div className="docs-notice-content">
        {data.title && <p className="docs-notice-title">{data.title}</p>}
        <div className="docs-notice-body">
          {ctx.renderMarkdown?.(data.body) ?? <p>{data.body}</p>}
        </div>
      </div>
    </div>
  );
}

export const noticeBlock = defineBlock<NoticeData>({
  type: "notice",
  schema: noticeSchema,
  mdx: noticeMdx,
  Read: NoticeBlock,
  placement: ["block"],
  label: "Notice",
  description:
    "A bold, filled alert card with an icon and optional title, for something a reader must not skim past. Tones: info, decision, risk, warning, success.",
  empty: () => ({ tone: "info", body: "Notice text" }),
});
