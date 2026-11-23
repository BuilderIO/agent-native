import {
  registerOnboardingStep,
  type OnboardingResolveContext,
  type OnboardingStep,
} from "@agent-native/core/onboarding";
import { listThreads } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";

import { workspaceChatScope } from "../../app/lib/workspace-chat-scope.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";
import { getDb, schema } from "../db/index.js";
import { listDataConnections } from "../model/data-connections.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import { APPLICATION_ID } from "./workspace-access.js";

export const GETTING_STARTED_CHECKLIST = "getting-started";

type Ctx = OnboardingResolveContext | undefined;

function scopeOf(ctx: Ctx) {
  const ownerEmail = ctx?.userEmail?.trim();
  const orgId = ctx?.orgId?.trim();
  return ownerEmail && orgId ? { ownerEmail, orgId } : null;
}

export async function hasOwnConnection(ctx: Ctx): Promise<boolean> {
  if (!scopeOf(ctx)) return false;
  const connections = await listDataConnections();
  return connections.some(
    (connection) => connection.id !== SAMPLE_DATA_SOURCE_ID,
  );
}

export async function hasAskedQuestion(ctx: Ctx): Promise<boolean> {
  const scope = scopeOf(ctx);
  if (!scope) return false;
  const threads = await listThreads(scope.ownerEmail, {
    limit: 1,
    orgId: scope.orgId,
    ownership: "mine",
    includeExternal: false,
    sourceAppId: APPLICATION_ID,
    scope: workspaceChatScope(scope.orgId, APPLICATION_ID),
  });
  return threads.length > 0;
}

export async function hasOwnProject(ctx: Ctx): Promise<boolean> {
  const scope = scopeOf(ctx);
  if (!scope) return false;
  await ensureAnalyticsDatabase();
  const { projects } = schema;
  const rows = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
        eq(projects.listed, true),
        isNull(projects.trashedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type GettingStartedStep = Pick<
  OnboardingStep,
  "id" | "order" | "title" | "description" | "href" | "isComplete"
>;

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    id: "connect-data",
    order: 10,
    title: "Connect your data",
    description: "Connect your warehouse so your team can explore it.",
    href: "/home/data?connect=1",
    isComplete: hasOwnConnection,
  },
  {
    id: "ask-question",
    order: 20,
    title: "Ask a data question",
    description: "Ask the agent a question about your data.",
    href: "/home",
    isComplete: hasAskedQuestion,
  },
  {
    id: "create-project",
    order: 30,
    title: "Create a project",
    description: "Start a notebook to analyze your data with SQL.",
    href: "/home",
    isComplete: hasOwnProject,
  },
];

export function registerGettingStartedSteps(): void {
  for (const step of GETTING_STARTED_STEPS) {
    registerOnboardingStep({
      ...step,
      checklist: GETTING_STARTED_CHECKLIST,
      required: false,
      methods: [],
    });
  }
}
