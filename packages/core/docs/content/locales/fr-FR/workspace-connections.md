---
title: "Connexions à l'espace de travail"
description: "Métadonnées, subventions et références d'informations d'identification partagées du fournisseur pour les intégrations à connexion unique, à utiliser partout."
---

# Connexions à l'espace de travail

Les connexions à l'espace de travail constituent la primitive de structure pour les métadonnées d'intégration réutilisables. Ils permettent de « se connecter une fois, d'accorder des applications, de réutiliser les informations d'identification » sans prétendre que chaque fournisseur est entièrement générique.

## Démarrage rapide {#quickstart}

### Les quatre concepts

- **Connexion** : un compte de fournisseur nommé (`team-slack`, `acme-hubspot`). Enregistre l’identifiant du fournisseur, l’étiquette du compte, le statut, les étendues et la configuration sécurisée. Ne stocke jamais les valeurs secrètes.
- **Accorder** — autorisation permettant à une application spécifique d'utiliser une connexion. Une application sans autorisation ne peut pas voir les informations d'identification de la connexion.
- **credentialRef** — un pointeur vers un secret de coffre-fort (`{ key: "SLACK_BOT_TOKEN", scope: "org" }`). La connexion indique où se trouve le jeton ; le coffre-fort contient la valeur.
- **Préparation** : état combiné affiché par une application : `connected` (accordé + informations d'identification présentes), `needs_grant`, `needs_credentials`, `needs_attention` ou `not_configured`.

```an-diagram title="Connectez-vous une fois, accordez des applications, réutilisez les informations d'identification" summary="Une connexion contient des métadonnées de fournisseur (jamais de secrets) et des informations d'identification qui pointent vers le coffre-fort. Les subventions par application le débloquent. Les applications lisent un seul état de préparation."
{
  "html": "<div class=\"diagram-conn\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">Connection</span><div class=\"diagram-box\" data-rough>named provider account<br><small class=\"diagram-muted\">provider, label, statut, périmètres, configuration &middot; never stores secret values</small></div><div class=\"diagram-muted\">credentialRef &rarr; pointer to a vault secret</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill\">Grant</span><div class=\"diagram-box\" data-rough>per-app permission<br><small class=\"diagram-muted\">no grant = no credential access</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Readiness</span><small class=\"diagram-muted\">what the app sees</small><div class=\"sev-row\"><span class=\"diagram-pill ok\">connected</span><span class=\"diagram-pill warn\">needs_grant</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">needs_credentials</span><span class=\"diagram-pill warn\">needs_attention</span></div><div class=\"sev-row\"><span class=\"diagram-pill\">not_configured</span></div></div></div>",
  "css": ".diagram-conn{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-conn .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-conn .diagram-arrow{font-size:22px;line-height:1}.diagram-conn .sev-row{display:flex;gap:8px;flex-wrap:wrap}"
}
```

### Exemple concret : Slack

Connectez Slack une fois et accordez-le à Brain and Analytics :

```ts
import {
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

await upsertWorkspaceConnection({
  id: "acme-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "Acme",
  status: "connected",
  scopes: ["channels:history", "groups:history", "chat:write"],
  config: {
    teamDomain: "acme",
    channelHints: ["product", "dev-fusion", "customer-success"],
  },
  credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "analytics",
});
```

```an-schema title="Le modèle de connexion" summary="A connection records safe provider metadata and credentialRefs (pointers, not secrets). Each grant unlocks one app — one connection, many grants."
{
  "entities": [
    {
      "id": "conn",
      "name": "workspace_connections",
      "note": "Compte de fournisseur nommé. Ne stocke jamais de valeurs secrètes.",
      "fields": [
        { "name": "id", "type": "string", "pk": true, "note": "e.g. acme-slack" },
        { "name": "provider", "type": "string", "note": "identifiant de fournisseur stable, par ex. mou" },
        { "name": "label", "type": "string" },
        { "name": "accountId", "type": "string", "nullable": true },
        { "name": "accountLabel", "type": "string", "nullable": true },
        { "name": "status", "type": "string", "note": "e.g. connected" },
        { "name": "scopes", "type": "string[]", "nullable": true },
        { "name": "config", "type": "json", "nullable": true, "note": "configuration sûre et non secrète" },
        { "name": "credentialRefs", "type": "json", "nullable": true, "note": "pointers to vault keys, e.g. { key, scope }" }
      ]
    },
    {
      "id": "grant",
      "name": "workspace_connection_grants",
      "note": "Autorisation par application d'utiliser une connexion.",
      "fields": [
        { "name": "connectionId", "type": "string", "fk": "conn.id" },
        { "name": "appId", "type": "string", "note": "par ex. cerveau, analytique" }
      ]
    }
  ],
  "relations": [
    { "from": "conn", "to": "grant", "kind": "1-n", "label": "grants apps" }
  ]
}
```

### Quels appels les applications

Avant de demander à un utilisateur de coller une nouvelle clé, vérifiez d'abord qu'il est prêt :

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

const catalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
  provider: "slack",
  includeConnections: "all",
});

const slack = catalog.providers[0];
if (slack.workspaceConnection.grantState === "needs_grant") {
  // Show "Grant Brain access" instead of asking for a second Slack token.
}
if (slack.readiness.status === "needs_credentials") {
  // Show the missing credential ref names, never a secret value.
}
```

## Référence {#reference}

### Catalogue des fournisseurs

Importer le catalogue depuis `@agent-native/core/connections` :

```ts
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForTemplate,
  workspaceConnectionProviderSupports,
} from "@agent-native/core/connections";

const brainProviders = listWorkspaceConnectionProvidersForTemplate("brain");
const slack = getWorkspaceConnectionProvider("slack");

if (workspaceConnectionProviderSupports("slack", "messages")) {
  // Offer a Slack source, sync check, or onboarding step.
}
```

Les identifiants de fournisseur initiaux sont :

| Fournisseur    | Capacités                                   | Utilisations courantes                           |
| -------------- | ------------------------------------------- | ------------------------------------------------ |
| `slack`        | recherche, importation, messages            | cerveau, répartition, analyses                   |
| `github`       | recherche, importation, code, documents     | cerveau, analyses, répartition                   |
| `notion`       | recherche, importation, documents           | cerveau, contenu, répartition                    |
| `gmail`        | recherche, importation, messages            | courrier, cerveau, expédition                    |
| `google_drive` | recherche, importation, documents           | cerveau, contenu, diapositives                   |
| `hubspot`      | recherche, importation, CRM                 | analyse, cerveau, courrier                       |
| `granola`      | recherche, importation, réunions, documents | cerveau, calendrier, répartition                 |
| `clips`        | recherche, importation, réunions            | cerveau, clips, vidéos                           |
| `generic`      | recherche, importation, documents           | webhooks personnalisé et suppression de fichiers |

Les clés d'identification sont uniquement des noms, tels que `SLACK_BOT_TOKEN` ou `GITHUB_TOKEN`. Les métadonnées du fournisseur ne doivent jamais inclure les valeurs réelles des informations d'identification.

### Magasin de connexion API

```ts
import {
  listWorkspaceConnectionProviderCatalogForApp,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderForApp,
  summarizeWorkspaceConnectionProviderReadiness,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  revokeWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

const connections = await listWorkspaceConnections({ includeDisabled: true });
const grants = await listWorkspaceConnectionGrants({ appId: "brain" });

const appGrant = summarizeWorkspaceConnectionProviderForApp({
  providerId: "slack",
  appId: "brain",
  connections,
  grants,
});

const readiness = summarizeWorkspaceConnectionProviderReadiness({
  provider: slack!,
  appId: "brain",
  connections,
  grants,
});

const brainCatalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
});
```

Le tableau `credentialRefs` pointe vers les clés du coffre-fort ; il ne s'agit pas de stockage d'informations d'identification. Par exemple, `{ key: "SLACK_BOT_TOKEN", scope: "org" }` demande à une application accordée de rechercher le secret du coffre-fort à l'échelle de l'organisation nommé `SLACK_BOT_TOKEN` lorsqu'elle doit appeler Slack. Les références au niveau de la connexion décrivent le compte du fournisseur ; les références au niveau des subventions peuvent restreindre ou remplacer ce qu'une application spécifique doit utiliser.

Les lignes de connexion sont limitées à l'organisation active lorsqu'elle est présente. Sans organisation, ils sont limités à l’utilisateur authentifié. Les lignes d'octroi utilisent la même portée.

**Champ `allowedApps` hérité :** `allowedApps: []` signifie que chaque application de la même portée peut utiliser la connexion ; `allowedApps: ["dispatch"]` accorde l'accès via le champ hérité. Utilisez des lignes `workspace_connection_grants` explicites pour la nouvelle configuration : elles facilitent la révocation, l'audit et la préparation par application. `revokeWorkspaceConnectionGrant(connectionId, appId)` supprime une autorisation explicite mais ne modifie pas l'ancien `allowedApps`.

Utilisez `summarizeWorkspaceConnectionProviderForApp()` et `summarizeWorkspaceConnectionProviderReadiness()` pour le statut de l'application au lieu de procéder à des contrôles d'octroi manuels. Les résumés partagés renvoient `grantState`, `grantAvailability`, les noms de référence d'informations d'identification sécurisées, les lignes de connexion par application et les champs de préparation tels que `readyConnectionCount` et `missingRequiredCredentialKeys`.

Pour les nouveaux écrans de configuration d'application, préférez `listWorkspaceConnectionProviderCatalogForApp()` comme limite de niveau supérieur : il combine le catalogue des fournisseurs, les connexions étendues, les autorisations explicites, les résumés d'accès par application et la préparation du fournisseur dans une forme sécurisée.

### Comment cela complète le coffre-fort

Le coffre-fort des informations d'identification répond : « Où le secret est-il stocké, qui peut y accéder et quelles applications y ont accès ? »

Réponses des métadonnées du fournisseur de connexion Workspace : "De quel fournisseur s'agit-il, que peut-il faire, de quelles clés d'identification pourrait-il avoir besoin et quels modèles devraient le proposer ?"

```an-diagram title="Magasin de connexions et coffre-fort" summary="Le coffre-fort possède la valeur secrète. La connexion possède les métadonnées du fournisseur ainsi que les credentialRefs (pointeurs). Au moment de l'exécution, l'application résout la référence via une connexion accordée et lit la valeur dans le coffre-fort."
{
  "html": "<div class=\"diagram-vault\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">Store de connexions</span><div class=\"diagram-box\" data-rough>provider account + metadata<br><small class=\"diagram-muted\">statut, périmètres, configuration</small></div><div class=\"diagram-box\" data-rough>credentialRef<br><small class=\"diagram-muted\">{ key: SLACK_BOT_TOKEN, scope: org }</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Action d’app</span><small class=\"diagram-muted\">resolves at execution time through a granted ref</small><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Vault</span><div class=\"diagram-box\" data-rough>secret value<br><small class=\"diagram-muted\">jamais renvoyé à l’agent ou à l’UI</small></div></div></div>",
  "css": ".diagram-vault{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-vault .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-vault .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-vault .diagram-arrow{font-size:22px;line-height:1}"
}
```

Utilisez les deux ensemble :

1. Dispatch (ou un autre flux de configuration de l'espace de travail) crée le secret du coffre-fort sous-jacent ou la référence d'identifiant OAuth.
2. Le magasin de connexions de l'espace de travail enregistre le compte du fournisseur, les métadonnées sécurisées, les références d'informations d'identification et les autorisations d'application.
3. Chaque application lit les métadonnées du fournisseur à partir du catalogue et les résumés de connexion/octroi à partir du magasin partagé.
4. L'application UI indique qu'elle est prête : connectée, accordée mais non opérationnelle, nécessite une autorisation, des informations d'identification manquantes ou des métadonnées uniquement.
5. SQL spécifique à l'application stocke uniquement les identifiants sources, les curseurs, les filtres, les fenêtres de synchronisation, les définitions de métriques, les règles de révision et les choix des utilisateurs spécifiques à l'application.
6. L'application actions résout les informations d'identification au moment de l'exécution via les références de connexion accordées et le coffre-fort, et ne renvoie jamais de valeurs secrètes.

### Exécution du lecteur du fournisseur

La couche fournisseur-lecteur est avant tout un contrat, et non une promesse selon laquelle chaque fournisseur dispose d'un lecteur en direct partagé. Les définitions de lecteur décrivent les opérations prises en charge, les exigences d'identification et l'état de mise en œuvre : `metadata-only`, `template-owned` ou `shared`. Le moteur d'exécution résout la connexion à l'espace de travail accordée et les références d'informations d'identification pour une application, appelle un gestionnaire enregistré et renvoie les éléments normalisés sans exposer les valeurs secrètes.

La plupart des gestionnaires en direct restent aujourd'hui la propriété de modèles, ce qui signifie que Brain est toujours propriétaire du comportement d'ingestion Slack/GitHub et qu'Analytics possède toujours l'interprétation analytique. Promouvez un lecteur vers `shared` uniquement lorsque les appels, la pagination, les autorisations et la sémantique des résultats spécifiques au fournisseur sont véritablement réutilisables dans les modèles.

### Modèle de préparation de l'application

Les applications qui utilisent les informations d'identification du fournisseur partagé doivent exposer une action de préparation en lecture seule et une petite surface de configuration couvrant :

- **Catalogue de fournisseurs :** identifiant du fournisseur, étiquette, fonctionnalités, utilisations de modèles recommandées et noms de clés d'identification requis de `@agent-native/core/connections`.
- **Résumé de l'espace de travail :** nombre de connexions, nombres d'actifs/accordés, état d'attribution, noms de référence d'informations d'identification et étiquettes de compte non secrets de `@agent-native/core/workspace-connections`.
- **Préparation du fournisseur :** `ready`, `needs_credentials`, `needs_attention`, `checking`, `disabled` ou `not_configured` via `summarizeWorkspaceConnectionProviderReadiness()`.
- **État de la source :** sources configurées au niveau de l'application locale, curseurs, état de synchronisation et action suivante.

La page Sources de Brain est l'implémentation de référence. Il affiche les fournisseurs de connexion d'espace de travail réutilisables à côté des enregistrements source Brain, étiquette les états d'octroi comme `connected`, `granted`, `needs_grant` ou `not_connected`, et affiche l'état du fournisseur comme étant prêt, clés manquantes, octroi nécessaire, besoin de réparation ou métadonnées uniquement.

### Créer un connecteur réutilisable

Quand un nouveau fournisseur doit fonctionner sur plusieurs modèles :

1. **Métadonnées du fournisseur :** ajoutez ou réutilisez un fournisseur dans `@agent-native/core/connections`. Il s'agit de l'identifiant stable, de l'étiquette d'affichage, de la liste des fonctionnalités, des utilisations de modèles recommandées et des noms de clés d'identification.
2. **Connexion à l'espace de travail :** Dispatch ou une autre surface de configuration de l'espace de travail stocke les métadonnées sécurisées, l'état, les étendues, `credentialRefs` et les subventions d'application du compte connecté via `@agent-native/core/workspace-connections`.
3. **Source locale de l'application :** Brain, Analytics, Mail ou une autre application stocke uniquement les choix spécifiques à l'application qu'elle possède, tels que les canaux Slack, les référentiels GitHub, les filtres d'objets HubSpot, les curseurs de synchronisation ou la cadence d'interrogation.

Ne dupliquez pas le stockage OAuth/jeton dans chaque application. L'enregistrement de connexion indique « ici Acme Slack et son jeton réside à `SLACK_BOT_TOKEN` » ; la source locale de l'application indique "Brain peut ingérer `#product` et `#dev-fusion` à partir de cette connexion Slack."

### Configuration du plan de contrôle de répartition

Dispatch expose le plan de contrôle actions qui écrit les mêmes fonctions de magasin partagé qu'une application pourrait appeler directement :

```ts
// templates/dispatch/actions/upsert-workspace-connection.ts delegates to this.
await upsertWorkspaceConnection({
  id: "team-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "acme",
  status: "connected",
  scopes: ["channels:history", "groups:history"],
  config: { teamDomain: "acme", preferredChannels: ["product", "dev-fusion"] },
  credentialRefs: [
    {
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: "slack",
      label: "Slack bot token",
    },
  ],
});

// Then grant the apps that should reuse the provider.
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "analytics",
});
```

Utilisez `allowedApps: []` uniquement lorsqu'une connexion doit être disponible pour chaque application dans la même étendue. Préférez les lignes d'attribution explicites pour la configuration de la production.

### Résolution des identifiants

Le code d'exécution de l'application résout les valeurs d'informations d'identification du `credentialRefs` accordé via le coffre-fort dans la portée de la demande active. Le `source-credentials.ts` de Brain est l'implémentation de référence actuelle : il répertorie les connexions à l'espace de travail pour le fournisseur, vérifie `getWorkspaceConnectionAppAccess` pour `appId: "brain"`, fusionne les références d'informations d'identification au niveau de la connexion et de l'octroi, et lit le premier secret de coffre-fort correspondant. D'autres applications devraient suivre cette forme au lieu d'atteindre `process.env`.

## Notes de conception {#design-notes}

<details>
<summary>Politique de promotion des lecteurs et chemin vers "Connectez-vous une fois, utilisez partout" </summary>

### Limite locale de l'application

La frontière entre les connexions partagées et les sources locales des applications est intentionnelle. Ce qui est réutilisable aujourd'hui, c'est l'identité du fournisseur, la résolution des références d'informations d'identification, les subventions par application, la préparation du fournisseur, les métadonnées de compte sécurisées et le contrat normalisé fournisseur-lecteur. Ce qui n'est pas encore générique, c'est la plupart des lectures API du fournisseur en direct, la propriété du flux OAuth, les curseurs d'ingestion, les filtres sources, la cadence de synchronisation et l'interprétation du domaine. Ceux-ci restent dans l'application propriétaire du flux de travail, à moins qu'une implémentation de lecteur ne soit explicitement promue au statut partagé.

Les connecteurs source d’application ne doivent pas lire les variables d’environnement au niveau du déploiement comme solution de secours pour les informations d’identification source de l’utilisateur/de l’organisation. Les variables d'environnement sont globales pour le déploiement et n'expriment pas les autorisations d'espace de travail.

Les agents doivent suivre une règle simple : si un utilisateur demande à se connecter à Slack, GitHub, HubSpot, Gmail, Google Drive, Granola ou un autre fournisseur partagé, inspectez d'abord le catalogue de connexions à l'espace de travail. Si le fournisseur est `connected`, utilisez-le. S'il s'agit de `needs_grant`, demandez ou effectuez l'octroi d'application. S'il s'agit de `needs_credentials`, demandez la clé du coffre-fort manquant. Ne demandez une nouvelle clé brute que lorsqu'aucune connexion réutilisable n'existe.

### Chemin vers "Connectez-vous une fois, utilisez partout"

Le catalogue des fournisseurs et le magasin de subventions constituent la base d'une couche d'espace de travail plus large :

- Les identifiants de fournisseur partagés et les noms de fonctionnalités maintiennent les modèles alignés.
- L'inventaire au niveau de l'espace de travail peut montrer quels fournisseurs sont configurés dans les applications Brain, Mail, Analytics, Dispatch et futures.
- Les lignes de connexion enregistrent les étiquettes de compte, l'état, les applications autorisées, les références d'informations d'identification et les vérifications d'état sans modifier les identifiants de fournisseur associés au modèle.
- Les lignes d'autorisation permettent au propriétaire d'un espace de travail de se connecter une seule fois, puis d'activer des applications individuelles au fur et à mesure que l'espace de travail les adopte.
- Les agents peuvent acheminer le travail entre les applications en sachant quels fournisseurs sont déjà connectés et quelles applications bénéficient de subventions.
- La recherche fédérée peut demander des fournisseurs dotés des fonctionnalités `search`, `docs`, `messages`, `meetings`, `crm` ou `code` au lieu de coder en dur la liste des connecteurs de chaque application.
- Les lecteurs spécifiques au fournisseur, les flux d'actualisation OAuth, les points de contrôle d'ingestion et les modèles de données appartenant à l'application peuvent être partagés ultérieurement, mais ils ne sont pas impliqués par une connexion à un espace de travail aujourd'hui.

Gardez les limites strictes : les métadonnées du fournisseur peuvent être affichées en toute sécurité ; les valeurs des informations d'identification restent dans le coffre-fort.

</details>
