import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
} from "h3";
import {
  exchangeNotionCodeForTokens,
  getDocumentOwnerEmail,
  getNotionRedirectPath,
  saveNotionTokensForOwner,
} from "../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const code = query.code as string | undefined;
  const error = query.error as string | undefined;
  const state = query.state as string | undefined;

  if (error) {
    setResponseStatus(event, 400);
    return { error };
  }

  if (!code) {
    setResponseStatus(event, 400);
    return { error: "Missing authorization code" };
  }

  const owner = await getDocumentOwnerEmail(event);
  const tokens = await exchangeNotionCodeForTokens(event, code);
  await saveNotionTokensForOwner(owner, tokens);

  return sendRedirect(event, getNotionRedirectPath(state), 302);
});
