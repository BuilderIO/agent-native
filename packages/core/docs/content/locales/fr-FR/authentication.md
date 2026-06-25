---
title: "Authentification"
description: "Meilleure intégration de l'authentification avec e-mail/mot de passe, fournisseurs de services sociaux, organisations et informations d'identification du porteur MCP."
---

# Authentification

Les applications natives d'agent utilisent [Better Auth](https://better-auth.com) pour l'authentification avec une conception axée sur le compte. Les utilisateurs créent un compte lors de la première visite et obtiennent une véritable identité dès le premier jour.

## Vue d'ensemble {#overview}

L'authentification est configurée automatiquement via `autoMountAuth(app)` dans le plugin du serveur d'authentification. Il existe trois modes :

- **Par défaut :** Meilleure authentification avec e-mail/mot de passe + fournisseurs sociaux. Page d'intégration affichée lors de la première visite.
- **MCP OAuth à distance :** Standard OAuth 2.1 pour les hôtes MCP tels que le code Claude et les connecteurs ChatGPT.
- **Personnalisé :** Apportez votre propre authentification via le rappel `getSession`.

```an-diagram title="Trois façons d'entrer, une seule séance" summary="Les visiteurs du navigateur, les clients programmatiques MCP et les fournisseurs personnalisés résolvent tous la même AuthSession que celle lue par la portée en aval."
{
  "html": "<div class=\"auth-modes\"><div class=\"diagram-col\"><div class=\"diagram-card\"><span class=\"diagram-pill accent\">Default</span><strong>Better Auth</strong><small class=\"diagram-muted\">email/password &middot; Google &middot; GitHub</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Remote MCP OAuth</span><strong>OAuth 2.1 + PKCE</strong><small class=\"diagram-muted\">connecteurs Claude Code et ChatGPT</small></div><div class=\"diagram-card\"><span class=\"diagram-pill\">Custom</span><strong>getSession callback</strong><small class=\"diagram-muted\">Clerk &middot; Auth0 &middot; Firebase</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill ok\">AuthSession</span><small class=\"diagram-muted\">email &middot; orgId &middot; orgRole</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">Request context &amp; data scoping</div></div>",
  "css": ".auth-modes{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.auth-modes .diagram-col{display:flex;flex-direction:column;gap:10px}.auth-modes .diagram-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px}.auth-modes .diagram-arrow{font-size:22px;line-height:1}.auth-modes .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

Le flux du navigateur est le même flux Better Auth partout : il n'y a **pas de contournement d'authentification de développement** et `getSession()` ne revient jamais à une sentinelle `local@localhost`. Ce qui change entre les environnements, ce sont les frictions d'inscription, pas le mur de connexion :

| Environnement               | Comportement au premier chargement                                                                            | Vérification de l'e-mail                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Développement local**     | Crée automatiquement un compte de développement jetable et vous connecte (pas de mur de connexion)            | Ignoré par défaut (et en l'absence de fournisseur de messagerie) |
| **Contrôle qualité/aperçu** | Inscription normale, mais la vérification peut être ignorée afin que les testeurs n'attendent pas les e-mails | Passer avec `AUTH_SKIP_EMAIL_VERIFICATION=1`                     |
| **Production**              | Inscription/connexion normale avec une meilleure authentification                                             | Obligatoire (lorsqu'un fournisseur de messagerie est configuré)  |

Quelques drapeaux règlent cela ; tous les détails sont dans le tableau [Environment Variables](#environment-variables) :

- `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` : utilisez la page d'inscription normale dans le développement local au lieu du compte de développement automatique.
- `AUTH_DISABLED=true` – ignorez complètement la connexion/l'inscription et exécutez chaque demande en tant qu'utilisateur partagé (développement local/aperçus/démos uniquement, jamais de production avec de vrais utilisateurs).
- `AUTH_MODE=local` — affecte uniquement l'identité de CLI/agent (sous quel utilisateur de développement `pnpm action` s'exécute) ; il ne s'agit **pas** d'un contournement de connexion au navigateur.

```an-callout
{
  "tone": "warning",
  "body": "`AUTH_DISABLED=true` runs **every request as one shared user**. Use it only for local dev, previews, or demos — never in production with real users, where it would expose all data to anyone."
}
```

## Meilleure authentification (par défaut) {#better-auth}

Par défaut, Better Auth gère l'authentification. Il fournit :

- Inscription et connexion par e-mail/mot de passe
- Fournisseurs de réseaux sociaux (Google, GitHub et plus de 35 autres)
- Organisations avec rôles et invitations
- Jetons JWT pour accès API et A2A
- Prise en charge des jetons Bearer pour les clients programmatiques

De meilleures routes d'authentification sont montées sur `/_agent-native/auth/ba/*`. Le framework fournit également des points de terminaison rétrocompatibles :

- `GET /_agent-native/auth/session` – obtenir la session en cours
- `POST /_agent-native/auth/login` — connexion par e-mail/mot de passe
- `POST /_agent-native/auth/register` — créer un compte
- `POST /_agent-native/auth/logout` — déconnexion

## Royaumes des cookies {#cookie-realms}

Le domaine du cookie de session suit la forme du déploiement, de sorte que les applications qui partagent un
Connexion aux bases de données/partages d'origine et applications qui ne restent pas isolées :

| Forme de déploiement                                           | Domaine des cookies                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application autonome                                           | Isolé par application par slug (`APP_NAME` ou nom du package dans le développement local) ; préfixe `an` stable en production                                 |
| Mode Espace de travail (`AGENT_NATIVE_WORKSPACE=1`)            | Un domaine partagé : les applications d'espace de travail partagent une origine et une base de données                                                        |
| Sous-domaines personnalisés de la même base de données         | Activer les cookies partagés avec `COOKIE_DOMAIN`                                                                                                             |
| Hébergé par un fournisseur propriétaire (`*.agent-native.com`) | Espace de noms isolé par application (chacune possède sa propre base de données d'authentification) ; `COOKIE_DOMAIN=.agent-native.com` est ignoré par défaut |

Les applications hébergées par des propriétaires possèdent chacune leur propre base de données d'authentification, donc la connexion entre applications
passe par [Cross-App SSO](/docs/cross-app-sso) plutôt que par un cookie partagé.
Ces déploiements doivent fournir `APP_NAME` ou une application dérivée URL (`APP_URL`, `URL`,
`DEPLOY_PRIME_URL` ou `DEPLOY_URL`); sinon le démarrage échoue au lieu de tomber
retour au nom `an_session` partagé. Pour partager intentionnellement une base de données d'authentification
dans les sous-domaines, définissez `AGENT_NATIVE_SHARE_COOKIE_DOMAIN=1` à côté
`COOKIE_DOMAIN`.

## Comptes d'assurance qualité {#qa-accounts}

Le développement et les tests locaux ignorent la vérification de l'e-mail d'inscription par défaut, vous pouvez donc
peut créer de vrais comptes de messagerie/mot de passe sans attendre une boîte de réception. Forcer
vérification locale lors du test de ce flux, définissez `AUTH_SKIP_EMAIL_VERIFICATION=0`.

Pour les environnements d'assurance qualité hébergés où les testeurs ont besoin de comptes réels mais ne doivent pas attendre
lors de la livraison de l'e-mail, définissez :

```bash
AUTH_SKIP_EMAIL_VERIFICATION=1
```

Lorsque cet indicateur est défini, l'inscription par e-mail/mot de passe ne nécessite pas d'e-mail
vérification et l'e-mail de vérification de l'inscription n'est pas envoyé. Utilisez-le uniquement pour le contrôle qualité
ou prévisualisez les environnements et nommez les comptes de test avec une adresse `+qa`
(`name+qa@example.com`) pour qu'ils soient faciles à identifier.

## Prestataires sociaux {#social-providers}

Définissez les variables d'environnement pour activer la connexion sociale. Better Auth les détecte automatiquement :

```bash
# Google OAuth
GOOGLE_SIGN_IN_CLIENT_ID=your-low-scope-sign-in-client-id
GOOGLE_SIGN_IN_CLIENT_SECRET=your-low-scope-sign-in-client-secret

# Solution de secours rétrocompatible et informations d'identification du fournisseur OAuth pour les modèles
# qui se connectent à Google APIs comme Gmail ou Calendar.
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

Les modèles qui utilisent `createGoogleAuthPlugin()` affichent une page « Se connecter avec Google ». Le rappel Google OAuth gère automatiquement les liens profonds mobiles pour les applications natives.

Préférez `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` pour le normal
connexion à l'application. Ce client doit demander uniquement des étendues d’identité. Conserver
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` pour les intégrations de produits qui nécessitent
Portées Google API, ou comme solution de secours héritée lorsqu'un déploiement n'a pas été fractionné
pas encore. Les applications de type Mail et Calendrier doivent donc utiliser leurs propres clients OAuth.
Les écrans de consentement de grande portée n'affectent pas la connexion aux applications génériques.

### Signature d'état OAuth {#oauth-state-secret}

Définissez `OAUTH_STATE_SECRET` sur une valeur aléatoire de plus de 32 caractères en production afin que les enveloppes d'état OAuth (Google, Atlassian, Zoom) soient signées HMAC avec une clé dédiée indépendante de tout secret tiers. Consultez [Security — OAuth State Signing](/docs/security#oauth-state) pour connaître les exigences complètes et le modèle de menace.

## Organisations {#organizations}

Le framework fournit un système d'organisation intégré. Il s'agit du module `org/` du framework — soutenu par les tables `organizations` et `org_members` — et non du plugin d'organisation de Better Auth, qui n'est intentionnellement pas enregistré. Chaque application prend en charge :

- Créer des organisations
- Invitation de membres avec des rôles (`owner`, `admin`, `member`)
- Changer d'organisation active
- Portée des données par organisation via les colonnes `org_id`

L'organisation active est suivie sur la session sous le nom `session.orgId`, et le changement d'organisation modifie les données vues par l'utilisateur et l'agent. La portée des données elle-même s'effectue plus bas dans la pile – voir [Security & Data Scoping](/docs/security#data-scoping) pour le pipeline `session.orgId → AGENT_ORG_ID → SQL` complet et les protections d'accès. Les documents [Multi-Tenancy](/docs/multi-tenancy) couvrent la surface de gestion de l'organisation.

## Jetons au porteur MCP statiques {#access-tokens}

`ACCESS_TOKEN` et `ACCESS_TOKENS` ne sont pas authentifiés par le navigateur et ne rendent pas une application privée. Ils restent uniquement en tant qu'informations d'identification de support statiques pour les clients MCP/connect qui ne peuvent pas utiliser le flux OAuth.

```bash
# Jeton unique
ACCESS_TOKEN=my-secret-token

# Plusieurs jetons
ACCESS_TOKENS=token1,token2,token3
```

La configuration de ces variables ne génère jamais de page de connexion par jeton pour les visiteurs. La connexion Web reste sur Better Auth ou sur votre fournisseur `getSession` personnalisé.

## Télécommande MCP OAuth {#remote-mcp-oauth}

Le point de terminaison MCP de chaque application peut agir comme une ressource MCP protégée standard. Les clients compatibles OAuth peuvent être configurés uniquement avec le MCP URL distant :

```text
https://mail.agent-native.com/_agent-native/mcp
```

Les requêtes MCP non authentifiées renvoient un défi `WWW-Authenticate` pointant vers `/.well-known/oauth-protected-resource`. Le client découvre ensuite les métadonnées OAuth de l'application, enregistre dynamiquement un client public, ouvre la page d'autorisation de l'application et échange un code d'autorisation avec PKCE pour les jetons d'accès et d'actualisation.

```an-diagram title="Prise de contact à distance MCP OAuth" summary="Un client compatible OAuth démarre uniquement à partir du MCP URL : défi, découverte, enregistrement dynamique, puis échange de code PKCE."
{
  "html": "<div class=\"mcp-flow\"><div class=\"diagram-node\">1 &middot; MCP request<br><small class=\"diagram-muted\">no token</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node warn\">2 &middot; 401 challenge<br><small class=\"diagram-muted\">WWW-Authenticate</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">3 &middot; Discover metadata<br><small class=\"diagram-muted\">.well-known</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">4 &middot; Register client<br><small class=\"diagram-muted\">dynamique, public</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\">5 &middot; Authorize + PKCE<br><small class=\"diagram-muted\">code exchange</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node ok\">6 &middot; Access + refresh<br><small class=\"diagram-muted\">audience-bound</small></div></div>",
  "css": ".mcp-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mcp-flow .diagram-node{display:flex;flex-direction:column;gap:2px;padding:8px 12px}.mcp-flow .diagram-arrow{font-size:20px;line-height:1}"
}
```

Les jetons d'accès sont signés avec `A2A_SECRET` lorsqu'ils sont définis, sinon `BETTER_AUTH_SECRET`. Ils portent l'identité d'utilisateur/d'organisation signée et les étendues `mcp:read`, `mcp:write` et/ou `mcp:apps`, et sont liés à l'audience à la ressource MCP exacte, URL. Les jetons d'actualisation sont stockés uniquement sous forme de hachages et tournent à chaque actualisation. Les appels d'outils et les lectures de ressources d'applications MCP s'exécutent dans le même contexte de demande que l'utilisateur connecté ; l'iframe de l'application MCP intégrée ne reçoit jamais de jetons OAuth bruts.

`npx @agent-native/core@latest connect <url> --client claude-code` écrit l’entrée MCP uniquement URL pour ce flux standard. Pour les clients qui ne peuvent pas exécuter MCP OAuth à distance, utilisez la page Connect ou la solution de secours `npx @agent-native/core@latest connect --token <token>` pour écrire une entrée explicite de jeton de porteur.

## Apportez votre propre authentification {#byoa}

Transmettez un rappel `getSession` personnalisé pour utiliser n'importe quel fournisseur d'authentification (Clerk, Auth0, Firebase, etc.) :

```ts
// server/plugins/auth.ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  getSession: async (event) => {
    // Your custom auth logic here
    const session = await myAuthProvider.verify(event);
    if (!session) return null;
    return { email: session.email };
  },
  publicPaths: ["/api/webhooks"],
});
```

## Applications de l'espace de travail public {#public-workspace-apps}

Les applications Workspace sont internes par défaut. Pour permettre aux visiteurs anonymes de charger un public
site tout en gardant les pages de gestion derrière l'authentification, déclarer l'accès à la route dans
`apps/<id>/package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

Pour la forme inverse, conserver l'audience interne par défaut et exposer uniquement
pages publiques spécifiques :

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

`publicPaths` et `protectedPaths` utilisent la correspondance de préfixe, donc `"/admin"` également
couvre `"/admin/users"`. Ces paramètres ouvrent uniquement la navigation dans les pages. Cadre
les itinéraires (`/_agent-native/*`) et les itinéraires API personnalisés (`/api/*`) nécessitent toujours une authentification
sauf si l'application ajoute explicitement ces préfixes à
`createAuthPlugin({ publicPaths: [...] })`.

## Séance API {#session-api}

L'objet session renvoyé par `getSession(event)` a cette forme :

```ts
interface AuthSession {
  email: string; // User's email (primary identifier)
  userId?: string; // Better Auth user ID
  token?: string; // Session token
  name?: string; // Display name from the auth provider, when available
  image?: string; // Profile image from the auth provider, when available
  orgId?: string; // Active organization ID
  orgRole?: string; // Role in active org (owner/admin/member)
}
```

Sur le client, utilisez le hook `useSession()` :

```ts
import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}
```

## Connexion avec retour URL {#sign-in-return-url}

Les modèles comportant des **pages publiques** (liens de partage, intégrations, pages marketing) nécessitent souvent un CTA sur la page qui demande aux utilisateurs anonymes de se connecter et les ramène à la page sur laquelle ils se trouvaient. Le framework fournit un point d'entrée unique pour cela :

```
/_agent-native/sign-in?return=<same-origin-path>
```

Lorsqu'un spectateur anonyme accède à ce URL, la page de connexion du framework est servie. Après une connexion réussie (n'importe quel flux : jeton, e-mail/mot de passe ou Google OAuth), le spectateur est redirigé vers `return`.

Le paramètre `return` est validé en tant que **chemin de même origine**. Les références de chemin réseau (`//evil.com/...`), les URL absolus, les schémas `data:`/`javascript:` et les caractères de contrôle intégrés reviennent tous à `/`. Le chemin validé est reconstruit à partir de l'analyseur URL et n'est pas renvoyé par l'entrée.

**À partir d'un composant React :**

```tsx
import { Button } from "@/components/ui/button";

function SignInCta() {
  const onClick = () => {
    const ret = window.location.pathname + window.location.search;
    window.location.href =
      "/_agent-native/sign-in?return=" + encodeURIComponent(ret);
  };
  return <Button onClick={onClick}>Sign in</Button>;
}
```

### Chemins privés marqués

Lorsqu'un utilisateur anonyme accède directement à un chemin privé tel que `/dashboard`, le framework dessert déjà la page de connexion sur ce URL : une fois la connexion réussie, la page se recharge et l'utilisateur atterrit sur `/dashboard`. Aucune manipulation particulière n'est nécessaire ; cela fonctionne pour le jeton, l'e-mail/mot de passe et **et** Google OAuth.

### Dans les coulisses : Google OAuth

Les deux flux (le point d'entrée explicite `/_agent-native/sign-in` et le cas du chemin marqué par un signet) transmettent le retour URL via l'état OAuth. L'état est signé HMAC, il ne peut donc pas être falsifié pendant le transport. Lors du rappel, le retour URL est revalidé comme étant de même origine avant la redirection — de sorte qu'une clé de signature divulguée ne peut toujours pas être transformée en un oracle de redirection ouverte.

Si votre modèle encapsule directement `/_agent-native/google/auth-url` (par exemple, les modèles de courrier et de calendrier le font, pour élargir les portées), acceptez une requête `?return=<path>` et transférez-la via le formulaire d'objet d'options de `encodeOAuthState` :

```ts
const returnUrl = getQuery(event).return;
const state = encodeOAuthState({
  redirectUri,
  desktop,
  returnUrl: typeof returnUrl === "string" ? returnUrl : undefined,
});
```

La route `/_agent-native/google/auth-url` par défaut le fait automatiquement : elle n'est remplacée que si votre modèle nécessite une gestion OAuth personnalisée.

## Variables d'environnement {#environment-variables}

| Variable                                | Objectif                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                    | Clé de signature pour une meilleure authentification (générée automatiquement si elle n'est pas définie)                                                                                                                          |
| `AUTH_SKIP_EMAIL_VERIFICATION`          | Défini sur `1` dans les environnements QA/preview pour permettre aux inscriptions par e-mail/mot de passe de se dérouler sans vérification ; le développement/test local est ignoré par défaut                                    |
| `AUTH_DISABLED`                         | Définissez sur `true` ou `1` pour ignorer la connexion/l'inscription ; toutes les requêtes s'exécutent en tant qu'utilisateur partagé (développement/aperçu local uniquement – pas pour la production avec de vrais utilisateurs) |
| `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT` | Définissez sur `1` pour désactiver la connexion automatique de localhost sur une nouvelle base de données de développement                                                                                                        |
| `AUTH_MODE`                             | `local` résout uniquement l'identité de CLI/agent (sous quel utilisateur de développement `pnpm action` s'exécute) ; jamais de contournement de connexion au navigateur                                                           |
| `COOKIE_DOMAIN`                         | Activer les cookies de session partagée sur les sous-domaines de la même base de données (voir [Cookie Realms](#cookie-realms))                                                                                                   |
| `AGENT_NATIVE_WORKSPACE`                | `1` s'exécute en mode espace de travail : un domaine de session partagé entre les applications de l'espace de travail                                                                                                             |
| `AGENT_NATIVE_SHARE_COOKIE_DOMAIN`      | Défini avec `COOKIE_DOMAIN` pour partager une base de données d'authentification entre les sous-domaines propriétaires                                                                                                            |
| `OAUTH_STATE_SECRET`                    | Touche HMAC dédiée aux enveloppes d'état OAuth (voir [Security — OAuth State Signing](/docs/security#oauth-state))                                                                                                                |
| `GOOGLE_SIGN_IN_CLIENT_ID`              | ID client Google OAuth de faible portée préféré pour la connexion à l'application                                                                                                                                                 |
| `GOOGLE_SIGN_IN_CLIENT_SECRET`          | Secret Google OAuth de faible portée préféré pour la connexion à l'application                                                                                                                                                    |
| `GOOGLE_CLIENT_ID`                      | Ancien système de secours de connexion Google et ID client du fournisseur OAuth pour les intégrations Google API                                                                                                                  |
| `GOOGLE_CLIENT_SECRET`                  | Ancien système de secours de connexion Google et secret du fournisseur OAuth pour les intégrations Google API                                                                                                                     |
| `GITHUB_CLIENT_ID`                      | Activer GitHub OAuth                                                                                                                                                                                                              |
| `GITHUB_CLIENT_SECRET`                  | Secret GitHub OAuth                                                                                                                                                                                                               |
| `ACCESS_TOKEN`                          | Repli du support statique pour les clients MCP/connect ; pas l'authentification du navigateur                                                                                                                                     |
| `ACCESS_TOKENS`                         | Supports statiques de secours séparés par des virgules pour les clients MCP/connect ; pas l'authentification du navigateur                                                                                                        |
| `A2A_SECRET`                            | Secret partagé pour la vérification de l'identité inter-applications A2A signée par JWT et, le cas échéant, la signature du jeton d'accès MCP OAuth                                                                               |
