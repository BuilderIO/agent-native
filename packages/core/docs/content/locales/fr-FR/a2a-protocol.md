---
title: "Protocole A2A"
description: "Communication d'agent à agent via JSON-RPC : découverte, messagerie, streaming et gestion des tâches."
---

# Protocole A2A

Communication agent à agent via HTTP. Les agents se découvrent, envoient des messages et reçoivent des résultats structurés.

## Vue d'ensemble {#overview}

A2A (agent à agent) est un protocole JSON-RPC pour la communication inter-agents. Un agent de messagerie peut demander à un agent d'analyse d'exécuter une requête. Un agent de calendrier peut rechercher des problèmes dans un agent de gestion de projet. Chaque agent expose ses capacités via une carte d'agent et accepte le travail via un point de terminaison standard JSON-RPC.

A2A est le substrat de la délégation entre applications dans ce cadre, notamment pour [Dispatch](/docs/dispatch), qui achemine un seul message entrant (Slack, e-mail, etc.) vers l'application de l'espace de travail la mieux adaptée pour le gérer.

Concepts clés :

- **Carte d'agent** : métadonnées publiques sur `/.well-known/agent-card.json` décrivant skills et ses fonctionnalités
- **JSON-RPC** : les applications natives d'agent utilisent `POST /_agent-native/a2a` ; les pairs externes/anciens peuvent utiliser `POST /a2a`
- **Tâches** — chaque message crée une tâche avec un cycle de vie (soumis, en cours d'exécution, terminé, échoué, annulé)
- **Authentification du porteur JWT** — la production A2A nécessite `A2A_SECRET` ou un ancien `apiKeyEnv` explicite

```an-diagram title="Un agent confie le travail à un autre" summary="Un agent de messagerie découvre la carte de l'agent d'analyse, envoie un message JSON-RPC et récupère une tâche terminée."
{
  "html": "<div class=\"diagram-handoff\"><div class=\"diagram-card\"><strong>Agent Mail</strong><small class=\"diagram-muted\">needs analytics</small></div><div class=\"diagram-col\"><div class=\"diagram-pill\">GET /.well-known/agent-card.json</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">POST /_agent-native/a2a<br><small class=\"diagram-muted\">message/send</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&larr;</div><div class=\"diagram-pill ok\">tâche · terminée</div></div><div class=\"diagram-card\" data-rough><strong>Agent Analytics</strong><small class=\"diagram-muted\">exécute run-query, renvoie le résultat</small></div></div>",
  "css": ".diagram-handoff{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-handoff .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-handoff .diagram-arrow{font-size:20px;line-height:1}"
}
```

## Configuration du serveur {#server-setup}

La plupart des modèles obtiennent A2A via le plug-in de discussion de l'agent framework. Si vous le montez vous-même, appelez `mountA2A()` dans un plugin serveur :

```ts
// server/plugins/a2a.ts
import { mountA2A } from "@agent-native/core/a2a";

export default defineNitroPlugin((nitro) => {
  mountA2A(nitro, {
    name: "Analytics Agent",
    description: "Runs analytics queries and returns chart data",
    skills: [
      {
        id: "run-query",
        name: "Run Query",
        description: "Execute a SQL query against the analytics database",
        tags: ["analytics", "sql"],
        examples: ["Show me signups by source this month"],
      },
    ],
    // Optional legacy external-peer bearer key. Prefer A2A_SECRET for
    // agent-native workspace calls and production deployments.
    apiKeyEnv: "A2A_API_KEY",
    streaming: true, // enable message/stream
  });
});
```

Ce montage :

- `GET /.well-known/agent-card.json` : métadonnées de découverte publiques.
- `POST /_agent-native/a2a` : point de terminaison JSON-RPC natif de l'agent principal.
- `POST /_agent-native/a2a/_process-task` — route de processeur asynchrone interne, signée avec `A2A_SECRET`.

Le client utilise également `/a2a` pour les agents externes qui exposent le chemin hérité/simple. Les déploiements natifs d'agent de production doivent définir `A2A_SECRET` ; sans cela, les environnements d'exécution hébergés échouent au lieu d'accepter le travail à distance non authentifié.

## Carte d'agent {#agent-card}

La carte d'agent est générée automatiquement à partir de votre configuration et servie sur `/.well-known/agent-card.json`. D'autres agents le récupèrent pour découvrir le skills de votre agent.

### Filtrage des compétences par locataire {#agent-card-filtering}

Le point de terminaison de la carte est public, donc le framework supprime skills dont les ID révèlent les intégrations par utilisateur ou par organisation avant de le diffuser. Toute compétence dont l'identifiant commence par `mcp__user_<emailhash>_…` ou `mcp__org_<orgid>_…` est supprimée de la carte publiée. Les outils stdio MCP contrôlés par l'opérateur (chargés à partir du `mcp.config.json`) et le skills défini par un modèle restent visibles. Cela empêche un appelant non authentifié de déterminer quels locataires existent ou quelles intégrations ils ont connectées. Voir `packages/core/src/a2a/server.ts`.

```json
{
  "name": "Analytics Agent",
  "description": "Runs analytics queries and returns chart data",
  "url": "https://analytics.example.com",
  "version": "1.0.0",
  "protocolVersion": "0.3",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "run-query",
      "name": "Run Query",
      "description": "Execute a SQL query against the analytics database",
      "tags": ["analytics", "sql"],
      "examples": ["Show me signups by source this month"]
    }
  ],
  "securitySchemes": {
    "jwtBearer": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" },
    "apiKey": { "type": "http", "scheme": "bearer" }
  },
  "security": [{ "jwtBearer": [] }, { "apiKey": [] }]
}
```

_(La version peut différer ; récupérez la carte active de votre application sur `/.well-known/agent-card.json` pour le `protocolVersion` actuel.)_

Lorsque `A2A_SECRET` est défini (le chemin recommandé), la carte annonce un
Schéma `jwtBearer` comme ci-dessus. Le schéma `apiKey` n'est ajouté que lorsqu'un ancien
`apiKeyEnv` est également configuré, donc une carte avec uniquement l'ensemble `A2A_SECRET` est publiée
`jwtBearer` seul.

## Méthodes JSON-RPC {#json-rpc-methods}

Toutes les méthodes sont appelées via `POST /_agent-native/a2a` au format JSON-RPC 2.0 :

| Méthode          | Description                                                                                                                            | Paramètres clés               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `message/send`   | Envoyez un message et attendez la tâche terminée. Passez `async: true` pour revenir immédiatement dans l'état `working` et interrogez. | `message, contextId?, async?` |
| `message/stream` | Envoyer un message, recevoir les mises à jour des tâches SSE                                                                           | `message, contextId?`         |
| `tasks/get`      | Récupérer une tâche par ID – utilisé pour interroger une tâche asynchrone jusqu'à son achèvement                                       | `id`                          |
| `tasks/cancel`   | Annuler une tâche en cours                                                                                                             | `id`                          |

```an-api title="Point de terminaison A2A principal" summary="Toutes les méthodes JSON-RPC sont ici POSTed. message/send illustré."
{
  "method": "POST",
  "path": "/_agent-native/a2a",
  "summary": "Envoyez un message et attendez la tâche terminée",
  "description": "JSON-RPC 2.0 endpoint for `message/send`, `message/stream`, `tasks/get`, and `tasks/cancel`. Pass `async: true` to return immediately in `working` state and poll with `tasks/get`.",
  "auth": "JWT bearer signed with A2A_SECRET (or legacy apiKeyEnv static token)",
  "params": [
    { "name": "Authorization", "in": "header", "type": "string", "required": false, "description": "Bearer token. Required in hosted production runtimes; optional in local dev." },
    { "name": "method", "in": "body", "type": "string", "required": true, "description": "One of message/send, message/stream, tasks/get, tasks/cancel." },
    { "name": "params.message", "in": "body", "type": "object", "required": false, "description": "{ role, parts[] } for message/send and message/stream." },
    { "name": "params.async", "in": "body", "type": "boolean", "required": false, "description": "Return immediately in working state and poll via tasks/get. Use on serverless hosts." },
    { "name": "params.id", "in": "body", "type": "string", "required": false, "description": "Task id for tasks/get and tasks/cancel." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"method\": \"message/send\",\n  \"params\": {\n    \"message\": {\n      \"role\": \"user\",\n      \"parts\": [{ \"type\": \"text\", \"text\": \"Show signups by source\" }]\n    },\n    \"async\": true\n  }\n}"
  },
  "responses": [
    { "status": "200", "description": "JSON-RPC result containing the task. With async:true the task returns in working state.", "example": "{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"result\": { \"id\": \"task_123\", \"status\": { \"state\": \"working\" } }\n}" },
    { "status": "503", "description": "Hosted production runtime with no A2A_SECRET configured — fails closed instead of running unauthenticated." }
  ]
}
```

Lorsque `message/send` est appelé avec `async: true`, le gestionnaire JSON-RPC met la tâche en file d'attente et déclenche automatiquement un POST vers une route `/_agent-native/a2a/_process-task` interne afin que le gestionnaire s'exécute dans une nouvelle exécution de fonction avec son propre délai d'attente complet. Cette route est authentifiée avec un jeton HMAC lié à l'ID de tâche (durée de vie de 5 minutes, signé avec `A2A_SECRET`). Il est monté avant la route `/_agent-native/a2a` JSON-RPC afin que la correspondance du préfixe de h3 ne l'avale pas.

```an-diagram title="Cycle de vie des tâches asynchrones sur sans serveur" summary="async:true revient à fonctionner en millisecondes, puis une nouvelle exécution exécute la boucle de l'agent pendant que l'appelant interroge."
{
  "html": "<div class=\"diagram-async\"><div class=\"diagram-box\" data-rough>message/send<br><small class=\"diagram-muted\">async: true</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill\">enqueue task</span><span class=\"diagram-pill warn\">return working</span><small class=\"diagram-muted\">~millisecondes</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>POST auto-déclenché /_agent-native/a2a/_process-task<br><small class=\"diagram-muted\">jeton HMAC · exécution neuve · timeout complet</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">tasks/get (poll)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">completed</div></div></div>",
  "css": ".diagram-async{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-async .diagram-panel{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-col{display:flex;flex-direction:column;align-items:center;gap:6px}.diagram-async .diagram-arrow{font-size:20px;line-height:1}",
  "caption": "A recurring sweeper re-claims any task left in flight if the function execution dies mid-run."
}
```

> [!IMPORTANT]
> **Délai d'expiration du webhook et de la passerelle sans serveur :**
> Les passerelles d'environnement hébergées (telles que Netlify, Vercel ou Cloudflare Pages) imposent des limites d'exécution strictes (souvent de 10 à 30 secondes) sur les routes HTTP publiques. Étant donné que les boucles d'agent peuvent prendre beaucoup de temps pour exécuter des requêtes, récupérer le contexte et exécuter des outils, vous ** devez utiliser `async: true`** lorsque vous appelez des points de terminaison A2A ou gérez un webhooks externe. Cela renvoie immédiatement un statut `working` à la passerelle API, gardant la connexion ouverte pendant quelques millisecondes seulement, tandis que le `/process-task` POST auto-déclenché exécute la boucle d'agent en arrière-plan. Ne bloquez pas la requête HTTP principale en attendant la fin de la boucle de l'agent.

Les messages contiennent des parties saisies : le texte, les données structurées et les fichiers peuvent tous voyager dans un seul message :

```an-annotated-code title="Message A2A avec des parties saisies"
{
  "language": "json",
  "code": "{\n  \"role\": \"user\",\n  \"parts\": [\n    { \"type\": \"text\", \"text\": \"Show signups by source\" },\n    { \"type\": \"data\", \"data\": { \"dateRange\": \"last-30d\" } },\n    {\n      \"type\": \"file\",\n      \"file\": { \"name\": \"report.csv\", \"mimeType\": \"text/csv\", \"bytes\": \"...\" }\n    }\n  ]\n}",
  "annotations": [
    { "lines": "4", "label": "text part", "note": "Instruction simple en langage naturel que l'agent lit." },
    { "lines": "5", "label": "data part", "note": "Arguments JSON structurés — par ex. une plage de dates — transmis avec l'invite." },
    { "lines": "6-9", "label": "file part", "note": "Joignez un fichier par nom, `mimeType` et base64 `bytes`." }
  ]
}
```

## Client {#client}

La classe `A2AClient` gère la découverte, la messagerie et le streaming :

```ts
import { A2AClient } from "@agent-native/core/a2a";

const client = new A2AClient("https://analytics.example.com", "my-api-key");

// Discover agent capabilities
const card = await client.getAgentCard();
console.log(card.skills);

// Send a message and get a completed task
const task = await client.send({
  role: "user",
  parts: [{ type: "text", text: "Show signups by source this month" }],
});
console.log(task.status.state); // "completed"
// task.status.message is a Message object ({ role, parts }), not a string.
// Pull text out of its parts:
const reply = task.status.message?.parts
  .filter((p) => p.type === "text")
  .map((p) => p.text)
  .join("");
console.log(reply); // agent's response text

// Stream responses for long-running work
for await (const update of client.stream({
  role: "user",
  parts: [{ type: "text", text: "Generate a full quarterly report" }],
})) {
  console.log(update.status.state, update.status.message);
}
```

## Aide pratique {#convenience-helper}

Pour les appels simples avec entrée/sortie de texte, utilisez `callAgent()` :

```ts
import { callAgent } from "@agent-native/core/a2a";

// One-shot: send text, get text back
const response = await callAgent(
  "https://analytics.example.com",
  "How many signups last week?",
  { apiKey: process.env.ANALYTICS_API_KEY },
);
console.log(response); // "There were 1,247 signups last week..."
```

## Invocation d'un espace de travail programmatique {#programmatic-invoke}

Pour les espaces de travail natifs d'agent, préférez l'assistant `agentNative` lorsque du code ou un
L'application sans tête doit découvrir les applications sœurs et les appeler par identifiant, nom ou
URL. Il utilise les mêmes primitives de découverte et d'invocation A2A que le
Commandes `agent-native agents` et `agent-native invoke` CLI.

```ts
import { agentNative } from "@agent-native/core/agent-native";

const agents = await agentNative.listAgents();

const result = await agentNative.invoke(
  "analytics",
  "Summarize signups by source this month.",
  { userEmail: "steve@example.com" },
);

console.log(`Called ${result.target.name}: ${result.responseText}`);
```

Utilisez ceci pour les mini-applications composables : Dispatch ou une application Orchestrator découvre
frères et sœurs de l'espace de travail, puis appelle l'application spécialisée propriétaire du fournisseur,
ensemble de données ou flux de travail. Dans les applications natives d'agent de production, définissez `A2A_SECRET` dans chaque
environnement d'application et transmettre l'identité de l'appelant (`userEmail`) afin que les appels sortants soient
signé en tant que jetons au porteur JWT. Utilisez `apiKeyEnv` uniquement pour les anciens homologues externes qui
attendez-vous à un jeton de porteur statique. Utilisez actions local au lieu de vous invoquer.

## Cycle de vie des tâches {#task-lifecycle}

Chaque message crée une tâche qui passe par ces états :

`submitted` → `working` → `completed` | `failed` | `canceled` | `input-required`

`input-required` n'est pas un terminal : le gestionnaire attend plus d'informations de la part de l'appelant et la tâche peut revenir à `working` une fois cette entrée arrivée.

| État             | Signification                                                            |
| ---------------- | ------------------------------------------------------------------------ |
| `submitted`      | Tâche créée, mise en file d'attente pour traitement                      |
| `working`        | Le gestionnaire traite le message                                        |
| `completed`      | Le gestionnaire s'est terminé avec succès                                |
| `failed`         | Le gestionnaire a généré une erreur                                      |
| `canceled`       | La tâche a été annulée via tâches/annulation                             |
| `input-required` | Le gestionnaire a besoin de plus d'informations de la part de l'appelant |

Les tâches persistent dans la table `a2a_tasks` SQL et peuvent être récupérées ultérieurement via `tasks/get`.

## Sécurité {#security}

Définissez `A2A_SECRET` sur chaque application de production qui appelle ou reçoit du trafic A2A. Les appelants natifs de l'agent signent les jetons du porteur JWT avec ce secret afin que les destinataires puissent vérifier l'identité de l'appelant avant le début de la boucle de l'agent.

Pour les homologues externes qui utilisent toujours un jeton statique partagé, définissez `apiKeyEnv` dans votre configuration sur le nom d'une variable d'environnement contenant le jeton de support attendu :

```ts
// Config
mountA2A(app, {
  // ...
  apiKeyEnv: "A2A_API_KEY", // reads process.env.A2A_API_KEY
});

// Client calls with the matching key
const client = new A2AClient(url, process.env.A2A_API_KEY);
```

Le point de terminaison de la carte d'agent est toujours public (pas d'authentification) afin que les autres agents puissent découvrir des fonctionnalités. Le point de terminaison `/_agent-native/a2a` JSON-RPC accepte les jetons de support JWT signés par `A2A_SECRET` et accepte également l'ancien jeton `apiKeyEnv` une fois configuré. Dans le développement local, l'authentification peut être omise ; dans les environnements d'exécution de production hébergés, l'authentification A2A manquante renvoie 503 au lieu de s'exécuter sans authentification.

### Limite de la stratégie d'authentification {#auth-policy}

La validation du support s'exécute à la limite de la requête (dans le gestionnaire JSON-RPC) avant que la boucle d'agent ne voie le message. Les assistants partagés dans `packages/core/src/a2a/auth-policy.ts` décident des besoins du déploiement :

- `isA2AProductionRuntime()` renvoie `true` sur Netlify, AWS Lambda, Cloudflare Pages/Workers, Vercel, Render, Fly et Cloud Run, même lorsque `NODE_ENV` n'est pas `"production"`. Certains fournisseurs sans serveur ne définissent pas `NODE_ENV` de manière cohérente. La stratégie lit donc également les indicateurs spécifiques au fournisseur.
- `hasConfiguredA2ASecret()` renvoie `true` lorsque `A2A_SECRET` est défini.
- `shouldAdvertiseJwtA2AAuth()` est ce que la carte d'agent utilise pour décider de publier ou non un schéma de sécurité `jwtBearer`.

La politique de production est stricte : dans n'importe quel environnement d'exécution de production, la route asynchrone `_process-task` refuse d'être distribuée à moins que `A2A_SECRET` ne soit configuré (renvoie 503), et le point de terminaison JSON-RPC refuse les appels non authentifiés. La solution de secours du développement (avertir une fois, autoriser) ne se déclenche que lorsqu'aucun indicateur de production n'est défini.

Cette limite est importante car la boucle d'agent accepte les entrées de forme libre d'un appelant distant. Placer la vérification du porteur à l'intérieur de la boucle, ou s'appuyer sur un outil pour l'appliquer, permettrait à l'injection rapide ou à un gestionnaire de bogues de contourner l'authentification. Le garder à la limite HTTP signifie qu'un échec de jeton court-circuite avant tout appel LLM.

La vérification JWT (`verifyA2AToken` dans `server.ts`) accepte les jetons signés soit avec le `A2A_SECRET` global, soit avec un secret d'organisation recherché à partir de SQL via la revendication `org_domain` du jeton, et applique les propres revendications `aud`/`iss` du jeton lorsqu'elles sont présentes.

## Suites {#continuations}

Lorsqu'un agent appelle un homologue distant A2A qui ne revient pas immédiatement, l'infrastructure interroge `tasks/get` jusqu'à ce que la tâche soit réglée. Ceci est câblé via `A2AClient.sendAndWait`, qui est le mode par défaut utilisé par l'assistant `callAgent()`.

```ts
// Default: async + poll (safe on serverless hosts)
const reply = await callAgent(url, "Generate the quarterly report", {
  userEmail: session.email,
});

// Single-shot blocking POST (avoid on Netlify/Vercel for slow handlers)
const reply2 = await callAgent(url, "Quick lookup", { async: false });
```

Pour les continuations entrantes déclenchées par une intégration de messagerie (Slack, email), le framework conserve la continuation dans SQL et la traite hors bande :

- Une ligne est écrite dans la table `a2a_continuations` lorsque le gestionnaire d'intégration passe le relais à un agent distant.
- Un `POST /_agent-native/integrations/process-a2a-continuation` auto-déclenché revendique la ligne, appelle `tasks/get` sur l'agent distant et transmet la réponse à l'adaptateur d'intégration ou replanifie.
- Si la tâche distante fonctionne toujours, la ligne est replanifiée et redistribuée. Le budget du sondage est **limité par ~20 minutes de travail à distance** (`MAX_REMOTE_WORK_MS`) et **30 tentatives d'envoi** (`MAX_ATTEMPTS`) ; après l'une ou l'autre limite, la continuation échoue avec une erreur claire et l'utilisateur obtient une réponse "l'agent n'a pas répondu à temps".
- Un balayeur récurrent (`claimDueA2AContinuations`) récupère toutes les lignes de continuation qui ont été laissées en vol lorsque l'exécution précédente de la fonction a été interrompue. Même si l'application appelante plante en cours d'interrogation, le prochain tick de balayage reprend le travail.

Défini dans `packages/core/src/integrations/a2a-continuation-processor.ts`. Le même modèle de tâche de nouvelle tentative est utilisé pour les tâches de webhook d'intégration (`pending-tasks-retry-job.ts`), qui est une file d'attente distincte limitée à 3 tentatives, distincte du budget d'interrogation de continuation ci-dessus.

## Espace de travail A2A {#workspace-a2a}

Dans un espace de travail multi-applications déployé sur un seul site Netlify (voir [multi-app workspace](/docs/multi-app-workspace)), chaque application sous `apps/<id>/` est automatiquement enregistrée en tant qu'homologue A2A :

- Un `A2A_SECRET` partagé est monté dans l'environnement de chaque application au moment de la construction.
- Les appels entre applications ont la même origine : `https://workspace.example.com/apps/analytics` appelle `https://workspace.example.com/apps/mail` – il n'y a donc pas de configuration DNS, CORS ou JWT par paire.
- Les appels sortants signés avec le secret partagé portent l'adresse e-mail de l'appelant sous le nom `sub` et (le cas échéant) le domaine de l'organisation. Le vérificateur JWT du destinataire accepte soit le secret partagé, soit le secret de portée organisationnelle de SQL, dans cet ordre.
- La découverte d'agent parcourt le registre de l'espace de travail plutôt que de compter sur l'opérateur pour câbler chaque homologue manuellement. Voir `discoverAgents` dans `packages/core/src/server/agent-discovery.ts` et le chemin d'actualisation de l'organisation dans `packages/core/src/org/handlers.ts`.

A2A externe (appels à des agents en dehors de votre espace de travail) utilise toujours le modèle de jeton de porteur (`apiKeyEnv` + `A2AClient(url, apiKey)`). L'espace de travail A2A est superposé au-dessus ; rien sur les changements des pairs externes.

## Les pièges du sans serveur {#serverless}

**Ne comptez jamais sur un `Promise` qui survivra à la réponse.** Les fonctions sans serveur (Netlify, Vercel, AWS Lambda, Cloud Run) gèlent au moment où le corps de la réponse est vidé - parfois avant même que la poignée de main TCP d'un `fetch(...)` inattendu ne se termine. Les modèles qui fonctionnent localement sur Node abandonneront silencieusement le travail en production.

Le modèle du framework, utilisé à la fois par la répartition asynchrone A2A et par [integration webhook queue](/docs/messaging), est :

1. Acceptez la demande, conservez ce qui doit arriver à SQL, renvoyez 200 immédiatement.
2. Déclenchez automatiquement un `POST` vers une route de structure distincte (`/_agent-native/a2a/_process-task` ou `/_agent-native/integrations/process-task`) afin que le travail réel s'exécute dans une **nouvelle exécution de fonction** avec son propre délai d'attente complet.
3. Authentifiez l'auto-tir avec un jeton HMAC lié à l'ID de ligne, signé avec `A2A_SECRET`.
4. Une nouvelle tentative récurrente balaie toutes les lignes réclamées mais non terminées, de sorte qu'une fonction en panne ne bloque pas le travail.

Lorsque vous écrivez votre propre gestionnaire A2A ou adaptateur d'intégration, suivez la même forme. N'attachez pas de travail à une promesse détachée après `return`. Si vous devez vous lancer automatiquement à partir d'un gestionnaire sans serveur, démarrez la récupération avant de revenir et donnez-lui une petite longueur d'avance (le framework utilise un court délai d'attente) afin que les environnements d'exécution de style Lambda ne se figent pas avant que la requête sortante ne quitte le processus. La compétence `integration-webhooks` est la référence canonique.

## Mentions des agents {#agent-mentions}

Vous pouvez mentionner les agents `@` directement dans le composeur de chat. Les agents connectés utilisent A2A : lorsque vous mentionnez un agent connecté, le serveur effectue un appel A2A à cet agent et intègre la réponse dans le contexte de votre conversation.

Les agents d'espace de travail personnalisés sont différents : ils s'exécutent localement dans l'application/le runtime actuel plutôt que sur A2A.

Voir [Agent Mentions](/docs/agent-mentions) pour plus de détails sur le fonctionnement des mentions, comment ajouter des agents et comment créer des fournisseurs de mentions personnalisés.

## Intégrations de messagerie {#messaging-integrations}

Les agents peuvent également être contactés à partir de plateformes de messagerie externes telles que Slack, la messagerie électronique, Telegram et WhatsApp. Les utilisateurs envoient des messages sur ces plateformes et l'agent répond dans le même fil de discussion, en utilisant les mêmes outils et actions que le chat Web.

Voir [Messaging](/docs/messaging) pour les détails de configuration sur chaque plate-forme.

## Exemple : requête multi-agents {#example}

Un agent de messagerie a besoin de données analytiques. L'agent d'analyse expose une compétence « exécuter-requête » via A2A :

```ts
// In the mail agent's actions/get-analytics.ts
import { defineAction } from "@agent-native/core/action";
import { callAgent } from "@agent-native/core/a2a";
import { z } from "zod";

export default defineAction({
  description: "Ask the analytics agent a question.",
  schema: z.object({ question: z.string() }),
  async run({ question }) {
    const response = await callAgent(
      "https://analytics.example.com",
      question,
      { apiKey: process.env.ANALYTICS_API_KEY },
    );
    return { answer: response };
  },
});
```

L'agent d'analyse reçoit le message, exécute la requête via son gestionnaire et renvoie le résultat. L'action mail récupère la réponse textuelle. Pas de base de données partagée, pas d'appels API directs : juste une communication d'agent à agent.
