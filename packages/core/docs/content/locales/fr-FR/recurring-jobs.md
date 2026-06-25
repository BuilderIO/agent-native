---
title: "Tâches récurrentes"
description: "Invites planifiées par Cron que l'agent exécute seul : résumés quotidiens, rapports hebdomadaires, interrogations horaires."
---

# Tâches récurrentes

Une **tâche récurrente** est une invite qui s'exécute selon une planification cron. C'est ainsi que l'agent fait les choses tout seul : "chaque matin à 7 heures, résumez mes e-mails de la nuit", "chaque lundi, publiez les numéros d'inscription de la semaine dernière sur Slack", "chaque heure recherchez les brouillons périmés et supprimez-les."

Les tâches récurrentes se déclenchent selon une horloge. Pour réagir aux _événements_ (une réservation créée, un e-mail reçu) — même format de fichier `jobs/` plus conditions — voir [Automations](/docs/automations).

Les tâches sont en direct dans le [workspace](/docs/workspace) sur `jobs/<name>.md` — juste un fichier Markdown avec le frontmatter YAML. Pas d'enregistrement, pas de câblage. Déposez le fichier et le framework le récupère.

## Un fichier de travail {#job-file}

```an-annotated-code title="jobs/morning-digest.md"
{
  "filename": "jobs/morning-digest.md",
  "language": "markdown",
  "code": "---\nschedule: \"0 7 * * *\"\nenabled: true\nrunAs: creator\n---\n\n# Résumé du matin\n\nSummarize les e-mails reçus pendant la nuit. Regroupez par domaine d'expéditeur.\nPin les trois principaux sujets qui semblent avoir besoin d'une réponse aujourd'hui au libellé\n\"Réponse nécessaire\". Rédigez des réponses pour celles qui sont évidentes.",
  "annotations": [
    { "lines": "2", "label": "Quand", "note": "Cron standard à 5 champs — `0 7 * * *` est tous les jours à 07h00." },
    { "lines": "3", "label": "Bouton pause", "note": "Flip to `false` to stop the job without deleting it." },
    { "lines": "4", "label": "Identité", "note": "`creator` runs with the owner's identity and `ANTHROPIC_API_KEY`; `shared` uses the org's key." },
    { "lines": "7-12", "label": "L'invite", "note": "Le corps n'est qu'une invite : l'agent l'exécute à chaque déclenchement avec tous ses outils et son contexte d'espace de travail normaux." }
  ]
}
```

C'est tout. Le corps est une invite que l'agent exécute à chaque déclenchement planifié. L'agent a accès aux mêmes outils et au même contexte d'espace de travail que dans un chat interactif : actions, skills, mémoire, serveurs MCP connectés, sous-agents.

## Première question {#frontmatter}

| Champ        | Tapez                         | Par défaut      | Description                                                                                                                            |
| ------------ | ----------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule`   | expression cron               | _(obligatoire)_ | Cron standard à 5 champs. `"0 7 * * *"` = tous les jours à 07h00 ; `"0 */4 * * *"` = toutes les 4 heures.                              |
| `enabled`    | booléen                       | `true`          | Basculez vers `false` pour mettre en pause sans supprimer la tâche.                                                                    |
| `runAs`      | `"creator"` \| `"shared"`     | `"creator"`     | `"creator"` s'exécute avec l'identité du propriétaire de la tâche et `ANTHROPIC_API_KEY`. `"shared"` utilise la clé de l'organisation. |
| `createdBy`  | e-mail                        | _(auto)_        | Rempli lorsque le travail est créé via l'espace de travail UI ou par l'agent.                                                          |
| `orgId`      | chaîne                        | _(auto)_        | Portée de l'organisation ; hérité de l'organisation active du créateur.                                                                |
| `lastRun`    | Horodatage ISO                | _(géré)_        | Écrit par le planificateur après chaque exécution.                                                                                     |
| `lastStatus` | `"success"` \| `"error"` \| … | _(géré)_        | Dernier résultat.                                                                                                                      |
| `lastError`  | chaîne                        | _(géré)_        | Message d'erreur si la dernière exécution a échoué.                                                                                    |
| `nextRun`    | Horodatage ISO                | _(géré)_        | Calculé à partir de `schedule` ; utilisé par le planificateur pour décider quand déclencher ensuite.                                   |

Les champs `last*` et `nextRun` sont écrits par le planificateur. Vous pouvez les lire pour voir l'historique, mais ne les modifiez pas manuellement : la prochaine exécution les écrasera.

## Syntaxe Cron {#cron}

Cron standard à 5 champs (minute, heure, jour du mois, mois, jour de la semaine) :

| Cron           | Signification               |
| -------------- | --------------------------- |
| `*/5 * * * *`  | Toutes les 5 minutes        |
| `0 * * * *`    | Toutes les heures           |
| `0 */4 * * *`  | Toutes les 4 heures         |
| `0 7 * * *`    | Tous les jours à 07h00      |
| `0 9 * * 1`    | Tous les lundis à 09h00     |
| `0 17 * * 1-5` | En semaine à 17h00          |
| `0 0 1 * *`    | Premier jour de chaque mois |

Le framework comprend des utilitaires cron (`isValidCron()` et `describeCron()`) pour valider et restituer les chaînes cron, utilisées en interne par les couches de ressources et de planificateur.

## Créer une tâche {#creating}

### Depuis l'onglet Espace de travail

`+` → **Tâche planifiée** dans le panneau de l'espace de travail. Remplissez l'invite et le calendrier. Enregistre sous `jobs/<slug>.md` et commence à s'exécuter au prochain tick correspondant.

### En demandant à l'agent

> "Créez une tâche planifiée qui résume mes e-mails non lus chaque matin à 7 heures."

L'agent écrit le fichier pour vous.

### À la main

Déposez un fichier Markdown dans `jobs/` via la ressource APIs du framework :

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/morning-digest.md",
  `---
schedule: "0 7 * * *"
enabled: true
---
Summarize overnight emails.`,
);
```

## Fonctionnement du planificateur {#how-scheduler-runs}

Le planificateur est un plugin de framework (la routine interne `processRecurringJobs()`) qui s'exécute en cours de processus : un `setInterval` se déclenche toutes les 60 secondes (avec un délai de démarrage de 10 secondes) dans le plugin de chat de l'agent, partout où le serveur est en cours d'exécution.

```an-diagram title="Une coche du planificateur" summary="Toutes les 60 secondes, le planificateur recherche les tâches dues, les exécute en tant que nouveau thread d'agent et réécrit le résultat dans le fichier de tâches."
{
  "html": "<div class=\"sched\"><div class=\"diagram-box accent\"><code>setInterval</code> &bull; 60s &#8635;</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">1 &middot; scan</span><small class=\"diagram-muted\">list every enabled <code>jobs/*.md</code> across all owners</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">2 &middot; due?</span><small class=\"diagram-muted\">compare <code>nextRun</code> to now</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card accent\"><span class=\"diagram-pill accent\">3 &middot; run</span><small class=\"diagram-muted\">fresh agent thread, job body as the user message &mdash; actions, SQL, A2A, email</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card ok\"><span class=\"diagram-pill ok\">4 &middot; record</span><small class=\"diagram-muted\">write <code>lastRun</code> / <code>lastStatus</code> / <code>lastError</code>, recompute <code>nextRun</code></small></div></div>",
  "css": ".sched{display:flex;flex-direction:column;gap:6px;max-width:520px}.sched .diagram-card{display:flex;flex-direction:column;gap:2px;padding:10px 14px}.sched .diagram-box{align-self:flex-start}.sched .diagram-arrow{font-size:18px;align-self:center}"
}
```

```an-callout
{ "tone": "risk", "body": "**Scale-to-zero caveat.** The scheduler is in-process, so on serverless hosts jobs only fire while an instance is warm. If reliable scheduling matters, keep an instance warm with keep-alive pings or use an always-on host (Fly, Render, a VPS)." }
```

## Débogage d'une tâche {#debugging}

- Ouvrez `jobs/<name>.md` dans l'espace de travail : le premier plan affiche `lastRun`, `lastStatus`, `lastError`, `nextRun`.
- **Testez-le sans attendre :** il n'y a pas d'outil de tir forcé. Pour effectuer le même travail à la demande, collez l'invite du travail dans le chat de l'agent et laissez-le s'y exécuter, ou définissez temporairement le planning sur la minute suivante afin que le planificateur le récupère au tick suivant (puis restaurez le vrai cron).
- **Mettez-le en pause :** retournez `enabled: false`. Le fichier reste en place, arrête simplement de s'exécuter.

## Outil d'agent {#agent-tool}

Un seul outil `manage-jobs` est enregistré dans chaque modèle. Le paramètre `action` sélectionne l'opération :

| Actions  | Paramètres                                                            | Objectif                                                                                     |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `create` | `name`, `schedule`, `instructions` (obligatoire) ; `scope`, `runAs`   | Créer une nouvelle tâche récurrente                                                          |
| `list`   | `scope` (`personal`, `shared` ou tous)                                | Liste de toutes les tâches avec statut (planification, activé, dernière/prochaine exécution) |
| `update` | `name` (obligatoire) ; `schedule`, `instructions`, `enabled`, `runAs` | Modifier une tâche existante                                                                 |
| `delete` | `name` (obligatoire)                                                  | Supprimer une tâche – toujours confirmer d'abord avec l'utilisateur                          |

**Portée personnelle ou partagée.** Chaque tâche se déroule soit dans une portée personnelle (s'exécute en tant que et n'est visible que par le créateur), soit dans une portée partagée/organisationnelle (s'exécute au nom du créateur mais est visible par les membres de l'organisation). Les paramètres `scope` et `runAs` contrôlent cela au moment de la création. Les administrateurs de l'organisation peuvent mettre à jour ou supprimer n'importe quelle tâche partagée ; Les membres non-administrateurs ne peuvent gérer que les leurs.

## Différent du package de planification {#vs-scheduling-package}

Ne confondez pas les tâches récurrentes avec `@agent-native/scheduling` :

- **Tâches récurrentes (cette page)** — _invites_ planifiées par cron que l'agent exécute en arrière-plan. Au niveau du framework. Vit dans l'espace de travail. S'exécute sur n'importe quelle application native d'agent.
- **`@agent-native/scheduling`** — un package de domaine réutilisable pour créer des fonctionnalités de calendrier/réservation (types d'événements, fenêtres de disponibilité, réservations). Alimente le modèle `calendar` et les surfaces de planification personnalisées.

Les tâches récurrentes sont : "Comment faire en sorte que l'agent agisse seul ?" Le package de planification est « Comment puis-je créer une application de calendrier ? » Différentes préoccupations.

## Quelle est la prochaine étape

- [**Automations**](/docs/automations) : ajoutez des déclencheurs d'événements et des conditions au même format `jobs/`
- [**Workspace**](/docs/workspace) — où les tâches cohabitent avec skills, la mémoire et les agents personnalisés
- [**Actions**](/docs/actions) — les outils qu'un travail appelle
- [**Agent Teams**](/docs/agent-teams) — les tâches génèrent souvent des sous-agents pour effectuer un travail parallèle
