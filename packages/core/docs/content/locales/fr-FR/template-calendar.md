---
title: "Calendrier"
description: "Un calendrier alimenté par un agent avec synchronisation Google Calendar et liens de réservation de style Calendly. Planifiez, trouvez des créneaux horaires et gérez la disponibilité grâce à un anglais simple."
---

# Calendrier

Une application de calendrier alimentée par un agent. Connectez votre Google Calendar et l'agent peut lire votre emploi du temps, trouver des créneaux libres, créer des événements et gérer les liens de réservation de style Calendly, le tout dans un anglais simple. Il remplace le combo Google Calendar + Calendly par une application que vous possédez.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1.4px solid var(--wf-line)'><button>Week</button><button>Today</button><button>‹</button><button>›</button><div style='flex:1'></div><strong>3-9 mai 2026</strong><div style='flex:1'></div><button class='primary'>Nouvel événement</button></div><div style='display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));grid-template-rows:36px repeat(5,72px);gap:7px;padding:14px;flex:1'><div></div><strong>dim. 3</strong><strong>lun. 4</strong><strong>mar. 5</strong><strong>mer. 6</strong><strong>jeu. 7</strong><strong>ven. 8</strong><strong>sam. 9</strong><small class='wf-muted'>7 AM</small><div class='wf-box' style='opacity:.45'></div><div></div><div></div><div></div><div></div><div></div><div></div><small class='wf-muted'>9 AM</small><div class='wf-box'>Réunion générale</div><div class='wf-box'>Standup ingénierie</div><div class='wf-box'>Standup ingénierie</div><div class='wf-box'>Standup ingénierie</div><div></div><div class='wf-box'>Planning</div><div></div><small class='wf-muted'>11 AM</small><div class='wf-box'>Revue design</div><div></div><div class='wf-box'>Critique design</div><div class='wf-box'>Roadmap</div><div class='wf-box'>Démo du vendredi</div><div></div><div></div><small class='wf-muted'>1 PM</small><div></div><div class='wf-box'>1:1</div><div class='wf-box'>Bloc de concentration</div><div></div><div></div><div class='wf-box'>Réunion générale</div><div></div><small class='wf-muted'>3 PM</small><div></div><div></div><div></div><div class='wf-box'>Réunion skip-level</div><div></div><div></div><div></div></div></div>"
}
```

Lorsque vous ouvrez l'application, la vue active du calendrier constitue la surface principale. L'agent sait toujours quel jour, semaine ou événement vous consultez, vous pouvez donc dire « planifier un appel de 30 minutes avec Alex ce jour-là » sans tout préciser.

```an-diagram title="Comment se déroule une demande de planification" summary="Que vous cliquiez dans le calendrier ou demandiez à l'agent, les mêmes actions sont lues en direct depuis Google Calendar et réécrites dans la même vue."
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">Vous cliquez<br><small class=\"diagram-muted\">glisser, barre d’outils, raccourcis</small></div><div class=\"diagram-node\">Vous demandez à l’agent<br><small class=\"diagram-muted\">\"find a 1-hour slot next week\"</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Actions</span><small class=\"diagram-muted\">list-events · check-availability · create-event</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Google Calendar<br><small class=\"diagram-muted\">en direct, multi-comptes</small></div><div class=\"diagram-box\">SQL<br><small class=\"diagram-muted\">réservations · disponibilité</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">La vue calendrier se met à jour en direct</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## Ce que vous pouvez en faire

- **Voir votre véritable Google Calendar** en mode jour, semaine ou mois, avec plusieurs comptes superposés.
- **Abonnez-vous aux flux ICS** (congés RH, horaires de conférence, calendriers d'équipe) – en lecture seule, mélangés dans la même vue.
- **Définir la disponibilité hebdomadaire** avec prise en charge du fuseau horaire : l'agent l'utilise pour trouver des créneaux libres.
- **Créez des liens de réservation publics** sur `/book/{slug}` pour des éléments tels que "Intro de 15 minutes" ou "Démo de 30 minutes". Configurez les durées, les champs personnalisés et l'outil de conférence à utiliser.
- **Demandez à l'agent tout ce qui concerne l'horaire** : "Suis-je libre jeudi après-midi ?" "Trouvez un créneau d'une heure la semaine prochaine et inscrivez-y 'Planification avec Alex'." "Suspendre mon lien de réservation de démo."
- **Partagez les liens de réservation** avec vos coéquipiers afin qu'ils puissent également les gérer.

## Démarrer

Démo en direct : [calendar.agent-native.com](https://calendar.agent-native.com).

Lorsque vous ouvrez l'application pour la première fois :

1. Cliquez sur **Paramètres**.
2. Cliquez sur **Connecter Google Calendar** et approuvez.
3. (Facultatif) Connectez davantage de comptes Google si vous souhaitez superposer vos comptes personnels et professionnels.
4. Ouvrez la vue principale : votre véritable calendrier se chargera.

Pour créer votre premier lien de réservation :

1. Cliquez sur **Liens de réservation** dans la barre latérale.
2. Cliquez sur **Nouveau lien de réservation**, définissez un titre et une durée.
3. Partagez le URL public : les visiteurs choisissent parmi vos emplacements disponibles.

Ou demandez simplement à l'agent : "Créez un lien de réservation d'introduction de 15 minutes avec un champ de nom."

### Invites utiles

- "Qu'y a-t-il sur mon agenda aujourd'hui ?"
- "Suis-je libre jeudi après-midi pendant 30 minutes ?"
- "Trouvez un créneau d'une heure la semaine prochaine et inscrivez-y "Planification avec Alex"."
- "Reprogrammer cet événement au vendredi à 14h." (lorsqu'un événement est sélectionné)
- "Passer à l'affichage quotidien et passer au lundi suivant."
- "Créez un lien de réservation appelé "Intro de 15 min" à 15 minutes avec un champ de note."
- "Suspendre mon lien de réservation 'Démo de 30 minutes'."
- "Bloquer les vendredis après-midi selon mes disponibilités."
- "Quelles réunions ai-je à propos du "lancement" ce mois-ci ?"

L'agent interrogera Google Calendar en direct pour toute question de planning ; il ne devine jamais.

## Pour les développeurs

Le reste de ce document s'adresse à toute personne qui crée le modèle de calendrier ou l'étend.

### Démarrage rapide

Créez un nouvel espace de travail avec le modèle de calendrier :

```bash
npx @agent-native/core@latest create my-app --standalone --template calendar
cd my-app
pnpm install
pnpm dev
```

Ouvrez `http://localhost:8082` (le port de développement du calendrier par défaut).

Pour connecter Google Calendar en développement, ouvrez la vue Paramètres, collez un `GOOGLE_CLIENT_ID` et un `GOOGLE_CLIENT_SECRET` à partir de [Google Cloud Console](https://console.cloud.google.com/), puis cliquez sur « Connecter Google Calendar ». La redirection OAuth URI est `http://localhost:8082/_agent-native/google/callback` en développement. Les jetons sont stockés dans la table `oauth_tokens` SQL et s'actualisent automatiquement.

### Fonctionnalités clés

**Vues du calendrier en direct.** Les vues du jour, de la semaine et du mois sont lues directement à partir des comptes Google connectés, avec des flux ICS en lecture seule facultatifs superposés dans le même calendrier.

**Disponibilité et recherche d'emplacements libres.** Les règles de disponibilité hebdomadaires, la prise en charge des fuseaux horaires et les événements existants alimentent tous la même action de disponibilité utilisée par le UI et l'agent.

**Liens de réservation.** Les pages publiques `/book/{slug}` collectent le nom, l'adresse e-mail, les champs personnalisés, les préférences de conférence et les jetons d'annulation/reprogrammation.

**Gestion partageable.** Les liens de réservation sont privés par défaut, mais peuvent être partagés avec des coéquipiers via le framework de partage actions.

**Aperçus d'événements en ligne.** L'agent peut intégrer des cartes d'événements compactes dans le chat avec le titre, l'heure, le lieu, les participants et un bouton de retour en arrière.

### Travailler avec l'agent

L'agent voit ce que vous regardez. La vue actuelle du calendrier, la date sélectionnée et l'événement sélectionné sont inclus dans chaque message sous forme de bloc `current-screen`, vous pouvez donc dire « cet événement » ou « ce jour » et cela se résoudra correctement.

Sous le capot, l'agent appelle actions comme `list-events`, `check-availability`, `create-event`, `navigate` et `update-availability`. Étant donné que les événements se trouvent dans Google Calendar, l'agent interroge toujours le API au lieu de deviner : il ne renverra pas de résultats vides sans exécuter au préalable un script.

### Modèle de données

Défini dans `templates/calendar/server/db/schema.ts`. Seules les données non événementielles sont stockées localement :

- `bookings` : rendez-vous confirmés à partir des pages de réservation publiques. Stocke le nom, l'e-mail, le début, la fin, le slug, les notes facultatives, les réponses aux champs personnalisés, le lien de réunion, un `cancelToken` pour le public, gérer URL et un statut `confirmed` ou `cancelled`.
- `booking_links` — les définitions de liens de style Calendly. Slug, titre, description, `duration` principal, liste `durations` facultative, `customFields`, `conferencing`, `color` et un indicateur `isActive`. Utilise le `ownableColumns` du framework pour que le système de partage s'applique.
- `booking_slug_redirects` : mémorise les anciens slugs lorsqu'un lien est renommé afin que les URL publics existants continuent de fonctionner.
- `booking_link_shares` – partager les subventions pour les liens de réservation.

```an-schema title="Modèle de données Calendar" summary="Seules les données non événementielles sont stockées localement — les événements vivent dans Google Calendar. Les liens de réservation utilisent ownableColumns donc le système de partage s'applique."
{
  "entities": [
    {
      "id": "booking_links",
      "name": "booking_links",
      "note": "Calendly-style link definitions (ownable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "note": "public page at /book/{slug}" },
        { "name": "title", "type": "string" },
        { "name": "description", "type": "string", "nullable": true },
        { "name": "duration", "type": "int", "note": "primary duration in minutes" },
        { "name": "durations", "type": "json", "nullable": true, "note": "alternative durations" },
        { "name": "customFields", "type": "json", "nullable": true },
        { "name": "conferencing", "type": "string", "note": "Google Meet / Zoom / personnalisé" },
        { "name": "color", "type": "string", "nullable": true },
        { "name": "isActive", "type": "bool", "note": "pause without deleting" }
      ]
    },
    {
      "id": "bookings",
      "name": "bookings",
      "note": "Rendez-vous confirmés à partir des pages de réservation publiques",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "slug", "type": "string", "fk": "booking_links.slug" },
        { "name": "name", "type": "string" },
        { "name": "email", "type": "string" },
        { "name": "start", "type": "datetime" },
        { "name": "end", "type": "datetime" },
        { "name": "notes", "type": "string", "nullable": true },
        { "name": "customFields", "type": "json", "nullable": true, "note": "custom field responses" },
        { "name": "meetingLink", "type": "string", "nullable": true },
        { "name": "cancelToken", "type": "string", "note": "powers /booking/manage/{token}" },
        { "name": "status", "type": "enum", "note": "confirmé | annulé" }
      ]
    },
    {
      "id": "booking_slug_redirects",
      "name": "booking_slug_redirects",
      "note": "Maintient l'ancien public URLs fonctionnel après qu'un lien soit renommé",
      "fields": [
        { "name": "oldSlug", "type": "string", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" }
      ]
    },
    {
      "id": "booking_link_shares",
      "name": "booking_link_shares",
      "note": "Partager les subventions pour les liens de réservation",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "linkId", "type": "id", "fk": "booking_links.id" },
        { "name": "principal", "type": "string", "note": "user or org" },
        { "name": "role", "type": "enum", "note": "spectateur | éditeur | administrateur" }
      ]
    }
  ],
  "relations": [
    { "from": "booking_links", "to": "bookings", "kind": "1-n", "label": "has bookings" },
    { "from": "booking_links", "to": "booking_slug_redirects", "kind": "1-n", "label": "has old slugs" },
    { "from": "booking_links", "to": "booking_link_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

Les règles de disponibilité et la configuration par utilisateur se trouvent dans le tableau des paramètres, saisis par `calendar-availability`. Les jetons Google OAuth résident dans la table framework `oauth_tokens`. L'état éphémère UI (vue actuelle, date, événement sélectionné) réside dans `application_state` sous la clé `navigation`.

### Le personnaliser

Chaque partie de l'application est une source modifiable. Commencez ici :

- `templates/calendar/actions/` : chaque opération appelable par un agent. Ajoutez un nouveau fichier avec `defineAction` pour exposer de nouvelles fonctionnalités à la fois à l'agent et au frontend. Fichiers clés : `check-availability.ts`, `create-event.ts`, `list-events.ts`, `create-booking-link.ts`, `update-availability.ts`, `add-external-calendar.ts`, `navigate.ts`, `view-screen.ts`.
- `templates/calendar/app/routes/` — le UI. `_app._index.tsx` est le calendrier, `_app.availability.tsx` est l'éditeur de planning, `_app.booking-links._index.tsx` et `_app.booking-links.$id.tsx` gèrent les liens de réservation, `_app.bookings.tsx` répertorie les réservations, `_app.settings.tsx` est les paramètres et `book.$slug.tsx` plus `meet.$username.$slug.tsx` sont les pages de réservation publiques.
- `templates/calendar/server/db/schema.ts` — ajoutez des colonnes ou des tableaux avec Drizzle. Gardez le code indépendant du dialecte afin que le modèle s'exécute sur SQLite, Postgres, Turso, D1 et Neon.
- `templates/calendar/AGENTS.md` — instructions pour les agents. Mettez-le à jour lorsque vous enseignez à l'agent de nouvelles capacités ou conventions.
- `templates/calendar/.agents/skills/` : modèles détaillés suivis par l'agent. skills concerné : `event-management`, `availability-booking`, `real-time-sync`, `storing-data`, `delegate-to-agent`, `frontend-design`.
- `templates/calendar/shared/api.ts` — les types TypeScript partagés (`AvailabilityConfig`, `BookingLink`, `ExternalCalendar`, etc.) utilisés à la fois par le serveur et le client.

Si vous ajoutez une fonctionnalité, n'oubliez pas de mettre à jour les quatre zones : UI, action, compétence ou entrée AGENTS.md, ainsi que tout état d'application que l'agent doit voir. C'est ce qui maintient l'agent et le UI à parité.
