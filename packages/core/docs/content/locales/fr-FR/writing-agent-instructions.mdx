---
title: "Rédaction des instructions pour l'agent et Compétences"
description: "Comment rédiger des instructions d'agent efficaces pour une application ou un modèle natif d'agent : AGENTS.md, skills et descriptions d'outils."
---

# Rédaction des instructions de l'agent et Compétences

Le comportement de l'agent dans une application native d'agent dépend des instructions que vous lui donnez. Trois surfaces portent ces conseils : `AGENTS.md` (la carte), skills (les analyses approfondies) et les descriptions d'actions/d'outils (comment l'agent choisit le bon outil). Écrivez chacun pour une récupération rapide, pas pour de la prose.

```an-diagram title="Trois surfaces créées + une surface d'exécution" summary="AGENTS.md et les descriptions d'outils se chargent à chaque tour ; charge de compétences sur demande ; application_state est écrit en direct par votre interface utilisateur."
{
  "html": "<div class=\"diagram-surfaces\"><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">Chaque tour</span><strong>AGENTS.md</strong><small class=\"diagram-muted\">la carte : objectif, règles clés, clés d’état, index actions + compétences</small></div><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">Chaque tour</span><strong>Descriptions d’outils</strong><small class=\"diagram-muted\">guide le choix des outils — une phrase précise chacun</small></div><div class=\"diagram-card ondemand\" data-rough><span class=\"diagram-pill\">À la demande</span><strong>Compétences</strong><small class=\"diagram-muted\">guide approfondi, chargé quand la description correspond</small></div><div class=\"diagram-card runtime\" data-rough><span class=\"diagram-pill ok\">Live</span><strong>application_state</strong><small class=\"diagram-muted\">écrit par votre UI : navigation, sélection, focus</small></div></div>",
  "css": ".diagram-surfaces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-surfaces .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

## Gardez AGENTS.md petit et écrémé {#small-agents-md}

`AGENTS.md` est chargé comme orientation. Cela devrait être la plus petite chose qui permette à l'agent d'agir correctement, avec tout ce qui est profondément intégré à skills. Visez ces sections et rien d'autre :

- **Ligne d'objectif** : une phrase expliquant ce qu'est l'application et le flux de travail principal.
- **Règles de base** — la poignée d'invariants qui doivent toujours être valables (les données dans SQL, les opérations passent par actions, l'IA passe par le chat de l'agent, les modifications de schéma sont additives). Puces courtes et impératives.
- **Clés d'état d'application** : les touches `navigation`/sélection/focus que l'agent lit pour savoir ce que l'utilisateur regarde, avec leur forme.
- **Tableau d'actions** — un tableau compact des noms d'actions à accomplir.
- **Index Compétences** — une liste des skills qui existent et quand lire chacun d'entre eux.

Si une section dépasse un écran, elle appartient à une compétence. `AGENTS.md` répond « qu'est-ce que cette application et que puis-je faire », et non « comment puis-je faire exactement la chose difficile ? »

```markdown
# Application Projets

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## Règles de base

- Data lives in SQL avec Drizzle. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## État de la demande

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## Opérations

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## Compétences

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## AGENTS.md à source unique {#single-source}

Conservez un fichier d'instructions canoniques : `AGENTS.md`. Si un client attend `CLAUDE.md`, faites-en un lien symbolique vers `AGENTS.md` plutôt qu'une deuxième copie. Deux fichiers gérés manuellement dérivent, et l'agent se retrouve avec des règles contradictoires. Une source de vérité, reliée là où c'est nécessaire.

## Le frontmatter de SKILL.md doit dire ce que AND quand {#skill-frontmatter}

Le `description` est la seule chose que l'agent voit lorsqu'il décide de lire ou non une compétence. Il doit répondre à deux questions : ce que couvre la compétence et quand la déclencher. Une description qui décrit uniquement le sujet ne se déclenchera pas.

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- Dirigez avec la fonctionnalité, puis ajoutez une clause explicite ** "Utiliser quand…" **.
- Soyez légèrement insistant : un déclenchement excessif bat une compétence qui ne se charge jamais.
- Gardez-le sous environ 40 mots ; il est chargé dans le contexte à chaque conversation.

## Divulgation progressive {#progressive-disclosure}

Écrivez le `SKILL.md` en tant que couche simple et incontournable : la règle, comment le faire, la liste des choses à faire/à ne pas faire et les pointeurs. Insérez de longs exemples, des références de champs exhaustives, des bizarreries API et des tableaux de cas extrêmes dans des fichiers `references/` que l'agent lit uniquement lorsqu'il en a besoin.

```text
.agents/skills/project-imports/
├── SKILL.md            # règle + chemin heureux + do/don't
└── references/
    └── csv-format.md   # spécification de colonne complète, encodages, cas extrêmes
```

Cela maintient la surface toujours chargée petite et permet d'évoluer en profondeur sans contexte de ballonnement. Consultez le [Compétences Guide](/docs/skills-guide) pour le format complet des compétences.

## Écrire des tableaux orientés actions {#action-tables}

L'agent analyse les tableaux plus rapidement que la prose. Préférez un tableau de noms à des fins plutôt que des paragraphes décrivant chaque opération. La même chose s'applique aux clés d'état, aux types de champs et à tout ensemble énumérable. Les tableaux sont écrémés, modifiables et faciles à synchroniser lorsque vous ajoutez une action.

## Rédigez des descriptions claires des outils {#tool-descriptions}

Les descriptions d'actions sont des descriptions d'outils : elles déterminent la sélection des outils. Faites de chacun une phrase précise et à but unique :

- Dites ce qu'il fait et ce qu'il renvoie, pas comment il est implémenté.
- Décrivez chaque paramètre dans son `.describe()` afin que l'agent le remplisse correctement.
- Une responsabilité par action. Si une description nécessite "et aussi…", divisez-la.
- Marquer actions en lecture seule (`readOnly: true` ou `http: { method: "GET" }`) afin que l'agent sache qu'il peut appeler librement en toute sécurité.

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## Compétences contre actions {#skills-vs-actions}

Compétences et actions sont complémentaires. Une compétence est un guide que l'agent lit ; un
l'action est le code que l'agent peut exécuter.

| Besoin                                                                                     | Utiliser                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| L'agent doit suivre un workflow, une politique, une liste de contrôle ou une rubrique      | **Compétence**                           |
| L'agent a besoin d'exemples, de documents de référence ou de règles spécifiques au domaine | **Compétence**                           |
| L'agent doit lire ou écrire les données de l'application                                   | **Action**                               |
| L'agent doit appeler un API externe ou effectuer une approbation                           | **Action**                               |
| L'agent appelle la bonne opération mais de la mauvaise manière                             | Améliorer la **compétence**              |
| L'agent ne peut pas appeler l'opération de manière fiable                                  | Améliorer l'**action**                   |
| L'agent choisit le mauvais outil                                                           | Améliorer la **description de l'action** |

La plupart des fonctionnalités réelles utilisent les deux : la compétence explique comment aborder la tâche, et
l'action fournit l'opération typée. Par exemple, une compétence `invoice-review`
peut expliquer la politique de révision et les règles de remontée d'informations, tandis que `list-invoices`,
`flag-invoice` et `approve-invoice` actions effectuent les lectures et écritures réelles.

## Cuire en anti-fabrication et vérifier avant de faire {#anti-fabrication}

Les instructions de l'application doivent faire de l'honnêteté et de la vérification le comportement par défaut :

- **Ne fabriquez jamais.** Si les données ne sont pas trouvées ou si une action échoue, dites-le et récupérez. N'inventez pas de résultats et ne prétendez pas avoir réussi. Lisez la valeur réelle via une action ou une requête avant de la signaler.
- **Vérifiez avant de déclarer terminé.** Après une modification, confirmez-la avec une relecture (réinterrogez la ligne, relisez l'écran via `view-screen`) au lieu de supposer que l'écriture a fonctionné.
- **Récupérez, n'abandonnez pas.** En cas d'erreur récupérable (un échec de requête, une récupération transitoire), réessayez ou corrigez l'entrée plutôt que d'abandonner la tâche. Gardez ceci distinct de la règle anti-fabrication : ne confondez pas "ne pas inventer" avec "arrêtez-vous à la première erreur".

Mettez-les comme règles de base dans `AGENTS.md` afin qu'elles s'appliquent à chaque tour.

## Les quatre surfaces vues par l'agent {#four-surfaces}

Chaque élément de guidage que vous créez atterrit sur l'une des quatre surfaces. Savoir quelle surface utiliser évite les duplications et les détails égarés :

| Surface                           | Qui l'écrit                              | Quand il est chargé                                                 | Ce qui y appartient                                                                                 |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Instructions `AGENTS.md`          | Vous (développeur)                       | Chaque tour, comme orientation                                      | Objectif, règles de base, clés d'état, index d'action, index skills                                 |
| Compétences (`SKILL.md`)          | Vous (développeur)                       | Sur demande lorsque l'agent décide que la compétence est pertinente | Comment procéder étape par étape pour un modèle spécifique, listes de choses à faire/à ne pas faire |
| Descriptions des actions (outils) | Vous (développeur)                       | À chaque tour, comme la liste des outils                            | Ce que fait l'action, ce qu'elle renvoie, sémantique des paramètres                                 |
| Contexte `application_state`      | Votre code UI (au moment de l'exécution) | À chaque tour, selon l'état de l'application en direct              | Navigation actuelle, sélection, objet sélectionné, URL                                              |

**Diagnostic rapide :**

- "L'agent continue de demander sur quel enregistrement agir même lorsqu'un enregistrement est ouvert" → correctif : écrivez l'ID de l'élément actuel dans `application_state` (clé `navigation`) depuis votre UI. Il s'agit d'un écart `application_state`, pas d'un écart de compétences.
- "L'agent appelle la mauvaise action ou utilise mal un paramètre" → correctif : amélioration des `description` et `.describe()` de l'action sur le paramètre. Il s'agit d'un correctif de description d'outil, pas d'une compétence.

## Qu'est-ce qui va où {#what-goes-where}

- **AGENTS.md** — s'applique à l'ensemble de l'application, à chaque tour : objectif, règles de base, clés d'état, index d'action, index skills.
- **Compétences** — procédure réutilisable pour un modèle spécifique, chargée à la demande. S'applique à toutes les personnes travaillant dans l'application.
- **Mémoire (`memory/MEMORY.md`)** — préférences et corrections par utilisateur, pas de conseils rédigés.

## Quelle est la prochaine étape {#whats-next}

- [Compétences Guide](/docs/skills-guide) : le format de fichier de compétences, le framework skills et le skills basé sur l'application.
- [Creating Templates](/docs/creating-templates) : comment les `AGENTS.md` et skills s'intègrent dans un modèle livrable.
- [The four-area checklist](/docs/key-concepts#four-area-checklist) — le modèle à quatre domaines que chaque fonctionnalité doit satisfaire.
