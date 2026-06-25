---
title: "Serveur"
description: "Routes du serveur Nitro, plug-ins, routes montées sur le framework, contexte de requête et synchronisation basée sur SQL."
---

# Serveur

Les applications natives d'agent utilisent [Nitro](https://nitro.build) pour les routes de serveur et les plug-ins. La plupart des comportements de produits devraient résider dans [Actions](/docs/actions) ; les routes personnalisées sont destinées aux surfaces de protocole auxquelles actions ne s'adapte pas : téléchargements, streaming, pages publiques, rappels webhooks, OAuth et API spécifiques au fournisseur.

```an-diagram title="Ce qui s'exécute sur le serveur" summary="Les actions sont la valeur par défaut. Les routes de fichiers personnalisées et les routes montées sur le framework partagent la même application Nitro et la même base de données SQL."
{
  "html": "<div class=\"diagram-server\"><div class=\"diagram-col entry\"><div class=\"diagram-node\">Navigateur / UI</div><div class=\"diagram-node\">boucle agent</div><div class=\"diagram-node\">clients externes<br><small class=\"diagram-muted\">HTTP · MCP · A2A</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>serveur Nitro</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">surface par défaut</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/_agent-native/*</span><small class=\"diagram-muted\">framework routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">/api/*</span><small class=\"diagram-muted\">custom file routes</small></div><div class=\"diagram-row\"><span class=\"diagram-pill\">plugins</span><small class=\"diagram-muted\">démarrage : migrations, jobs</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>base de données SQL<br><small class=\"diagram-muted\">Drizzle · point de coordination</small></div></div>",
  "css": ".diagram-server{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-server .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-server .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px 16px}.diagram-server .diagram-row{display:flex;align-items:center;gap:8px}.diagram-server .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Routages basés sur des fichiers {#file-based-routes}

Les itinéraires présents dans `server/routes/` et Nitro mappent les noms de fichiers aux méthodes et aux chemins :

```text
server/routes/
  api/
    health.get.ts              -> GET  /api/health
    uploads.post.ts            -> POST /api/uploads
    webhooks/
      stripe.post.ts           -> POST /api/webhooks/stripe
  [...page].get.ts             -> SSR catch-all for public pages
```

Chaque itinéraire exporte un `defineEventHandler` :

```ts
// server/routes/api/health.get.ts
import { defineEventHandler } from "h3";

export default defineEventHandler(() => ({
  ok: true,
  service: "my-template",
}));
```

### Conventions de dénomination des itinéraires {#route-naming-conventions}

| Modèle de nom de fichier | Méthode HTTP | Exemple de chemin             |
| ------------------------ | ------------ | ----------------------------- |
| `index.get.ts`           | GET          | `/api/items`                  |
| `index.post.ts`          | POST         | `/api/items`                  |
| `[id].get.ts`            | GET          | `/api/items/:id`              |
| `[id].patch.ts`          | PATCH        | `/api/items/:id`              |
| `[id].delete.ts`         | DELETE       | `/api/items/:id`              |
| `[...slug].get.ts`       | GET          | `/api/items/*` ou fourre-tout |

## Préférez Actions pour les opérations d'application {#actions-first}

Si le UI et l'agent doivent tous deux faire quelque chose, définissez une action au lieu d'un itinéraire API personnalisé. Actions devient automatiquement :

- Outils d'agent.
- Hooks frontaux typés.
- Points de terminaison HTTP sous `/_agent-native/actions/:name`.
- Outils appelables MCP et A2A.
- Commandes CLI pour le développement.

Utilisez des routes `/api/*` personnalisées uniquement lorsque vous avez besoin d'un protocole en forme de route ou d'un comportement binaire/streaming. Voir [Actions](/docs/actions).

## Achèvement du texte en une seule fois {#complete-text}

La plupart des travaux d'IA doivent passer par le chat de l'agent afin que les utilisateurs puissent voir, piloter et auditer
que s'est-il passé. Pour les transformations étroites côté serveur qui n'ont intentionnellement pas besoin
outils, historique des discussions ou état d'exécution, utilisez `completeText()` comme échappement explicite
trappe.

```ts
// actions/classify-message.ts
import { defineAction } from "@agent-native/core/action";
import { completeText } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Classify a short message",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => {
    const result = await completeText({
      systemPrompt:
        "Return exactly one label: urgent, follow-up, waiting, or archive.",
      input: body,
      maxOutputTokens: 16,
      temperature: 0,
    });

    return { label: result.text.trim() };
  },
});
```

`completeText()` s'exécute via la même couche moteur configurée que l'agent
chat, y compris les fournisseurs Builder, Anthropic, AI SDK, les paramètres par défaut du modèle utilisateur/application,
secrets au niveau de la demande et erreurs normalisées par le moteur. Il s'agit uniquement d'un serveur ; ne le fais pas
appelez les fournisseurs de modèles à partir du code client. Si l'opération est destinée à l'utilisateur, enveloppez-la
dans une action afin que le UI et l'agent partagent la même capacité.

## Demander le contexte et l'accès {#request-context}

Actions monté par le framework s'exécute automatiquement avec le contexte de la requête. Les itinéraires personnalisés ne le font pas. Si un itinéraire personnalisé lit ou écrit des ressources propriétaires, chargez la session et terminez le travail :

```an-annotated-code title="Attribution d'un itinéraire personnalisé à l'utilisateur de la demande"
{
  "filename": "server/routes/api/projects.get.ts",
  "language": "ts",
  "code": "import { defineEventHandler, createError } from \"h3\";\nimport { getSession, runWithRequestContext } from \"@agent-native/core/server\";\nimport { getDb } from \"../../db/index.js\";\nimport { accessFilter } from \"@agent-native/core/sharing\";\nimport * as schema from \"../../db/schema\";\n\nexport default defineEventHandler(async (event) => {\n  const session = await getSession(event);\n  if (!session?.email) {\n    throw createError({ statusCode: 401, statusMessage: \"Unauthorized\" });\n  }\n\n  return runWithRequestContext(\n    { userEmail: session.email, orgId: session.orgId },\n    async () => {\n      const db = getDb();\n      return db\n        .select()\n        .from(schema.projects)\n        .where(accessFilter(schema.projects, schema.projectPartagers));\n    },\n  );\n});",
  "annotations": [
    {
      "lines": "7-10",
      "label": "Les itinéraires personnalisés n'ont pas de contexte automatique",
      "note": "Contrairement aux actions, une route de fichiers doit charger la session elle-même et échouer lorsqu'il n'y a aucun utilisateur authentifié."
    },
    {
      "lines": "12-13",
      "label": "Établir le contexte de la demande",
      "note": "`runWithRequestContext` met l'utilisateur et l'organisation à disposition des aides de portée pendant toute la durée du travail."
    },
    {
      "lines": "18-19",
      "label": "Lectures appartenant à la portée",
      "note": "`accessFilter` constrains the query to rows the caller may see. Never run an unscoped `db.select().from(ownableTable)` here."
    }
  ]
}
```

`getDb` est créé par application via `createGetDb(schema)` dans `server/db/index.ts`, donc les itinéraires personnalisés l'importent à partir du modèle (`../../db/index.js`), et non à partir de `@agent-native/core/db` ; voir [Database — Where the DB Client Lives](/docs/database#db-client). N'exécutez pas `db.select().from(ownableTable)` sans portée dans des itinéraires personnalisés.

## Plugins de serveur {#server-plugins}

Les plugins résident dans `server/plugins/` et s'exécutent au démarrage. Utilisez-les pour les migrations, la configuration du fournisseur, les tâches récurrentes, les adaptateurs d'intégration et la configuration du plugin framework.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    },
  ],
  { table: "my_app_migrations" },
);
```

Les migrations doivent être additives. Ne mettez jamais de SQL destructeur dans les plugins de démarrage.

## Itinéraires montés sur cadre {#framework-routes}

Le framework monte ses propres routes sous `/_agent-native/`. Traitez cet espace de noms comme réservé.

| Préfixe d'itinéraire             | Objectif                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `/_agent-native/actions/:name`   | Points de terminaison de l'action HTTP                                                |
| `/_agent-native/agent-chat`      | Boucle de discussion avec les agents                                                  |
| `/_agent-native/poll`            | Synchronisation UI basée sur SQL                                                      |
| `/_agent-native/resources/*`     | Ressources de l'espace de travail                                                     |
| `/_agent-native/extensions/*`    | Extensions d'exécution et proxy d'extension (alias hérité : `/_agent-native/tools/*`) |
| `/_agent-native/integrations/*`  | Intégrations de messagerie/webhook                                                    |
| `/_agent-native/a2a`             | Agent à agent JSON-RPC                                                                |
| `/_agent-native/mcp`             | Point de terminaison MCP                                                              |
| `/_agent-native/onboarding/*`    | Liste de contrôle de configuration                                                    |
| `/_agent-native/observability/*` | Traces, retours, évaluations, expériences                                             |
| `/_agent-native/file-upload`     | Point de terminaison du fournisseur de téléchargement de fichiers                     |

Les routes d'application personnalisées doivent utiliser `/api/*`, des chemins d'application publics ou des chemins de rappel spécifiques au fournisseur qui n'entrent pas en collision avec `/_agent-native/`.

## Synchronisation basée sur SQL {#sync}

L'agent natif ne s'appuie pas sur les observateurs du système de fichiers ni sur l'état persistant en mémoire. Lorsque actions ou les assistants du framework mute les données, la version de synchronisation de la base de données s'incrémente. Le hook client `useDbSync()` interroge `/_agent-native/poll` et invalide les caches de requête React.

Cela fonctionne dans les déploiements sans serveur et multi-instances, car la base de données est le point de coordination. Si vous écrivez des mutations personnalisées en dehors de actions, utilisez des assistants de framework ou émettez l'invalidation de synchronisation appropriée afin d'ouvrir l'actualisation de UI.

```an-diagram title="Boucle de synchronisation SQL-backed" summary="Pas d'observateurs, pas d'état collant. Une écriture modifie une version dans SQL ; chaque client interroge la version et la récupère."
{
  "html": "<div class=\"diagram-sync\"><div class=\"diagram-box\" data-rough>Action / assistant<br><small class=\"diagram-muted\">mutates data</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>base de données SQL</strong><small class=\"diagram-muted\">sync version increments</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-col\"><div class=\"diagram-node\">useDbSync()<br><small class=\"diagram-muted\">polls /_agent-native/poll</small></div><div class=\"diagram-pill ok\">invalidate caches &rarr; UI refreshes</div></div></div>",
  "css": ".diagram-sync{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-sync .diagram-col{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.diagram-sync .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="Le point final du sondage" method="GET" path="/_agent-native/poll"
{
  "method": "GET",
  "path": "/_agent-native/poll",
  "summary": "Renvoie les versions actuelles de synchronisation de la base de données par source afin que le client puisse détecter les modifications.",
  "description": "`useDbSync()` calls this on an interval (and falls back to it when SSE is unavailable). When a returned version is higher than the client's last-seen value, the matching React Query caches are invalidated and refetch.",
  "auth": "Session cookie (request-scoped identity)",
  "responses": [
    { "status": "200", "description": "Current sync versions keyed by source." }
  ]
}
```

## Webhooks {#webhooks}

Le webhooks entrant doit être vérifié, conservé et renvoyé rapidement. Le travail d'agent de longue durée doit utiliser le modèle de file d'attente d'intégration :

1. Vérifiez la signature ou le défi de la plateforme.
2. Insérez un travail durable dans SQL.
3. Déclenchez automatiquement une route de processeur signée.
4. Renvoyez 200 immédiatement.
5. Laissez la nouvelle exécution du processeur exécuter la boucle d'agent et publier le résultat.

```an-diagram title="Modèle de file d'attente d'intégration" summary="Le gestionnaire de webhook renvoie en millisecondes ; une exécution signée distincte exécute le travail lent de l'agent."
{
  "html": "<div class=\"diagram-webhook\"><div class=\"diagram-box\" data-rough>Webhook entrant<br><small class=\"diagram-muted\">Slack · Stripe · email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\" data-rough><strong>Handler</strong><div class=\"diagram-step\"><span class=\"diagram-pill\">1</span><small class=\"diagram-muted\">verify signature</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><small class=\"diagram-muted\">insère le travail dans SQL</small></div><div class=\"diagram-step\"><span class=\"diagram-pill\">3</span><small class=\"diagram-muted\">self-fire processor</small></div><div class=\"diagram-step\"><span class=\"diagram-pill ok\">4</span><small class=\"diagram-muted\">return 200 now</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Signed processor<br><small class=\"diagram-muted\">exécute la boucle agent et publie le résultat</small></div></div>",
  "css": ".diagram-webhook{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-webhook .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-webhook .diagram-step{display:flex;align-items:center;gap:8px}.diagram-webhook .diagram-arrow{font-size:22px;line-height:1}"
}
```

> [!WARNING]
> Ne vous fiez pas à des promesses non attendues après avoir renvoyé une réponse : les hôtes sans serveur gèlent l'exécution. Voir [Messaging](/docs/messaging) pour la file d'attente d'intégration canonique.

## Avancé : trappes d'évacuation {#advanced-escape-hatches}

La plupart des modèles n'en ont jamais besoin. Routes de fichiers Nitro et agent du framework
Le plugin de chat connecte déjà le serveur d'applications et le gestionnaire de l'agent de production.
Contactez-les uniquement lors de la création d'une intégration de serveur personnalisée en dehors du
pile de plugins de modèles standard.

### Serveurs H3 programmatiques {#create-server}

Pour les packages ou tests personnalisés nécessitant directement une application H3, `createServer()`
renvoie une application et un routeur préconfigurés :

```ts
import { createServer } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

const { app, router } = createServer();

router.get(
  "/api/health",
  defineEventHandler(() => ({ ok: true })),
);
```

### Gestionnaire d'agent de production {#agent-handler}

Le plugin de chat d'agent du framework monte déjà le gestionnaire d'agent de production
pour les modèles. N'appelez `createProductionAgentHandler()` directement lors de la construction
une intégration de serveur personnalisée en dehors de la pile de plugins de modèles standard —
sinon, personnalisez l'agent via `AGENTS.md`, skills, actions et
plugin de chat d'agent.

```ts
import { createProductionAgentHandler } from "@agent-native/core/server";

const handler = createProductionAgentHandler({
  scripts,
  systemPrompt: "You are the app agent...",
});
```
