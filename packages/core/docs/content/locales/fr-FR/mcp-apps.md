---
title: "Applications MCP"
description: "Créez et intégrez des applications interactives MCP UI dans Claude, ChatGPT et d'autres hôtes compatibles, en utilisant de véritables routes d'application, le pont d'intégration et le pont hôte API."
---

# Applications MCP

**Cette page : les UI en ligne dans Claude/ChatGPT.** Création des ressources de l'application MCP et du pont intégré qui restitue un véritable itinéraire d'application dans le chat d'un hôte compatible. Cette page constitue également la page d'accueil unique de la **matrice de support client** ([below](#client-support)).

| Si vous voulez…                                                                               | Lire                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Connectez un agent/hôte externe à votre application                                           | [External Agents](/docs/external-agents) |
| Donnez plus d'outils à votre agent (consommez d'autres serveurs MCP)                          | [MCP Clients](/docs/mcp-clients)         |
| Créez des UI en ligne qui s'affichent dans Claude/ChatGPT                                     | **Cette page** — Applications MCP        |
| Référence du serveur MCP de niveau inférieur (authentification, outils, montage personnalisé) | [MCP Protocol](/docs/mcp-protocol)       |

Les applications MCP sont l'extension officielle `io.modelcontextprotocol/ui` qui permet aux hôtes compatibles (Claude, Claude Desktop, ChatGPT, VS Code GitHub Copilot, Goose, Postman, MCPJam et Cursor) de rendre les UI interactifs en ligne dans le chat. Dans les applications natives d'agent, chaque application MCP est une **véritable route React**, et non un widget distinct HTML.

Dans le chat d'une application Agent-Native, préférez [native chat renderers](/docs/native-chat-ui) pour les widgets propriétaires tels que les tableaux, les graphiques, les résultats saisis et les possibilités d'approbation. Utilisez les applications MCP pour les UI externes/inter-hôtes en ligne dans Claude, ChatGPT, Copilot, Cursor et d'autres hôtes compatibles, avec l'action `link` comme solution de secours universelle pour les liens profonds.

## Création : applications MCP en option UI {#mcp-apps}

Pour les hôtes qui prennent en charge l'extension d'applications MCP, une action peut également annoncer une ressource UI en ligne avec `mcpApp`. Il s'agit d'une amélioration progressive pour les flux dans lesquels l'agent externe doit fournir à l'utilisateur une surface interactive au lieu d'un simple texte – par exemple, consulter un brouillon d'e-mail, modifier une invitation de calendrier ou choisir entre les variantes de tableau de bord générées.

Utilisez la véritable application React avec `embedRoute()` ou `embedApp()` chaque fois que l'utilisateur a besoin de UI. Le modèle mental est simple : la cible `link` de l'action est également la cible intégrée de l'application MCP. Exposez l'opération comme une action/un outil normal, renvoyez un lien profond ciblé avec `link` et ajoutez `mcpApp.resource = embedApp(...)` afin que les hôtes capables chargent cette même route en ligne au lieu d'ouvrir un nouvel onglet. Lorsque les deux doivent être construits à partir du même itinéraire, préférez `embedRoute({ title, openLabel, path })` : c'est le wrapper pratique qui renvoie les champs `link` et `mcpApp` correspondants à partir d'un seul appel, tandis que `embedApp(...)` est la ressource de niveau inférieur que vous attribuez directement à `mcpApp.resource`.

Cela signifie que les intégrations d'applications complètes peuvent faire tout ce que l'itinéraire peut faire une fois ouvertes : réviser ou modifier un brouillon d'e-mail, afficher une boîte de réception/une recherche filtrée, ouvrir un événement de calendrier ou un brouillon d'événement, charger une page d'extension, inspecter un tableau de bord d'analyse complet ou une analyse enregistrée, continuer une présentation dans l'éditeur de diapositives ou ouvrir un projet/éditeur de conception. Préférez les paramètres URL/deep-link et le pont de navigation/état d'application `/_agent-native/open` existant plutôt que d'inventer un deuxième protocole d'état pour les applications MCP.

Dans de rares occasions, la bonne cible est une route d'application ciblée qui restitue un composant React partagé au lieu de l'ensemble du shell de l'application. L'itinéraire `/chart` d'Analytics est le modèle : il prend une charge utile `SqlPanel` compacte dans le URL et restitue le même composant graphique que celui utilisé par le tableau de bord. Il s'agit toujours d'une application intégrée, pas d'une simple application HTML MCP. Exposez-le ou appelez-le via une action normale / `open_app({ path, embed: true })`, gardez le URL déterministe et laissez `embedApp()` restituer cet itinéraire en ligne.

Ne pas écrire à la main des applications HTML MCP uniques pour le produit UI ; si l'action nécessite une surface personnalisée, ajoutez ou réutilisez d'abord un véritable itinéraire/composant d'application et intégrez cet itinéraire.

```an-diagram title="MCP Aller-retour intégré à l'application" summary="La cible du lien de l'action est également la cible de l'intégration. Les hôtes capables chargent la même route d'application signée en ligne ; tout le monde revient au lien profond."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-card\" data-rough><strong>Action</strong><small class=\"diagram-muted\">`link` target = MCP App embed target</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>embedApp()</strong><span class=\"diagram-pill accent\">create_embed_session</span><small class=\"diagram-muted\">mints short-lived embed session</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>/_agent-native/embed/start</strong><small class=\"diagram-muted\">échange un ticket SQL à usage unique</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Signed app route</strong><span class=\"diagram-pill ok\">vraie route React</span><small class=\"diagram-muted\">short-lived browser session</small></div><div class=\"diagram-fallback\"><span class=\"diagram-pill warn\">pas de prise en charge MCP Apps</span><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box\" data-rough>&quot;Open in … &rarr;&quot; deep link</div></div></div>",
"css": ".diagram-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-embed .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;min-width:140px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .diagram-fallback{display:flex;flex-direction:column;align-items:center;gap:6px;margin-inline-start:8px}"
}

```

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

```an-annotated-code title="La configuration des ressources mcpApp"
{
  "filename": "actions/review-draft.ts",
  "language": "ts",
  "code": "import { embedApp } from \"@agent-native/core\";\n\nexport default defineAction({\n  // ...description, schema, run, link...\n  mcpApp: {\n    resource: embedApp({\n      title: \"Review draft\",\n      description: \"Open the generated draft in the real Mail compose UI.\",\n      iframeTitle: \"Agent-Native Mail\",\n      openLabel: \"Open in Mail\",\n    }),\n  },\n});",
  "annotations": [
    { "lines": "6", "label": "Amélioration progressive", "note": "`mcpApp.resource` annonce une interface utilisateur en ligne pour les hôtes prenant en charge l'extension d'applications MCP. Conservez également le générateur `link` de l'action : les hôtes uniquement CLI et les hôtes plus anciens ignorent les métadonnées de l'interface utilisateur et ont toujours besoin du lien profond." },
    { "lines": "7", "label": "Embed = the link target", "note": "`embedApp()` uses the action's `link` as its launch target: it calls `create_embed_session`, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the same signed app route." },
    { "lines": "11", "label": "Étiquette de secours universelle", "note": "`openLabel` is the visible `\"Open in … →\"` text used as the deep-link escape hatch when a host does not render the inline iframe." }
  ]
}
```

Le serveur MCP annonce l'extension `io.modelcontextprotocol/ui`, ajoute `_meta.ui.resourceUri` plus `_meta["ui/resourceUri"]` à `tools/list` et émet également des métadonnées de compatibilité ChatGPT Apps SDK (`openai/outputTemplate`, widget CSP/description/accessibilité). Il expose les HTML à `resources/list`, `resources/templates/list` et `resources/read` en utilisant MIME `text/html;profile=mcp-app`. Le proxy stdio transfère ces gestionnaires de ressources depuis l'application en direct, afin que les clients de bureau et CLI voient les mêmes ressources que les clients HTTP.

Conservez le générateur `link` existant même lors de l'ajout de `mcpApp`. Les clients CLI uniquement, les hôtes plus anciens et tout hôte qui ne restitue pas les applications MCP ignoreront les métadonnées UI et auront toujours besoin du lien `"Open in … →"`. `embedApp()` utilise ce lien comme cible de lancement, appelle l'assistant `create_embed_session` réservé à l'application, échange un ticket SQL unique sur `/_agent-native/embed/start` et navigue dans le cadre de l'application MCP jusqu'à l'itinéraire cible avec une session de navigateur de courte durée plus un support de secours pour les récupérations de même origine. `open_app({ app, path, embed: true })` est la trappe de secours générique pour les itinéraires tels que les tableaux de bord complets, les boîtes de réception filtrées, les brouillons de calendrier, les analyses et les pages d'extension, et doit être utilisé généreusement lorsque l'application complète constitue la surface de révision/modification la plus claire.

`embedApp()` inclut l'origine de la requête MCP dans la ressource CSP afin que le lanceur puisse récupérer et, lorsqu'il est explicitement demandé, encadrer l'itinéraire signé de l'application propriétaire. Dispatch ajoute les origines exactes des applications accordées à sa ressource `open_app` afin qu'un seul connecteur Dispatch puisse intégrer le courrier, le calendrier, les diapositives et le reste sans autoriser chaque origine HTTPS. Transmettez uniquement des domaines de trames ou de ressources supplémentaires pour une application MCP personnalisée qui intègre véritablement un lecteur tiers ou charge des ressources tierces.

À l'intérieur de ces routes `embedApp()`, `sendToAgentChat()` est compatible avec l'intégration. Les invites soumises automatiquement sont transmises à l'hôte MCP en tant que `ui/update-model-context` plus `ui/message`, de sorte qu'un bouton dans l'application intégrée peut intentionnellement poursuivre la conversation Claude/ChatGPT à partir de l'état de l'application sélectionné. Le contexte masqué est envoyé comme contexte de modèle ; le tour visible de l'utilisateur reste simplement l'invite de l'application, ce qui évite un consentement effrayant de l'hôte autour des chemins de fichiers internes de l'état de l'application. `submit: false` reste un comportement de pré-remplissage/révision local.

## Pont d'application MCP de première classe {#mcp-app-bridge}

Les intégrations d'applications MCP sont des intégrations d'itinéraires, et non des mini-produits séparés. `embedApp()` démarre à partir de la cible `link` de l'action, crée une session d'intégration de courte durée et lance cette route d'application signée. Les hôtes de l'application MCP standard peuvent naviguer eux-mêmes dans le cadre de l'application MCP lorsque l'hôte peut hydrater directement l'itinéraire.

```an-diagram title="Deux sentiers de pont hôte, un itinéraire balisé" summary="Claude transplante la voie hydratée et utilise le ui/_bridge direct ; ChatGPT obtient une iframe contrôlée via window.openai et relaie les actions de l'hôte via postMessage. Les deux pointent vers la même route d’application signée."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><strong>Claude web</strong><span class=\"diagram-pill accent\">single-frame transplant</span><small class=\"diagram-muted\">hydrate le HTML signé de l’app dans l’iframe de Claude, puis pont hôte direct `ui/_`</small></div><div class=\"diagram-card\" data-rough><strong>ChatGPT web</strong><span class=\"diagram-pill accent\">controlled route iframe</span><small class=\"diagram-muted\">`window.openai`host APIs ·`agentNative.mcpHost.*` postMessage relay</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Same signed app route<br><small class=\"diagram-muted\">route normale + composants React</small></div></div>",
"css": ".diagram-bridge{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-bridge .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-bridge .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;max-width:300px}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}.diagram-bridge .diagram-box{padding:16px 18px;text-align:center}"
}

```

Le Web Claude utilise un chemin de transplantation à image unique : le document de ressource récupère l'application signée HTML et l'hydrate dans l'iframe de l'application MCP de Claude, car Claude n'autorise pas de manière fiable les iframes enfants appartenant à l'application ou la navigation dans des images externes. Le Web ChatGPT obtient une iframe d'itinéraire contrôlé car son pont d'applications nous offre des hôtes `window.openai` stables API et un contrôle de hauteur limité. Tous les chemins pointent vers la même route d'application signée et restituent la route normale et les composants React. Concevez des itinéraires intégrés afin qu'un rechargement avec le même URL signé reconstruise la même vue.

Pour `open_app({ embed: true })` de la même application, le framework génère le ticket de démarrage d'intégration lors de l'appel de l'outil d'origine et stocke le URL de démarrage signé dans les métadonnées cachées de l'outil. Le actions personnalisé peut renvoyer le `embedStartUrl` pour le même chemin rapide ; la couche MCP supprime le URL porteur du ticket du `structuredContent` visible par le modèle et des métadonnées normales de lien ouvert. Lorsqu’aucun démarrage d’intégration URL n’est présent, la ressource revient à l’assistant `create_embed_session` réservé aux applications. Cela permet aux hôtes de production de restreindre les appels d'outils lancés par iframe sur la route directe sans divulguer les URL de session d'application unique dans la transcription. Si un utilisateur rouvre une ancienne discussion après l'expiration d'un ticket de démarrage unique, la route de démarrage renvoie une petite page d'actualisation et publie `agentNative.embedSessionExpired` dans le wrapper ; `embedApp()` efface le démarrage obsolète URL et crée un nouveau ticket via `create_embed_session` alors qu'il a toujours l'itinéraire d'origine de l'application.

ChatGPT obtient un chemin de compatibilité dédié via `window.openai` : le document de lancement lit directement `toolInput`, `toolOutput` et `toolResponseMetadata`, puis appelle `create_embed_session` via `window.openai.callTool(...)`. Les hôtes d'applications MCP standard utilisent le pont `ui/*` JSON-RPC. Les itinéraires directement hydratés peuvent appeler `ui/update-model-context`, `ui/message`, `ui/open-link` et `ui/request-display-mode` via les assistants de pont hôte. La route transplantée de Claude utilise le même pont hôte direct `ui/*` après hydratation. Lorsque le chemin d'iframe de diagnostic ChatGPT ou explicite est utilisé, le wrapper relaie le même hôte actions sur les requêtes postMessage `agentNative.mcpHost.*`. Gardez la forme du résultat identique pour les deux chemins : renvoyez un `link` ciblé et un contenu structuré concis.

Ne définissez pas le standard `_meta.ui.domain` sur une application URL. MCP Apps traite ce champ comme spécifique à l'hôte : Claude valide les domaines sandbox de style `{hash}.claudemcpcontent.com`, tandis que ChatGPT utilise ses propres métadonnées `openai/widgetDomain`. Omettez `ui.domain` sauf si vous émettez délibérément une valeur spécifique à l'hôte ; l'hôte choisira une origine sandbox par défaut.

Les pages d'extension conservent leur bac à sable dans les intégrations de chat MCP sans naviguer dans une deuxième iframe de route. L'utilisation normale de l'application rend `/_agent-native/extensions/:id/render` sous la forme d'une iframe enfant en bac à sable. En mode pont de discussion MCP, le framework restitue le même document d'extension que le `srcDoc` en bac à sable à l'intérieur de l'iframe de route, évitant ainsi les échecs de l'hôte `frame-ancestors` / `X-Frame-Options` tout en préservant `sandbox="allow-scripts allow-forms"`.

Le shell de ressources possède la taille de l'hôte externe. `embedApp({ height })` est par défaut `560px`, fixe la coque à `320-900px` et réserve `44px` pour la petite barre d'outils, de sorte que la fenêtre d'affichage de l'itinéraire est `height - 44px`. Gardez les itinéraires des applications intégrées défilables en interne et laissez le lanceur signaler la hauteur intrinsèque délimitée plutôt que la hauteur totale du document ; sinon, le redimensionnement automatique de l'hôte peut transformer une page d'application normale en un très grand artefact de discussion. Un shell modifié affecte uniquement les nouvelles ressources de l'application MCP et les nouveaux appels d'outils. Les anciennes trames de conversation ChatGPT/Claude peuvent conserver le comportement précédent des ressources, alors vérifiez le dimensionnement avec un nouveau rendu en ligne avant de juger d'un correctif.

### Modes d'intégration {#embed-modes}

Claude utilise par défaut le chemin de transplantation d'une seule image. Vous pouvez également le forcer sur d'autres hôtes avec `embedMode: "transplant"` ou `frame: "transplant"` lors du débogage du comportement de chargement du module hôte. Vous pouvez forcer l'iframe de diagnostic imbriquée avec `embedMode: "iframe"`, `renderMode: "iframe"`, `nested: true` ou `frame: "iframe"`. Si l'iframe est bloquée, `embedApp()` la remplace par une solution de secours d'application ouverte : l'utilisateur peut réessayer en ligne, ouvrir une session d'intégration fraîchement créée via l'hôte ou utiliser la route visible URL. Gardez la cible `link` de l'action utile seule, car elle reste la trappe de secours universelle.

Lorsque vous testez Claude via ngrok, utilisez une version de production (`npx @agent-native/core@latest build` puis `npx @agent-native/core@latest start`) ou une version d'aperçu/production déployée URL. Le chemin de transplantation à image unique de Claude fonctionne avec des morceaux d'actifs de production ; Les modules de développement bruts Vite tels que `/app/root.tsx` peuvent être protégés par l'authentification de l'application et faire échouer les importations dynamiques à partir de l'origine de la ressource Claude.

## Pont hôte API {#host-bridge}

Le pont hôte est volontairement petit :

| Mode                        | Type de message                       | Utilisez-le pour                                          |
| --------------------------- | ------------------------------------- | --------------------------------------------------------- |
| route hôte directe          | `ui/update-model-context`             | Contexte masqué pour le modèle hôte                       |
| route hôte directe          | `ui/message`                          | Publier un utilisateur visible comme hôte                 |
| route hôte directe          | `ui/open-link`                        | Ouvrez un URL externe ou une application via l'hôte       |
| route hôte directe          | `ui/request-display-mode`             | Demander `inline`, `fullscreen` ou `pip`                  |
| Greffe Claude               | `ui/*`                                | Même pont hôte direct après hydratation                   |
| ChatGPT / itinéraire iframe | `agentNative.mcpHostContext`          | Thème, paramètres régionaux, plate-forme hôte, dimensions |
| ChatGPT / itinéraire iframe | `agentNative.embeddedAppReady`        | Confirmez l'iframe de route chargée                       |
| ChatGPT / itinéraire iframe | `agentNative.mcpHost.*` / `.response` | Relais wrapper pour les requêtes d'hôte                   |

Les itinéraires intégrés peuvent utiliser `updateMcpAppModelContext()`, `openMcpAppHostLink()`, `requestMcpAppDisplayMode()`, `getMcpAppHostContext()` et `useMcpAppHostContext()` à partir de `@agent-native/core/client`. `sendToAgentChat()` utilise le même chemin d'accès à partir des intégrations d'applications complètes pour les invites soumises automatiquement.

Le mode d'affichage est le meilleur effort. Le `McpAppRenderer` intégré à l'application signale actuellement un contexte d'hébergement Web en ligne et un mode d'affichage en ligne uniquement ; les hôtes externes peuvent honorer des demandes d'affichage plus importantes, les ignorer ou répondre avec une erreur de mode non pris en charge. Gardez toujours l'itinéraire en ligne utilisable.

## Support client et mise en cache {#client-support}

La liste officielle actuelle des clients des applications MCP comprend Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT et Cursor ; la prise en charge de l'hôte varie toujours selon le plan, le canal de publication et la version du client, alors vérifiez le [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). Les applications MCP personnalisées ChatGPT sont disponibles via le mode développeur pour les espaces de travail Business et Enterprise/Edu sur le Web ChatGPT ; voir les notes [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) de OpenAI.

Claude Code, Codex et les autres clients CLI/éditeur de code reçoivent toujours les mêmes ressources et métadonnées lorsqu'ils prennent en charge les applications MCP, mais les traitent comme des hôtes de liaison, sauf si vous avez vérifié le rendu iframe en ligne dans cette surface exacte. Le lien profond reste la solution de secours fiable lorsqu'un hôte choisit de ne pas restituer une iframe. En pratique, chaque application native d'agent doit être créée avec les deux : applications MCP pour la révision/modification en ligne sur des hôtes compatibles, et `link` pour un aller-retour universel vers l'application complète.

Claude et ChatGPT peuvent mettre en cache les métadonnées des outils et des ressources pour un connecteur personnalisé existant. Après avoir modifié les métadonnées de l'application MCP, vérifiez avec un nouvel appel d'outil ; si l'hôte utilise toujours l'ancien descripteur, reconnectez le connecteur Claude ou analysez/vérifiez à nouveau le connecteur ChatGPT afin qu'il actualise le catalogue. Si Claude enregistre un avertissement concernant `_meta.ui.csp` ou `_meta.ui.permissions` vivant sur le descripteur d'outil après un déploiement, ce connecteur utilise des métadonnées obsolètes : supprimez/reconnectez le connecteur Claude et démarrez une nouvelle discussion.

## Tests {#testing}

Testez les applications MCP avec les appareils légers autour de `embedApp()` et `McpAppRenderer` ; ils couvrent CSP, le contexte de l'hôte, le lancement de l'application et le comportement des messages de pont sans avoir besoin d'un véritable hôte externe. Lors de la validation du Web ChatGPT ou Claude, déclenchez un nouvel appel d'outil après les modifications du shell et mesurez l'iframe visible. Les images précédemment rendues dans la même conversation peuvent toujours afficher la hauteur en cache ou le comportement de lancement.

## Connexe {#related}

- [External Agents](/docs/external-agents) : connexion de Claude, ChatGPT, Codex et Cursor aux applications hébergées ; Matrice de compatibilité des applications MCP ; niveaux de catalogue ; liens profonds.
- [MCP Protocol](/docs/mcp-protocol) : le serveur MCP monté automatiquement, l'authentification, les outils et `ask-agent`.
- [Actions](/docs/actions) — `defineAction`, le constructeur `link`, `publicAgent`.

```

```
