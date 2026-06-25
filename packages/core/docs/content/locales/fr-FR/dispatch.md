---
title: "Expédition"
description: "Le plan de contrôle de l'espace de travail : coffre-fort de secrets, hub d'intégration, délégué inter-applications et boîte de réception centrale pour Slack, e-mail, Telegram, WhatsApp."
---

# Expédition

Dispatch est l'application centrale qui se trouve devant toutes les autres applications de votre espace de travail et gère les secrets, les intégrations, la messagerie et la délégation entre applications. Il s'agit du **plan de contrôle de l'espace de travail** : l'agent unique avec lequel votre équipe communique, les informations d'identification uniques en direct et le routeur unique qui décide quelle application spécialisée doit traiter une demande donnée.

> **Distribuez le modèle par rapport au package `@agent-native/dispatch`.** Cette page couvre le concept d'application/modèle Dispatch : ce qu'il fait et pourquoi vous le souhaitez. Le package `@agent-native/dispatch` npm est le runtime publié séparément qui regroupe la logique de serveur du modèle Dispatch (coffre-fort, intégrations, destinations, tâches planifiées et délégation inter-applications) en tant que package drop-in pour les espaces de travail qui l'étendent. Pour l'application échafaudée elle-même (itinéraires, écrans, guide de l'agent), consultez le [Dispatch template](/docs/template-dispatch).

Sans Dispatch, chaque application dans un espace de travail multi-applications finit par réimplémenter la même plomberie : son propre robot Slack, son propre magasin secret, ses propres tâches planifiées, sa propre copie des instructions de l'espace de travail. La rotation d’une clé API se transforme en dix redéploiements. L’ajout d’une nouvelle politique se transforme en dix copier-coller. Dispatch centralise tout cela dans une seule application afin que les autres restent concentrés sur leur domaine.

```an-diagram title="Dispatch comme plan de contrôle de l'espace de travail" summary="Une boîte de réception, un coffre-fort, une passerelle MCP et des ressources partagées se trouvent devant les applications de domaine, que Dispatch atteint en tant que pairs A2A."
{
  "html": "<div class=\"dsp-hub\"><div class=\"diagram-node\">Users &amp; external agents<br><small class=\"diagram-muted\">Slack · e-mail · Telegram · WhatsApp · MCP</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-panel dsp-control\" data-rough><span class=\"diagram-pill accent\">Dispatch &mdash; control plane</span><div class=\"dsp-caps\"><span class=\"diagram-pill\">Boîte de réception centrale</span><span class=\"diagram-pill\">Coffre des secrets</span><span class=\"diagram-pill\">Délégation inter-apps</span><span class=\"diagram-pill\">MCP gateway</span><span class=\"diagram-pill\">Ressources d’espace de travail</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"dsp-peers\"><div class=\"diagram-box\" data-rough>Mail</div><div class=\"diagram-box\" data-rough>Calendar</div><div class=\"diagram-box\" data-rough>Analytics</div></div><small class=\"diagram-muted\">domain apps &mdash; A2A peers</small></div>",
  "css": ".dsp-hub{display:flex;flex-direction:column;align-items:center;gap:10px}.dsp-hub .dsp-control{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}.dsp-hub .dsp-caps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.dsp-hub .dsp-peers{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}"
}
```

## Quand vous souhaitez envoyer {#when}

Contactez le répartiteur lorsque l'une de ces conditions est vraie :

- Vous utilisez un [multi-app workspace](/docs/multi-app-workspace) (courrier, calendrier, analyses, contenu) et vous ne voulez pas d'un seul bot Slack par application.
- Vous voulez **une boîte de réception pour "l'agent"** afin que les utilisateurs envoient un seul robot en DM et que la bonne application spécialisée se charge du travail en coulisses.
- Vous disposez de **secrets à l'échelle de l'espace de travail** (clé Stripe, clé OpenAI, jetons API tiers) dont plusieurs applications ont besoin et vous souhaitez un seul coffre-fort au lieu de copier les valeurs dans chaque `.env`.
- Vous souhaitez un **flux d'approbation d'exécution** avant les modifications sensibles (destinations enregistrées, modifications de stratégie) afin que les non-administrateurs puissent demander et que les administrateurs puissent se déconnecter sans déploiement de code.
- Vous souhaitez que les **skills partagés, les instructions, les profils d'agent et les serveurs MCP** dont les applications de l'espace de travail héritent – changent une fois, atteignent tous.

Si vous exécutez un seul modèle autonome, vous n'avez pas besoin de Dispatch : chaque modèle peut câbler directement ses propres intégrations de messagerie. Voir [Messaging](/docs/messaging) pour la configuration autonome.

## Ce que fait Dispatch {#what-it-does}

Sept fonctionnalités, toutes situées au-dessus de la même base de données d'espace de travail que celles utilisées par les autres applications :

| Capacité                              | Ce que cela vous donne                                                                                 | Configurez-le                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Boîte de réception centrale**       | Slack, e-mail, Telegram, WhatsApp atteignent tous un seul agent avec mémoire partagée + outils         | **Paramètres → Messagerie** ([Messaging](/docs/messaging))     |
| **Coffre secret**                     | Stockez chaque identifiant une fois ; effectuer une rotation au même endroit dans chaque application   | **Vault** + mode d'accès (toutes les applications ou manuel)   |
| **Délégation inter-applications**     | Achemine une demande vers la bonne application spécialisée via A2A et répond dans le fil de discussion | Automatique ([A2A](/docs/a2a-protocol))                        |
| **Passerelle unifiée MCP**            | Un connecteur MCP pour les agents externes atteint chaque application d'espace de travail accordée     | [External Agents](/docs/external-agents)                       |
| **Ressources de l'espace de travail** | Auteur skills/instructions/profils une fois ; les applications en héritent au moment de l'exécution    | **Ressources** ([Workspace](/docs/workspace#global-resources)) |
| **Rêves**                             | Examine les exécutions/commentaires passés et propose des améliorations durables à approuver           | Onglet **Rêves**                                               |
| **Flux d'approbation**                | Gestion des modifications d'exécution sensibles derrière la révision par l'administrateur en ligne     | **Politique d'approbation d'expédition**                       |

Chacun est détaillé ci-dessous.

### Boîte de réception centrale

Slack, les e-mails, Telegram et WhatsApp circulent tous dans la boucle des agents de Dispatch. Connectez chaque plateforme une fois dans **Paramètres → Messagerie** et chaque canal atteint le même agent avec la même mémoire et les mêmes outils. Un DM Slack et un e-mail adressé à `agent@yourcompany.com` se transforment en deux surfaces sur un seul historique de conversation, et non en deux robots déconnectés. Voir [Messaging](/docs/messaging) pour les informations d'identification et le webhook URL.

### Coffre secret

Stockez les informations d'identification une fois dans le coffre-fort de Dispatch. Par défaut, l'accès au coffre-fort s'effectue **toutes les applications** : chaque clé enregistrée est disponible pour chaque application d'espace de travail et `sync-vault-to-app` transfère l'intégralité du coffre-fort vers l'application cible. Les espaces de travail qui nécessitent une séparation plus stricte peuvent faire passer le coffre-fort en mode **manuel**, où des autorisations explicites par application sont requises avant la synchronisation. Les non-administrateurs peuvent **demander** un secret pour une application ; les administrateurs **approuvent**, ce qui crée le secret et, dans les flux de travail manuels, l'octroi. Chaque lecture, attribution, synchronisation et rotation est capturée dans un journal d'audit. C'est ce qui fait de la « rotation de la clé OpenAI » une opération en un seul clic sur dix applications au lieu de dix PR.

### Délégation inter-applications

Dispatch découvre automatiquement les autres applications de votre espace de travail en tant que pairs A2A : pas d'enregistrement manuel, pas de configuration par application. Lorsqu'un utilisateur demande « Résumer les inscriptions de la semaine dernière » dans Slack, Dispatch reconnaît cela comme une demande d'analyse et appelle l'application d'analyse via [A2A](/docs/a2a-protocol). Lorsqu'ils demandent « rédiger une réponse à Alice », cela est acheminé vers l'application de messagerie. Dispatch publie la réponse finale dans le fil de discussion d'origine. La règle de comportement réside dans les instructions du répartiteur : le travail de domaine appartient à l'application de domaine. Dispatch est l'orchestrateur, pas le spécialiste.

### Passerelle unifiée MCP

Dispatch peut être le connecteur MCP unique pour les agents externes : ajoutez `https://dispatch.agent-native.com/_agent-native/mcp` une fois dans Claude, ChatGPT, Codex ou Cursor, et une autorisation atteint chaque application d'espace de travail accordée au lieu d'un connecteur par application. Consultez [External Agents](/docs/external-agents) pour connaître le flux de connexion complet, les subventions d'application, OAuth et les aperçus de l'application MCP en ligne.

```an-api
{
  "method": "POST",
  "path": "/_agent-native/mcp",
  "summary": "Point de terminaison de passerelle MCP unifiée",
  "description": "The single MCP connector URL external agents add (e.g. `https://dispatch.agent-native.com/_agent-native/mcp`). One authorization here reaches every **granted** workspace app instead of wiring one connector per app. App grants, OAuth, and inline MCP App previews are covered in [External Agents](/docs/external-agents).",
  "auth": "Standard remote MCP OAuth, handled by the framework. The granted-app set scopes which workspace apps the connector can reach.",
  "responses": [
    { "status": "200", "description": "MCP JSON-RPC response — tools, resources, and MCP App UI resources aggregated across granted workspace apps." }
  ]
}
```

### Ressources de l'espace de travail

Skills, les instructions de garde-corps, les profils d'agent et les ressources de référence peuvent être créés une fois dans Dispatch et hérités par le reste de l'espace de travail. Les ressources avec la portée **Toutes les applications** sont globales : Dispatch les stocke une fois dans la portée de l'espace de travail et chaque agent d'application les lit au moment de l'exécution. Ils ne sont pas copiés dans chaque application et il n’y a pas d’étape de synchronisation manuelle espace de travail-ressource. Les ressources partagées de l'application et les ressources personnelles peuvent remplacer ou restreindre les paramètres par défaut de l'espace de travail localement.

Voir [Workspace — Global resources](/docs/workspace#global-resources) pour le tableau des chemins canoniques, le pack de démarrage et le modèle de remplacement.

Les ressources du serveur MCP utilisent JSON et sont intentionnellement réservées à HTTP. Stocker les jetons dans
Distribuez Vault, accordez ou synchronisez ces clés avec les applications cibles et référencez-les
à partir des en-têtes avec `${keys.NAME}` pour que les informations d'identification brutes ne vivent jamais dans le
corps de ressource.

La page **Ressources** met en évidence le pack de démarrage recommandé afin que les administrateurs puissent rapidement voir quels fichiers existent, restaurer les fichiers de démarrage manquants sans écraser ceux existants et modifier leur contenu. Développez n'importe quelle ressource pour prévisualiser sa pile d'exécution effective pour une application/un utilisateur sélectionné. Chaque fiche d'application dispose également d'une vue **Contexte** qui montre exactement ce que cette application reçoit.

### Rêves

Dispatch Dreams examine les exécutions précédentes des agents, les commentaires, les évaluations et les échecs répétés pour proposer des améliorations durables. Un rapport de rêve est une surface de révision, pas une réécriture silencieuse : il peut suggérer des mises à jour de la mémoire personnelle, un nettoyage de la mémoire obsolète, des modifications `LEARNINGS.md` partagées, des instructions/compétences/connaissances/ressources d'agent dans l'espace de travail, ou des tâches récurrentes, et chaque proposition renvoie aux exécutions qui la justifient. Les instructions partagées et les ressources à l'échelle de l'équipe doivent être examinées avant d'être appliquées, en particulier lorsque les preuves proviennent d'un Slack entrant, d'un courrier électronique, d'un télégramme, de WhatsApp ou d'un contenu Web.

Avant de proposer une écriture, Dreams compare les preuves avec l'index de mémoire personnelle, les notes `memory/*.md` existantes et les `LEARNINGS.md` partagées. Si une leçon est déjà capturée, le rapport enregistre qu'elle a été ignorée ; si un souvenir personnel associé semble obsolète, la proposition cible cette note existante au lieu de créer un doublon.

Démarrez à partir de l'onglet **Dreams** dans Dispatch. Exécutez d'abord une passe manuelle, ouvrez une feuille de révision de proposition pour comparer la cible actuelle avec le contenu proposé et les preuves sources, puis appliquez uniquement les modifications que vous souhaitez conserver. Une fois que les rapports sont constamment utiles, Dispatch peut créer une tâche de rêve récurrente qui continue de produire des propositions sans appliquer automatiquement des modifications partagées ou au niveau des instructions.

### Flux d'approbation

Dispatch peut gérer les modifications d'exécution sensibles après examen par l'administrateur. Aujourd'hui, cela couvre les **destinations enregistrées** (les canaux Slack et les adresses e-mail auxquelles l'agent peut envoyer de manière proactive), les **propositions de rêve** partagées/en équipe, les **ressources d'espace de travail** de toutes les applications créées/mises à jour/supprimées et la **politique d'approbation d'envoi** elle-même. Lorsque la stratégie est activée, la modification est mise en file d'attente et l'agent affiche un aperçu d'approbation en ligne directement dans le chat : les administrateurs approuvent ou rejettent sans quitter la conversation.

## Comment un message Slack circule via Dispatch {#flow}

Parcourez un exemple de bout en bout. Un utilisateur envoie un message privé au bot : _"résumer les inscriptions de la semaine dernière."_

1. **Slack → webhook.** Slack `POST` à `/_agent-native/integrations/slack/webhook` sur l'application Dispatch. Le gestionnaire vérifie la signature et **insère une ligne dans `integration_pending_tasks`**, puis déclenche un `POST` auto-ciblé sur son propre processeur et renvoie immédiatement `200` afin que Slack ne réessaye pas.
2. **Nouvelle exécution du processeur.** Le point de terminaison du processeur s'exécute dans une toute nouvelle exécution de fonction avec son propre délai d'attente complet. Il revendique atomiquement la tâche et démarre la boucle d'agent.
3. **L'agent de répartition décide.** L'agent lit le message, reconnaît les « inscriptions » comme une intention d'analyse et appelle `call-agent` par rapport au [A2A endpoint](/docs/a2a-protocol) de l'application d'analyse. Le travail réel de SQL se déroule là-bas.
4. **Réponse publiée dans le fil de discussion.** L'agent d'analyse renvoie un résultat. Dispatch le formate et le publie dans le même fil de discussion Slack dans lequel l'utilisateur a écrit, en utilisant l'identité liée s'il en existe une (de sorte que l'agent agit avec les autorisations du demandeur, et non celles du propriétaire de l'espace de travail).
5. **Récupération en cas de panne.** Si le processeur plante en plein vol (délai d'expiration A2A, erreur de l'agent en aval, gel des fonctions), une nouvelle tentative balaie les tâches bloquées toutes les 60 secondes et relance le processeur. Jusqu'à trois tentatives avant que la tâche ne soit marquée `failed`.

```an-diagram title="Un message Slack via Dispatch" summary="Slack est mis en file d'attente dans SQL, une nouvelle exécution le draine, l'agent Dispatch délègue le travail de domaine sur A2A et la réponse revient dans le thread d'origine. Une nouvelle tentative de 60 s récupère tout ce qui meurt en plein vol."
{
  "html": "<div class=\"dsp-flow\"><div class=\"dsp-row\"><div class=\"diagram-node\">DM Slack<br><small class=\"diagram-muted\">\"summarize last week's signups\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough><strong>/slack/webhook</strong><br><small class=\"diagram-muted\">vérifie + INSERT tâche en attente</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">200</div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough><strong>fresh processor</strong><br><small class=\"diagram-muted\">revendique la tâche · démarre la boucle agent</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">L’agent Dispatch décide</span><small class=\"diagram-muted\">analytics intent &rarr; call-agent</small></div></div><div class=\"dsp-row\"><div class=\"diagram-box\" data-rough>App d’analyse<br><small class=\"diagram-muted\">pair A2A · exécute le travail SQL</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">reply posted in thread</div></div><div class=\"diagram-panel dsp-retry\" data-rough><span class=\"diagram-pill warn\">recovery</span> <span class=\"diagram-muted\">if the processor crashes &mdash; A2A timeout, downstream error, freeze &mdash; the 60s retry job re-fires it (&le;3 attempts) so the Slack reply still arrives</span> <span class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</span></div></div>",
  "css": ".dsp-flow{display:flex;flex-direction:column;gap:12px}.dsp-flow .dsp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsp-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.dsp-flow .dsp-retry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}"
}
```

Le même flux s'applique aux e-mails, Telegram et WhatsApp : seul l'adaptateur change.

## Histoire de fiabilité {#reliability}

L'ensemble du pipeline est conçu pour survivre sur chaque hôte sans serveur (Netlify, Vercel, Cloudflare Workers) sans s'appuyer sur des API d'exécution en arrière-plan spécifiques à la plate-forme.

- **Webhook → file d'attente SQL → processeur de nouvelle exécution.** La boucle d'agent ne s'exécute jamais à l'intérieur du gestionnaire de webhook. Le seul travail du gestionnaire est de vérifier, de mettre en file d'attente et de renvoyer 200. Une nouvelle exécution distincte draine la file d'attente, de sorte qu'une exécution lente de l'agent ne peut jamais bloquer le webhook entrant ni provoquer une nouvelle tentative de la plate-forme.
- **Interrogation de continuation A2A.** Lorsque Dispatch délègue à une autre application, il interroge la tâche en aval avec un délai d'expiration limité. Si l'agent en aval prend trop de temps ou plante, Dispatch enregistre la suite et la tâche de nouvelle tentative la récupère : la réponse Slack de l'utilisateur arrive toujours.
- **A2A inter-applications signé automatiquement.** Les espaces de travail multi-applications hébergés génèrent automatiquement des informations d'identification A2A par application au moment du déploiement, afin que les applications du même espace de travail puissent s'appeler sans jamais coller un secret JWT. La couche de découverte d'agent de Dispatch lit ces informations d'identification dans la base de données de l'espace de travail afin que les applications nouvellement ajoutées apparaissent automatiquement en tant que homologues appelables.

## Configuration {#setup}

Trois courtes étapes :

1. **Élaborez un espace de travail qui inclut Dispatch.** Exécutez `npx @agent-native/core@latest create my-company-platform` et choisissez `dispatch` à côté des modèles de domaine de votre choix. Dispatch vit à `apps/dispatch` et le reste des applications se trouve à côté. Voir [Multi-App Workspace](/docs/multi-app-workspace).
2. **Connectez la messagerie.** Ouvrez **Paramètres → Messagerie** dans Dispatch et cliquez sur Connecter pour Slack, Email, Telegram ou WhatsApp. Les champs du formulaire correspondent aux variables d'environnement dans le document [Messaging](/docs/messaging) – reportez-vous ici pour connaître les besoins de chaque plate-forme.
3. **Ajoutez d'autres applications.** Exécutez `npx @agent-native/core@latest add-app` à partir de la racine de l'espace de travail pour chaque application de domaine. Ils apparaissent automatiquement en tant que pairs A2A dans `list-workspace-apps` de Dispatch — pas d'enregistrement manuel, pas de modification de la carte d'agent. Dispatch commencera à leur déléguer dès que leurs cartes d'agent seront accessibles.

Ajoutez ensuite les informations d'identification au coffre-fort et (éventuellement) créez des ressources d'espace de travail globales sous **Ressources**. Les clés du coffre-fort peuvent toujours être synchronisées ou accordées en fonction du mode d'accès ; Les ressources de l’espace de travail de toutes les applications sont héritées automatiquement. Si vous avez besoin d'une isolation secrète par application, définissez le paramètre d'accès au coffre-fort sur manuel avant d'accorder des applications individuelles.

## Voir aussi {#see-also}

- [Dispatch template](/docs/template-dispatch) : la véritable application échafaudée, avec son catalogue d'actions complet et son guide d'agent
- [Messaging](/docs/messaging) — connexion Slack, e-mail, Telegram, WhatsApp
- [A2A Protocol](/docs/a2a-protocol) : comment fonctionne la délégation entre applications en coulisses
- [Multi-App Workspace](/docs/multi-app-workspace) — la forme de déploiement pour laquelle Dispatch est conçu
- [Workspace Governance](/docs/workspace-management) — gouvernance git/GitHub qui s'associe à la gouvernance d'exécution de Dispatch
