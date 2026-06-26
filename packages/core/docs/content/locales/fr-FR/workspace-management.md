---
title: "Gouvernance de l'espace de travail"
description: "Branching, CODEOWNERS, examen des relations publiques et comment Dispatch gère la gouvernance d'exécution parallèlement à la gouvernance au niveau Git."
---

# Gouvernance de l'espace de travail

> **Quel document d'espace de travail ?** Cette page couvre la **gouvernance** : qui révise, approuve et possède quoi dans de nombreuses applications dans un seul dépôt. Pour savoir ce qu'est un espace de travail (la couche de personnalisation), voir [Workspace](/docs/workspace) ; pour la forme de déploiement (un monorepo, plusieurs applications), voir [Multi-App Workspaces](/docs/multi-app-workspace).

Ce guide couvre l'aspect opérationnel de l'exécution d'un espace de travail natif d'agent : comment créer des branches, qui examine quoi, comment configurer la propriété du code et comment le plan de contrôle Dispatch s'intègre dans votre modèle de gouvernance.

```an-diagram title="Deux plans de gouvernance" summary="Git régit le code ; Dispatch régit l'exécution. Ils sont complémentaires : ne se reproduisent pas l’un dans l’autre."
{
  "html": "<div class=\"gov\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Git et GitHub</span><strong>Gouvernance du code</strong><div class=\"gov-list\"><span class=\"diagram-pill\">CODEOWNERS</span><span class=\"diagram-pill\">branch protection</span><span class=\"diagram-pill\">Revue de PR</span><span class=\"diagram-pill\">git log / blame</span></div></div><div class=\"diagram-pill diagram-muted\">+</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Dispatch</span><strong>Runtime governance</strong><div class=\"gov-list\"><span class=\"diagram-pill\">vault secrets &amp; grants</span><span class=\"diagram-pill\">workspace resources</span><span class=\"diagram-pill\">agent profiles</span><span class=\"diagram-pill\">approvals &amp; audit</span></div></div></div>",
  "css": ".gov{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.gov .diagram-card{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.gov .gov-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}"
}
```

## Branchement

### Branches de fonctionnalités

Utilisez des branches de fonctionnalités éphémères pour tous les travaux :

```
main                         ← production
├── feat/mail-filters        ← single-app change
├── feat/core-oauth-refresh  ← framework change
├── fix/analytics-chart      ← targeted bug fix
└── feat/vault-encryption    ← dispatch/infra change
```

**Conventions de dénomination :**

- **Modifications pour une seule application :** `feat/<app>-<description>` ou `fix/<app>-<description>` — par ex. `feat/mail-thread-search`, `fix/calendar-recurrence-parse`
- **Modifications du framework :** `feat/core-<description>` ou `fix/core-<description>` — par ex. `feat/core-polling-v2`
- **Modifications de répartition :** `feat/dispatch-<description>` — par ex. `feat/dispatch-vault-policies`
- **Modifications inter-applications :** si une modification du framework nécessite des mises à jour de modèles, effectuez les deux dans une seule branche afin qu'elles soient expédiées de manière atomique

Gardez les branches de courte durée. Les branches de longue durée divergent des branches principales et créent des fusions douloureuses, en particulier dans un monorepo où plusieurs équipes poussent quotidiennement.

### Branchement non-développeur

Tous ceux qui ont besoin d'apporter des modifications ne sont pas à l'aise avec git. [Builder.io](https://www.builder.io) prend en charge un modèle de branchement visuel qui correspond aux branches Git sous le capot – utile pour les modifications de contenu et de copie, les ajustements de mise en page, les itérations de conception et les tests A/B sans environnement de développement.

## Propriété du code

La gouvernance du code est configurée par une poignée de fichiers à la racine du dépôt :

```an-file-tree title="Configuration de gouvernance dans le repo"
{
  "entries": [
    { "path": ".github/CODEOWNERS", "note": "Assigne automatiquement les reviewers selon le chemin modifié" },
    { "path": ".github/labeler.yml", "note": "Ajoute automatiquement des labels aux PRs par app" },
    { "path": "pnpm-workspace.yaml", "note": "Niveau workspace : revue large" },
    { "path": "package.json", "note": "Niveau workspace : propriété de l'équipe plateforme" }
  ]
}
```

Le fichier CODEOWNERS de GitHub attribue automatiquement les réviseurs aux PR en fonction des fichiers modifiés. Créez `.github/CODEOWNERS` à la racine du dépôt :

```
# Framework core — affects every app; platform team reviews all changes
packages/core/                     @your-org/platform-team

# Plan de contrôle Dispatch — secrets, intégrations, ressources de l'espace de travail
templates/dispatch/                @your-org/platform-team

# Propriété par application : chaque équipe examine sa propre application
templates/mail/                    @your-org/mail-team
templates/analytics/               @your-org/analytics-team
templates/calendar/                @your-org/calendar-team
# ... add an entry per app

# Configuration au niveau de l'espace de travail – examen approfondi car cela affecte tout le monde
.github/                           @your-org/platform-team
package.json                       @your-org/platform-team
pnpm-workspace.yaml                @your-org/platform-team
```

Conseils clés : utilisez les équipes GitHub (`@org/team`), et non les individus. Les modifications du framework et de la répartition devraient toujours nécessiter un examen de la plate-forme. Voir [GitHub CODEOWNERS docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) pour la syntaxe globale et les modèles à propriétaires multiples.

Pour activer les révisions requises : Paramètres → Branches → Protection des branches pour `main` → **Exiger une demande d'extraction avant la fusion** → **Exiger une révision des propriétaires de code**.

## Étiquetage des relations publiques

Étiqueter automatiquement les PR par application avec `.github/labeler.yml` (extrait) :

```yaml
app:mail:
  - changed-files:
      - any-glob-to-any-file: templates/mail/**
app:analytics:
  - changed-files:
      - any-glob-to-any-file: templates/analytics/**
core:
  - changed-files:
      - any-glob-to-any-file: packages/core/**
```

Ajoutez ensuite l'action [actions/labeler](https://github.com/actions/labeler) — consultez le README de ce dépôt pour le flux de travail complet YAML. Les étiquettes s'appliquent automatiquement lorsque les PR sont ouvertes ou mises à jour.

## Consignes relatives à l'examen des relations publiques

| Modifier le type                                | Qui évalue                                                 | À surveiller                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Application uniquement** (`templates/<app>/`) | Propriétaire de l'équipe de l'application                  | Excellence du domaine, schémas d'action                                                                    |
| **Cadre** (`packages/core/`)                    | Équipe de plate-forme + une équipe d'application concernée | Modifications révolutionnaires, performances, compatibilité ascendante                                     |
| **Migrations de schéma**                        | Équipe plateforme + ingénieur senior                       | Sécurité des données, agnosticisme dialectal (SQLite + Postgres)                                           |
| **Actions**                                     | Équipe propriétaire                                        | Actions sont tous deux des points de terminaison des outils d'agent AND HTTP – examen sous les deux angles |
| **Inter-application A2A**                       | Les deux équipes d'application                             | Si vous modifiez une interface A2A, les appelants doivent le savoir                                        |
| **Répartir le coffre-fort/les ressources**      | Équipe Plateforme                                          | Accès secret, portée d'octroi, qui obtient quoi                                                            |

### Travail d'agent simultané

Les espaces de travail natifs pour agents comportent souvent plusieurs agents IA travaillant simultanément sur la même branche. C'est inhérent à la conception : les agents partagent une branche et effectuent des opérations indépendantes.

```an-callout
{ "tone": "warning", "body": "**The later commit wins.** Two agents touching the same file won't conflict at commit time — the conflict surfaces at review. Run `pnpm run prep` (typecheck + test + format) before pushing, and don't revert changes you didn't make unless they're clearly broken." }
```

Lors de l'examen des PR dans cet environnement :

- **N'annulez pas les modifications que vous n'avez pas apportées** à moins qu'elles ne soient clairement rompues
- **Les fichiers peuvent être modifiés par plusieurs agents** dans le même PR — c'est normal
- **Exécutez `pnpm run prep`** (vérification de type + test + format) avant de pousser pour détecter les problèmes d'intégration entre les modifications des agents
- **Si deux agents touchent le même fichier**, la validation la plus récente l'emporte. Les conflits font surface au moment de l'examen, pas au moment de la validation
- **Corrigez les bugs dans n'importe quel code du PR,** quel que soit l'agent qui l'a écrit. Le PR est examiné dans son ensemble.

## Répartition en tant que gouvernance

L'application [Dispatch](/docs/dispatch) est le plan de contrôle d'exécution de l'espace de travail. Il complète la gouvernance au niveau Git avec la gouvernance d'exécution :

| Inquiétudes                               | Git et GitHub                       | Expédition                                                                 |
| ----------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| Qui peut modifier le code                 | CODEOWNERS, protection des branches | —                                                                          |
| Qui peut accéder aux secrets              | —                                   | Règle de Vault, subventions, workflow de demande                           |
| Quelles instructions suivent les agents   | —                                   | Ressources de l'espace de travail global (AGENTS.md, instructions, skills) |
| Quels agents sont partagés                | —                                   | Profils d'agent Workspace                                                  |
| Inventaire d'intégration                  | —                                   | Catalogue de connexions et d'intégrations Workspace                        |
| Approbation des modifications d'exécution | —                                   | Flux d'approbation d'envoi                                                 |
| Piste d'audit                             | `git log` / `git blame`             | Audit du coffre-fort + journaux d'audit de répartition                     |
| Messagerie et routage                     | —                                   | Slack / Intégration Telegram                                               |

**Git gère la gouvernance du code. Dispatch gère la gouvernance d'exécution.** N'essayez pas de répliquer les workflows git dans Dispatch ou vice versa.

Dispatch gère : les secrets du coffre-fort, les connexions à l'espace de travail réutilisables, les ressources de l'espace de travail (skills, instructions, profils d'agent, serveurs MCP), les approbations et les journaux d'audit. Pour la configuration de l'itinéraire de l'application publique (`workspaceApp.audience` / `publicPaths` / `protectedPaths`), voir [Multi-App Workspaces — Public app routes](/docs/multi-app-workspace#deployment).

Pour le modèle de ressource et les chemins canoniques, voir [Workspace — Global resources](/docs/workspace#global-resources).

## Liste de contrôle de configuration

Pour un nouvel espace de travail, après avoir exécuté `npx @agent-native/core@latest create` :

**Git & GitHub :**

- [ ] Créez `.github/CODEOWNERS` avec propriété d'équipe par application
- [ ] Activer la protection des branches sur `main` avec les révisions requises du propriétaire du code
- [ ] Ajoutez `.github/labeler.yml` pour l'étiquetage automatique des PR par application
- [ ] Créer des équipes GitHub pour chaque application et l'équipe de plateforme

**Expédition :**

- [ ] Ajouter des secrets partagés au coffre-fort (clés API, informations d'identification OAuth, etc.)
- [ ] Conservez la stratégie de coffre-fort par défaut pour toutes les applications ou passez aux subventions manuelles par application
- [ ] Synchronisez les secrets du coffre-fort pour les transmettre aux applications
- [ ] Enregistrez les connexions d'espace de travail réutilisables pour les comptes de fournisseur partagés, puis
      accorder des applications telles que Brain, Analytics, Mail ou Dispatch uniquement lorsqu'elles en ont besoin
      ce compte
- [ ] Ajoutez skills à l'échelle de l'espace de travail, des instructions de garde-corps et des ressources de référence de marque/entreprise via la page Ressources. Voir [Workspace](/docs/workspace#global-resources) pour le tableau complet du modèle de ressource et le pack de démarrage recommandé.
- [ ] Configurer la politique d'approbation et les e-mails des approbateurs
- [ ] Configurer SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) pour les notifications d'administrateur
- [ ] Connectez Slack ou Telegram pour la messagerie de l'espace de travail
- [ ] Configurez les serveurs MCP partagés : ajoutez des ressources d'espace de travail `mcp-servers/<name>.json` dans Dispatch pour les subventions pour toutes les applications ou les applications sélectionnées ; utilisez `mcp.config.json` ou [MCP hub mode](/docs/mcp-clients#hub) pour les déploiements de niveau inférieur
