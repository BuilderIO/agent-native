import { AsyncLocalStorage } from "node:async_hooks";

import { ActionContractError } from "@agent-native/core";
import { getAppConfig } from "@agent-native/core/app-config";

import {
  isAgentCall,
  type CallProvenance,
} from "../../actions/_document-agent-lock.js";
import {
  refusedInteractiveHtml,
  type InteractiveHtmlDisplaySources,
} from "../../shared/interactive-html.js";

export function interactiveHtmlDisplaySources(): InteractiveHtmlDisplaySources {
  const { iframeImageSources, iframeMediaSources } = getAppConfig().extensions;
  return { imageSources: iframeImageSources, mediaSources: iframeMediaSources };
}

const checkedAsOneEdit = new AsyncLocalStorage<true>();

export function savePiecesOfCheckedEdit<Result>(save: () => Result): Result {
  return checkedAsOneEdit.run(true, save);
}

export function assertInteractiveHtmlBlocks(
  ctx: CallProvenance | undefined,
  before: string | null | undefined,
  after: string,
) {
  if (!isAgentCall(ctx) || checkedAsOneEdit.getStore()) return;
  const refused = refusedInteractiveHtml(
    before,
    after,
    interactiveHtmlDisplaySources(),
  );
  if (!refused) return;
  throw new ActionContractError(
    `The interactive HTML block${refused.title ? ` "${refused.title}"` : ""} would not work, so nothing was saved. ${refused.problems.join(" ")} Fix it and retry.`,
    {
      errorCode: "INTERACTIVE_HTML_BLOCK_REFUSED",
      statusCode: 422,
      details: { title: refused.title, problems: refused.problems },
    },
  );
}
