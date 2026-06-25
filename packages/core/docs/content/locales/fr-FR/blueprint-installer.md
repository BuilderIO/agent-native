---
title: "Installateur de plans"
description: "agent-native add imprime une recette d'intégration Markdown organisée sur la sortie standard – transmettez-la à votre agent de codage, qui applique les modifications à votre dépôt en direct."
---

# Installateur de plans

> **À qui s'adresse-t-il :** auteurs d'hôtes et intégrateurs ajoutant un fournisseur, un canal,
> backend sandbox, ou action vers un dépôt en transmettant une recette à leur agent de codage.

`agent-native add` n'est **pas** un échafaudage stupide qui écrit des fichiers pour vous. Il émet un _plan d'intégration_ Markdown organisé sur la sortie standard. Vous transférez ce plan vers votre propre agent de codage (code Claude, Codex,…), qui applique les modifications au dépôt en direct avec un contexte complet.

Cela correspond au style maison agent-applique-changes, système de fichiers d'abord : le framework fournit la recette (les fichiers canoniques à toucher, les règles à respecter, l'étape de vérification) et l'agent de codage effectue l'édition.

```bash
agent-native add provider stripe | claude
agent-native add channel discord  | codex
```

```an-diagram title="ajouter imprime une recette ; votre agent de codage l'applique" summary="agent-native émet un plan Markdown vers stdout (diagnostics vers stderr) ; vous le dirigez vers Claude Code ou Codex, qui édite votre dépôt en direct avec un contexte complet."
{
  "html": "<div class=\"diagram-bp\"><div class=\"diagram-node\" data-rough>agent-native add<br><small class=\"diagram-muted\">&lt;kind&gt; &lt;name|URL&gt;</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Blueprint Markdown<br><small class=\"diagram-muted\">stdout · fichiers à toucher · règles · vérifier</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>Agent de code<br><small class=\"diagram-muted\">claude · codex</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">edits your live repo</div></div>",
  "css": ".diagram-bp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bp .diagram-arrow{font-size:22px;line-height:1}.diagram-bp .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Usage {#usage}

```bash
agent-native add <kind> <name>            # print a curated blueprint
agent-native add <kind> <https://docs…>   # rechercher et intégrer à partir d'un URL
agent-native add --list                   # list available kinds and blueprints
```

- Un simple **nom** résout un plan organisé à partir de `blueprints/<kind>/<name>.md`.
- Un **URL** au lieu d'un nom émet un plan générique de _recherche et d'intégration_ pour ce type, avec le URL intégré comme point de départ de la recherche (un URL est une graine de recherche, pas une recette connue).
- Le plan va vers **stdout** ; les diagnostics vont à stderr, donc `… | claude` ne reçoit que le plan.

## Plans prédéfinis {#seeded}

`agent-native add --list` montre ce qui est livré dans la boîte :

| Gentil     | Nom       | Ce qu'il configure                                                                         |
| ---------- | --------- | ------------------------------------------------------------------------------------------ |
| `provider` | `stripe`  | Câbler un fournisseur dans le substrat `provider-api` (catalogue / docs / request trio).   |
| `channel`  | `discord` | Implémentez un canal de webhook entrant `PlatformAdapter` et enregistrez-le.               |
| `sandbox`  | `docker`  | Implémentez la couture `SandboxAdapter` pour exécuter `run-code` dans un conteneur Docker. |
| `action`   | `crud`    | Ajoutez un seul `defineAction` multi-surfaces avec un schéma Zod (un `update` sur N).      |

Chaque plan est autonome : l'agent de codage qui le lit fait toucher les fichiers, les règles du cadre à respecter (actions est la source unique de vérité, ne code jamais en dur les secrets, étend la portée des données propriétaires, ajoute un ensemble de modifications pour la source `packages/*`) et une section concrète **Vérifier**.

## URL → plan de recherche {#url}

Lorsque vous réussissez un URL pour lequel le type n'a pas de recette organisée (ou si vous souhaitez une nouvelle intégration), `add` émet un plan générique de « recherche et intégration » avec le URL comme graine :

```bash
agent-native add provider https://docs.example.com/api | claude
```

Le plan généré indique à l'agent de codage de récupérer le URL (et les pages auxquelles il renvoie) pour les points de terminaison réels, le modèle d'authentification, les formes de charge utile et les exigences de signature/vérification - _ne pas_ deviner à partir des données de formation - puis de l'implémenter et de le vérifier. Il comporte également des conseils spécifiques au type (par exemple, un `provider` URL est dirigé vers le substrat `provider-api` ; un `channel` URL vers un `PlatformAdapter`).

## Ajout de votre propre plan {#authoring}

Déposez un fichier Markdown dans `packages/core/blueprints/<kind>/<name>.md`. Le genre est le sous-répertoire ; le nom est le nom du fichier sans `.md`. Il est récupéré automatiquement : `--list`, la résolution de nom et le catalogue lisent tous le répertoire au moment de l'exécution. Aucun changement de code n'est nécessaire pour l'enregistrer.

Les fichiers Blueprint `.md` sont livrés dans le package publié via l'entrée `blueprints` dans `package.json` `files`, ils sont donc résolus à `node_modules/@agent-native/core/blueprints/**` pour les utilisateurs finaux.

Écrivez chaque plan sous la forme d'un jeu d'instructions pour un agent de codage sans autre contexte. Un bon plan doit :

1. **Un objectif sur une ligne** et un cadrage "Vous êtes un agent de codage dans une application native d'agent, appliquez-les en tant que modifications réelles de la source".
2. **Lire en premier** — les fichiers exacts qui _sont_ le contrat.
3. **Fichiers à toucher** – chemins concrets et effet de chaque modification.
4. **Règles du framework à respecter** – actions en premier, pas de secrets codés en dur, portée des données propriétaires, ajout d'un ensemble de modifications pour la source du package publiable.
5. **Verify** — vérification de type, un `*.spec.ts` ciblé et une vérification de bout en bout.

> [!TIP]
> Un nouveau plan organisé sous un type existant ne nécessite aucun code, mais si vous créez un tout nouveau répertoire de type, ce type apparaît également automatiquement dans `--list`.

## Quelle est la prochaine étape

- [**Sandbox Adapters**](/docs/sandbox-adapters) — la couture ciblée par le plan `add sandbox docker`
- [**Actions**](/docs/actions) — la source unique de vérité sur laquelle chaque plan s'appuie
- [**External Agents**](/docs/external-agents) : connexion de l'agent de codage vers lequel vous transférez les plans
