---
title: "Notifications"
description: "Notifications dans l'application avec canaux enfichables : boîte de réception, webhook ou personnalisé"
---

# Notifications

Une fonction, plusieurs destinations. Appelez `notify()` à partir de n'importe quel code côté serveur (une action, une automatisation, un plugin) et l'événement atterrit dans la boîte de réception de l'application de l'utilisateur et se diffuse sur chaque chaîne enregistrée. Livré avec un composant UI en forme de cloche et de liste déroulante que le modèle hôte dépose dans son en-tête.

Les notifications sont des alertes unidirectionnelles envoyées dans la boîte de réception de l'application (plus la diffusion du webhook). Pour _converser_ avec votre agent depuis Slack/email/Telegram/WhatsApp, voir [Messaging](/docs/messaging).

```ts
import { notify } from "@agent-native/core/notifications";

await notify(
  { severity: "info", title: "Booking confirmed", body: "Jane at 3pm" },
  { owner: "steve@builder.io" },
);
```

```an-diagram title="Un appel, plusieurs destinations" summary="notify() écrit toujours la ligne de la boîte de réception réservée au propriétaire, est diffusée en parallèle sur chaque canal enregistré (au mieux), puis émet notification.sent sur le bus d'événements."
{
  "html": "<div class=\"diagram-notify\"><div class=\"diagram-node\">notify(input, { owner })<br><small class=\"diagram-muted\">any server code &middot; action, automation, plugin</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel fan\" data-rough><div class=\"fan-row\"><span class=\"diagram-pill accent\">inbox</span><div class=\"diagram-box\" data-rough>notifications table &rarr; bell UI<br><small class=\"diagram-muted\">always on &middot; owner-scoped</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">webhook</span><div class=\"diagram-box\" data-rough>POST JSON to NOTIFICATIONS_WEBHOOK_URL<br><small class=\"diagram-muted\">best-effort</small></div></div><div class=\"fan-row\"><span class=\"diagram-pill\">custom</span><div class=\"diagram-box\" data-rough>registerNotificationChannel(...)<br><small class=\"diagram-muted\">best-effort &middot; runs in parallel</small></div></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill ok\">notification.sent</span><small class=\"diagram-muted\">event bus &middot; automations can chain</small></div></div>",
  "css": ".diagram-notify{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-notify .fan{display:flex;flex-direction:column;gap:10px;padding:14px}.diagram-notify .fan-row{display:flex;align-items:center;gap:10px}.diagram-notify .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-notify .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Gravités {#severities}

| Gravité    | Utiliser pour                                             |
| ---------- | --------------------------------------------------------- |
| `info`     | Confirmations, étapes de progression, FYI                 |
| `warning`  | Quelque chose que l'utilisateur devrait bientôt consulter |
| `critical` | Besoin d'une attention immédiate                          |

La gravité détermine le style du badge dans la liste déroulante et est transmise aux canaux afin qu'ils puissent effectuer une branche en cas d'urgence.

## Canaux intégrés {#channels}

| Chaîne    | Livraison                                                      | Requiert                                                              |
| --------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `inbox`   | Persiste dans la table `notifications` ; entraîne la cloche UI | Toujours activé – fait partie de la primitive.                        |
| `webhook` | POST JSON vers un URL configuré                                | Var d'environnement `NOTIFICATIONS_WEBHOOK_URL` définie au démarrage. |

Le canal webhook résout les références `${keys.NAME}` dans les URL et `NOTIFICATIONS_WEBHOOK_AUTH` par rapport au [secrets](/docs/security) ad hoc du propriétaire, de sorte que la valeur brute n'entre jamais dans le contexte de l'agent. Les listes d'autorisation URL par clé sont appliquées – même règle que celle utilisée par l'outil d'automatisation `web-request`.

```an-diagram title="Canaux et gravité" summary="la boîte de réception est toujours activée ; le webhook a besoin d'une variable d'environnement ; les canaux personnalisés s'enregistrent au démarrage. La gravité détermine le style du badge et est transmise à tous les canaux."
{
  "html": "<div class=\"diagram-channels\"><div class=\"diagram-panel col\" data-rough><strong>Channels</strong><div class=\"diagram-box\" data-rough>inbox<br><small class=\"diagram-muted\">always on &mdash; part of the primitive</small></div><div class=\"diagram-box\" data-rough>webhook<br><small class=\"diagram-muted\">needs NOTIFICATIONS_WEBHOOK_URL</small></div><div class=\"diagram-box\" data-rough>custom<br><small class=\"diagram-muted\">registerNotificationChannel()</small></div></div><div class=\"diagram-panel col\" data-rough><strong>La gravité détermine le badge</strong><div class=\"sev-row\"><span class=\"diagram-pill\">info</span><span class=\"diagram-muted\">confirmations, infos</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">warning</span><span class=\"diagram-muted\">look at soon</span></div><div class=\"sev-row\"><span class=\"diagram-pill accent\">critical</span><span class=\"diagram-muted\">needs immediate attention</span></div></div></div>",
  "css": ".diagram-channels{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.diagram-channels .col{display:flex;flex-direction:column;gap:10px;padding:14px;min-width:240px}.diagram-channels .sev-row{display:flex;align-items:center;gap:10px}"
}
```

## API {#api}

### `notify(input, meta)` {#notify}

Envoyez une notification. Conserve toujours dans la boîte de réception, sauf exclusion explicite ; des chaînes enregistrées supplémentaires fonctionnent en parallèle, au mieux.

```ts
await notify(
  {
    severity: "critical",
    title: "Database offline",
    body: "Primary dropped connections",
    metadata: { runbookUrl: "https://runbooks/db-offline" },
    channels: ["inbox", "webhook"], // optional allowlist; omit to run all
  },
  { owner: "ops@company.com" },
);
```

`meta.owner` est obligatoire : la notification s'étend de manière à ce que seul cet utilisateur la voie dans la cloche.

### `registerNotificationChannel(channel)` {#register}

Enregistrez un canal personnalisé à partir de n'importe quel plugin de serveur.

```ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

registerNotificationChannel({
  name: "slack-ops",
  async deliver(input, meta) {
    await fetch(process.env.OPS_SLACK_WEBHOOK!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*${input.severity.toUpperCase()}* — ${input.title}\n${input.body ?? ""}`,
        owner: meta.owner,
      }),
    });
  },
});
```

Les noms des chaînes sont uniques : le réenregistrement remplace la chaîne précédente. `deliver()` est le meilleur effort ; le lancement enregistre l'erreur mais ne bloque pas les autres canaux ni la ligne de la boîte de réception.

### Liste et lecture {#read}

```ts
import {
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "@agent-native/core/notifications";

const rows = await listNotifications("steve@builder.io", {
  unreadOnly: true,
  limit: 50,
});
const unread = await countUnread("steve@builder.io");
await markNotificationRead(rows[0].id, "steve@builder.io");
await markAllNotificationsRead("steve@builder.io");
await deleteNotification(rows[0].id, "steve@builder.io");
```

Chaque fonction est limitée au propriétaire : aucune lecture ni écriture entre utilisateurs.

## L'interface NotificationChannel {#channel-interface}

```ts
interface NotificationChannel {
  name: string;
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ): void | Promise<void>;
}

interface NotificationInput {
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

interface NotificationMeta {
  owner: string;
}
```

## HTTP API {#http}

Monté sur `/_agent-native/notifications/*` par le plugin core-routes. Toutes les routes sont limitées à l'e-mail de la session authentifiée.

| Méthode  | Chemin                                              |
| -------- | --------------------------------------------------- |
| `GET`    | `/_agent-native/notifications?unread=true&limit=50` |
| `GET`    | `/_agent-native/notifications/count`                |
| `POST`   | `/_agent-native/notifications/:id/read`             |
| `POST`   | `/_agent-native/notifications/read-all`             |
| `DELETE` | `/_agent-native/notifications/:id`                  |

```an-api title="Liste des notifications" summary="The route behind listNotifications() — scoped to the authenticated session's email."
{
  "method": "GET",
  "path": "/_agent-native/notifications?unread=true&limit=50",
  "summary": "Répertorier les notifications récentes pour l'utilisateur actuel",
  "auth": "Authenticated session; results are scoped to the session's email.",
  "params": [
    { "name": "unread", "in": "query", "type": "boolean", "required": false, "description": "When true, returns only unread notifications." },
    { "name": "limit", "in": "query", "type": "number", "required": false, "description": "Max rows to return." }
  ],
  "responses": [
    { "status": "200", "description": "Owner-scoped notification rows, newest first." }
  ]
}
```

## Composant UI {#ui}

```tsx
import { NotificationsBell } from "@agent-native/core/client/notifications";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <NotificationsBell browserNotifications />
    </header>
  );
}
```

Icône en forme de cloche avec badge non lu. En cliquant, vous ouvrez une liste déroulante des notifications récentes. Utilise des jetons sémantiques shadcn, s'adapte au thème clair/sombre du modèle hôte.

Transmettez `browserNotifications` pour déclencher également les fenêtres contextuelles `new Notification(...)` du système pour chaque nouvel élément non lu – utile lorsque l'onglet de l'utilisateur est en arrière-plan. La liste déroulante affiche une invite « Activer » jusqu'à ce que l'utilisateur accorde l'autorisation ; les doublons sont évités par identifiant via le champ Notification `tag`.

## Outils d'agent {#agent-tools}

Un seul outil `manage-notifications` est enregistré dans chaque modèle. Le paramètre `action` sélectionne l'opération :

| Actions | Paramètres                                                                          | Objectif                                                                                      |
| ------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `send`  | `severity` (obligatoire), `title` (obligatoire), `body`, `metadataJson`, `channels` | Envoyer une notification à la boîte de réception de l'utilisateur et aux chaînes enregistrées |
| `list`  | `unreadOnly`, `limit` (max 200, 20 par défaut)                                      | Répertorier les notifications récentes pour le contexte                                       |

Les automatisations (voir [Automations](/docs/automations)) peuvent appeler `manage-notifications` avec `action=send` dans leur corps — il s'agit du modèle canonique pour transformer un événement externe en une alerte visible par l'utilisateur.

## Bus d'événements {#event-bus}

Chaque livraison réussie émet `notification.sent` sur le [event bus](/docs/automations#event-bus) :

```json
{
  "notificationId": "n-123",
  "severity": "critical",
  "title": "DB offline",
  "body": "Primary dropped connections",
  "deliveredChannels": ["inbox", "webhook"]
}
```

Les automatisations peuvent enchaîner cela – par ex. _"si une notification critique se déclenche, avertissez également."_

## Comment ça marche {#internals}

- **Portée du propriétaire** — chaque ligne a une colonne `owner` ; chaque requête est filtrée dessus ; chaque itinéraire utilise l'e-mail de la session authentifiée. Les utilisateurs ne voient jamais les notifications des autres.
- **Intégration de sondage** — chaque mutation appelle `recordChange()` afin que les modèles utilisant [`useDbSync`](/docs/client) s'invalident automatiquement sans aucun câblage supplémentaire.
- **Distribution au mieux** : les erreurs de canal sont détectées et enregistrées ; un canal défaillant ne bloque pas les autres ni l'écriture dans la boîte de réception.
- **Fire-and-forget** — `notify()` revient une fois l'écriture de la boîte de réception terminée ; les canaux personnalisés s'exécutent en arrière-plan.

## Quelle est la prochaine étape

- [**Automations**](/docs/automations) — l'appelant le plus courant de `notify()`
- [**Security**](/docs/security) — la substitution `${keys.NAME}` qui alimente le canal webhook
- [**Server plugins**](/docs/server) — où les canaux personnalisés sont enregistrés au démarrage
