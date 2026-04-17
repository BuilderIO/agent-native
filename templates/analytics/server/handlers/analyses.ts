import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { getOrgContext } from "@agent-native/core/org";
import {
  getAnalysis as loadAnalysis,
  listAnalyses as loadAnalyses,
  removeAnalysis,
} from "../lib/dashboards-store";

async function ctxFromEvent(event: any) {
  const ctx = await getOrgContext(event);
  return { email: ctx.email, orgId: ctx.orgId ?? null };
}

export const listAnalyses = defineEventHandler(async (event) => {
  try {
    const ctx = await ctxFromEvent(event);
    const rows = await loadAnalyses(ctx);
    const analyses = rows
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        dataSources: a.dataSources,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        author: a.author,
        ownerEmail: a.ownerEmail,
        visibility: a.visibility,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    return { analyses };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const getAnalysis = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing analysis id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    const a = await loadAnalysis(id, ctx);
    if (!a) {
      setResponseStatus(event, 404);
      return { error: "Analysis not found" };
    }
    return {
      id,
      name: a.name,
      description: a.description,
      question: a.question,
      instructions: a.instructions,
      dataSources: a.dataSources,
      resultMarkdown: a.resultMarkdown,
      resultData: a.resultData,
      author: a.author,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      ownerEmail: a.ownerEmail,
      orgId: a.orgId,
      visibility: a.visibility,
    };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});

export const deleteAnalysis = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Missing analysis id" };
  }
  try {
    const ctx = await ctxFromEvent(event);
    await removeAnalysis(id, ctx);
    return { id, success: true };
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    setResponseStatus(event, status);
    return { error: err.message };
  }
});
