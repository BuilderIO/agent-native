---
title: "Suivi et analyses"
description: "Analyses côté serveur avec fournisseurs enfichables : PostHog, Mixpanel, Amplitude ou webhook personnalisé"
---

# Suivi des analyses

Une fonction, plusieurs destinations. Appelez `track()` à partir de n'importe quel code côté serveur (actions, plugins, routes de serveur) et l'événement est diffusé auprès de chaque fournisseur d'analyse enregistré. Aucune dépendance SDK, aucun script côté client, aucun blocage. Le même `track()` est également disponible dans [browser/app code](#client) et est acheminé vers les mêmes fournisseurs.

Il s'agit de _product_ Analytics : les événements de votre application sont transmis à PostHog/Mixpanel/Amplitude. Pour les métriques de _qualité des agents_ (traces, coûts, évaluations, commentaires) stockées dans votre propre base de données, voir [Observability](/docs/observability).

```ts
import { track } from "@agent-native/core/tracking";

track(
  "order.completed",
  { total: 49.99, items: 3 },
  { userId: "steve@builder.io" },
);
```

```an-diagram title="Un appel track(), chaque fournisseur" summary="Les appelants du serveur et du client accèdent au même registre, qui diffuse chaque événement en parallèle à tous les fournisseurs actifs."
{
  "html": "<div class=\"trk\"><div class=\"diagram-col\"><div class=\"diagram-node\">Code serveur<br><small class=\"diagram-muted\">actions &middot; plugins &middot; routes</small></div><div class=\"diagram-node\">Code navigateur<br><small class=\"diagram-muted\">POST /_agent-native/track</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Provider registry</span><small class=\"diagram-muted\">fan-out, lancer sans attendre</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">PostHog</div><div class=\"diagram-box\">Mixpanel</div><div class=\"diagram-box\">Amplitude</div><div class=\"diagram-box\">Webhook</div></div></div>",
  "css": ".trk{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.trk .diagram-col{display:flex;flex-direction:column;gap:8px}.trk .diagram-arrow{font-size:22px;line-height:1}.trk .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Fournisseurs intégrés {#built-in}

Définissez une variable d'environnement et le fournisseur s'enregistre automatiquement au démarrage du serveur. Aucune modification de code requise.

| Fournisseur       | Vars d'environnement                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| PostHog           | `POSTHOG_API_KEY` (obligatoire), `POSTHOG_HOST` (facultatif, par défaut `https://us.i.posthog.com`) |
| Panneau de mixage | `MIXPANEL_TOKEN`                                                                                    |
| Amplitude         | `AMPLITUDE_API_KEY`                                                                                 |
| Webhook           | `TRACKING_WEBHOOK_URL` (obligatoire), `TRACKING_WEBHOOK_AUTH` (en-tête `Authorization` en option)   |

Plusieurs fournisseurs peuvent être actifs simultanément. Chaque événement leur est destiné à tous.

## API {#api}

### `track(name, properties?, meta?)` {#track}

Déclenchez un événement d'analyse. Distribution à tous les fournisseurs enregistrés.

```ts
import { track } from "@agent-native/core/tracking";

track(
  "meal.logged",
  { mealName: "Salad", calories: 350 },
  { userId: "steve@builder.io" },
);
```

### `identify(userId, traits?)` {#identify}

Identifiez un utilisateur avec des caractéristiques. Transmis aux fournisseurs qui le prennent en charge (PostHog, Mixpanel, Amplitude, webhook).

```ts
import { identify } from "@agent-native/core/tracking";

identify("steve@builder.io", { plan: "pro", company: "Builder.io" });
```

Besoin d'un backend personnalisé, du registre de fournisseur API ou des composants internes de traitement par lots/singleton ? Voir [Advanced: custom providers & internals](#advanced) à la fin.

## Utiliser track() dans les modèles {#templates}

Appelez `track()` à partir des gestionnaires d'actions pour enregistrer l'activité de l'utilisateur ou de l'agent :

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core/action";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

export default defineAction({
  description: "Create a new project.",
  schema: z.object({
    name: z.string(),
    template: z.string().optional(),
  }),
  run: async ({ name, template }, ctx) => {
    const project = await db
      .insert(projects)
      .values({ name, template })
      .returning();

    track("project.created", { name, template }, { userId: ctx.userEmail });

    return { ok: true, projectId: project[0].id };
  },
});
```

Les appels de suivi sont déclenchés et oubliés : ils reviennent immédiatement et ne bloquent jamais la réponse à l'action.

## Suivi côté client {#client}

`track()` fonctionne également à partir du code du navigateur/de l'application. Importez le jumeau client de `@agent-native/core/client` et appelez-le de la même manière : il POST l'événement sur la route du framework sur `POST /_agent-native/track`, qui le transmet aux **mêmes** fournisseurs côté serveur enregistrés (PostHog, Mixpanel, Amplitude, webhook). Aucune analyse SDK n'est envoyée au navigateur et aucune clé de fournisseur n'est exposée côté client.

```an-api title="Le parcours de suivi des clients"
{
  "method": "POST",
  "path": "/_agent-native/track",
  "summary": "Transférer un événement de navigateur aux fournisseurs côté serveur enregistrés",
  "auth": "Session required + same-origin/CSRF marker (set automatically by the client helper). Not an open analytics relay.",
  "params": [
    { "name": "name", "in": "body", "type": "string", "required": true, "description": "Event name. Capped at 200 characters." },
    { "name": "properties", "in": "body", "type": "object", "description": "Event properties (~16KB cap). `source: \"client\"` and the active `org_id` are added server-side." }
  ],
  "description": "Identity is resolved **server-side** from the session — browser code never passes a `userId`. Fire-and-forget: never blocks the UI, never throws, swallows network errors. Oversized or malformed payloads are rejected."
}
```

```ts
import { track } from "@agent-native/core/client";

// e.g. inside a click handler or effect
track("checkout.completed", { total: 49.99, items: 3 });
```

Principales différences par rapport au [server `track()`](#track) :

- **Aucun argument d'identité.** L'événement est attribué côté serveur à l'utilisateur connecté (et à l'organisation active, comme `org_id` dans `properties`). Le code du navigateur ne transmet jamais un `userId`.
- **`source: "client"`** est ajouté aux propriétés de chaque événement afin que vous puissiez distinguer les événements générés par le client de ceux du serveur.
- **Fire-and-forget.** Il ne bloque jamais le UI, ne lance jamais et avale les erreurs réseau.
- **Authentifié, propriétaire uniquement.** L'itinéraire nécessite une session et un marqueur de même origine/CSRF (défini automatiquement par l'assistant), il ne peut donc pas être utilisé comme relais d'analyse ouvert. `name` est limité à 200 caractères et `properties` à ~ 16 Ko ; les charges utiles surdimensionnées ou mal formées sont rejetées.

Ceci est distinct de la télémétrie interne du navigateur du framework (`trackEvent()` / pages vues automatiques – voir [Browser defaults](#browser-defaults) ci-dessous), qui alimente les propres analyses de produits de Agent Native. Utilisez `track()` pour les événements d'analyse de votre application qui doivent atteindre vos fournisseurs configurés.

## Avancé : fournisseurs personnalisés et éléments internes {#advanced}

La plupart des applications n'ont besoin que de `track()` / `identify()` et d'un fournisseur intégré. Le reste de la surface (enregistrement des fournisseurs personnalisés, de l'interface `TrackingProvider`, des éléments internes de traitement par lots et de la propre télémétrie du navigateur du framework) se trouve ci-dessous.

<details>
<summary><strong>Registre du fournisseur API, interface, composants internes et paramètres par défaut du navigateur</strong></summary>

### `registerTrackingProvider(provider)` {#register}

Enregistrez un fournisseur personnalisé pour n'importe quel backend d'analyse.

```ts
import { registerTrackingProvider } from "@agent-native/core/tracking";

registerTrackingProvider({
  name: "my-analytics",
  track(event) {
    // Send event to your backend
    fetch("https://analytics.example.com/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {});
  },
  identify(userId, traits) {
    // Optional — link user identity to future events
  },
  flush() {
    // Optional — called on graceful shutdown
  },
});
```

### `flushTracking()` {#flush}

Videz tous les fournisseurs. Appelez avant la sortie du processus pour garantir que les événements en attente sont envoyés.

```ts
import { flushTracking } from "@agent-native/core/tracking";

await flushTracking();
```

### `unregisterTrackingProvider(name)` {#unregister}

Supprimer un fournisseur par son nom. Renvoie `true` si le fournisseur a été trouvé et supprimé.

### `listTrackingProviders()` {#list}

Renvoie les noms de tous les fournisseurs enregistrés.

### L'interface TrackingProvider {#provider-interface}

```ts
interface TrackingProvider {
  name: string;
  track(event: TrackingEvent): void | Promise<void>;
  identify?(
    userId: string,
    traits?: Record<string, unknown>,
  ): void | Promise<void>;
  flush?(): void | Promise<void>;
}

interface TrackingEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
}
```

Seuls les `name` et `track` sont requis. `identify` et `flush` sont facultatifs : implémentez-les si votre backend prend en charge l'identité utilisateur et la livraison par lots.

### Comment ça marche {#internals}

- **HTTP par lots** : les fournisseurs intégrés mettent les événements en file d'attente et les vident toutes les 10 secondes ou lorsque 50 événements s'accumulent, selon la première éventualité. Cela minimise les requêtes sortantes sans perdre de données.
- **Aucune dépendance SDK** — tous les fournisseurs intégrés utilisent `fetch()` brut. Pas de PostHog SDK, pas de Mixpanel SDK, pas d'Amplitude SDK. Maintient la légèreté du framework.
- **Livraison dans les meilleurs efforts** : les erreurs du fournisseur sont détectées et enregistrées. Une intégration analytique défaillante ne fait jamais planter l'appelant ni ne bloque le traitement des requêtes.
- **Global singleton** : le registre utilise une clé `Symbol.for` sur `globalThis` afin que plusieurs instances de graphiques ESM (mode développement Vite + Nitro, liens symboliques) partagent un ensemble de fournisseurs.

### Paramètres par défaut du navigateur {#browser-defaults}

Cela couvre la télémétrie interne du framework, qui concerne principalement les contributeurs du framework et les auteurs de modèles avancés.

Les racines du modèle appellent `configureTracking()` une fois au démarrage. Les événements du navigateur envoyés avec `trackEvent()` incluent automatiquement le contexte de l'application/du modèle ainsi que la connexion LLM actuelle lorsque l'application peut le résoudre :

- `llm_connection` : étiquette de fournisseur normalisée telle que `builder`, `anthropic`, `openai`, `google` ou `none`
- `llm_engine` : identifiant du moteur, par exemple `builder` ou `ai-sdk:openai`
- `llm_model` — le modèle sélectionné/par défaut lorsqu'il est connu
- `llm_connection_source` — `app_secrets`, `settings` ou `env`
- `llm_connection_configured` – si une connexion LLM est disponible

Le framework suit également `builder connect clicked` à partir des CTA Connect Builder, et les routes de connexion Builder côté serveur suivent les événements de cycle de vie démarrés/réussis/échoués. `configureTracking()` est appelé automatiquement par le framework ; vous n'avez pas besoin de l'appeler dans votre propre code de modèle.

</details>

## Quelle est la prochaine étape

- [**Actions**](/docs/actions) – d'où proviennent la plupart des appels de suivi
- [**Server Plugins**](/docs/server) — `registerBuiltinProviders()` s'exécute dans le plugin core-routes au démarrage
- [**Secrets**](/docs/security) : gérer les clés API pour les fournisseurs de suivi
