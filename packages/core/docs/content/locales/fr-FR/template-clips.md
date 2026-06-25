---
title: "Extraits"
description: "Enregistrement d'écran asynchrone, notes de réunion synchronisées avec le calendrier et dictée vocale Push-to-talk : collez les liens Clips dans les agents et ils pourront lire les transcriptions, les visuels et les résumés."
search: "Clips journaux du navigateur journaux du développeur journaux de la console journaux réseau récupérer XHR application de bureau enregistreur de diagnostics de l'extension Chrome"
---

# Extraits

Une application permettant de tout capturer : enregistrements d'écran, notes de réunion de votre calendrier et dictée vocale en mode Fn. L'agent transcrit, titre, résume et indexe le tout, puis vous permet de demander « trouver le clip dans lequel nous avons discuté du plan de déploiement » et de rechercher dans chaque transcription que vous avez réalisée.

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>Clips d’ingénierie</h1><span class='wf-pill accent'>Library</span><span class='wf-pill'>Meetings</span><span class='wf-pill'>Dictation</span><div style='flex:1'></div><button>Import</button><button class='primary'>Record</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Revue des OKR</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Parcours d’intégration</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Reproduction de bug</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>Lisible par les agents</span><span>Transcription + images prêtes pour les liens de partage</span><div style='flex:1'></div><button>Partager</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>Recherche de transcription</strong><div class='wf-box'>Chapitre trouvé 03:12 · risques de déploiement et relais propriétaire</div><div class='wf-box'>Résumé de réunion et actions</div></div></div>"
}
```

Pensez à l'exemple de Loom + Granola + Wispr Flow regroupés dans une seule application - mais l'agent est un éditeur de premier ordre sur toutes les surfaces, et les enregistrements, les réunions et les dictées vous appartiennent, et non celles d'un fournisseur SaaS. Clips rend également les enregistrements partagés lisibles par l'agent : collez un lien de partage Clips normal dans un agent et celui-ci peut "entendre" la transcription sous forme de texte et "voir" les images d'écran horodatées sous forme d'images - aucune vidéo brute n'est nécessaire. La visualisation des images fonctionne dans n'importe quel agent compatible avec les images (ChatGPT, code Claude, curseur, Codex) ; Les discussions Web en texte uniquement reçoivent toujours la transcription complète et peuvent prendre une image que vous téléchargez.

```an-diagram title="Capturer, transcrire, réutiliser" summary="Trois types de capture atterrissent dans une seule bibliothèque ; l'agent transcrit, titre et résume, puis chaque transcription est consultable et partageable."
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">Enregistrement d’écran</div><div class=\"diagram-node\">Réunion calendrier</div><div class=\"diagram-node\">Dictée en maintenant Fn</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Une bibliothèque<br><small class=\"diagram-muted\">recordings + transcripts (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">titre · résumé · chapitres</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">Rechercher</div><div class=\"diagram-pill\">Partager</div><div class=\"diagram-pill\">Lisible par les agents links</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## Ce que vous pouvez en faire

- **Enregistrez votre écran** avec un enregistreur intégré, une superposition de webcam, une capture audio et une pause/recadrage.
- **Capturez des réunions à partir de votre calendrier.** Connectez Google Calendar, consultez les réunions à venir dans la barre latérale et cliquez sur Enregistrer sur l'une d'entre elles. Vous obtenez une transcription en direct ainsi qu'un résumé de l'IA, des notes à puces et des éléments d'action dès la fin.
- **Dictée Push-to-talk.** Maintenez Fn sur votre appareil, parlez et le texte nettoyé apparaît dans l'application que vous utilisez. Chaque dictée est conservée dans un historique consultable avec les originaux et les versions nettoyées par l'IA côte à côte.
- **Obtenez un titre, un résumé et des marqueurs de chapitre générés automatiquement** pour chaque enregistrement : l'agent les remplit et les tient à jour.
- **Recherchez dans chaque transcription** : enregistrements d'écran, réunions et dictées dans une seule bibliothèque. "Trouvez le clip dans lequel nous avons discuté du plan de déploiement."
- **Partagez des clips** avec des autorisations par clip (publiques, d'équipe, privées). Le suivi des liens et les commentaires en fil de discussion fonctionnent également.
- **Prévisualisez les clips publics dans Slack** avec un déroulement jouable de style Loom après le
  workspace installe votre application Clips Slack.
- **Capturez les journaux du navigateur avec l'extension Chrome.** Les enregistrements du navigateur peuvent
  joindre les journaux de console expurgés et récupérer les métadonnées/XHR, ce qui est utile pour
  bogues de produits et repros uniquement sur navigateur.
- **Coller les liens des clips dans les agents** afin qu'ils puissent découvrir le contexte lisible par l'agent : métadonnées, segments de transcription, images recommandées et images d'images horodatées sans recevoir le fichier vidéo brut.
- **Vues de la bibliothèque intelligente.** Regrouper par projet, filtrer par enceinte, marquage automatique en fonction du contenu.
- **Modifiez la transcription via le chat.** "Corrigez le mot mal transcrit à 1:42." "Tirez trois citations pour un article de blog." L'agent modifie la transcription et les mises à jour UI en direct.

## Journaux du navigateur et diagnostics du développeur

Utilisez l'extension Clips Chrome lorsque vous avez besoin d'un enregistrement et des journaux du navigateur
l'onglet que vous déboguez. L'extension démarre un enregistrement à onglet actif et peut
enregistrer les journaux de console expurgés, les exceptions JavaScript et récupérer/réseau XHR
métadonnées telles que la méthode, le URL expurgé, le statut, la durée et le texte d'échec. Il
n'enregistre pas les corps de requête, les corps de réponse ou les en-têtes.

La page standard de l'enregistreur du navigateur peut enregistrer les diagnostics de la page de l'enregistreur
lui-même. L'extension Chrome est le chemin d'accès aux journaux des développeurs à onglet actif et
reproductions uniquement sur navigateur. Dans les clips UI, utilisez l'option Chrome pour les journaux du navigateur et
l'application de bureau pour le chemin de capture quotidien le plus fluide.

La liste des extensions Chrome Agent-Native Clips est
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
Si vous hébergez votre propre serveur Clips, laissez l'option d'extension Chrome masquée jusqu'à
votre fiche Web Store est en ligne. Définir `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`
après approbation pour afficher l'extension à côté des invites de téléchargement de l'application de bureau. Définir
`VITE_CLIPS_CHROME_EXTENSION_URL` uniquement si vous devez remplacer la valeur par défaut
liste URL.

## Clips lisibles par l'agent

Collez un lien de partage Clips public normal dans un agent. La page de partage fait de la publicité
un contexte d'agent compact URL, et ce contexte pointe vers la transcription et le cadre
API, afin que les modèles qui n'acceptent que du texte ou des images fixes puissent toujours comprendre ce qu'il s'agit
ce qui s'est passé dans l'enregistrement.

Tout agent pouvant récupérer une image URL dans sa vision — ChatGPT, Code Claude,
Agents connectés au curseur, à Codex et à MCP : lit la transcription et voit le
images. Quelques discussions Web en texte uniquement lisent la transcription mais n'extraient pas d'images encadrées
de leur propre chef ; là-bas, téléchargez une image clé ou ouvrez le clip dans un fichier compatible avec les images
agent.

| Point de terminaison                              | Ce que les agents obtiennent                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | Métadonnées du clip, statut de la transcription, chapitres, CTA, cadres recommandés et liens vers les API de la transcription/du cadre |
| `/api/agent-transcript.json?id=<recordingId>`     | Segments de transcription horodatés avec `startMs`, `endMs`, horodatages lisibles, texte et étiquettes de source facultatives          |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | Une image JPEG extraite de la vidéo avec un horodatage de la vidéo d'origine                                                           |

Les points de terminaison suivent les mêmes règles de public/mot de passe/expiration que la page de partage.
Les clips protégés par mot de passe nécessitent le mot de passe une seule fois ; les réponses positives reviennent
Liens tokenisés de courte durée afin que les agents en aval n'aient pas besoin du texte brut
mot de passe.

Les aperçus Slack utilisent la même limite de partage. Le webhook `/api/slack/unfurl`
renvoie uniquement un bloc Slack `video` lisible pour les clips publics prêts sans
mot de passe, expiration, marqueur d'archive ou marqueur de corbeille. D'autres clips reçoivent toujours le
métadonnées normales du titre/vignette de la page de partage et nécessitant l'ouverture de clips.

```an-api title="Point d'entrée du contexte de l'agent"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "Description compacte et lisible par l'agent d'un clip partagé",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="Transcription horodatée"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "Transcription horodatée segments for a shared clip",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="Image à un horodatage"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "Une image JPEG extraite de la vidéo avec un horodatage de la vidéo originale",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## Démarrer

Démo en direct : [clips.agent-native.com](https://clips.agent-native.com).

1. **Ouvrir la bibliothèque.** Parcourez les enregistrements d'écran, les enregistrements de réunions, les dictées,
   dossiers et espaces à partir d'un seul endroit.
2. **Enregistrer ou importer.** Capturer un enregistrement d'écran, démarrer à partir d'un calendrier
   réunion, ou utilisez la dictée push-to-talk.
3. **Laissez l'agent nettoyer.** Générez un titre, un résumé, des chapitres, une action
   éléments ou texte de transcription nettoyé.
4. **Recherchez et réutilisez.** Demandez le clip, la citation, l'action ou la décision que vous avez prise
   besoin, puis partagez le résultat avec la bonne visibilité.

### Invites utiles

- "Résumez ce clip pour une mise à jour du produit."
- "Trouvez la réunion au cours de laquelle nous avons discuté du plan de déploiement."
- "Extrayez trois devis de clients de cette transcription."
- "Créer des éléments d'action à partir du dernier appel commercial."
- "Nettoyez cette dictée et transformez-la en ticket Linear."

## Pour les développeurs

Le reste de ce document s'adresse à toute personne qui crée le modèle Clips ou l'étend.

### Démarrage rapide

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips est un modèle plus grand avec un enregistreur natif (il est livré avec un compagnon de bureau pour la capture locale). Trois étapes de configuration sont nécessaires avant que les enregistrements puissent être téléchargés :

1. **Stockage vidéo (obligatoire).** Connectez un backend de stockage via l'assistant d'intégration. Le chemin le plus simple est Builder.io (gratuit pendant la version bêta, en un clic). Pour le stockage auto-hébergé, définissez `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` et éventuellement `S3_REGION` et `S3_PUBLIC_BASE_URL`. Cloudflare R2 et DigitalOcean Spaces utilisent les mêmes variables d'environnement avec le préfixe `R2_*`.
2. **Google Calendar (facultatif).** Pour synchroniser les réunions à venir, connectez un compte Google Calendar depuis Paramètres. Le rappel OAuth URL en développement est `http://localhost:8094/_agent-native/google/callback`. Configurez un client Google OAuth dans [Google Cloud Console](https://console.cloud.google.com/) avec les Gmail et Google Calendar API activés.
3. **Autorisations de capture d'écran.** Sur macOS, accordez l'autorisation d'enregistrement d'écran au navigateur (ou à l'application compagnon de bureau) dans Paramètres système → Confidentialité et sécurité → Enregistrement d'écran. Les enregistrements du navigateur peuvent enregistrer la console expurgée et récupérer les diagnostics/XHR à partir de la page de l'enregistreur. Une fois la liste des extensions Chrome disponible, activez `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` afin que les utilisateurs puissent choisir l'extension pour les journaux du navigateur à onglets actifs ou l'application de bureau pour le chemin de capture natif le plus fluide.
4. **Aperçus Slack (facultatif).** Créez une application Slack avec `links:read`, `links:write` et `links.embed:write` ; abonnez-vous à `link_shared` ; ajoutez votre domaine de partage Clips sous **App Unfurl Domains** ; définir la demande URL sur `https://your-clips.example.com/api/slack/unfurl` ; et ajoutez la redirection OAuth URL `https://your-clips.example.com/api/slack/oauth/callback`. Configurez `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` et `SLACK_SIGNING_SECRET`, puis connectez les espaces de travail à partir des paramètres de clips.

### Hébergez votre propre serveur Clips

L'application Clips hébergée sur [clips.agent-native.com](https://clips.agent-native.com)
est simplement une copie déployée du modèle Clips. Pour exécuter votre propre serveur, échafaudez
le modèle, déployez-le comme n'importe quelle autre application native d'agent, puis pointez le bureau
application de barre d'état lors de votre déploiement.

1. **Créez l'application.**

   ```bash
   npx @agent-native/core@latest créer mes-clips --standalone --template clips
   cd mes-clips
   Installation de pnpm
   ```

2. **Configurer l'état de production.** Définir un `DATABASE_URL` persistant, le normal
   variables d'authentification/secrets de production de [Deployment](/docs/deployment) et un
   fournisseur de stockage vidéo. Builder.io Connect est le chemin de stockage le plus simple ; pour
   stockage auto-hébergé, utilisez les variables `S3_*` ou `R2_*` pour un stockage compatible S3
   seau.

3. **Déployez l'application Web.** Pour un déploiement de nœud simple :

   ```bash
   Construction pnpm
   noeud .output/server/index.mjs
   ```

   Vous pouvez également utiliser n'importe quelle cible Nitro de [Deployment](/docs/deployment), telle que
   comme Netlify, Vercel, Cloudflare Pages, AWS Lambda ou Deno Deploy. Assurez-vous
   `BETTER_AUTH_URL` est l'origine publique des clips, par exemple
   `https://clips.example.com`.

4. **Connectez l'application de la barre d'état du bureau.** Ouvrez les paramètres de Clips Desktop et définissez
   **Clips le serveur URL** à la base publique URL de votre déploiement, par exemple
   `https://clips.example.com`. Si l'application est montée sous un chemin d'espace de travail,
   incluez ce chemin, tel que `https://example.com/clips`. Cliquez sur **Connecter**,
   puis connectez-vous avec un compte sur ce serveur Clips.

5. **Activez l'extension Chrome après la publication.** Conserver
   `VITE_CLIPS_CHROME_EXTENSION_ENABLED` désactivé jusqu'à la liste du Chrome Web Store
   est approuvé. Ensuite, définissez-le sur `1` pour révéler l'option de journal du navigateur à côté du
   invites de l'application de bureau. La liste par défaut URL est
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   définissez `VITE_CLIPS_CHROME_EXTENSION_URL` uniquement si votre déploiement utilise un
   liste d'extensions différentes.

6. **Connectez les intégrations facultatives.** Google Calendar alimente l'onglet Réunions,
   `GEMINI_API_KEY` ou Builder.io Connect permet le nettoyage des transcriptions et des titres,
   Le `GROQ_API_KEY` peut fournir une conversion parole-texte, et le Slack OAuth
   la connexion dans les paramètres permet le déploiement jouable de Slack.

Pour le développement local, exécutez l'application Web avec `pnpm dev` et pointez le bureau
Application de barre d'état sur `http://localhost:8094`.

### Fonctionnalités clés

**Une bibliothèque, trois types de capture.** Les enregistrements d'écran, les réunions du calendrier et les dictées Push-to-Talk partagent une bibliothèque consultable.

**Transcription et pipeline IA.** Les enregistrements obtiennent des segments de transcription horodatés, des titres générés, des résumés et des marqueurs de chapitre.

**Édition non destructive.** Le découpage, le fractionnement, la suppression des mots de remplissage, la suppression des silences et l'assemblage restent dans `edits_json` afin que le support d'origine reste intact.

**Liens de partage lisibles par l'agent.** Les liens de partage publics exposent les transcriptions et les trames API afin que les agents puissent comprendre les enregistrements sans ingérer de vidéo brute.

**Le jouable Slack se déploie.** Les liens de partage publics peuvent restituer un bloc Slack `video`
qui pointe vers le lecteur `/embed/:id` existant. Ceci est une application d'espace de travail Slack
installation, pas un comportement global du robot : les métadonnées normales d'Open Graph/Twitter sont
la solution de secours lorsque l'application n'est pas installée.

### Modèle de données

Toutes les données résident dans SQL avec Drizzle ORM. Schéma : `templates/clips/server/db/schema.ts`. Les enregistrements, les réunions, les dictées, les comptes de calendrier et le vocabulaire portent tous la norme `ownableColumns` et disposent d'un tableau de partage de cadre correspondant, de sorte qu'ils s'intègrent dans le modèle de partage par utilisateur/par organisation.

```an-schema title="Modèle de données de base Clips" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "Modifications non destructives" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "Confidentialité : mot de passe / expiration" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "Divisez pour que les vues de la bibliothèque et des transcriptions s'affichent rapidement",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "Brut" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "maintien de Fn, etc." },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| Tableau                                         | Ce qu'il contient                                                                                                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | La ressource principale : titre, vidéo URL/format/taille, durée, miniatures, statut, `edits_json` non destructifs, `chapters_json`, confidentialité (mot de passe, expiration) et bascules du lecteur       |
| `recording_transcripts`                         | Transcription par enregistrement : `segments_json` (`{startMs,endMs,text}`), `full_text`, langue et statut                                                                                                  |
| `recording_tags`                                | Balises de forme libre sur un enregistrement                                                                                                                                                                |
| `recording_ctas`                                | Boutons d'appel à l'action (libellé, URL, couleur, emplacement) superposés sur un enregistrement                                                                                                            |
| `recording_comments`                            | Commentaires filés et horodatés avec carte de réaction emoji et indicateur résolu                                                                                                                           |
| `recording_reactions`                           | Emoji reactions épinglé sur un horodatage vidéo (les spectateurs anonymes sont autorisés)                                                                                                                   |
| `recording_viewers` / `recording_events`        | Afficher les analyses : durée et fin de visionnage par téléspectateur, ainsi que des événements granulaires (début de visualisation, progression de la visualisation, recherche, pause, cta-clic, réaction) |
| `clips_meetings`                                | Réunions basées sur un calendrier ou ponctuelles : durées planifiées/réelles, plate-forme, notes d'utilisateur, IA `summary_md`, `bullets_json`, `action_items_json` et lien vers son `recording_id`        |
| `meeting_participants` / `meeting_action_items` | Participants et éléments d'action extraits pour une réunion                                                                                                                                                 |
| `calendar_accounts` / `calendar_events`         | Comptes de calendrier connectés (les jetons OAuth sont présents dans `app_secrets`, référencés uniquement ici) et instantanés d'événements synchronisés                                                     |
| `clips_dictations`                              | Historique des dictées Push-to-talk : `full_text` brut, `cleaned_text` en option, source (`fn-hold`, etc.) et application cible                                                                             |
| `clips_vocabulary`                              | Corrections de vocabulaire personnel (terme → remplacement préféré) qui biaisent les futures dictées                                                                                                        |
| `spaces` / `space_members` / `folders`          | Organisation de la bibliothèque : espaces (conteneurs thématiques), leurs membres et dossiers emboîtables                                                                                                   |
| `organization_settings`                         | Sidecar Clips par organisation : couleur de la marque, logo, visibilité par défaut                                                                                                                          |

Les enregistrements et les transcriptions sont intentionnellement des tableaux séparés afin que les vues de la bibliothèque et des transcriptions puissent chacune s'afficher rapidement. Les réunions sont composées à partir d'enregistrements plutôt que de duplication de médias : une réunion est propriétaire de l'enregistrement qu'elle capture, mais la ligne `recordings` reste la source de vérité pour la vidéo et la transcription par segment.

Les itinéraires du UI sont en direct sous `templates/clips/app/routes/` : l'application authentifiée se trouve sous `_app.*` (bibliothèque, espaces, dossiers, réunions, dicté, informations, corbeille, paramètres), avec des surfaces publiques sous `r.$recordingId`, `share.$shareId`, `embed.$shareId` et `invite.$token`.

### Clé actions

Chaque opération appelable par un agent est un fichier TypeScript dans `templates/clips/actions/`, monté automatiquement sur `POST /_agent-native/actions/:name` et exécutable à partir du CLI en tant que `pnpm action <name>`. Il y a environ 80 actions ; les regroupements utiles :

- **Cycle de vie de l'enregistrement** — `create-recording`, `finalize-recording`, `update-recording`, `set-thumbnail`, `archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`, `move-recording`, `tag-recording`.
- **Transcription et IA** — `request-transcript`, `cleanup-transcript`, `regenerate-title` / `regenerate-summary` / `regenerate-chapters`, `set-chapters`, `generate-workflow`. (`cleanup-transcript` et `finalize-meeting` sont des appels de pipeline multimédia côté serveur ; la plupart des autres fonctionnalités d'IA délèguent au chat de l'agent.)
- **Édition** – non destructives `trim-recording`, `split-recording`, `remove-filler-words`, `remove-silences`, plus `stitch-recordings`, `undo-edit`, `clear-edits`. Les modifications s'accumulent dans `edits_json` ; le client concatène/exporte via ffmpeg.wasm.
- **Réunions** — `create-meeting`, `start-meeting-recording` / `stop-meeting-recording`, `finalize-meeting`, `update-meeting`, `get-meeting`, `list-meetings`, plus câblage de calendrier `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **Dictée** – `create-dictation`, `cleanup-dictation`, `update-dictation`, `list-dictations` et `add-vocabulary-term` / `list-vocabulary` pour une optimisation du vocabulaire personnel.
- **Organisation de la bibliothèque** — `create-space` / `rename-space` / `delete-space`, `add-space-member` / `remove-space-member`, `create-folder` / `rename-folder` / `delete-folder`, `add-recording-to-space`.
- **Partage, commentaires et engagement** — partage du cadre actions plus `create-cta` / `update-cta` / `delete-cta`, `add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`, `react-to-recording`, `list-viewers`.
- **Organisations et membres** — `create-organization`, `set-organization-branding`, `invite-member` / `accept-invite` / `decline-invite` / `get-invite`, `remove-member`, `update-member-role`, `list-organization-state`, `list-notifications`.
- **Recherche, informations et exportation** – `search-recordings` (correspond aux titres, descriptions, textes de transcription et commentaires, avec horodatages), `get-recording-insights`, `get-organization-insights`, `export-insights-csv`, `export-to-brain`.
- **Contexte et navigation** — `view-screen` (clip actuel, tête de lecture, plage de transcription sélectionnée) et `navigate` ; `refresh-list` après mutations.

### Le personnaliser

Clips est un modèle complet et clonable : créez-le et demandez à l'agent de l'étendre. Quelques exemples :

- "Ajoutez un bouton de suppression des mots de remplissage qui supprime les euh et les euh de la transcription et recoud la vidéo."
- "Publiez automatiquement mes notes de stand-up sur Slack #eng chaque fois qu'une réunion se termine." (Connectez d'abord Slack via [Messaging](/docs/messaging).)
- "Ajoutez un raccourci clavier qui dépose la dernière dictée dans Linear en tant que nouveau ticket."
- "Regroupez la bibliothèque par projet — détectez le projet à partir des premiers mots de chaque transcription."
- "Ajoutez un bouton "Générer un article de blog à partir de ce clip" qui rédige un article à partir de la transcription et l'enregistre en tant que brouillon."
- "Autoriser les spectateurs à laisser reactions horodaté sur un clip partagé."

L'agent modifie les routes, les composants, le pipeline de transcription et le schéma selon les besoins. Consultez [Templates](/docs/cloneable-saas) pour le clonage complet, la personnalisation, le flux de déploiement et [Getting Started](/docs/getting-started) s'il s'agit de votre premier modèle natif d'agent.

## Quelle est la prochaine étape

- [**Templates**](/docs/cloneable-saas) — le modèle cloner et posséder
- [**Context Awareness**](/docs/context-awareness) : comment l'agent connaît le clip et la tête de lecture actuels
- [**Agent Teams**](/docs/agent-teams) – déléguer le nettoyage des transcriptions à un sous-agent spécialisé
