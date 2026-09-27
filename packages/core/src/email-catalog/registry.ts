import { getAppConfig } from "../app-config/index.js";
import type { RenderedEmailMessage } from "../server/email-templates.js";

export interface TransactionalEmailDefinition {
  id: string;
  name: string;
  app?: string;
  trigger: string;
  recipient: string;
  recipientLabel: string;
  sender: string;
  senderLabel: string;
  preview: () => RenderedEmailMessage;
}

export type RegisteredTransactionalEmail = TransactionalEmailDefinition & {
  app: string;
};

const registry = new Map<string, RegisteredTransactionalEmail>();

function resolveDefinition(
  definition: TransactionalEmailDefinition,
): RegisteredTransactionalEmail {
  return {
    ...definition,
    app: definition.app ?? getAppConfig().app.slug ?? "unknown",
  };
}

function assertCanRegister(
  resolved: RegisteredTransactionalEmail,
  existing: RegisteredTransactionalEmail | undefined,
): void {
  if (
    existing &&
    (existing.app !== resolved.app ||
      existing.name !== resolved.name ||
      existing.trigger !== resolved.trigger ||
      existing.recipient !== resolved.recipient ||
      existing.recipientLabel !== resolved.recipientLabel ||
      existing.sender !== resolved.sender ||
      existing.senderLabel !== resolved.senderLabel)
  ) {
    throw new Error(
      `Duplicate transactional email id "${resolved.id}". Ids must be unique across the app.`,
    );
  }
}

export function defineTransactionalEmail(
  definition: TransactionalEmailDefinition,
): RegisteredTransactionalEmail {
  const resolved = resolveDefinition(definition);
  assertCanRegister(resolved, registry.get(resolved.id));
  registry.set(definition.id, resolved);
  return resolved;
}

function resolveDefinitions(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const resolved = definitions.map(resolveDefinition);
  const seen = new Set<string>();

  for (const definition of resolved) {
    if (seen.has(definition.id)) {
      throw new Error(
        `Duplicate transactional email id "${definition.id}". Ids must be unique across the app.`,
      );
    }
    seen.add(definition.id);
  }

  return resolved;
}

function validateDefinitions(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const resolved = resolveDefinitions(definitions);
  for (const definition of resolved) {
    assertCanRegister(definition, registry.get(definition.id));
  }
  return resolved;
}

function commitDefinitions(
  definitions: readonly RegisteredTransactionalEmail[],
): RegisteredTransactionalEmail[] {
  for (const definition of definitions) {
    registry.set(definition.id, definition);
  }
  return [...definitions];
}

export function defineTransactionalEmails(
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  return commitDefinitions(validateDefinitions(definitions));
}

export function replaceTransactionalEmails(
  ownerApp: string,
  idPrefix: string,
  definitions: readonly TransactionalEmailDefinition[],
): RegisteredTransactionalEmail[] {
  const runtimeApp = getAppConfig().app.slug;
  if (!ownerApp || ownerApp.includes(".") || idPrefix !== `${ownerApp}.`) {
    throw new Error(
      "Transactional email replacement requires an owner app and its exact namespace prefix.",
    );
  }

  const resolved = resolveDefinitions(definitions);
  if (
    resolved.some(({ id, app }) => app !== ownerApp || !id.startsWith(idPrefix))
  ) {
    throw new Error(
      `Transactional email replacement must contain only ${ownerApp} email definitions in the "${idPrefix}" scope.`,
    );
  }

  for (const [id, existing] of registry) {
    if (id.startsWith(idPrefix) && existing.app !== ownerApp) {
      throw new Error(
        `Transactional email replacement cannot modify "${id}" owned by "${existing.app}".`,
      );
    }
  }

  const hasExplicitOwner =
    resolved.length > 0 && resolved.every(({ app }) => app === ownerApp);
  if (
    (runtimeApp && runtimeApp !== ownerApp) ||
    (!runtimeApp && !hasExplicitOwner)
  ) {
    throw new Error(
      "Transactional email replacement requires a recognized runtime owner or a non-empty snapshot with explicit owner metadata.",
    );
  }

  const nextIds = new Set(resolved.map(({ id }) => id));
  for (const id of registry.keys()) {
    if (id.startsWith(idPrefix) && !nextIds.has(id)) {
      registry.delete(id);
    }
  }

  return commitDefinitions(resolved);
}

export function listTransactionalEmails(): RegisteredTransactionalEmail[] {
  return [...registry.values()].sort(
    (a, b) => a.app.localeCompare(b.app) || a.name.localeCompare(b.name),
  );
}

export function getTransactionalEmail(
  id: string,
): RegisteredTransactionalEmail | undefined {
  return registry.get(id);
}

export function renderTransactionalEmailPreview(
  id: string,
): RenderedEmailMessage {
  const definition = registry.get(id);
  if (!definition) {
    throw new Error(`Unknown transactional email "${id}".`);
  }
  return definition.preview();
}

export function resetTransactionalEmailRegistry(): void {
  registry.clear();
}
