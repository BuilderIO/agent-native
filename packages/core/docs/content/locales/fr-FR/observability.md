---
title: "Observabilité"
description: "Traces d'agent, évaluations, commentaires, expériences A/B et tableau de bord intégré, le tout sans configuration."
---

# Observabilité des agents

Chaque application native d'agent bénéficie d'une observabilité prête à l'emploi. Les traces, les évaluations automatisées, les commentaires des utilisateurs et les expériences A/B fonctionnent sans configuration : toutes les données se trouvent dans la propre base de données SQL de l'application.

Cette page couvre les métriques de *qualité de l'agent* : traces, coûts, évaluations et commentaires stockés dans votre base de données. Pour les analyses de _produit_ (les événements de votre application transmis à PostHog/Mixpanel/Amplitude), voir [Tracking](/docs/tracking).

## Trois choses appelées « évaluations »/« observabilité » – qu'est-ce que je veux ? {#which}

Ces trois pages sont faciles à confondre. Choisissez en fonction de la question que vous posez :

| Page                                                           | La question à laquelle il répond                                           | Quand il s'exécute                                    | Inquiétudes     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------- |
| **Évaluations d'observabilité** (cette page, l'onglet _Evals_) | "Comment se sont déroulés mes véritables cycles de production ?"           | Passif, après chaque course (échantillon du juge LLM) | Qualité         |
| **[CI Eval Gate](/docs/evals)** (`*.eval.ts`)                  | "L'agent fait-il ce qu'il faut sur cette entrée fixe ?"                    | Actif, déterministe, une porte CI/déploiement         | Qualité         |
| **[Observational Memory](/docs/observational-memory)**         | "Est-ce que ce long fil reste bon marché et à l'intérieur de la fenêtre ?" | Compactage en arrière-plan sur les threads longs      | Coût / contexte |

L'observabilité et CI Eval Gate obtiennent tous deux une _qualité_ mais à partir d'extrémités opposées : notation passive post-hoc du trafic réel par rapport aux contrôles actifs de réussite/d'échec sur les entrées fixes. La mémoire observationnelle n'est pas liée à la qualité ; il s'agit du coût des jetons et de la pression de la fenêtre contextuelle.

## Ce qui est capturé automatiquement {#captured}

Lorsqu'un utilisateur envoie un message, le framework enregistre automatiquement :

- **Utilisation du jeton** — entrée, sortie, lecture du cache, écriture du cache
- **Coût** — calculé à partir du nombre de jetons et de la tarification du modèle
- **Latence** – durée totale et durée par appel d'outil
- **Appels d'outils** — quels actions ont été invoqués, statut de réussite/erreur, durée
- **Évaluations automatisées** – 5 scores de qualité calculés après chaque exécution

Aucune modification de code n’est nécessaire. L'instrumentation s'accroche de manière transparente au `production-agent.ts`.

```an-diagram title="Chaque course alimente la boucle" summary="Une exécution d'agent produit une trace, des scores automatisés et un feedback hook, le tout stocké dans le propre SQL de l'application et affiché sur le tableau de bord. Les expériences répartissent le trafic entre les variantes de configuration."
{
  "html": "<div class=\"obs-loop\"><div class=\"diagram-node\">Exécution agent<br><small class=\"diagram-muted\">production-agent.ts</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Capturé automatiquement</span><small class=\"diagram-muted\">tokens &middot; cost &middot; latency &middot; tool calls</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Traces &amp; spans</div><div class=\"diagram-box\">Evals (5 scorers + LLM judge)</div><div class=\"diagram-box\">Feedback &amp; frustration index</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">Dashboard<br><small class=\"diagram-muted\">scoped to the signed-in user</small></div></div>",
  "css": ".obs-loop{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.obs-loop .diagram-col{display:flex;flex-direction:column;gap:8px}.obs-loop .diagram-arrow{font-size:22px;line-height:1}.obs-loop .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Le tableau de bord {#dashboard}

Ajoutez le tableau de bord à n'importe quel modèle avec un seul itinéraire :

```tsx
// app/routes/observability.tsx
import { ObservabilityDashboard } from "@agent-native/core/client";

export default function ObservabilityPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <ObservabilityDashboard />
    </div>
  );
}
```

Toutes les données sont limitées à l'utilisateur connecté ; il n'existe pas de vue d'administration multi-utilisateurs aujourd'hui.

Le tableau de bord comporte 5 onglets :

| Onglet             | Ce que cela montre                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **Vue d'ensemble** | Mesures clés : exécutions, coût, latence, taux de réussite de l'outil, satisfaction, score d'évaluation |
| **Conversations**  | Liste de traces avec exploration vers des étendues individuelles (agent_run, llm_call, tool_call)       |
| **Évaluations**    | Scores d'évaluation automatisés par critères, tendances au fil du temps                                 |
| **Expériences**    | Liste de tests A/B avec badges de statut, résultats des variantes avec intervalles de confiance         |
| **Commentaires**   | Flux de pouces vers le haut/vers le bas, répartition par catégorie, scores de frustration               |

## Commentaires des utilisateurs {#feedback}

### Commentaires explicites

Les boutons de pouce vers le haut/vers le bas s'affichent en ligne sur chaque message d'agent dans le chat UI. Le pouce vers le bas ouvre une fenêtre contextuelle de catégorie (Inexact, Pas utile, Mauvais outil, Trop lent). Ceci est automatiquement connecté au `AssistantChat.tsx`.

### Commentaires implicites (indice de frustration)

Le framework calcule un indice de frustration (0-100) à partir des signaux de conversation :

| Signal                        | Poids | Ce qu'il détecte                                    |
| ----------------------------- | ----- | --------------------------------------------------- |
| Reformulation                 | 30%   | L'utilisateur répète des messages similaires        |
| Modèles de nouvelle tentative | 20%   | "Réessayez", "non, c'est faux"                      |
| Abandon                       | 20%   | La session se termine peu de temps après la réponse |
| Sentiments                    | 15%   | Modèles de langage négatifs                         |
| Tendance de longueur          | 15%   | Diminution de la longueur des messages              |

Interprétation des scores : 0-20 = sain, 20-40 = friction, 40-60 = insatisfait, 60+ = session interrompue.

## Évaluations automatisées {#evals}

Cinq scoreurs déterministes s'exécutent après chaque exécution d'agent :

| Critères            | Ce qu'il mesure                                                                 | Plage de scores |
| ------------------- | ------------------------------------------------------------------------------- | --------------- |
| `tool_success_rate` | % d'appels d'outils sans erreurs                                                | 0-1             |
| `step_efficiency`   | Pénalise les itérations LLM excessives pour les exécutions utilisant des outils | 0-1             |
| `latency_score`     | Normalisé par rapport à la ligne de base de 10 s/outil                          | 0-1             |
| `cost_efficiency`   | Normalisé par rapport au coût de référence                                      | 0-1             |
| `error_recovery`    | L'agent a-t-il récupéré des erreurs de l'outil ?                                | 0 ou 1          |

### LLM-en tant que juge (facultatif)

Activez l'évaluation basée sur LLM échantillonnée en définissant `evalSampleRate` :

```ts
import { putSetting } from "@agent-native/core/settings";

await putSetting("observability-config", {
  enabled: true,
  evalSampleRate: 0.05, // 5% of runs
});
```

Les critères personnalisés utilisent des rubriques en langage naturel :

```ts
const criteria = {
  name: "helpfulness",
  description: "Was the response helpful and complete?",
  rubric: "0.0 = unhelpful, 0.5 = partially helpful, 1.0 = fully resolved",
};
```

## Expériences A/B {#experiments}

Testez différents modèles, températures ou configurations d'agent :

```ts
// Create via API
POST /_agent-native/observability/experiments
{
  "name": "model-a-vs-b",
  "variants": [
    { "id": "control", "weight": 50, "config": { "model": "<your-model-id>" } },
    { "id": "treatment", "weight": 50, "config": { "model": "<other-model-id>" } }
  ],
  "metrics": ["cost", "latency", "satisfaction"]
}

// Start the experiment
PUT /_agent-native/observability/experiments/:id
{ "status": "running" }
```

Utilisez les identifiants de modèle réels acceptés par votre moteur à la place de `<your-model-id>` / `<other-model-id>` (les noms de modèles changent souvent — vérifiez votre fournisseur/moteur pour les identifiants actuels). La boucle d'agent résout automatiquement la variante de l'utilisateur et applique le remplacement de la configuration. L'affectation utilise un hachage cohérent : le même utilisateur obtient toujours la même variante.

```an-diagram title="Attribution de variantes de hachage cohérentes" summary="Chaque utilisateur hache une variante stable, la boucle applique le remplacement de configuration de cette variante et les résultats sont cumulés par variante avec des intervalles de confiance."
{
  "html": "<div class=\"exp\"><div class=\"diagram-node\">ID utilisateur<br><small class=\"diagram-muted\">consistent hash</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill\">control &middot; 50%</span><small class=\"diagram-muted\">surcharge de config A</small></div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">treatment &middot; 50%</span><small class=\"diagram-muted\">surcharge de config B</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Résultats per variant<br><small class=\"diagram-muted\">cost &middot; latency &middot; satisfaction</small></div></div>",
  "css": ".exp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.exp .diagram-col{display:flex;flex-direction:column;gap:8px}.exp .diagram-card{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.exp .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Configuration {#config}

Tous les paramètres sont stockés dans la clé `observability-config` :

```ts
{
  enabled: true,           // Master switch
  capturePrompts: false,   // Store prompt content in traces
  captureToolArgs: false,  // Store action input arguments
  captureToolResults: false, // Store action results
  evalSampleRate: 0,       // 0-1, fraction of runs to LLM-judge
  exporters: []            // OTLP export targets
}
```

```an-callout
{
  "tone": "info",
  "body": "Content is **redacted by default** — only token counts, costs, and timing are stored. `capturePrompts`, `captureToolArgs`, and `captureToolResults` are opt-in; turn them on only when you need prompt/argument content for debugging."
}
```

## Points de terminaison API {#api}

Tous montés automatiquement sur `/_agent-native/observability/` :

| Méthode | Chemin                     | Objectif                                |
| ------- | -------------------------- | --------------------------------------- |
| GET     | `/`                        | Statistiques générales                  |
| GET     | `/traces`                  | Liste des résumés de trace              |
| GET     | `/traces/:runId`           | Détails de la trace (résumé + étendues) |
| GET     | `/traces/:runId/evals`     | Évaluations pour une exécution          |
| POST    | `/feedback`                | Envoyer des commentaires                |
| GET     | `/feedback`                | Répertorier les commentaires            |
| GET     | `/feedback/stats`          | Agrégation de commentaires              |
| GET     | `/satisfaction`            | Notes de satisfaction                   |
| GET     | `/evals/stats`             | Statistiques d'évaluation               |
| POST    | `/experiments`             | Créer un test                           |
| GET     | `/experiments`             | Liste des tests                         |
| GET     | `/experiments/:id`         | Obtenir les détails du test             |
| PUT     | `/experiments/:id`         | Mettre à jour le test                   |
| POST    | `/experiments/:id/results` | Calculer les résultats                  |
| GET     | `/experiments/:id/results` | Obtenir des résultats                   |

Tous les points de terminaison prennent en charge les paramètres de requête `?since=N` (horodatage ms) et `?limit=N`.

## Exporter vers des plateformes externes {#export}

Envoyer des traces à Langfuse, Datadog, Grafana ou tout autre backend compatible OTel :

```ts
await putSetting("observability-config", {
  enabled: true,
  exporters: [
    {
      type: "otlp",
      endpoint: "https://cloud.langfuse.com/api/public/otel",
      headers: { Authorization: "Bearer sk-..." },
    },
  ],
});
```

Le framework émet des étendues de convention sémantique `gen_ai.*` compatibles avec la spécification OpenTelemetry GenAI.

## Étendues OpenTelemetry {#otel}

Séparée de la configuration `exporters` ci-dessus (qui envoie les traces internes à un point de terminaison OTLP), la boucle d'agent peut également émettre des **spans OpenTelemetry en direct** pour chaque exécution, appel de modèle et appel d'outil — de sorte qu'un hôte qui exécute déjà un collecteur OTel voit l'activité de l'agent aux côtés du reste de ses traces distribuées.

Cette couche est **facultative et non opérationnelle par défaut** :

- `@opentelemetry/api` est une **dépendance facultative**. S'il n'est pas installé, les assistants se dégradent en mode silencieux - rien ici n'est jamais jeté dans la boucle de l'agent.
- Même lorsque le package API _est_ présent, il fournit un traceur sans opération par défaut. Les étendues ne deviennent réelles qu'une fois que le **hôte enregistre un `TracerProvider`** (via `@opentelemetry/sdk-node` ou similaire). Le framework ne dépend délibérément **pas** des packages lourds SDK/exporter ni n'enregistre un fournisseur lui-même - l'instrumentation est activée par l'application d'intégration.

Ainsi, le coût lorsque vous n'avez pas câblé OTel est de quelques lectures de propriétés mises en cache par appel. Pour l'activer, installez le package API ainsi que votre SDK et enregistrez un fournisseur au démarrage du serveur de la même manière que vous le feriez pour tout autre service Node.

La boucle d'agent émet trois types de span :

| Portée      | Quand                          | Attributs                                                         |
| ----------- | ------------------------------ | ----------------------------------------------------------------- |
| `agent.run` | une fois par exécution d'agent | `agent.run_id`, `agent.thread_id`, `agent.user_id`, `agent.model` |
| `tool.call` | une fois par appel d'action    | `tool.name`, plus statut de réussite/erreur                       |
| `llm.call`  | par appel de modèle            | timing + état OK/erreur                                           |

Les travées sont terminées avec l'état OK/ERROR et enregistrent le message d'erreur en cas d'échec. Les valeurs des attributs zéro/sentinelle sont élaguées afin que les étendues ne soient pas encombrées de bruit. Cette couche OTel est purement additive aux tables internes `agent_trace_spans` / `agent_trace_summaries` qui alimentent le tableau de bord ci-dessus : les deux sont produites à partir des mêmes événements d'exécution.

## Rapport d'erreurs (Sentry) {#sentry}

Les erreurs côté serveur qui échappent aux gestionnaires de route Nitro sont signalées à Sentry lorsqu’un DSN est configuré. Sans cela, le SDK ne fonctionne silencieusement, il est donc prudent de laisser les variables d'environnement non définies dans le développement. Les événements du navigateur et du serveur peuvent être dirigés vers le même projet Sentry ; divisez-les en projets distincts uniquement lorsque vous souhaitez une séparation opérationnelle pour la propriété, le volume, les quotas ou le routage des alertes.

| Surface            | SDK               | Variable d'environnement                                      | Remarques                                                                                    |
| ------------------ | ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Navigateur / SPA   | `@sentry/browser` | `VITE_SENTRY_CLIENT_DSN`, `SENTRY_CLIENT_DSN` ou `SENTRY_DSN` | Capture les erreurs non gérées et le fil d'Ariane de changement d'itinéraire dans le client. |
| Serveur Nitro      | `@sentry/node`    | `SENTRY_SERVER_DSN` ou `SENTRY_DSN`                           | Capture les réponses 5xx et les erreurs de cycle de vie Nitro. Utilisateur par requête.      |
| `agent-native` CLI | `@sentry/node`    | _hardcoded_                                                   | Rapports de crash du binaire CLI publié ; non configurable par l'utilisateur.                |

### Configuration côté serveur {#sentry-config}

Définissez `SENTRY_SERVER_DSN` ou le `SENTRY_DSN` partagé dans l'environnement de déploiement (tableau de bord Netlify, secrets Cloudflare, etc.). Le framework monte automatiquement un plugin Nitro qui :

1. Appelle `Sentry.init` une fois au démarrage (idempotent : appel sécurisé à partir de plusieurs plugins).
2. Résout l'utilisateur via `getSession(event)` pour chaque demande API/framework et attache `id` / `email` / `username` ainsi qu'une balise `orgId` à la portée d'isolation par demande de Sentry. Les chemins d'actifs statiques sont ignorés pour éviter des accès supplémentaires à la base de données.
3. Capture chaque framework-route 5xx avec les balises `route`, `method` et `userAgent` consultables.

Boutons optionnels :

- `SENTRY_SERVER_TRACES_SAMPLE_RATE` (float `0`–`1`) : activez le suivi des performances. La valeur par défaut est `0` (erreurs uniquement). Les valeurs non valides se limitent à `0`.
- `AGENT_NATIVE_RELEASE` : remplace la balise `release`. La valeur par défaut est `agent-native-server@<core-version>`.

### Modèles

Chaque modèle en hérite automatiquement : il n'y a rien à importer. Pour les applications SSR, le serveur injecte un petit script de configuration de navigateur lorsque `SENTRY_CLIENT_DSN`, `VITE_SENTRY_CLIENT_DSN` ou `SENTRY_DSN` partagé est disponible au moment de l'exécution, de sorte que la capture du navigateur n'est pas limitée à l'environnement de construction Vite. Les modèles qui souhaitent un comportement personnalisé (balises supplémentaires, DSN différent par modèle, Sentry désactivée) peuvent remplacer en exportant leur propre plugin depuis `server/plugins/sentry.ts` :

```ts
// server/plugins/sentry.ts
import { createSentryPlugin } from "@agent-native/core/server";
export default createSentryPlugin();
```

Le DSN codé en dur du CLI est intentionnel : le binaire publié doit téléphoner aux plantages, quel que soit l'environnement qui l'exécute. Le module serveur ne code jamais en dur un DSN car il s'exécute dans des environnements clients où les opérateurs décident si les erreurs doivent atteindre Sentry.

### Confidentialité et PII {#privacy}

Le serveur et CLI s'initialisent avec `sendDefaultPii: false` et un hook `beforeSend` qui supprime :

- `request.headers.authorization`, `cookie`, `set-cookie`, `proxy-authorization`
- `request.cookies`
- `user.ip_address` (collecté automatiquement sans consentement)
- `contexts.runtime_env` (instantané d'environnement de processus)
- Tout événement dont le type d'exception de niveau supérieur est `ValidationError` (traité comme un rejet attendu d'une entrée utilisateur, et non comme un bug).

Les champs d'identité explicitement définis via `setUser({ id, email, username })` sont conservés.

## Quelle est la prochaine étape

- [**Tracking**](/docs/tracking) – analyses de produits (PostHog, Mixpanel, Amplitude) pour les propres événements de votre application
- [**Actions**](/docs/actions) — les opérations qui apparaissent sous forme d'appels d'outils dans les traces
- [**Security**](/docs/security) – Portée des données et gestion des informations d'identification
