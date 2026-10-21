import {
  createOperationRegistry,
  type OperationCatalog,
  type OperationDefinition,
  type OperationDefinitionInput,
  type OperationRegistry,
} from "../operations.js";
import { bigqueryOperations } from "./bigquery.js";
import { builderOperations } from "./builder.js";
import { emailOperations } from "./email.js";
import { factoryOperations } from "./factory.js";
import { githubOperations } from "./github.js";
import { gongOperations } from "./gong.js";
import { hubspotOperations } from "./hubspot.js";
import { jiraOperations } from "./jira.js";
import { notionOperations } from "./notion.js";
import { posthogOperations } from "./posthog.js";
import { pylonOperations } from "./pylon.js";
import { sentryOperations } from "./sentry.js";
import { slackOperations } from "./slack.js";
import { stripeOperations } from "./stripe.js";

export const OPERATION_DEFINITIONS: readonly OperationDefinitionInput[] = [
  ...slackOperations,
  ...githubOperations,
  ...factoryOperations,
  ...builderOperations,
  ...hubspotOperations,
  ...gongOperations,
  ...pylonOperations,
  ...stripeOperations,
  ...posthogOperations,
  ...bigqueryOperations,
  ...jiraOperations,
  ...notionOperations,
  ...sentryOperations,
  ...emailOperations,
];

/** Parses every definition, so a malformed or duplicate one fails here and not at a run. */
export function buildOperationCatalog(): OperationRegistry {
  const registry = createOperationRegistry();
  for (const definition of OPERATION_DEFINITIONS) {
    registry.register(definition);
  }
  return registry;
}

interface ReadOnlyOperationCatalog extends OperationCatalog {
  list(): OperationDefinition[];
}

/** The catalog the workflow engine runs against; it cannot be added to after build. */
export const OPERATION_CATALOG: ReadOnlyOperationCatalog = (() => {
  const { get, list } = buildOperationCatalog();
  return { get, list };
})();
