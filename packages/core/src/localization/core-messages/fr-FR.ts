import type { AgentChatTranslation } from "../core-messages.js";

const messages: AgentChatTranslation = {
  "composer.contextUrlLabel": "Adresse URL",
  "composer.contextInvalidUrl": "Saisissez une URL HTTP ou HTTPS valide.",
  "composer.contextAttach": "Joindre",
  "composer.menu.search": "Rechercher…",
  "composer.contextPrevious": "Précédent",
  "composer.contextNext": "Suivant",
  "composer.contextLoadFailed": "Impossible de charger le contexte.",
  "composer.contextLinkRequired": "Saisissez un lien.",
  "composer.submitFailed": "Envoi impossible. Réessayez.",
  "composer.addContext": "Ajouter du contexte",
  "composer.contextActionFailed": "Impossible d’ajouter le contexte.",
  "composer.contextBack": "Retour",
  "composer.searchContext": "Rechercher du contexte…",
  "composer.noContextResults": "Aucun contexte correspondant.",
  "composer.contextPending": "Contexte en attente",
  "composer.contextError": "Échec du contexte",
  "composer.retryContext": "Réessayer le contexte {{name}}",
  "composer.contextLimitExceeded":
    "Le contexte est trop volumineux. Supprimez un élément ou joignez une sélection plus petite.",
  "activity.reasoning": "Raisonnement",
  "approval.alwaysAllow": "Toujours autoriser",
  "approval.alwaysAllowHint":
    "Approuver et toujours autoriser cette commande exacte",
  "approval.alwaysAllowAction": "Toujours autoriser cette action",
  "approval.alwaysAllowActionHint":
    "Approuver et toujours autoriser cette action",
  "approval.approve": "Approuver",
  "approval.approved": "Approuvé. Nouvelle exécution de {{tool}}...",
  "approval.denied": "Refusé. {{tool}} n’a pas été exécuté.",
  "approval.deny": "Refuser",
  "approval.moreOptions": "Plus d’options d’approbation",
  "approval.question": "Approuver l’exécution de {{tool}} ?",
  "auth.expiredDescription":
    "Votre session a peut-être expiré. Déconnectez-vous, puis reconnectez-vous pour rétablir la connexion.",
  "auth.expiredTitle": "Session expirée",
  "auth.logIn": "Se connecter",
  "auth.logOut": "Se déconnecter",
  "auth.refreshChat": "Actualiser le chat",
  "auth.refreshDescription":
    "Vous êtes connecté, mais la connexion de ce chat doit être rétablie.",
  "auth.refreshTitle": "La session du chat doit être actualisée",
  "auth.requiredDescription":
    "Vous devez vous connecter pour utiliser l’agent.",
  "auth.requiredTitle": "Authentification requise",
  "commands.act": "Revenir au mode Action",
  "commands.available": "Commandes disponibles",
  "commands.clear":
    "Démarrer un nouveau chat (conserve le chat actuel dans l’historique)",
  "commands.closeHelp": "Fermer l’aide",
  "commands.help": "Afficher cette liste de commandes",
  "commands.history": "Parcourir tous les chats",
  "commands.mention": "Mentionner des fichiers, des agents ou des ressources",
  "commands.new": "Identique à /clear",
  "commands.plan": "Passer à la planification en lecture seule",
  "observability.viewDetails": "Afficher les détails",
  "observability.hideDetails": "Masquer les détails",
  "observability.input": "Entrée",
  "observability.output": "Sortie",
  "observability.error": "Erreur",
  "observability.metadata": "Métadonnées",
  "observability.notCaptured": "Non capturé",
  "observability.openFullConversation": "Ouvrir la conversation complète",
  "observability.learnAboutTab": "En savoir plus sur cet onglet",
  "onboarding.back": "Retour",
  "onboarding.chooseRole": "Choisissez votre rôle",
  "onboarding.customizeRole": "Personnalisons cette expérience pour vous.",
  "onboarding.roleQuestion": "Quel choix décrit le mieux votre rôle ?",
  "onboarding.roleHelperText":
    "Cela nous aide à personnaliser votre expérience",
  "onboarding.roleProduct": "Chef de produit",
  "onboarding.roleDesign": "Designer",
  "onboarding.roleDeveloper": "Développement",
  "onboarding.roleMarketing": "Marketing",
  "onboarding.roleSales": "Ventes",
  "onboarding.roleOps": "Opérations",
  "onboarding.roleIndividual": "Individuel",
  "onboarding.roleOther": "Autre",
  "onboarding.roleOtherInputLabel": "Décrivez votre rôle",
  "onboarding.skipForNow": "Ignorer pour l’instant",
  "onboarding.saveRoleError": "Impossible d’enregistrer votre rôle.",
  "onboarding.builderCreateAccount": "Créer un compte Builder.io",
  "onboarding.builderSignInWithAccount":
    "Se connecter avec un compte Builder.io",
  "onboarding.builderActivateDescription":
    "Créez ou réutilisez votre compte Builder.io et activez ses crédits gratuits en un clic.",
  "onboarding.builderActiveCredits":
    "Inclus avec les crédits gratuits Builder.io actifs",
  "onboarding.builderCredits": "Inclus avec les crédits gratuits Builder.io",
  "onboarding.builderActivateTitle": "Activer les crédits gratuits",
  "onboarding.builderAccountExistsTitle": "Vous avez déjà un compte Builder.io",
  "onboarding.builderAccountExistsDescription":
    "Connectez-vous pour l’associer.",
  "onboarding.builderActivationDescription":
    "Nous créerons automatiquement votre compte Builder.io en un clic.",
  "onboarding.builderCreateAndActivate": "Créer et activer",
  "onboarding.builderConsentPrefix":
    "En créant un compte Builder.io, vous acceptez nos",
  "onboarding.builderTerms": "Conditions d’utilisation",
  "onboarding.builderPrivacy": "Politique de confidentialité",
  "onboarding.builderConsentAnd": "et",
  "onboarding.builderExistingAccount": "J’ai un compte Builder.io",
  "onboarding.builderActivating": "Activation des crédits gratuits Builder.io",
  "onboarding.builderConnecting": "Connexion aux crédits gratuits Builder.io",
  "onboarding.builderProvisioningDescription":
    "Création ou réutilisation de votre compte Builder.io. Cela prend généralement quelques secondes.",
  "onboarding.builderConnectionDescription":
    "Terminez la connexion en un clic dans la nouvelle fenêtre.",
  "onboarding.builderReadyWithCodeChanges":
    "Les crédits IA et les modifications de code dans le cloud sont prêts à l’emploi.",
  "onboarding.builderReadyCreditsOnly":
    "Les crédits IA sont prêts à l’emploi. Les modifications de code dans le cloud nécessitent un projet Builder dans les paramètres de l’agent en arrière-plan.",
  "onboarding.openBackgroundAgentSettings":
    "Ouvrir les paramètres de l’agent en arrière-plan",
  "onboarding.capability.llm.keySummary": "Connectez votre propre modèle d’IA",
  "onboarding.capability.fileStorage.keySummary":
    "Téléversement et stockage de fichiers",
  "onboarding.fileStorage.title":
    "Connecter un stockage pour envoyer des fichiers",
  "onboarding.fileStorage.description":
    "Connectez Builder.io (gratuit) ou configurez votre propre stockage d’objets compatible S3.",
  "onboarding.fileStorage.reconnectBuilder": "Reconnecter Builder.io",
  "onboarding.fileStorage.custom": "Ajouter vos propres clés de stockage",
  "onboarding.fileStorage.customDescription":
    "Configurez un bucket compatible S3 avec une URL publique stable.",
  "onboarding.capability.voiceInput.label": "Entrée vocale",
  "onboarding.capability.voiceInput.keySummary": "Entrée vocale",
  "onboarding.capability.voiceInput.why":
    "L’entrée vocale transforme les demandes parlées en texte ; la saisie reste toujours disponible.",
  "onboarding.capability.embeddings.label": "Représentations vectorielles",
  "onboarding.capability.embeddings.keySummary": "Représentations vectorielles",
  "onboarding.capability.embeddings.why":
    "Les représentations vectorielles améliorent la recherche sémantique. La recherche par mots-clés fonctionne toujours sans elles.",
  "onboarding.capability.assetsImageGeneration.label": "Génération d’images",
  "onboarding.capability.assetsImageGeneration.keySummary":
    "Crédits Builder ou clé d’un fournisseur d’images",
  "onboarding.capability.assetsImageGeneration.why":
    "La génération d’images est le flux principal pour créer des ressources à votre marque.",
  "onboarding.capability.assetsVideoGeneration.label": "Génération vidéo",
  "onboarding.capability.assetsVideoGeneration.keySummary": "Clé API Gemini",
  "onboarding.capability.assetsVideoGeneration.why":
    "La génération vidéo est facultative ; le flux principal d’Assets est la génération d’images.",
  "onboarding.capability.clipsObjectStorage.label": "Stockage objet",
  "onboarding.capability.clipsObjectStorage.keySummary":
    "Stockage Builder ou bucket compatible S3",
  "onboarding.capability.clipsObjectStorage.why":
    "Les vidéos enregistrées ont besoin d’un stockage objet durable avant de pouvoir être lues ou partagées.",
  "onboarding.capability.clipsTranscription.keySummary":
    "Clé d’un fournisseur de conversion parole-texte",
  "onboarding.capability.about": "À propos de {{label}}",
  "onboarding.capability.why": "Pourquoi {{label}} est nécessaire",
  "onboarding.openAiKeySettings": "Ouvrir les paramètres des clés IA",
  "aboutAgentNative.title": "À propos d’Agent-Native",
  "aboutAgentNative.version": "Version",
  "aboutAgentNative.environment": "Environnement",
  "aboutAgentNative.build": "Build",
  "aboutAgentNative.copyDiagnostics": "Copier les diagnostics",
  "aboutAgentNative.unknown": "Inconnue",
  "common.agent": "Agent",
  "agentPanel.mode": "Mode",
  "agentPanel.uiMode": "Interface utilisateur",
  "agentPanel.keyScope": "Portée de la clé",
  "agentPanel.personalKeyScope": "Personnelle",
  "agentPanel.organizationKeyScope": "Organisation",
  "agentPanel.personalKeyInEffect": "Votre clé personnelle est utilisée.",
  "agentPanel.organizationKeyInEffect":
    "La clé de l’organisation est utilisée.",
  "agentPanel.sharedKeyInEffect": "Une clé partagée est utilisée.",
  "agentPanel.useOrganizationKey": "Utiliser la clé de l’organisation",
  "agentPanel.keyStatusUnavailable": "L’état de la clé est indisponible.",
  "agentPanel.saveScopeRoleUnavailable":
    "Impossible de charger votre rôle dans l’organisation. Les clés ne peuvent pas encore être enregistrées.",
  "agentPanel.chatgptSubscriptionPopupBlocked":
    "Autorisez les fenêtres pop-up pour ce site, puis réessayez.",
  "agentPanel.chatgptSubscriptionTitle": "Abonnement ChatGPT",
  "agentPanel.chatgptSubscriptionDescription":
    "Accès expérimental à Codex via votre abonnement ChatGPT.",
  "agentPanel.chatgptSubscriptionInUse": "Utilisé",
  "agentPanel.chatgptSubscriptionConnected": "Connecté",
  "agentPanel.chatgptSubscriptionConnecting": "Connexion…",
  "agentPanel.chatgptSubscriptionReconnect": "Reconnecter",
  "agentPanel.chatgptSubscriptionConnect": "Connecter ChatGPT",
  "agentPanel.chatgptSubscriptionUse": "Utiliser dans le chat",
  "agentPanel.chatgptSubscriptionDisconnect": "Déconnecter",
  "agentHostNudge.sidebarTitle": "Utiliser le chat de {{agent}}",
  "agentHostNudge.sidebarDescription":
    "Vous discutez déjà avec {{agent}}. Demandez-lui de travailler directement avec cette app.",
  "agentHostNudge.promptTitle": "Demander plutôt à {{agent}}",
  "agentHostNudge.promptDescription":
    "Vous pouvez demander à {{agent}} de créer ou modifier ceci ici.",
  "agentHostNudge.useThisChat": "Utiliser ce chat",
  "agentHostNudge.useThisPrompt": "Utiliser cette invite",
  "common.cancel": "Annuler",
  "common.collapse": "Réduire",
  "common.connect": "Connecter",
  "common.continue": "Continuer",
  "common.copied": "Copié",
  "common.copy": "Copier",
  "common.details": "Détails",
  "common.dismiss": "Ignorer",
  "common.dismissError": "Ignorer l’erreur",
  "common.expand": "Développer",
  "common.loading": "Chargement...",
  "common.no": "Non",
  "common.retry": "Réessayer",
  "common.chunkLoadFailed": "Impossible de charger. Veuillez réessayer.",
  "common.save": "Enregistrer",
  "agents.hostedAgent": "Agent hébergé",
  "agents.provider": "Fournisseur",
  "agents.providerA2A": "Agent A2A (Foundry, Gemini ou personnalisé)",
  "agents.providerAnthropic": "Agents gérés Anthropic",
  "agents.agentId": "ID de l’agent",
  "agents.agentIdPlaceholder": "agent_...",
  "agents.environmentId": "ID de l’environnement",
  "agents.environmentIdPlaceholder": "env_...",
  "agents.apiBaseUrl": "URL de base de l’API (facultative)",
  "agents.apiBaseUrlPlaceholder": "https://api.anthropic.com",
  "agents.managedAgentIncomplete":
    "Complétez les champs Anthropic Managed Agents.",
  "agents.managedAgentCheck":
    "La connexion est vérifiée lorsque vous déléguez depuis le chat.",
  "agents.managedAgentSaved":
    "Anthropic Managed Agent enregistré. Déléguez-lui une tâche depuis le chat.",
  "agents.cardUrl": "URL de la carte de l’agent",
  "agents.cardUrlPlaceholder": "https://host.example/agent-card.json",
  "agents.authType": "Authentification",
  "agents.authNone": "Aucune authentification",
  "agents.authBearer": "Jeton Bearer",
  "agents.authClientCredentials": "Identifiants client OAuth",
  "agents.chooseCredential": "Choisir un identifiant",
  "agents.vault": "Coffre",
  "agents.tokenUrl": "URL du jeton",
  "agents.clientId": "ID client",
  "agents.scope": "Portée",
  "agents.authIncomplete":
    "Complétez les champs d’authentification de l’agent hébergé.",
  "agents.invalidUrl":
    "Les URL d’agent doivent utiliser HTTPS, sauf pour localhost ou les URL de développement de bouclage.",
  "agents.statusReachable": "Accessible",
  "agents.statusAuthRejected": "Authentification refusée",
  "agents.statusNoJsonRpc": "Pas de JSON-RPC",
  "agents.directoryTab": "Annuaire des agents",
  "agents.directoryPageHint":
    "Trouvez un backend d’agent et connectez-le à votre espace de travail.",
  "agents.directorySearch": "Rechercher des fournisseurs",
  "agents.directoryProviders": "Fournisseurs",
  "agents.directoryManual": "Ajouter par URL",
  "agents.directoryA2A": "A2A",
  "agents.directoryManaged": "API gérée",
  "agents.directoryFoundry": "Microsoft Foundry",
  "agents.directoryFoundryHint": "Connectez un agent Foundry via A2A.",
  "agents.directoryGemini": "Gemini Enterprise",
  "agents.directoryGeminiHint": "Connectez un agent Gemini Enterprise via A2A.",
  "agents.directoryAnthropic": "Agents gérés Anthropic",
  "agents.directoryAnthropicHint":
    "Connectez les sessions et approbations Anthropic.",
  "agents.directoryNoMatches":
    "Aucun fournisseur ne correspond à votre recherche.",
  "agents.directoryRegistry": "Registre A2A mondial",
  "agents.directoryRegistryHint":
    "Parcourez les cartes d’agents publiques et vérifiez-les avant la connexion.",
  "agents.directoryBrowse": "Parcourir le registre",
  "agents.formName": "Nom",
  "agents.formUrl": "URL",
  "agents.formUrlPlaceholder": "URL (par ex. http://localhost:8085)",
  "agents.formDescription": "Description",
  "agents.formDescriptionPlaceholder": "Description (facultative)",
  "agents.formCheck": "Vérifier",
  "agents.formAdd": "Ajouter",
  "agents.formAdding": "Ajout",
  "agents.formAddAnyway": "Ajouter quand même",
  "agents.formRemove": "Retirer",
  "agents.formSaveFailed": "Impossible d'enregistrer l'agent.",
  "agents.formAddFailed": "Impossible d'ajouter l'agent.",
  "agents.checkFailed": "Échec de la vérification",
  "agents.checkFailedStatus": "Échec de la vérification ({{status}})",
  "agents.checkNotReachable": "Inaccessible",
  "agents.checkLive": "En ligne · {{scheme}}",
  "agents.checkNoAuthScheme": "aucun schéma d'authentification annoncé",
  "agents.checkTokenRejected":
    "le pair a refusé notre jeton, les appels renverront donc 401 en production",
  "agents.checkTokenUnverified": "impossible de vérifier notre jeton",
  "agents.checkTokenUnverifiedReason":
    "impossible de vérifier notre jeton ({{reason}})",
  "agents.checkTokenWorks": "notre jeton fonctionne",
  "agents.checkReadsRequireAuth":
    "les lectures nécessitent une authentification",
  "agents.checkPublicSkills": "compétences publiques : {{count}}",
  "agents.unreachableHint":
    "L'app n'est peut-être pas encore lancée. Vous pouvez quand même l'ajouter.",
  "agents.addedOneWay":
    "{{name}} a été ajouté de votre côté uniquement. L'enregistrement est unidirectionnel : {{name}} ne connaîtra cette app qu'une fois que vous l'y aurez ajoutée aussi.",
  "agents.openPeerSettings": "Ouvrir les paramètres de {{name}}",
  "agents.syncSecret": "Synchroniser le secret avec les apps",
  "agents.noSharedSecret": "Aucun secret partagé défini pour l'instant.",
  "agents.noSharedSecretLink": "Définissez-en un d'abord sur la page Équipe.",
  "agents.askOwnerSyncSecret":
    "Demandez au propriétaire de l'espace de travail de synchroniser le secret partagé.",
  "common.saveFailed": "Échec de l’enregistrement",
  "common.saveFailedStatus": "Échec de l’enregistrement ({{status}})",
  "common.saving": "Enregistrement...",
  "common.settings": "Paramètres",
  "common.waiting": "En attente...",
  "common.yes": "Oui",
  "composer.attachmentError": "La pièce jointe n’a pas pu être traitée.",
  "composer.dropToAttach": "Déposez pour joindre",
  "composer.droppedFileError":
    "Impossible d’ajouter le fichier déposé. Essayez un autre format.",
  "composer.openDesktop":
    "Ouvrez l’application de bureau pour utiliser ce chat.",
  "composer.removeAttachment": "Supprimer {{name}}",
  "composer.scrollToBottom": "Faire défiler jusqu’en bas",
  "composer.suggestedPrompts": "Prompts suggérés",
  "composer.stopResponse": "Arrêter la réponse",
  "composer.subAgentReadOnly":
    "Envoyez des messages au chat de l’orchestrateur ; ce sous-agent s’exécute automatiquement",
  "empty.loadingChat": "Chargement du chat...",
  "empty.prompt": "Comment puis-je vous aider ?",
  "error.afterDuration": "{{headline}} après {{duration}}",
  "error.failed": "L’agent a rencontré une erreur",
  "error.stopped": "L’agent s’est arrêté avant d’avoir terminé",
  "header.switchToCli": "Passer à la CLI",
  "history.active": "Actif",
  "history.empty": "Aucun chat pour le moment",
  "history.loadOlder": "Charger les chats précédents",
  "history.noMatches": "Aucun chat correspondant",
  "history.open": "Ouvrir",
  "history.pinned": "Épinglé",
  "history.search": "Rechercher des chats...",
  "history.searching": "Recherche...",
  "history.untitledChat": "Chat",
  "history.yesterday": "Hier",
  "integrations.availableSection": "Intégrations disponibles",
  "integrations.connectedSection": "Connecté",
  "integrations.goToApiKeys": "Aller aux clés API",
  "integrations.goToIntegrations": "Aller aux intégrations",
  "integrations.lookingForApiKeys": "Vous cherchez plutôt une clé API ?",
  "integrations.lookingForProviders":
    "Vous cherchez des fournisseurs OAuth ou MCP ?",
  "integrations.manage": "Gérer",
  "integrations.recommended": "Recommandé",
  "integrations.subtitle":
    "Connectez les outils que votre agent peut utiliser.",
  "mcpIntegrations.menuLabel": "Intégrations",
  "mcpIntegrations.menuDescription":
    "Connecter les outils et services à l’agent",
  "mcpIntegrations.title": "Connecter des intégrations",
  "mcpIntegrations.description":
    "Parcourez {{count}} intégrations d’agent ou ajoutez-en une personnalisée.",
  "mcpIntegrations.searchPlaceholder": "Rechercher des intégrations",
  "mcpIntegrations.addYourOwn": "Ajouter la vôtre",
  "mcpIntegrations.noMatches":
    "Aucune intégration ne correspond à cette recherche.",
  "mcpIntegrations.connected": "Connecté",
  "mcpIntegrations.connectionError": "Erreur de connexion",
  "mcpIntegrations.connectionErrorReason": "Raison : {{reason}}",
  "mcpIntegrations.reconnect": "Reconnecter",
  "mcpIntegrations.reconnecting": "Reconnexion…",
  "mcpIntegrations.reconnectFailed": "Échec de la reconnexion : {{error}}",
  "mcpIntegrations.configure": "Configurer",
  "mcpIntegrations.connect": "Connecter",
  "mcpIntegrations.connectWithOAuth": "Connecter",
  "mcpIntegrations.connecting": "Connexion…",
  "mcpIntegrations.useApiToken": "Utiliser un jeton API",
  "mcpIntegrations.customOAuthDefault": "Se connecter avec OAuth",
  "mcpIntegrations.customHeadersMode": "Utiliser une clé API",
  "mcpIntegrations.useApiKeyInstead": "Utiliser plutôt une clé API",
  "mcpIntegrations.useOAuthInstead": "Utiliser plutôt OAuth",
  "mcpIntegrations.connectSuggestion":
    "Connectez {{name}} pour l’utiliser dans le chat",
  "mcpIntegrations.connectSuggestionWithApiToken":
    "Connectez {{name}} avec un jeton API pour l’utiliser dans le chat",
  "mcpIntegrations.dismissSuggestion": "Ignorer la suggestion d’intégration",
  "mcpIntegrations.backToIntegrations": "Retour aux intégrations",
  "mcpIntegrations.customTitle":
    "Ajouter une intégration d’agent personnalisée",
  "mcpIntegrations.configureTitle": "Configurer {{name}}",
  "mcpIntegrations.presetNoAuthDescription":
    "Les valeurs prédéfinies sont renseignées. Testez le point de terminaison ou connectez-le maintenant.",
  "mcpIntegrations.presetAuthDescription":
    "Les valeurs prédéfinies sont renseignées. Ajoutez les informations d’autorisation requises avant de vous connecter.",
  "mcpIntegrations.customDescription":
    "Collez un point de terminaison Streamable HTTP ou SSE et des en-têtes facultatifs.",
  "mcpIntegrations.oauthNotice":
    "Ce fournisseur nécessite généralement une configuration OAuth. Suivez la documentation du fournisseur ou ajoutez un en-tête Authorization si votre point de terminaison prend en charge l’accès par jeton.",
  "mcpIntegrations.providerSetupRequired":
    "Configuration du fournisseur requise",
  "mcpIntegrations.providerSetupDescription":
    "Effectuez d’abord la configuration requise dans {{name}}. Revenez ensuite ici pour connecter votre compte.",
  "mcpIntegrations.providerSetupFormDescription":
    "Effectuez la configuration du fournisseur avant de connecter votre compte.",
  "mcpIntegrations.continueToConnect": "Connecter mon compte",
  "mcpIntegrations.setupTitle": "Connecter {{name}}",
  "mcpIntegrations.personal": "Personnel",
  "mcpIntegrations.personalConnection": "Connexion personnelle",
  "mcpIntegrations.organization": "Organisation",
  "mcpIntegrations.scopeQuestion":
    "Qui doit pouvoir utiliser cette connexion ?",
  "mcpIntegrations.scopeChoiceTitle": "Qui doit l’utiliser ?",
  "mcpIntegrations.scopeChoiceDescription":
    "Choisissez où cette connexion est disponible.",
  "mcpIntegrations.connectForMe": "Connecter pour moi",
  "mcpIntegrations.setUpForWorkspace": "Configurer pour l’espace de travail",
  "mcpIntegrations.workspaceAdminRequired":
    "Propriétaire ou administrateur de l’espace de travail requis.",
  "mcpIntegrations.workspaceJoinRequired":
    "Rejoignez d’abord un espace de travail.",
  "mcpIntegrations.personalOnlyDescription":
    "Seules les connexions personnelles sont prises en charge pour cette intégration.",
  "mcpIntegrations.workspaceOnlyDescription":
    "Cette intégration se connecte une seule fois pour tout l’espace de travail. Elle ne peut donc pas être connectée à votre seul compte. Un propriétaire ou un administrateur de l’espace de travail peut la configurer.",
  "mcpIntegrations.loadingScopeMetadata":
    "Chargement de la portée de la connexion…",
  "mcpIntegrations.retry": "Réessayer",
  "mcpIntegrations.retrying": "Nouvelle tentative…",
  "mcpIntegrations.personalDescription":
    "Vous seul pouvez utiliser cette connexion.",
  "mcpIntegrations.sharedWithWorkspace": "Partagée avec l’espace de travail",
  "mcpIntegrations.organizationDescription":
    "Les membres autorisés de l’espace de travail peuvent utiliser cette connexion. Les autorisations du fournisseur s’appliquent toujours.",
  "mcpIntegrations.serverNameRequired":
    "Saisissez un nom d’intégration avant de vous connecter avec OAuth.",
  "mcpIntegrations.serverName": "Nom de l’intégration",
  "mcpIntegrations.url": "URL",
  "mcpIntegrations.fieldDescription": "Description",
  "mcpIntegrations.headers": "En-têtes",
  "mcpIntegrations.serverNamePlaceholder": "Nom de l’intégration",
  "mcpIntegrations.urlPlaceholder": "https://example.com/agent-integration",
  "mcpIntegrations.descriptionPlaceholder": "Description (facultative)",
  "mcpIntegrations.headersPlaceholder": "Authorization: Bearer <token>",
  "mcpIntegrations.openSetupDocs": "Ouvrir la documentation de configuration",
  "mcpIntegrations.viewSetup": "Ouvrir le guide de configuration",
  "mcpIntegrations.test": "Tester",
  "mcpIntegrations.testing": "Test en cours…",
  "mcpIntegrations.toolsAvailable_one": "{{count}} outil disponible",
  "mcpIntegrations.toolsAvailable_many": "{{count}} outils disponibles",
  "mcpIntegrations.toolsAvailable_other": "{{count}} outils disponibles",
  "mcpIntegrations.failed": "Échec",
  "mcpIntegrations.docsLabel": "Voir la documentation de {{name}}",
  "mcpIntegrations.catalog.context7.description":
    "Récupérez la documentation à jour des bibliothèques dans les chats de l’agent.",
  "mcpIntegrations.catalog.context7.useCase":
    "Documentation, référence technique, documentation d’API, guides de frameworks",
  "mcpIntegrations.catalog.sentry.description":
    "Inspectez les problèmes, les événements et les données de débogage.",
  "mcpIntegrations.catalog.sentry.useCase":
    "Surveillance des erreurs, débogage, performances, rapports de plantage",
  "mcpIntegrations.catalog.fullstory.description":
    "Consultez l’analytique comportementale et inspectez les replays de session.",
  "mcpIntegrations.catalog.fullstory.useCase":
    "Analytique produit, replay de session, comportement qualitatif, recherche utilisateur",
  "mcpIntegrations.catalog.fullstory.setupNote":
    "FullStory MCP est actuellement en bêta. Un administrateur de l’organisation FullStory doit activer les fonctionnalités StoryAI ainsi que l’option Model Context Protocol.",
  "mcpIntegrations.catalog.amplitude.description":
    "Consultez et exploitez l’analytique produit d’Amplitude.",
  "mcpIntegrations.catalog.amplitude.useCase":
    "Analytique produit, graphiques, tableaux de bord, cohortes, expériences",
  "mcpIntegrations.catalog.amplitude.setupNote":
    "Amplitude MCP utilise OAuth via HTTP en streaming. Le point de terminaison par défaut correspond à l’hébergement des données aux États-Unis. Utilisez le point de terminaison européen d’Amplitude si le compte exige un hébergement des données dans l’UE.",
  "mcpIntegrations.catalog.sigma.description":
    "Recherchez, explorez et analysez les classeurs et tableaux de bord Sigma.",
  "mcpIntegrations.catalog.sigma.useCase":
    "Analytique, tableaux de bord, classeurs, exploration de données, informatique décisionnelle",
  "mcpIntegrations.catalog.sigma.setupNote":
    "L’URL MCP de Sigma est propre à chaque organisation. Dans Sigma, ouvrez Profile > Integrations > Connect Sigma to AI tools, copiez l’URL et collez-la ici. Sigma MCP prend actuellement en charge la recherche, l’exploration des métadonnées et l’analyse. Cette connexion ne permet pas de créer ni d’importer des tableaux de bord ou des classeurs.",
  "mcpIntegrations.catalog.notion.description":
    "Recherchez des pages et les connaissances de l’équipe.",
  "mcpIntegrations.catalog.notion.useCase":
    "Documentation, gestion des connaissances, notes, création de contenu",
  "mcpIntegrations.catalog.notion.setupNote":
    "L’intégration Notion utilise l’OAuth utilisateur. Les espaces de travail Enterprise peuvent auditer l’utilisation des intégrations et autoriser ou bloquer des clients. Reconnectez-vous après une modification des règles d’administration.",
  "mcpIntegrations.catalog.granola.description":
    "Recherchez des notes de réunion, des transcriptions et des actions à mener.",
  "mcpIntegrations.catalog.granola.useCase":
    "Notes de réunion, enregistrements, transcriptions, actions à mener, suivis",
  "mcpIntegrations.catalog.granola.setupNote":
    "L’intégration Granola utilise OAuth dans le navigateur. Autorisez le compte Granola connecté et vérifiez les notes de réunion et les transcriptions auxquelles l’agent peut accéder.",
  "mcpIntegrations.catalog.gong.description":
    "Recherchez des appels Gong et générez des insights sur les comptes et les opportunités.",
  "mcpIntegrations.catalog.gong.useCase":
    "Appels commerciaux, transcriptions, insights sur les opportunités, résumés de comptes",
  "mcpIntegrations.catalog.gong.setupNote":
    "Gong exige qu’un administrateur technique crée une intégration MCP et choisisse une autorisation personnelle ou partagée. L’ID client et le secret générés doivent être configurés avant la connexion.",
  "mcpIntegrations.catalog.semgrep.description":
    "Analysez le code pour détecter des problèmes de sécurité.",
  "mcpIntegrations.catalog.semgrep.useCase":
    "Analyse de sécurité, détection de vulnérabilités, analyse de code",
  "mcpIntegrations.catalog.linear.description":
    "Consultez et modifiez les tickets Linear.",
  "mcpIntegrations.catalog.linear.useCase":
    "Gestion de projet, suivi des tickets, planification, rapports de bugs",
  "mcpIntegrations.catalog.apollo.description":
    "Recherchez, enrichissez et gérez les données GTM d’Apollo.",
  "mcpIntegrations.catalog.apollo.useCase":
    "Prospection, enrichissement, contacts, séquences, recherche sur les comptes",
  "mcpIntegrations.catalog.apollo.setupNote":
    "Apollo MCP utilise l’OAuth utilisateur et ne nécessite pas de clé API Apollo. Les autorisations du forfait Apollo, les crédits et les restrictions du fournisseur sur l’entraînement des modèles s’appliquent toujours.",
  "mcpIntegrations.catalog.commonRoom.description":
    "Étudiez les signaux d’achat, les contacts et les organisations.",
  "mcpIntegrations.catalog.commonRoom.useCase":
    "Intelligence acheteur, signaux produit, intention, enrichissement des contacts",
  "mcpIntegrations.catalog.commonRoom.setupNote":
    "Common Room MCP utilise OAuth par utilisateur et respecte le rôle de l’utilisateur autorisé dans l’espace de travail. Un administrateur devra peut-être activer la connexion MCP pour l’instance.",
  "mcpIntegrations.catalog.exa.description":
    "Recherchez sur le web et récupérez des pages avec Exa.",
  "mcpIntegrations.catalog.exa.useCase":
    "Recherche web, recherche documentaire, recherche de code, récupération de pages",
  "mcpIntegrations.catalog.exa.setupNote":
    "Le point de terminaison MCP distant d’Exa permet une utilisation gratuite de base sans clé. Ajoutez une clé API Exa via la configuration des en-têtes du fournisseur si vous avez besoin de limites plus élevées ou d’outils supplémentaires.",
  "mcpIntegrations.catalog.supabase.description":
    "Gérez les données, l’authentification et les services backend.",
  "mcpIntegrations.catalog.supabase.useCase":
    "Base de données, authentification, stockage, fonctions edge",
  "mcpIntegrations.catalog.neon.description":
    "Travaillez avec des projets Postgres serverless.",
  "mcpIntegrations.catalog.neon.useCase":
    "Gestion de bases de données, Postgres serverless, stockage de données",
  "mcpIntegrations.catalog.stripe.description":
    "Gérez les paiements, les abonnements et les clients.",
  "mcpIntegrations.catalog.stripe.useCase":
    "Paiements, abonnements, facturation, gestion des clients",
  "mcpIntegrations.catalog.atlassian.description":
    "Consultez et modifiez les tickets Jira et le contenu Confluence.",
  "mcpIntegrations.catalog.atlassian.useCase":
    "Gestion de projet, suivi des tickets, documentation, collaboration d’équipe",
  "mcpIntegrations.catalog.atlassian.setupNote":
    "Demandez à votre administrateur Atlassian d’autoriser le domaine de l’app Clips et d’activer Rovo/MCP avec les autorisations de lecture, d’écriture et de recherche pour votre site Jira.",
  "mcpIntegrations.catalog.cloudflare.description":
    "Recherchez et pilotez les services Cloudflare via son intégration.",
  "mcpIntegrations.catalog.cloudflare.useCase":
    "DNS, Workers, domaines, sécurité, observabilité, API de la plateforme",
  "mcpIntegrations.catalog.cloudflare.setupNote":
    "L’annuaire des intégrations gérées de Cloudflare contient des intégrations propres à chaque produit ainsi que l’intégration API générale. Vérifiez les portées et choisissez le point de terminaison le plus restreint adapté à votre flux de travail.",
  "mcpIntegrations.catalog.grafana.description":
    "Interrogez les métriques, les journaux et les données d’observabilité de Grafana Cloud.",
  "mcpIntegrations.catalog.grafana.useCase":
    "Observabilité, métriques, journaux, traces, tableaux de bord",
  "mcpIntegrations.catalog.grafana.setupNote":
    "Grafana Cloud MCP est en préversion publique et nécessite un accès MCP à Grafana Cloud Assistant. Il est réservé à Grafana Cloud hébergé. Grafana auto-hébergé nécessite le serveur MCP local.",
  "mcpIntegrations.catalog.gitlab.description":
    "Consultez et gérez les projets, tickets et demandes de fusion GitLab.",
  "mcpIntegrations.catalog.gitlab.useCase":
    "Dépôts, tickets, demandes de fusion, CI/CD, analytique du code",
  "mcpIntegrations.catalog.gitlab.setupNote":
    "L’intégration GitLab est actuellement en bêta. Sur GitLab.com, un administrateur de groupe de premier niveau doit autoriser l’accès à l’intégration avant que la procédure OAuth puisse aboutir. Les instances autogérées disposent d’un paramètre d’instance équivalent.",
  "mcpIntegrations.catalog.figma.description":
    "Apportez le contexte de design Figma et les actions sur le canevas à un agent.",
  "mcpIntegrations.catalog.figma.useCase":
    "Fichiers de design, composants, variables, systèmes de design, canevas",
  "mcpIntegrations.catalog.figma.setupNote":
    "L’intégration Figma n’autorise que les clients répertoriés dans le catalogue d’intégrations de Figma. Ce point de terminaison distant ne peut donc pas encore se connecter depuis Agent-Native. Utilisez l’API REST Figma en solution de repli, avec un jeton d’accès personnel, pour lire le contexte des fichiers et des nœuds. Les actions sur le canevas restent indisponibles tant que Figma n’a pas approuvé Agent-Native.",
  "mcpIntegrations.catalog.canva.description":
    "Recherchez, créez et modifiez des designs et des ressources Canva.",
  "mcpIntegrations.catalog.canva.useCase":
    "Designs, modèles, ressources, kits de marque, exports, collaboration",
  "mcpIntegrations.catalog.canva.setupNote":
    "L’intégration Canva utilise OAuth par utilisateur et exige que les clients autorisent les domaines canva.com et canva.ai de Canva. Vérifiez la configuration actuelle de la redirection et du client dans la documentation d’intégration de Canva avant de vous connecter.",
  "mcpIntegrations.catalog.vercel.description":
    "Recherchez dans la documentation Vercel et inspectez les projets, les déploiements et les journaux.",
  "mcpIntegrations.catalog.vercel.useCase":
    "Déploiements, projets, journaux, domaines, hébergement, documentation",
  "mcpIntegrations.catalog.vercel.setupNote":
    "L’intégration Vercel n’accepte que les clients IA examinés et approuvés. Agent-Native doit être ajouté à la liste des clients pris en charge par Vercel pour qu’une connexion générique du framework fonctionne.",
  "mcpIntegrations.catalog.github.description":
    "Consultez les dépôts, les tickets, les pull requests et le contexte du code.",
  "mcpIntegrations.catalog.github.useCase":
    "Dépôts, tickets, pull requests, code, analytique d’ingénierie",
  "mcpIntegrations.catalog.github.setupNote":
    "Le fournisseur de connexion de GitHub ne permet pas aux apps de s’enregistrer elles-mêmes. Le bouton Connecter ne peut donc pas mener OAuth à bien. Connectez-vous plutôt avec un jeton d’accès personnel GitHub. Notez que les organisations peuvent imposer des stratégies d’accès aux applications OAuth.",
  "mcpIntegrations.catalog.slack.description":
    "Recherchez dans les conversations Slack et effectuez des actions dans l’espace de travail via son intégration.",
  "mcpIntegrations.catalog.slack.useCase":
    "Messages, canaux, personnes, mémoire de l’entreprise, flux de travail",
  "mcpIntegrations.catalog.slack.setupNote":
    "L’intégration Slack nécessite une app Slack enregistrée avec un ID d’app fixe. L’enregistrement dynamique de clients n’est pas pris en charge, et seules les apps de Slack Marketplace ou les apps internes peuvent se connecter. Utilisez le flux OAuth de messagerie géré par Slack pour les flux de travail Agent-Native.",
  "mcpIntegrations.catalog.asana.description":
    "Recherchez et gérez les tâches, les projets et les données du graphe de travail Asana.",
  "mcpIntegrations.catalog.asana.useCase":
    "Tâches, projets, portefeuilles, planification, charge de travail",
  "mcpIntegrations.catalog.asana.setupNote":
    "L’intégration d’agent d’Asana nécessite une app OAuth préenregistrée et ne prend pas en charge l’enregistrement dynamique de clients. Configurez un client d’app Asana avant de vous connecter.",
  "mcpIntegrations.catalog.hubspot.description":
    "Recherchez et mettez à jour les fiches du CRM HubSpot via son intégration.",
  "mcpIntegrations.catalog.hubspot.useCase":
    "CRM, contacts, entreprises, transactions, tickets, analytique client",
  "mcpIntegrations.catalog.hubspot.setupNote":
    "Lorsqu’une HubSpot MCP Auth App gérée par l’espace de travail est configurée, tout membre peut connecter un compte HubSpot personnel avec OAuth et PKCE. Sinon, créez l’app dans HubSpot Developer Platform avant de vous connecter. Le connecteur OAuth HubSpot existant reste disponible pour les actions de l’app.",
  "mcpIntegrations.catalog.pylon.description":
    "Recherchez et mettez à jour les données de support Pylon.",
  "mcpIntegrations.catalog.pylon.useCase":
    "Support client, tickets, comptes, contacts, conversations",
  "mcpIntegrations.catalog.pylon.setupNote":
    "Activez l’accès MCP à Pylon pour les utilisateurs concernés et activez le serveur MCP dans Pylon avant de vous connecter. Pylon exige une licence Membre ou Admin et utilise uniquement l’OAuth utilisateur.",
  "mcpIntegrations.catalog.intercom.description":
    "Recherchez dans les conversations et la base de connaissances du support client.",
  "mcpIntegrations.catalog.intercom.useCase":
    "Support client, conversations, contacts, contenu du centre d’aide",
  "mcpIntegrations.catalog.intercom.setupNote":
    "L’intégration Intercom utilise OAuth et est disponible pour les espaces de travail hébergés aux États-Unis. Vérifiez la région de l’espace de travail et les portées demandées lors de l’autorisation.",
  "mcpIntegrations.catalog.monday.description":
    "Travaillez avec les tableaux, les éléments et les flux de travail de l’équipe.",
  "mcpIntegrations.catalog.monday.useCase":
    "Gestion du travail, tableaux, projets, tâches, opérations d’équipe",
  "mcpIntegrations.catalog.monday.setupNote":
    "L’intégration monday.com utilise OAuth via Streamable HTTP. Choisissez l’espace de travail et les autorisations à partager lors de l’autorisation.",
  "mcpIntegrations.catalog.webflow.description":
    "Consultez et mettez à jour les sites et le contenu Webflow.",
  "mcpIntegrations.catalog.webflow.useCase":
    "Sites web, CMS, contenu du site, publication, flux de travail de design",
  "mcpIntegrations.catalog.webflow.setupNote":
    "L’intégration Webflow utilise OAuth. Les fonctionnalités Designer peuvent installer la Bridge App de Webflow lors de l’autorisation. L’accès à la Data API est disponible séparément.",
  "mcpIntegrations.catalog.paypal.description":
    "Travaillez avec les paiements, les factures et les données commerciales PayPal.",
  "mcpIntegrations.catalog.paypal.useCase":
    "Paiements, factures, transactions, opérations marchandes",
  "mcpIntegrations.catalog.paypal.setupNote":
    "PayPal propose la découverte et la connexion OAuth pour son intégration d’agent distante. Agent-Native utilise le point de terminaison /sse actuellement en service. Vérifiez les autorisations marchandes avant d’autoriser l’accès.",
  "mcpIntegrations.catalog.box.description":
    "Recherchez et gérez les fichiers et dossiers dans Box.",
  "mcpIntegrations.catalog.box.useCase":
    "Fichiers, dossiers, contenu d’entreprise, recherche, collaboration",
  "mcpIntegrations.catalog.box.setupNote":
    "L’intégration Box est en bêta et doit être activée par un administrateur. Les clients personnalisés ont aussi besoin de Box Integration Credentials, d’un URI de redirection et de portées approuvées.",
  "mcpIntegrations.catalog.builder.description":
    "Recherchez du contenu Builder Publish et Hybrid Space.",
  "mcpIntegrations.catalog.builder.useCase":
    "Modèles de contenu, pages, entrées, Publish et Hybrid Spaces",
  "mcpIntegrations.catalog.builder.setupNote":
    "Builder CMS MCP utilise OAuth avec l’enregistrement dynamique de clients. Il se connecte uniquement aux Publish ou Hybrid Spaces, et le flux d’autorisation vous demande de sélectionner l’espace.",
  "mcpIntegrations.catalog.netlify.description":
    "Inspectez et pilotez les sites et déploiements Netlify.",
  "mcpIntegrations.catalog.netlify.useCase":
    "Sites, déploiements, builds, domaines, opérations d’hébergement",
  "mcpIntegrations.catalog.netlify.setupNote":
    "Netlify documente une configuration d’intégration distante pour les clients pris en charge. Vérifiez les autorisations du site et de l’équipe avant de terminer la procédure OAuth.",
  "mcpIntegrations.catalog.zapier.description":
    "Connectez des outils à des milliers d’actions d’apps.",
  "mcpIntegrations.catalog.zapier.useCase":
    "Automatisation, flux de travail, actions d’apps, opérations entre services",
  "mcpIntegrations.catalog.zapier.setupNote":
    "L’intégration d’agent de Zapier utilise une connexion et un jeton créés par l’utilisateur pour les clients non répertoriés. Créez la connexion dans Zapier, puis collez le jeton bearer généré dans le champ d’en-tête.",
  "mcpIntegrations.auth.none": "Aucune authentification",
  "mcpIntegrations.auth.headers": "En-tête",
  "mcpIntegrations.auth.oauth": "OAuth",
  "mcpIntegrations.status.beta": "Bêta",
  "mcpIntegrations.status.setupRequired": "Configuration du fournisseur",
  "mcpIntegrations.status.clientRestricted": "Clients approuvés uniquement",
  "mcpIntegrations.status.verified": "Vérifié",
  "mcpIntegrations.status.preflightOnly": "Prévérification uniquement",
  "mcpIntegrations.status.restricted": "Restreint",
  "limit.account": "votre compte",
  "limit.descriptionAll":
    "L’agent a utilisé toutes les étapes disponibles. Continuez dans une nouvelle interaction ou augmentez d’abord la limite de {{scope}}.",
  "limit.descriptionWithCount":
    "L’agent a utilisé {{formattedCount}} étapes. Continuez dans une nouvelle interaction ou augmentez d’abord la limite de {{scope}}.",
  "limit.keepGoing": "Continuer",
  "limit.maxSteps": "Nombre maximal d’étapes",
  "limit.namedOrganization": "l’organisation {{organization}}",
  "limit.organization": "l’organisation",
  "limit.ownerOnly":
    "Seuls les propriétaires et les administrateurs de l’organisation peuvent modifier cette limite.",
  "limit.reached": "Limite d’étapes atteinte",
  "limit.saveAndContinue": "Enregistrer et continuer",
  "message.actions": "Actions du message",
  "message.copyMessage": "Copier le message",
  "message.copyRequestId": "Copier l’ID de requête",
  "message.requestIdUnavailable": "ID de requête indisponible",
  "message.edit": "Modifier le message",
  "message.forkChat": "Dupliquer le chat",
  "message.missingFinal":
    "L’agent s’est arrêté sans envoyer de message final. Demandez-lui de continuer ou réessayez.",
  "message.messages": "Liste des messages",
  "message.nextBranch": "Branche suivante",
  "message.noRestoreRun": "Ce message ne possède aucune exécution à restaurer.",
  "message.previousBranch": "Branche précédente",
  "message.regenerate": "Régénérer la réponse",
  "message.restoreFailed": "Échec de la restauration ({{status}}).",
  "message.restoreQuestion": "Restaurer jusqu’ici ?",
  "message.revertQuestion":
    "Revenir à ce point ? Les modifications ultérieures seront perdues.",
  "message.restoreRequestFailed": "Échec de la demande de restauration.",
  "message.threadNotFound":
    "Ce fil de discussion n’est plus disponible. Démarrez une nouvelle discussion ou réessayez si cela est inattendu.",
  "message.restoring": "Restauration...",
  "message.revertHere": "Revenir jusqu’ici",
  "message.revertToBeginning": "Revenir au début",
  "message.sentAt": "Envoyé à {{time}}",
  "plan.act": "Agir",
  "plan.implement": "Implémenter",
  "plan.mode": "Mode Plan",
  "plan.ready": "Plan prêt",
  "plan.switchToAct": "Passer au mode Action",
  "queue.count": "{{count}} en attente",
  "queue.followUp": "Envoyer un message de suivi...",
  "queue.followUpWithCount":
    "{{count}} en attente — envoyer un message de suivi...",
  "queue.remove": "Retirer de la file d’attente",
  "queue.sendNow": "Envoyer maintenant",
  "queue.sendNowHint": "Envoyer maintenant (arrête la réponse actuelle)",
  "queue.steer": "Orienter",
  "queue.steerHint": "Envoyer ce message ensuite",
  "queue.moreActions": "Autres actions",
  "queue.moveToTop": "Déplacer en haut",
  "recovery.connectingBuilder": "Connexion à Builder.io",
  "recovery.copyDebug": "Copier les informations de débogage",
  "recovery.copyFailed": "Échec de la copie",
  "recovery.credentialRejected":
    "Le fournisseur du modèle a refusé les identifiants enregistrés. Mettez à jour votre connexion Builder.io ou la clé du fournisseur, puis réessayez d’envoyer ce message.",
  "codeRequired.builderAgentNotConnected":
    "Les Builder Cloud Agents ne sont pas connectés. Connectez Builder.io dans les paramètres pour exécuter cette opération hébergée de modification du code. Les clés de fournisseur de modèle fonctionnent toujours pour le chat et les autres fonctions d’IA, mais elles n’autorisent pas le Builder Cloud Agent.",
  "recovery.diagnoseRetry": "Diagnostiquer et réessayer",
  "recovery.forkDescription":
    "Dupliquez cette conversation dans un fil de discussion distinct.",
  "recovery.forkFailed":
    "Impossible de dupliquer ce chat. Essayez de démarrer un nouveau chat.",
  "recovery.forking": "Duplication...",
  "recovery.newChatHint":
    "Si la nouvelle tentative produit la même erreur, démarrez une nouvelle session de chat et reprenez à partir des modifications déjà effectuées.",
  "recovery.backgroundTimeout":
    "L’exécution précédente de l’agent en arrière-plan a atteint sa limite de temps avant de se terminer. Le travail partiel a été conservé ; continuez ou réessayez à partir d’ici.",
  "recovery.noProgress":
    "L’exécution précédente de l’agent ne montrait plus de progression pendant la récupération et a été arrêtée avant de pouvoir continuer en boucle.",
  "recovery.statusCheckFailed":
    "Impossible de joindre le serveur pour vérifier si l’agent travaille toujours. Renvoyez votre message pour réessayer.",
  "recovery.streamEnded":
    "Le flux précédent de l’agent s’est terminé pendant la récupération. Continuez ou réessayez pour vous reconnecter à l’exécution.",
  "recovery.reconnectBuilder": "Reconnecter Builder.io",
  "secrets.addCustomKeyNamed": 'Ajouter "{{name}}" comme clé personnalisée',
  "secrets.chooseKey": "Choisir une clé",
  "secrets.customKey": "Clé personnalisée",
  "secrets.customKeyHint": "Ajoutez n'importe quelle clé par son nom",
  "secrets.emptyHint": "Ajoutez une clé pour utiliser vos propres comptes.",
  "secrets.emptyMore":
    "et {{count}} de plus sous Nouveau, ou ajoutez n'importe quelle clé personnalisée",
  "secrets.emptyTitle": "Aucune clé pour le moment.",
  "secrets.fromEnvironment": "Fourni par l'environnement de déploiement.",
  "secrets.managedInVault":
    "Géré dans le Vault de l'espace de travail. Chaque application de cet espace de travail utilise cette valeur.",
  "secrets.openVault": "Ouvrir Vault",
  "secrets.managedByOwner": "Géré dans {{owner}}",
  "secrets.removeCredentials": "Supprimer les identifiants",
  "secrets.confirmRemove": "Supprimer",
  "secrets.sharedKeysKept":
    "Certaines clés partagées n’ont pas été supprimées. Seuls les administrateurs de l’espace de travail peuvent les supprimer.",
  "secrets.newKey": "Nouveau",
  "secrets.noKeysFound": "Aucune clé trouvée.",
  "secrets.overridesVault":
    "Cette clé personnelle remplace la valeur du Vault de l'espace de travail. Supprimez-la pour utiliser la clé du Vault.",
  "secrets.overridesWorkspace":
    "Cette clé personnelle remplace la valeur de l'espace de travail. Supprimez-la pour utiliser la clé partagée.",
  "secrets.setForWorkspace":
    "Défini pour tout le monde dans cet espace de travail.",
  "secrets.sourceEnvironment": "Environnement",
  "secrets.sourceVault": "Vault",
  "secrets.sourceWorkspace": "Espace de travail",
  "secrets.statusUnavailable": "Indisponible",
  "secrets.required": "Obligatoire",
  "secrets.searchKeys": "Rechercher des clés...",
  "secrets.usePersonalKey": "Utiliser une clé personnelle à la place",
  "selection.attached": "{{formattedCount}} caractères de la sélection joints",
  "selection.clear": "Effacer le contexte de la sélection",
  "setup.addOwnKeys": "Ajouter vos propres clés",
  "setup.builderCredits":
    "Builder.io inclut des crédits gratuits, mais vous pouvez aussi utiliser votre propre clé API.",
  "setup.builderOrOwnKeys":
    "Utilisez Builder.io (crédits gratuits) ou ajoutez les clés de votre propre fournisseur.",
  "setup.connectAi": "Connecter l’IA",
  "setup.connectBuilder": "Connecter Builder.io",
  "setup.connectPlaceholder": "Connectez l’IA pour commencer à discuter...",
  "setup.connectToChat": "Connecter l’IA au chat",
  "setup.connectToStart": "Connectez l’IA pour commencer à discuter",
  "setup.checkingProvider": "Vérification de la connexion à l’IA…",
  "setup.providerStatusUnavailable":
    "Impossible de vérifier la connexion à l’IA.",
  "agentNativeClips.meetingAsk.placeholder": "Posez votre question",
  "agentNativeClips.meetingAsk.ariaLabel":
    "Posez une question sur cette réunion",
  "setup.connected": "Connecté",
  "setup.connectedOrganization": "Connecté — {{organization}}",
  "setup.connectedTo": "Connecté à {{organization}}",
  "setup.freeCredits":
    "Crédits gratuits pour les LLM, l’hébergement et bien plus encore — aucune clé API requise",
  "setup.keyProvider": "Fournisseur de clés API",
  "setup.keySaveFailed": "Impossible d’enregistrer la clé.",
  "setup.storedSecurely":
    "Stocké de façon sécurisée pour cette application uniquement.",
  "status.resuming": "Reprise",
  "status.stillWorking": "Toujours en cours",
  "status.thinking": "Réflexion",
  "status.working": "Travail en cours",
  "shell.chat": "Chat",
  "shell.loadingTerminal": "Chargement du terminal...",
  "shell.toggleAgent": "Afficher ou masquer l’agent",
  "status.contactingModel": "Connexion au modèle",
  "status.starting": "Démarrage de {{activity}}...",
  "status.preparing": "Préparation de {{activity}}...",
  "status.writing": "Écriture de {{activity}}...",
  "status.stillGenerating": "Génération de {{activity}} toujours en cours",
  "status.runningTool": "Exécution de {{activity}}",
  "tabs.allChats": "Tous les chats",
  "tabs.closeTab": "Fermer l’onglet",
  "tabs.main": "Principal",
  "tabs.newChat": "Nouveau chat",
  "tabs.subAgent": "Sous-agent...",
  "tool.askedAgent": "{{agent}} a été consulté",
  "tool.askingAgent": "Consultation de {{agent}}...",
  "tool.elapsed": "Temps écoulé : {{duration}}",
  "tool.askingAgentFailed": "Erreur lors de la consultation de {{agent}}",
  "tool.input": "Entrée",
  "tool.inputWithLabel": "Entrée - {{label}}",
  "tool.interrupted":
    "Interrompu avant la confirmation de la fin de l’opération ; celle-ci a peut-être abouti ou non. Vérifiez avant de réessayer.",
  "tool.longRunning":
    "Toujours en cours. Les mises à jour importantes peuvent prendre une ou deux minutes.",
  "tool.ranTools": "{{count}} outils exécutés",
  "tool.rawOutput": "Sortie brute de l’appel à l’outil {{tool}}",
  "tool.repeated": "Répété {{count}} fois",
  "tool.result": "Résultat",
  "tool.subAgentTask": "Tâche du sous-agent",
  "thinking.collapsed": "Replié",
  "thinking.display": "Réflexion",
  "thinking.expanded": "Développé",
  "thinking.hidden": "Masqué",
  "tool.thought": "Réflexion",
  "tool.thoughtFor": "Réflexion pendant {{duration}}",
  "tool.viewOutput": "Afficher la sortie de {{tool}}",
  "tool.worked": "A travaillé",
  "tool.workedFor": "A travaillé pendant {{duration}}",
  "widget.chart": "Graphique",
  "widget.dataChart": "Graphique de données",
  "widget.dataInsights": "Informations sur les données",
  "widget.dataTable": "Tableau de données",
  "widget.downloadCsv": "Télécharger le CSV",
  "widget.connectProvider": "Connecter {{provider}}",
  "widget.loadingToolResult": "Chargement du résultat de l’outil",
  "widget.noRows": "Aucune ligne",
  "widget.points": "{{formattedCount}} points",
  "widget.rows": "{{formattedCount}} lignes",
  "widget.sampled": "échantillonné",
  "commands.clearShort": "Démarrer une nouvelle discussion",
  "commands.newShort": "Démarrer une nouvelle discussion",
  "composer.actDescription":
    "Utiliser les outils et apporter les modifications approuvées",
  "composer.activeAppContext": "Contexte d'application actif",
  "composer.actMode": "Mode agir",
  "composer.add": "Ajouter...",
  "composer.addOwnKeys": "Clés personnalisées",
  "composer.assets.closePicker": "Fermer le sélecteur d'images",
  "composer.assets.contextTitle": "Image : {{title}}",
  "composer.assets.generatedImage": "Image générée",
  "composer.assets.generateImage": "Générer une image",
  "composer.assets.invalidUrl":
    "L'URL du sélecteur d'images configurée n'est pas valide.",
  "composer.assets.loadingPicker": "Chargement du sélecteur Assets",
  "composer.assets.openPicker": "Ouvrir le sélecteur d'images Assets",
  "composer.assets.openSecurely":
    "Ouvrez Assets dans un nouvel onglet pour vous connecter et choisir une image en toute sécurité.",
  "composer.assets.pickerTitle": "Sélecteur d'images Assets",
  "composer.auto": "Auto",
  "composer.builderModelCredits":
    "Crédits gratuits pour Claude, OpenAI et Gemini",
  "composer.chatGptSubscription": "Abonnement à ChatGPT",
  "composer.closePreview": "Fermer l'aperçu",
  "composer.configureProviderKeys":
    "Configurer Anthropic, OpenAI ou un autre fournisseur",
  "composer.connectAbove":
    "Connectez un fournisseur d’IA ci-dessus pour continuer...",
  "composer.connectBuilder": "Connecter Builder.io",
  "composer.connectKeys": "Connecter des clés",
  "composer.connectingBuilder": "Connexion à Builder.io…",
  "composer.costHigher": "Coût plus élevé",
  "composer.costLower": "Coût inférieur",
  "composer.costMedium": "Coût moyen",
  "composer.createAutomation": "Créer une automatisation",
  "composer.createAutomationPrefix": "Créer une automatisation : ",
  "composer.createExtension": "Créer une extension",
  "composer.createExtensionPrefix": "Créer une extension : ",
  "composer.createSkill": "Créer une compétence",
  "composer.createSkillPrefix": "Créer une compétence : ",
  "composer.currentDraft": "Brouillon actuel",
  "composer.defaultModel": "Modèle par défaut",
  "composer.describeAutomation":
    "Décrivez ce que vous souhaitez automatiser...",
  "composer.describeExtension":
    "Décrivez l'extension interactive que vous souhaitez créer...",
  "composer.describeSchedule": "Décrivez ce qui devrait arriver et quand...",
  "composer.describeSkill":
    "Décrivez la compétence que vous souhaitez créer...",
  "composer.documentTooLarge":
    "« {{name}} » fait {{size}} MB. {{label}} sont limités à {{maxSize}} MB afin de respecter la taille maximale des messages. Réduisez la taille du fichier ou divisez-le en plusieurs parties.",
  "composer.requestTooLarge":
    "Ce message et ses pièces jointes sont trop volumineux pour être envoyés. Supprimez une pièce jointe ou raccourcissez le message.",
  "composer.file": "fichier",
  "composer.imageModel": "Modèle d'image",
  "composer.imagePreview": "Aperçu de l'image",
  "composer.loadingModels": "Chargement des modèles",
  "composer.loadingModelsProgress": "Chargement des modèles…",
  "composer.menu.createAutomation": "Créer une automatisation",
  "composer.menu.createAutomationDescription":
    "Configurer une règle du type « si X, faire Y »",
  "composer.menu.createExtension": "Créer une extension",
  "composer.menu.createExtensionDescription":
    "Créer une extension de mini-application",
  "composer.menu.createSkill": "Créer une compétence",
  "composer.menu.createSkillDescription":
    "Apprenez à l'agent une nouvelle capacité",
  "composer.menu.generateImage": "Générer une image",
  "composer.menu.generateImageDescription":
    "Ouvrir le sélecteur d'images Assets",
  "composer.menu.integrations": "Intégrations",
  "composer.menu.integrationsDescription":
    "Connecter les outils et services à l'agent",
  "composer.menu.scheduleTask": "Planifier une tâche",
  "composer.menu.scheduleTaskDescription":
    "Exécuter quelque chose selon un calendrier",
  "composer.menu.uploadFile": "Télécharger le fichier",
  "composer.menu.uploadFileDescription": "Images, PDFs, texte/code, JSON, CSV",
  "composer.messageAgent": "Écrire à l’agent...",
  "composer.model": "Modèle",
  "composer.needsApiKey": "nécessite une clé API",
  "composer.pageTitle": "Titre de la page",
  "composer.pastedImageError":
    "Impossible de joindre l'image collée. Essayez un format différent.",
  "composer.pastedTextError": "Impossible de joindre le texte collé.",
  "composer.plan": "Plan",
  "composer.planDescription":
    "Recherche et approbation en lecture seule en premier",
  "composer.planDesktopRequired":
    "Ouvrez Agent-Native Desktop pour utiliser le mode Plan.",
  "composer.previewAttachment": "Aperçu {{name}}",
  "composer.reasoning": "Raisonnement",
  "composer.reasoningEffort.auto": "Auto",
  "composer.reasoningEffort.high": "Élevé",
  "composer.reasoningEffort.low": "Faible",
  "composer.reasoningEffort.max": "Max.",
  "composer.reasoningEffort.medium": "Moyen",
  "composer.reasoningEffort.minimal": "Minimal",
  "composer.reasoningEffort.none": "Aucun",
  "composer.reasoningEffort.xhigh": "Très élevé",
  "composer.reasoningExtraHighShort": "Très haut",
  "composer.reasoningMediumShort": "Moy.",
  "composer.reasoningMinimalShort": "Min.",
  "composer.removeContext": "Supprimer le contexte {{name}}",
  "composer.removeReference": "Supprimer la référence {{name}}",
  "composer.route": "Acheminement",
  "composer.scheduleTask": "Planifier une tâche",
  "composer.scheduleTaskPrefix": "Créer une tâche récurrente : ",
  "composer.selectedReferences": "Références sélectionnées",
  "composer.sendMessage": "Envoyer un message",
  "composer.skill.added": 'Compétence "{{name}}" ajoutée',
  "composer.skill.back": "Retour",
  "composer.skill.content": "Contenu",
  "composer.skill.createDescription":
    "Décrivez une compétence et laissez l'agent la rédiger",
  "composer.skill.createNew": "Créer une nouvelle compétence",
  "composer.skill.name": "Nom de la compétence",
  "composer.skill.review":
    "Vérifiez le contenu de {{name}} avant de l'enregistrer.",
  "composer.skill.savedAt": "Enregistré dans",
  "composer.skill.saveFailed":
    "Échec de l'enregistrement du fichier de compétences",
  "composer.skill.selectedFile": "le fichier sélectionné",
  "composer.skill.uploadDescription": "Importer un fichier SKILL.md existant",
  "composer.skill.uploadFailedStatus": "Échec du téléchargement ({{status}})",
  "composer.skill.uploadFile": "Télécharger le fichier de compétences",
  "composer.upload": "Télécharger",
  "composer.uploadFailed": "Impossible de télécharger le fichier sélectionné.",
  "composer.useAttachedContext": "Utilisez le contexte ci-joint.",
  "mentions.commands": "Commandes",
  "mentions.learnMore": "En savoir plus",
  "mentions.noResults": "Aucun résultat trouvé",
  "mentions.noSkills": "Aucune compétence disponible",
  "mentions.sections.agents": "Agents",
  "mentions.sections.connectedAgents": "Agents connectés",
  "mentions.sections.files": "Fichiers",
  "mentions.sections.other": "Autre",
  "mentions.skills": "Compétences",
  "mentions.typeToSearch": "Tapez pour rechercher...",
  "pastedText.characters": "{{formattedCount}} caractères",
  "pastedText.characters_many": "{{formattedCount}} caractères",
  "pastedText.characters_one": "{{formattedCount}} caractère",
  "pastedText.characters_other": "{{formattedCount}} caractères",
  "pastedText.lines": "{{formattedCount}} lignes",
  "pastedText.lines_many": "{{formattedCount}} lignes",
  "pastedText.lines_one": "{{formattedCount}} ligne",
  "pastedText.lines_other": "{{formattedCount}} lignes",
  "pastedText.preview": "Aperçu du texte collé",
  "pastedText.remove": "Supprimer le texte collé",
  "pastedText.title": "Texte collé",
  "voice.dictation.cancel": "Annuler (Esc)",
  "voice.dictation.cancelRecording": "Annuler l'enregistrement",
  "voice.dictation.start": "Dicter ({{shortcut}})",
  "voice.dictation.stopRecording": "Arrêter l'enregistrement",
  "voice.dictation.transcribing": "Transcription en cours…",
  "voiceMode.connectBuilder": "Connecter Builder.io",
  "voiceMode.end": "Terminer le mode vocal",
  "voiceMode.entryButtonLabel": "Utiliser un micro",
  "voiceMode.errors.channelDisconnected":
    "Le canal de commande vocale en temps réel s'est déconnecté.",
  "voiceMode.errors.connectionFailed":
    "La connexion vocale en temps réel a échoué.",
  "voiceMode.errors.connectionTimedOut":
    "La connexion vocale en temps réel a expiré.",
  "voiceMode.errors.offerFailed": "Le navigateur n'a pas créé d'offre audio.",
  "voiceMode.errors.responseFailed":
    "OpenAI n'a pas pu terminer la réponse vocale.",
  "voiceMode.errors.sessionFailed":
    "La session vocale en temps réel a rencontré une erreur.",
  "voiceMode.errors.unsupported":
    "Ce navigateur ne prend pas en charge les conversations vocales en temps réel.",
  "voiceMode.hideChat": "Masquer la discussion",
  "voiceMode.keepDictating": "Dicter un message",
  "voiceMode.promptDescription":
    "Le mode vocal continue d’écouter pendant que l’agent navigue et effectue des actions.",
  "voiceMode.promptTitle": "Utilisez votre voix",
  "voiceMode.rememberPreference": "Mémoriser ma préférence",
  "voiceMode.settings.autoLanguage": "Auto",
  "voiceMode.settings.defaultMicrophone": "Valeur par défaut du système",
  "voiceMode.settings.intelligence": "Intelligence",
  "voiceMode.settings.intelligenceLevels.balanced": "Équilibré",
  "voiceMode.settings.intelligenceLevels.deep": "Profond",
  "voiceMode.settings.intelligenceLevels.instant": "Instantané",
  "voiceMode.settings.language": "Langue",
  "voiceMode.settings.languages.de": "Allemand",
  "voiceMode.settings.languages.en": "Anglais",
  "voiceMode.settings.languages.es": "Espagnol",
  "voiceMode.settings.languages.fr": "Français",
  "voiceMode.settings.languages.it": "Italien",
  "voiceMode.settings.languages.ja": "Japonais",
  "voiceMode.settings.languages.ko": "Coréen",
  "voiceMode.settings.languages.pt": "Portugais",
  "voiceMode.settings.languages.zh": "Chinois",
  "voiceMode.settings.microphone": "Microphone",
  "voiceMode.settings.microphoneNumber": "Micro {{number}}",
  "voiceMode.settings.microphoneSwitchFailed":
    "Impossible de changer de microphone. Votre microphone actuel est toujours actif.",
  "voiceMode.settings.voiceChangePending":
    "Votre nouvelle voix s'appliquera la prochaine fois que vous démarrerez le mode vocal.",
  "voiceMode.settings.voiceDescriptions.alloy": "Équilibré et neutre",
  "voiceMode.settings.voiceDescriptions.ash": "Doux et confiant",
  "voiceMode.settings.voiceDescriptions.ballad": "Chaleureux et expressif",
  "voiceMode.settings.voiceDescriptions.cedar": "Clair et fondé",
  "voiceMode.settings.voiceDescriptions.coral": "Convivial et lumineux",
  "voiceMode.settings.voiceDescriptions.echo": "Clair et direct",
  "voiceMode.settings.voiceDescriptions.marin": "Chaleureux et naturel",
  "voiceMode.settings.voiceDescriptions.sage": "Calme et réfléchi",
  "voiceMode.settings.voiceDescriptions.shimmer": "Léger et optimiste",
  "voiceMode.settings.voiceDescriptions.verse": "Expressif et polyvalent",
  "voiceMode.settings.voiceStyle": "Style de voix",
  "voiceMode.setupDescription":
    "Connectez Builder.io pour utiliser la voix gérée avec des crédits gratuits, ou ajoutez vos propres clés.",
  "voiceMode.setupTitle": "Configurer le mode vocal",
  "voiceMode.showChat": "Afficher le chat",
  "voiceMode.start": "Démarrer le chat vocal",
  "voiceMode.startWithOpenAiKey": "Démarrer avec une clé OpenAI",
  "voiceMode.status.connecting": "Connexion en cours",
  "voiceMode.status.ending": "Fin du mode vocal",
  "voiceMode.status.error": "Le mode vocal nécessite votre attention",
  "voiceMode.status.listening": "À l’écoute",
  "voiceMode.status.speaking": "Parle",
  "voiceMode.status.working": "Travaille",
  "voiceMode.useOpenAiKey": "Ajoutez vos propres clés",
  "voiceMode.voiceSettings": "Paramètres vocaux",
  "duration.hourShort": "h",
  "duration.minuteShort": "m",
  "duration.secondShort": "s",
  "limit.descriptionWithCount_one":
    "L’agent a utilisé {{formattedCount}} étape. Continuez dans une nouvelle interaction ou augmentez d’abord la limite de {{scope}}.",
  "limit.descriptionWithCount_many":
    "L’agent a utilisé {{formattedCount}} étapes. Continuez dans une nouvelle interaction ou augmentez d’abord la limite de {{scope}}.",
  "limit.descriptionWithCount_other":
    "L’agent a utilisé {{formattedCount}} étapes. Continuez dans une nouvelle interaction ou augmentez d’abord la limite de {{scope}}.",
  "selection.attached_one": "{{formattedCount}} caractère de sélection joint",
  "selection.attached_many":
    "{{formattedCount}} caractères de la sélection joints",
  "selection.attached_other":
    "{{formattedCount}} caractères de la sélection joints",
  "tool.ranTools_one": "{{count}} outil exécuté",
  "tool.ranTools_many": "{{count}} outils exécutés",
  "tool.ranTools_other": "{{count}} outils exécutés",
  "widget.points_one": "{{formattedCount}} point",
  "widget.points_many": "{{formattedCount}} points",
  "widget.points_other": "{{formattedCount}} points",
  "widget.rows_one": "{{formattedCount}} ligne",
  "widget.rows_many": "{{formattedCount}} lignes",
  "widget.rows_other": "{{formattedCount}} lignes",
  "errorMessages.agentConnection":
    "La connexion de l'agent a été interrompue. Vérifiez votre connexion et réessayez.",
  "errorMessages.attachmentPasswordProtected":
    "Ce PDF est protégé par mot de passe et ne peut pas être lu. Supprimez la protection par mot de passe ou collez le texte pertinent, puis réessayez.",
  "errorMessages.builderAuthentication":
    "Builder a rejeté les identifiants connectés. Reconnectez Builder.io dans les paramètres, puis réessayez.",
  "errorMessages.builderModelUnauthorized":
    "Le fournisseur de ce modèle a rejeté la demande. Choisissez un autre modèle, puis réessayez.",
  "errorMessages.errorPrefix": "Erreur : {{message}}",
  "errorMessages.gatewayInternalError":
    "La passerelle du modèle a rencontré une erreur interne avant que l'agent puisse répondre. Réessayez dans un instant et indiquez l'identifiant d'erreur ci-dessous si cela persiste.",
  "errorMessages.gatewayNoDetails":
    "La passerelle du modèle n’a fourni aucun détail sur l’erreur et la discussion n’a pas pu reprendre. Patientez un instant et réessayez. Si le problème persiste, démarrez une nouvelle discussion.",
  "errorMessages.creditsLimitReached":
    "Vous avez atteint votre limite de crédits IA.",
  "errorMessages.inactivityTimeout":
    "La connexion à l’agent a expiré avant la fin. Vous pouvez poursuivre à partir du travail partiel ou réessayer.",
  "errorMessages.invalidToolSchema":
    "Le schéma d’un outil n’était pas valide. Le modèle a donc rejeté la demande avant son démarrage. Vous pouvez ignorer cet outil et réessayer.",
  "errorMessages.malformedRequest":
    "Le fournisseur du modèle a rejeté cette demande car elle était mal formée, elle n’a donc pas été réessayée. Réessayez ou démarrez une nouvelle conversation si le problème persiste.",
  "errorMessages.malformedRequestAttachment":
    "Le modèle a rejeté un fichier joint, donc ce message n’a jamais été envoyé. Retirez la pièce jointe et réessayez : un PDF, un fichier texte brut ou une image JPEG, PNG, GIF ou WebP est lu directement ; les autres formats doivent être téléversés puis liés.",
  "errorMessages.noProviderConnected":
    "Aucun fournisseur de LLM n’est connecté. Ouvrez Paramètres > Agent > Fournisseurs d’IA, puis connectez Builder.io (offre gratuite disponible) ou ajoutez une clé de fournisseur.",
  "errorMessages.openBuilderSpaceSettings":
    "Ouvrir les paramètres de l’espace Builder",
  "errorMessages.providerAuthentication":
    "Le fournisseur du modèle a rejeté la clé API enregistrée. Mettez-la à jour dans Paramètres → Intégrations → Clés API, puis réessayez.",
  "errorMessages.providerConfiguration":
    "Ce modèle ne peut pas utiliser d’outils avec les paramètres actuels. Changez de modèle dans les paramètres, puis réessayez.",
  "errorMessages.providerHtml":
    "Le fournisseur a renvoyé une page d'erreur HTML.",
  "errorMessages.providerNetwork":
    "Le fournisseur du modèle est injoignable. Vérifiez votre connexion et réessayez.",
  "errorMessages.providerRateLimit":
    "Le fournisseur du modèle limite temporairement cette discussion. Patientez un instant, puis réessayez.",
  "errorMessages.providerTransientRejection":
    "Le fournisseur d'IA a temporairement refusé cette demande. Cela se résout généralement en moins d'une minute : réessayez.",
  "errorMessages.startNewChat": "Démarrer une nouvelle discussion",
  "errorMessages.addCreditsInBuilder": "Ajouter des crédits dans Builder",
  "feedback.inaccurate": "Inexact",
  "feedback.keyboardHint": "{{shortcut}} Entrée pour envoyer",
  "feedback.notHelpful": "Peu utile",
  "feedback.placeholder": "Dites-nous ce qui n'a pas fonctionné...",
  "feedback.submit": "Envoyer",
  "feedback.submitted": "Commentaires envoyés",
  "feedback.thumbsDown": "Pouce vers le bas",
  "feedback.thumbsUp": "Pouce vers le haut",
  "feedback.tooSlow": "Trop lent",
  "feedback.whatWentWrong": "Qu'est-ce qui n'a pas fonctionné ?",
  "feedback.wrongTool": "Mauvais outil",
  "contextMeter.ariaLabel":
    "Contexte {{percent}} %, {{totalTokens}}{{breakdown}}. Ouvrir l’analyse du contexte.",
  "contextMeter.breakdown":
    " au total : {{systemTokens}} système + {{conversationTokens}} conversation",
  "contextMeter.summary": "Contexte {{percent}}% · {{totalTokens}}",
  "contextMeter.summaryBreakdown":
    " ({{systemTokens}} système + {{conversationTokens}} conversation)",
  "contextXray.advisory": "Indicatif",
  "contextXray.conversation": "{{count}} conversation",
  "contextXray.currentStatus": "État actuel",
  "contextXray.estimated": "estimé",
  "contextXray.estimatedPrefix": " estimé",
  "contextXray.estimatedSuffix": " · estimé",
  "contextXray.evict": "Retirer",
  "contextXray.evicted": "{{count}} retirés",
  "contextXray.evictSegment": "Retirer le segment",
  "contextXray.framework": "Framework",
  "contextXray.free": "{{count}} libres",
  "contextXray.governance.inherited": "Hérité",
  "contextXray.governance.required": "Requis",
  "contextXray.governance.user": "Votre contexte",
  "contextXray.groups.conversation": "Conversation",
  "contextXray.groups.evicted": "Retirés",
  "contextXray.groups.filesRead": "Fichiers lus",
  "contextXray.groups.pinned": "Épinglés",
  "contextXray.groups.taskInstructions": "Tâche et instructions",
  "contextXray.groups.thinking": "Réflexion",
  "contextXray.groups.toolResults": "Résultats des outils",
  "contextXray.inspect": "Inspecter {{name}}",
  "contextXray.list": "Liste",
  "contextXray.loading": "Chargement du contexte...",
  "contextXray.map": "Carte",
  "contextXray.messageIndex": "index des messages",
  "contextXray.noActiveSegments": "Aucun segment actif",
  "contextXray.panelTitle": "Analyse du contexte",
  "contextXray.partIndex": "index des parties",
  "contextXray.pin": "Épingler",
  "contextXray.pinned": "{{count}} épinglés",
  "contextXray.pinSegment": "Épingler le segment",
  "contextXray.protectedDescription":
    "Ce segment fait partie du tour actif et ne peut pas encore être retiré.",
  "contextXray.protectedDuringTurn": "Protégé pendant le tour actif",
  "contextXray.recordEvictionIntent": "Enregistrer l’intention de retrait",
  "contextXray.restore": "Restaurer",
  "contextXray.restoreSegment": "Restaurer le segment",
  "contextXray.segment": "Segment",
  "contextXray.showList": "Afficher la liste contextuelle",
  "contextXray.showMap": "Afficher la carte contextuelle",
  "contextXray.status.active": "Actif",
  "contextXray.status.evicted": "Retiré",
  "contextXray.status.pinned": "Épinglé",
  "contextXray.status.protected": "Protégé",
  "contextXray.status.summarized": "Résumé",
  "contextXray.system": "{{count}} système",
  "contextXray.systemOrdered": "Système · ordonné, non retirable",
  "contextXray.tokens": "jetons",
  "contextXray.tokensShare": "jetons · {{share}} %",
  "contextXray.unpin": "Désépingler",
  "contextXray.unpinSegment": "Désépingler le segment",
  "share.add": "Ajouter",
  "share.addPeopleEmail": "Ajouter des personnes par email",
  "share.addPeopleOrganization": "Ajouter des personnes de votre organisation",
  "share.admin": "Administrateur",
  "share.adminDescription": "Peut modifier et gérer l'accès",
  "share.commenter": "Commentateur",
  "share.commenterDescription": "Peut consulter et ajouter des commentaires",
  "share.advanced": "Avancé",
  "share.advancedAccess": "Accès avancé",
  "share.advancedDescription":
    "Contrôlez la façon dont l’accès à l’organisation apparaît dans la recherche.",
  "share.copied": "Copié",
  "share.copy": "Copier",
  "share.shareWithAgents": "Partager avec des agents",
  "share.agentContext": "Lien de contexte de l'agent",
  "share.agentContextDescription":
    "Contexte en lecture seule pour un agent externe.",
  "share.preparingAgentLink": "Préparation du lien de l'agent...",
  "share.agentLinkUnavailable": "Impossible de créer le lien de l'agent.",
  "share.retryAgentLink": "Réessayer",
  "share.editor": "Éditeur",
  "share.editorDescription": "Peut modifier",
  "share.generalAccess": "Accès général",
  "share.hideInSearch": "Masquer dans la recherche",
  "share.linkCanStillOpen":
    "Les personnes disposant du lien peuvent toujours l'ouvrir.",
  "share.loading": "Chargement...",
  "share.loadMore": "Afficher plus",
  "share.loadFailed": "Impossible de charger les paramètres de partage.",
  "share.loadPeopleFailed": "Impossible de charger des personnes.",
  "share.noAccess": "Personne n'y a encore accès.",
  "share.noMatches": "Aucun résultat.",
  "share.noPeopleFound": "Aucune personne trouvée.",
  "share.notifyPeople": "Notifier les personnes",
  "share.message": "Message",
  "share.addMessage": "Ajouter un message",
  "share.hideMessage": "Masquer le message",
  "share.messagePlaceholder": "Ajouter une courte note (facultatif)",
  "share.organization": "Organisation",
  "share.organizationDescription":
    "Tous les membres de votre organisation peuvent consulter",
  "share.owner": "Propriétaire",
  "share.peopleWithAccess": "Personnes ayant accès",
  "share.private": "Privé",
  "share.privateDescription":
    "Seules les personnes disposant d’un accès peuvent consulter",
  "share.public": "Public",
  "share.publicDescription": "Toute personne disposant du lien peut consulter",
  "share.remove": "Retirer",
  "share.role": "Rôle",
  "share.searching": "Recherche en cours...",
  "share.share": "Partager",
  "share.shareLink": "Partager le lien",
  "share.shareOptions": "Options de partage",
  "share.titleWithResource": 'Partager "{{title}}"',
  "share.titleWithType": "Partager {{type}}",
  "share.triggerWithVisibility": "Partager ({{visibility}})",
  "share.unknownPerson": "Personne inconnue",
  "share.viewer": "Lecteur",
  "share.viewerDescription": "Peut consulter",
  "share.userGroup": "Groupe d’utilisateurs",
  "settings.emailTitle": "Adresse e-mail",
  "settings.emailChange": "Changer d’adresse e-mail",
  "settings.emailChanging": "Envoi...",
  "settings.emailChangeSent":
    "Consultez vos e-mails pour confirmer ce changement.",
  "settings.emailChangeError": "Impossible d’envoyer la confirmation.",
  "settings.emailNewLabel": "Nouvelle adresse e-mail",
  "settings.emailNewPlaceholder": "Saisissez une nouvelle adresse e-mail",
  "usage.builderCredits": "Crédits Builder",
  "usage.inviteFriends": "Inviter des amis",
  "usage.inviteCredits":
    "Gagnez {{amount}} crédits Builder lorsqu’un ami s’abonne.",
  "usage.copyInviteLink": "Copier le lien d’invitation",
  "usage.inviteLinkCopied": "Lien d’invitation copié",
  "usage.creditBalance": "Solde de l’espace de travail",
  "usage.monthlyPlan": "Forfait mensuel",
  "usage.dailyFreeLimit": "Limite quotidienne gratuite",
  "usage.creditUsedOfLimit": "{{used}} sur {{limit}} utilisés",
  "usage.creditRemaining": "{{amount}} restants",
  "usage.creditUsageUnavailable":
    "Impossible de charger l’utilisation des crédits Builder.",
  "usage.estimatedBuilderCredits": "~{{amount}} crédits estimés",
  "usage.otherUsdSpend": "{{amount}} USD supplémentaires",
  "usage.noBuilderCredits": "0 crédit Builder",
  "usage.otherUnclassifiedSpend": "Dépenses USD autres ou non classées",
  "usage.providerSpendDetail":
    "Utilisation du fournisseur ou anciens appels hors facturation Builder",
  "usage.providerSpendToday":
    "Autre utilisation ou non classée aujourd’hui : {{amount}}",
  "usage.driverCreditsAndUsd": "Crédits Builder / USD",
  "settings.usage.tabsLabel": "Vues d'utilisation",
  "settings.usage.tabOverview": "Vue d'ensemble",
  "settings.usage.tabActivity": "Activité",
  "settings.usage.rangeLabel": "Période",
  "settings.usage.range7": "7 derniers jours",
  "settings.usage.range30": "30 derniers jours",
  "settings.usage.range90": "90 derniers jours",
  "settings.usage.appFilterLabel": "App",
  "settings.usage.allApps": "Toutes les apps",
  "settings.usage.unattributedApp": "Non attribué",
  "settings.usage.peopleFilterLabel": "Personnes",
  "settings.usage.everyone": "Tout le monde",
  "settings.usage.justYou": "Vous uniquement",
  "settings.usage.estimatedSpend": "Dépenses estimées",
  "settings.usage.creditSpend": "Crédits Builder.io dépensés",
  "settings.usage.yourEstimatedSpend": "Vos dépenses estimées",
  "settings.usage.yourCreditSpend": "Vos crédits Builder.io dépensés",
  "settings.usage.calls": "Appels",
  "settings.usage.tokens": "Tokens",
  "settings.usage.activePeople": "Personnes actives",
  "settings.usage.history": "Historique d'utilisation",
  "settings.usage.historyDimensionLabel":
    "Regrouper l'historique d'utilisation",
  "settings.usage.byFeature": "Par fonctionnalité",
  "settings.usage.byApp": "Par app",
  "settings.usage.byModel": "Par modèle",
  "settings.usage.bySurface": "Par surface",
  "settings.usage.historyChartLabel": "Utilisation quotidienne",
  "settings.usage.noUsage": "Aucune utilisation sur cette période.",
  "settings.usage.total": "Total",
  "settings.usage.featureChat": "Chat",
  "settings.usage.featureSubAgents": "Sous-agents",
  "settings.usage.featureAutomations": "Automatisations",
  "settings.usage.other": "Autre",
  "settings.usage.unknownModel": "Modèle inconnu",
  "settings.usage.surfaceApp": "Dans l'app",
  "settings.usage.topChats": "Principaux chats",
  "settings.usage.untitledChat": "Chat sans titre",
  "settings.usage.titleUnavailable": "Impossible de charger le titre",
  "settings.usage.showAll": "Tout afficher",
  "settings.usage.showLess": "Afficher moins",
  "settings.usage.topPeople": "Principales personnes",
  "settings.usage.you": "Vous",
  "settings.usage.toolCalls": "Appels d'outils",
  "settings.usage.toolCallsChartLabel": "Appels d'outils par jour",
  "settings.usage.noToolCalls": "Aucun appel d'outil sur cette période.",
  "settings.usage.toolCallsUnavailable":
    "Impossible de charger les appels d'outils.",
  "settings.usage.modelCalls": "Appels au modèle",
  "settings.usage.modelCallsDimensionLabel": "Regrouper les appels au modèle",
  "settings.usage.modelCallsChartLabel": "Appels au modèle par jour",
  "settings.usage.noModelCalls": "Aucun appel au modèle sur cette période.",
  "settings.usage.recentPrompts": "Prompts récents",
  "settings.usage.promptNotCaptured": "Prompt non enregistré",
  "settings.usage.promptUnavailable": "Impossible de charger le prompt",
  "settings.usage.loadError": "Impossible de charger l'utilisation.",
  "settings.usage.yourAlerts": "Vos alertes",
  "settings.usage.alertsLoadError": "Impossible de charger les alertes.",
  "settings.usage.alertDailySpend": "Dépenses quotidiennes",
  "settings.usage.alertMonthlySpend": "Dépenses mensuelles",
  "settings.usage.alertDailyTokens": "Tokens quotidiens",
  "settings.usage.alertMonthlyTokens": "Tokens mensuels",
  "settings.usage.alertOnTrack": "Dans la limite",
  "settings.usage.alertOverLimit": "Limite dépassée",
  "settings.usage.alertDismissed": "Ignorée",
  "settings.usage.alertOff": "Désactivée",
  "settings.usage.alertProgressDay": "{{current}} sur {{limit}} aujourd'hui",
  "settings.usage.alertProgressMonth": "{{current}} sur {{limit}} ce mois-ci",
  "settings.usage.alertChannelsBoth": "Dans l'app et par e-mail",
  "settings.usage.alertChannelInApp": "Dans l'app",
  "settings.usage.alertChannelEmail": "E-mail",
  "settings.usage.alertDefault": "Par défaut",
  "settings.usage.alertEdit": "Modifier",
  "settings.usage.alertDialogTitle": "Alerte : {{name}}",
  "settings.usage.alertThreshold": "M'alerter à partir de",
  "settings.usage.alertHintDayAll": "Par jour, sur toutes les apps.",
  "settings.usage.alertHintMonthAll": "Par mois, sur toutes les apps.",
  "settings.usage.alertHintDayApp": "Par jour, dans {{app}}.",
  "settings.usage.alertHintMonthApp": "Par mois, dans {{app}}.",
  "settings.usage.alertNotify": "Notifier",
  "settings.usage.alertEnabled": "Alerte activée",
  "settings.usage.alertReset": "Rétablir la valeur par défaut",
  "settings.usage.alertInvalidLimit": "Saisissez un montant supérieur à zéro.",
  "settings.usage.alertNoChannel":
    "Choisissez au moins un mode de notification.",
  "settings.usage.alertSaveError": "Impossible d'enregistrer l'alerte.",
  "settings.usage.unitUsd": "USD",
  "settings.usage.unitCredits": "crédits",
  "settings.usage.unitTokens": "tokens",
  "settings.usage.creditAmount_one": "{{amount}} crédit",
  "settings.usage.creditAmount_many": "{{amount}} crédits",
  "settings.usage.creditAmount_other": "{{amount}} crédits",
  "settings.usage.tokenAmount_one": "{{amount}} token",
  "settings.usage.tokenAmount_many": "{{amount}} tokens",
  "settings.usage.tokenAmount_other": "{{amount}} tokens",
  "settings.storage.provider": "Fournisseur",
  "settings.storage.providerOther": "Autre compatible S3",
  "settings.storage.endpoint": "URL du point de terminaison",
  "settings.storage.bucket": "Bucket",
  "settings.storage.accessKeyId": "ID de clé d'accès",
  "settings.storage.secretAccessKey": "Clé d'accès secrète",
  "settings.storage.region": "Région",
  "settings.storage.publicUrl": "URL publique",
  "settings.storage.optional": "Facultatif",
  "settings.storage.saved": "Enregistrée",
  "settings.storage.hintAws":
    "Utilisez le point de terminaison de la région de votre bucket.",
  "settings.storage.hintR2":
    "Vous le trouverez dans les paramètres de votre bucket R2.",
  "settings.storage.hintSupabase":
    "Vous le trouverez dans les paramètres Storage de votre projet.",
  "settings.storage.hintOther":
    "MinIO, Backblaze B2, Wasabi et DigitalOcean Spaces fonctionnent aussi.",
  "settings.storage.save": "Enregistrer",
  "settings.storage.saving": "Enregistrement…",
  "settings.storage.cancel": "Annuler",
  "settings.storage.clear": "Effacer les identifiants",
  "settings.storage.clearing": "Effacement…",
  "settings.storage.clearTitle": "Effacer les identifiants de stockage ?",
  "settings.storage.clearBuilder":
    "Les nouveaux envois iront dans le stockage Builder.io.",
  "settings.storage.clearNoFallback":
    "Les envois échoueront tant que le stockage ne sera pas reconfiguré.",
  "settings.storage.clearExisting":
    "Les fichiers existants restent dans {{bucket}}.",
  "settings.storage.clearExistingGeneric":
    "Les fichiers existants restent dans votre bucket.",
  "settings.storage.invalidUrl":
    "Utilisez une URL qui commence par https:// ou http://.",
  "settings.storage.invalidBucket":
    "Les noms de bucket utilisent des lettres, des chiffres, des points, des tirets et des traits de soulignement.",
  "settings.storage.savedNotice":
    "Stockage des fichiers enregistré. Les nouveaux envois iront dans {{bucket}}.",
  "settings.storage.cleared": "Identifiants de stockage effacés.",
  "settings.storage.clearedBuilder":
    "Identifiants de stockage effacés. Les nouveaux envois iront dans Builder.io.",
  "settings.storage.saveFailed":
    "Impossible d'enregistrer le stockage des fichiers.",
  "settings.storage.clearFailed":
    "Impossible d'effacer les identifiants de stockage.",
  "settings.storage.loadFailed":
    "Impossible de charger les paramètres de stockage des fichiers.",
  "settings.storage.retry": "Réessayer",
  "settings.storage.adminOnly":
    "Seuls les propriétaires et administrateurs de l'organisation peuvent modifier le stockage des fichiers.",
  "settings.audit.action": "Action",
  "settings.audit.allApps": "Toutes les apps",
  "settings.audit.app": "App",
  "settings.audit.changedBy": "Modifié par",
  "settings.audit.close": "Fermer",
  "settings.audit.empty": "Aucune modification sur cette période.",
  "settings.audit.emptyDescription":
    "Les modifications faites par les personnes et l’agent apparaissent ici.",
  "settings.audit.failed": "Échec",
  "settings.audit.input": "Entrée",
  "settings.audit.inputLoadFailed": "Impossible de charger l’entrée.",
  "settings.audit.last30Days": "30 derniers jours",
  "settings.audit.last7Days": "7 derniers jours",
  "settings.audit.last90Days": "90 derniers jours",
  "settings.audit.loadFailed": "Impossible de charger le journal d’audit.",
  "settings.audit.loading": "Chargement du journal d’audit",
  "settings.audit.onBehalfOf": "Au nom de",
  "settings.audit.range": "Période",
  "settings.audit.refused": "Refusé",
  "settings.audit.result": "Résultat",
  "settings.audit.showMore": "Afficher {{count}} de plus",
  "settings.audit.succeeded": "Réussi",
  "settings.audit.system": "Système",
  "settings.audit.target": "Cible",
  "settings.audit.when": "Date",
  "accountMenu.label": "Compte",
  "accountMenu.loading": "Chargement du compte",
  "accountMenu.triggerLabel": "{{name}}, {{organization}}",
  "accountMenu.triggerLabelDemo": "{{name}}, {{organization}}, mode démo",
  "accountMenu.personal": "Personnel",
  "accountMenu.demoMode": "Mode démo",
  "accountMenu.demoModeOn": "Le mode démo est activé",
  "accountMenu.demoModeDescription":
    "Les e-mails affichés et les graphiques compatibles sont ajustés pour les présentations. Votre compte et vos autorisations ne changent pas.",
  "accountMenu.turnOffDemoMode": "Désactiver le mode démo",
  "accountMenu.invitations": "Invitations en attente",
  "accountMenu.joinYourTeam": "Rejoindre votre équipe",
  "accountMenu.join": "Rejoindre",
  "accountMenu.yourWorkspace": "Votre espace de travail",
  "accountMenu.createOrganization": "Créer une organisation",
  "accountMenu.organizationName": "Nom de l’organisation",
  "accountMenu.create": "Créer",
  "accountMenu.usage": "Utilisation",
  "accountMenu.getApps": "Obtenir des apps et extensions",
  "accountMenu.back": "Retour",
  "settingsOrg.general.organization": "Organisation",
  "settingsOrg.general.name": "Nom",
  "settingsOrg.general.nameLocked":
    "Les propriétaires et les administrateurs peuvent modifier le nom.",
  "settingsOrg.general.membership": "Adhésion",
  "settingsOrg.general.yourRole": "Votre rôle",
  "settingsOrg.general.deleteDescription":
    "Supprime définitivement {{name}}, ses membres et ses données.",
  "settingsOrg.members.removeTitle": "Retirer {{name}} ?",
  "settingsOrg.members.removeDescription":
    "Cette personne perd l’accès à {{org}}. Ce qui lui appartient passe à la personne que vous choisissez.",
  "settingsOrg.members.roleFor": "Rôle de {{name}}",
  "settingsOrg.members.moreActions": "Autres actions pour {{name}}",
  "settingsOrg.members.removing": "Retrait…",
  "settingsOrg.members.groupsEmpty":
    "Regroupez les membres pour gérer ensemble l’accès aux applications.",
  "settingsOrg.auth.signIn": "Connexion",
  "settingsOrg.auth.joining": "Adhésion automatique",
  "settingsOrg.auth.betweenApps": "Entre les applications",
  "settingsOrg.auth.methodsEmailOnly": "E-mail et mot de passe.",
  "settingsOrg.auth.methodsEmailAndOne":
    "E-mail et mot de passe, et {{method}}.",
  "settingsOrg.auth.methodsEmailAndTwo":
    "E-mail et mot de passe, {{first}} et {{second}}.",
  "settingsOrg.auth.emailPassword": "E-mail et mot de passe",
  "settingsOrg.auth.emailPasswordNote": "Activé sur chaque déploiement.",
  "settingsOrg.auth.methodConfigured":
    "Configuré sur votre hébergeur avec ces variables.",
  "settingsOrg.auth.methodNotConfigured":
    "Non configuré. Ajoutez ces variables sur votre hébergeur, puis redéployez.",
  "settingsOrg.auth.methodOn": "Activé",
  "settingsOrg.auth.methodOff": "Désactivé",
  "settingsOrg.auth.requireHint":
    "Pour imposer l’une de ces méthodes à tous dans {{org}}, utilisez Connexion de l’organisation.",
  "settingsOrg.auth.view": "Afficher",
  "settingsOrg.auth.close": "Fermer",
  "settingsOrg.apps.access": "Accès",
  "settingsOrg.apps.browse": "Parcourir les applications",
  "settingsOrg.apps.defaults": "Valeurs par défaut",
  "settingsOrg.search.domainAutoJoin":
    "Adhésion automatique par domaine e-mail",
  "settingsOrg.search.roles": "Rôles des membres",
  "settingsOrg.learnMore": "En savoir plus",
  "settingsOrg.moreInformation": "Plus d’informations",
  "settingsOrg.general.workspaceUrl": "URL de l’espace de travail",
  "settingsOrg.general.workspaceUrlDescription":
    "Redirigez les membres vers cet espace de travail depuis un autre déploiement.",
  "settingsOrg.general.workspaceUrlHelp":
    "Les membres qui arrivent sur un autre déploiement sont redirigés vers cet espace de travail au lieu d’une application vide.",
  "settingsOrg.general.editWorkspaceUrl":
    "Modifier l’URL de l’espace de travail",
  "settingsOrg.general.removeWorkspaceUrl":
    "Supprimer l’URL de l’espace de travail",
  "settingsOrg.general.setWorkspaceUrl": "Définir l’URL",
  "settingsOrg.auth.domainDescription":
    "Ajoutez automatiquement les personnes ayant une adresse e-mail @{{domain}}.",
  "settingsOrg.auth.domainDescriptionNoDomain":
    "Ajoutez automatiquement les personnes ayant le domaine de votre e-mail professionnel.",
  "settingsOrg.auth.domainHelp":
    "Toute personne qui s’inscrit avec une adresse e-mail de ce domaine rejoint l’organisation. Seul votre propre domaine de messagerie peut être utilisé, et les fournisseurs de messagerie gratuits ne sont pas autorisés.",
  "settingsOrg.auth.editDomain": "Modifier le domaine",
  "settingsOrg.auth.removeDomain": "Supprimer le domaine",
  "settingsOrg.auth.sharedSecret": "Secret partagé",
  "settingsOrg.auth.sharedSecretSet":
    "Défini. Permet aux applications de cet espace de travail de se vérifier mutuellement.",
  "settingsOrg.auth.sharedSecretNotSet":
    "Non défini. Permet aux applications de cet espace de travail de se vérifier mutuellement.",
  "settingsOrg.auth.secretNotSetValue": "Non défini",
  "settingsOrg.auth.manage": "Gérer",
  "settingsOrg.auth.reveal": "Afficher",
  "settingsOrg.auth.hide": "Masquer",
  "settingsOrg.auth.regenerate": "Régénérer",
  "settingsOrg.auth.syncToApps": "Synchroniser avec les applications",
  "settingsOrg.auth.pasteSecret": "Coller le secret",
  "settingsOrg.auth.pasteSecretLabel": "Collez un secret partagé",
  "settingsOrg.auth.syncing": "Synchronisation avec les applications…",
  "settingsOrg.auth.syncErrorStatus": "HTTP {{status}}",
  "settingsOrg.invite.emails": "Adresses e-mail",
  "settingsOrg.invite.emailPlaceholder": "nom@entreprise.fr",
  "settingsOrg.invite.note":
    "Chaque personne se connecte avec cette adresse e-mail exacte pour accepter.",
  "settingsOrg.invite.noteNoEmail":
    "Les invitations ne seront pas envoyées par e-mail, demandez donc à chaque personne de se connecter avec cette adresse exacte.",
  "settingsOrg.invite.role": "Rôle",
  "settingsOrg.invite.member": "Membre",
  "settingsOrg.invite.admin": "Administrateur",
  "settingsOrg.invite.ownerOnlyAdmin":
    "Seul le propriétaire de l’organisation peut inviter des administrateurs.",
  "settingsOrg.invite.removeRow": "Supprimer",
  "settingsOrg.invite.addAnother": "Ajouter une autre",
  "settingsOrg.invite.pasteMany": "Coller plusieurs",
  "settingsOrg.invite.importCsv": "Importer un CSV",
  "settingsOrg.invite.pasteLabel":
    "Collez des adresses e-mail séparées par des virgules, des espaces ou des retours à la ligne.",
  "settingsOrg.invite.addAsMembers": "Ajouter comme membres",
  "settingsOrg.invite.addAsAdmins": "Ajouter comme administrateurs",
  "settingsOrg.invite.add": "Ajouter",
  "settingsOrg.invite.send": "Envoyer les invitations",
  "settingsOrg.invite.sending": "Envoi…",
  "settingsOrg.invite.invalidEmail": "Saisissez une adresse e-mail complète.",
  "settingsOrg.invite.csvNoEmails":
    "Aucune adresse e-mail valide trouvée dans ce CSV.",
  "settingsOrg.auth.synced_one": "Synchronisé avec {{count}} application.",
  "settingsOrg.auth.synced_many": "Synchronisé avec {{count}} applications.",
  "settingsOrg.auth.synced_other": "Synchronisé avec {{count}} applications.",
  "settingsOrg.auth.syncedPartial_one":
    "Synchronisé avec {{succeeded}} application sur {{count}}. {{failed}} en échec.",
  "settingsOrg.auth.syncedPartial_many":
    "Synchronisé avec {{succeeded}} applications sur {{count}}. {{failed}} en échec.",
  "settingsOrg.auth.syncedPartial_other":
    "Synchronisé avec {{succeeded}} applications sur {{count}}. {{failed}} en échec.",
  "settingsOrg.invite.sent_one": "{{count}} invitation envoyée.",
  "settingsOrg.invite.sent_many": "{{count}} invitations envoyées.",
  "settingsOrg.invite.sent_other": "{{count}} invitations envoyées.",
  "settingsOrg.invite.saved_one":
    "{{count}} invitation enregistrée. La personne la verra en se connectant.",
  "settingsOrg.invite.saved_many":
    "{{count}} invitations enregistrées. Les personnes les verront en se connectant.",
  "settingsOrg.invite.saved_other":
    "{{count}} invitations enregistrées. Les personnes les verront en se connectant.",
  "settingsShell.account.addPassword": "Ajouter un mot de passe",
  "settingsShell.account.authenticatorCode": "Code d’authentification",
  "settingsShell.account.change": "Modifier",
  "settingsShell.account.changeEmail": "Modifier l’adresse e-mail",
  "settingsShell.account.changePassword": "Modifier le mot de passe",
  "settingsShell.account.confirmPassword": "Confirmer le nouveau mot de passe",
  "settingsShell.account.currentPassword": "Mot de passe actuel",
  "settingsShell.account.deletionDialogDescription":
    "Une demande de suppression est envoyée à un administrateur. Vos données sont conservées jusqu’à ce qu’il l’examine.",
  "settingsShell.account.done": "Terminé",
  "settingsShell.account.email": "E-mail",
  "settingsShell.account.emailChangeError":
    "Impossible d’envoyer la confirmation.",
  "settingsShell.account.emailChangeSent":
    "Consultez vos e-mails pour savoir comment confirmer cette modification.",
  "settingsShell.account.languageAndRegion": "Langue et région",
  "settingsShell.account.languageDescription":
    "S’applique sur tous vos appareils.",
  "settingsShell.account.manage": "Gérer",
  "settingsShell.account.name": "Nom",
  "settingsShell.account.nameDescription":
    "Utilisé pour vous désigner dans les applications Agent-Native.",
  "settingsShell.account.namePlaceholder": "Votre nom",
  "settingsShell.account.nameSaveError":
    "Impossible de mettre à jour votre nom.",
  "settingsShell.account.nameSaved": "Nom mis à jour",
  "settingsShell.account.newEmail": "Nouvelle adresse e-mail",
  "settingsShell.account.newPassword": "Nouveau mot de passe",
  "settingsShell.account.password": "Mot de passe",
  "settingsShell.account.passwordDescription":
    "Ajoutez un mot de passe pour disposer d’un autre moyen de vous connecter à votre compte.",
  "settingsShell.account.passwordLoadError":
    "Impossible de charger vos méthodes de connexion.",
  "settingsShell.account.passwordMinLength":
    "Choisissez un mot de passe d’au moins {{count}} caractères.",
  "settingsShell.account.passwordMismatch":
    "Les mots de passe ne correspondent pas.",
  "settingsShell.account.passwordSaveError":
    "Impossible de mettre à jour le mot de passe.",
  "settingsShell.account.passwordSaved": "Mot de passe mis à jour",
  "settingsShell.account.photoError": "Impossible de mettre à jour la photo.",
  "settingsShell.account.photoUpdated": "Photo mise à jour",
  "settingsShell.account.profilePhoto": "Photo de profil",
  "settingsShell.account.requestCopyDescription":
    "Un administrateur vérifie votre identité et assure le suivi.",
  "settingsShell.account.requestCopyLabel": "Demander une copie de vos données",
  "settingsShell.account.requestDeletionDescription":
    "Vos données sont conservées jusqu’à ce qu’un administrateur traite la demande.",
  "settingsShell.account.requestDeletionLabel":
    "Demander la suppression des données",
  "settingsShell.account.savePassword": "Enregistrer le mot de passe",
  "settingsShell.account.sendConfirmation": "Envoyer la confirmation",
  "settingsShell.account.sending": "Envoi...",
  "settingsShell.account.setUpTwoFactor":
    "Configurer la double authentification",
  "settingsShell.account.settingUp": "Configuration...",
  "settingsShell.account.signIn": "Connexion",
  "settingsShell.account.timezone": "Fuseau horaire",
  "settingsShell.account.timezoneDescription":
    "Utilisé pour les horodatages et les automatisations planifiées.",
  "settingsShell.account.turnOffTwoFactor":
    "Désactiver la double authentification",
  "settingsShell.account.turningOff": "Désactivation...",
  "settingsShell.account.twoFactor": "Authentification à deux facteurs",
  "settingsShell.account.twoFactorBackupCodes":
    "Conservez ces codes de secours en lieu sûr. Chacun peut être utilisé une fois si vous perdez l’accès à votre application d’authentification.",
  "settingsShell.account.twoFactorCodeError":
    "Saisissez le code à six chiffres de votre application d’authentification.",
  "settingsShell.account.twoFactorDescription":
    "Utilisez une application d’authentification pour ajouter une seconde étape de connexion à votre compte.",
  "settingsShell.account.twoFactorDisableError":
    "Impossible de désactiver l’authentification à deux facteurs.",
  "settingsShell.account.twoFactorEnabled":
    "L’authentification à deux facteurs est activée.",
  "settingsShell.account.twoFactorLoadError":
    "Impossible de charger les paramètres de double authentification.",
  "settingsShell.account.twoFactorQrLabel":
    "Code QR de configuration de la double authentification",
  "settingsShell.account.twoFactorSaved":
    "Authentification à deux facteurs activée",
  "settingsShell.account.twoFactorScan":
    "Scannez ce code QR avec votre application d’authentification, puis saisissez le code qu’elle affiche.",
  "settingsShell.account.twoFactorSetupError":
    "Impossible de mettre à jour les paramètres de double authentification.",
  "settingsShell.account.twoFactorSetupTitle":
    "Configurer l’authentification à deux facteurs",
  "settingsShell.account.uploading": "Envoi en cours...",
  "settingsShell.account.verifyAndEnable": "Vérifier et activer",
  "settingsShell.account.verifying": "Vérification...",
  "settingsShell.account.voiceBatch": "Par lots",
  "settingsShell.account.voiceDescription":
    "Choisissez comment la saisie vocale est transcrite.",
  "settingsShell.account.voiceGoogleRealtime": "Google en temps réel",
  "settingsShell.account.voiceInput": "Saisie vocale",
  "settingsShell.account.voiceLoadError":
    "Impossible de charger votre paramètre de transcription vocale.",
  "settingsShell.account.voiceMacNative": "Mac natif",
  "settingsShell.account.voiceSaveError":
    "Impossible d’enregistrer votre paramètre de transcription vocale.",
  "settingsShell.account.yourData": "Vos données",
  "settingsShell.appFallbackName": "Application",
  "settingsShell.appGroup.adminOnly":
    "Seuls les propriétaires et les administrateurs peuvent modifier ce paramètre",
  "settingsShell.appGroup.automationsCreateTitle":
    "Que doit-il se passer, et quand ?",
  "settingsShell.appGroup.defaultModel": "Modèle par défaut",
  "settingsShell.appGroup.defaultModelDescription":
    "Utilisé pour les nouvelles conversations avec l’agent dans {{app}}. Le modèle par défaut est {{model}}.",
  "settingsShell.appGroup.defaultModelDescriptionUnset":
    "Utilisé pour les nouvelles conversations avec l’agent dans {{app}}.",
  "settingsShell.appGroup.defaultModelLoadError":
    "Impossible de charger le modèle par défaut.",
  "settingsShell.appGroup.defaultModelSaveError":
    "Impossible d’enregistrer le modèle par défaut. Réessayez.",
  "settingsShell.appGroup.demoMode": "Mode démo",
  "settingsShell.appGroup.demoModeDescription":
    "Utiliser des données d’exemple dans ce navigateur pour les présentations.",
  "settingsShell.appGroup.labsFootnote":
    "Ces nouvelles fonctionnalités instables peuvent comporter des bugs.",
  "settingsShell.appGroup.labsLoadError": "Impossible de charger vos Labs.",
  "settingsShell.appGroup.labsSaveError":
    "Impossible de modifier {{lab}}. Réessayez.",
  "settingsShell.appGroup.mcpAbout":
    "Connectez {{app}} à Claude, ChatGPT, Cursor ou toute application d’IA compatible avec MCP. Cette application peut alors travailler dans {{app}} pour vous. Elle ne voit que ce que vous pouvez voir.",
  "settingsShell.appGroup.mcpFootnote":
    "Pour les outils que l’agent utilise lui-même, consultez {{integrations}}.",
  "settingsShell.appGroup.newAutomation": "Nouvelle automatisation",
  "settingsShell.appGroup.retry": "Réessayer",
  "settingsShell.appGroup.thisBrowser": "Ce navigateur",
  "settingsShell.appGroup.useDefault": "Utiliser la valeur par défaut",
  "settingsShell.appGroup.whatsNewChip":
    "Mises à jour de {{app}}. Chaque application a son propre journal des modifications.",
  "settingsShell.appGroup.whatsNewEmpty": "Aucune mise à jour pour l’instant.",
  "settingsShell.appGroup.whatsNewShowFewer": "Afficher moins de mises à jour",
  "settingsShell.appGroup.whatsNewViewAll": "Voir toutes les mises à jour",
  "settingsShell.backToApp": "Retour à {{app}}",
  "settingsShell.breadcrumbLabel": "Fil d’Ariane",
  "settingsShell.builder.connect": "Connecter",
  "settingsShell.builder.connected": "Connecté",
  "settingsShell.builder.connectedTo": "Connecté · {{space}}",
  "settingsShell.builder.connection": "Connexion",
  "settingsShell.builder.disconnect": "Déconnecter",
  "settingsShell.builder.disconnecting": "Déconnexion…",
  "settingsShell.builder.disconnectBody":
    "Cela concerne toutes les personnes de {{org}} qui n’ont pas connecté leur propre compte.",
  "settingsShell.builder.disconnectFailed":
    "Impossible de déconnecter Builder.io.",
  "settingsShell.builder.disconnectTitle": "Déconnecter Builder.io ?",
  "settingsShell.builder.grantsFailed":
    "Impossible de lire les connexions Builder.io.",
  "settingsShell.builder.loss.defaultStops":
    "Les chats s'arrêtent jusqu'à ce que vous ajoutiez un fournisseur d'organisation.",
  "settingsShell.builder.loss.defaultSwitches":
    "Le modèle par défaut passe à {{next}}.",
  "settingsShell.builder.loss.modelPicker":
    "Les modèles Builder.io disparaissent du sélecteur de modèle.",
  "settingsShell.builder.loss.serviceStops":
    "S’arrête jusqu’à ce qu’un autre fournisseur soit configuré.",
  "settingsShell.builder.loss.stops": "Ne fonctionne plus.",
  "settingsShell.builder.loss.uploadsFail":
    "Les importations échouent tant que le stockage n’est pas configuré.",
  "settingsShell.builder.manage": "Gérer",
  "settingsShell.builder.needsReconnect": "Doit être reconnecté.",
  "settingsShell.builder.orgFallback": "votre organisation",
  "settingsShell.builder.orgNotConnectedAdmin":
    "Non connecté. Une fois connecté, toutes les personnes de {{org}} pourront l’utiliser.",
  "settingsShell.builder.orgNotConnectedMember":
    "Non connecté. Un propriétaire ou un administrateur peut le connecter.",
  "settingsShell.builder.organization": "Organisation",
  "settingsShell.builder.personal": "Personnel",
  "settingsShell.builder.personalConnected": "Connecté. Vous seul l’utilisez.",
  "settingsShell.builder.personalConnectedOverOrg":
    "Connecté. Vous seul l’utilisez, à la place de la connexion de l’organisation.",
  "settingsShell.builder.personalConnectedTo":
    "Connecté · {{space}}. Vous seul l’utilisez.",
  "settingsShell.builder.personalConnectedToOverOrg":
    "Connecté · {{space}}. Vous seul l’utilisez, à la place de la connexion de l’organisation.",
  "settingsShell.builder.personalNotConnected":
    "Connectez votre propre compte. Vous seul l’utilisez.",
  "settingsShell.builder.personalRestricted":
    "Les propriétaires et administrateurs ont restreint les clés API personnelles.",
  "settingsShell.builder.personalRestrictedUnused":
    "Non utilisé tant que les clés API personnelles sont restreintes.",
  "settingsShell.builder.reconnect": "Reconnecter",
  "settingsShell.builder.retry": "Réessayer",
  "settingsShell.builder.use.aiModel": "Modèle d’IA",
  "settingsShell.builder.use.aiModelDefaultNote":
    "Le modèle par défaut, {{model}}.",
  "settingsShell.builder.use.aiModelNote":
    "Les modèles Builder.io sont dans le sélecteur de modèle.",
  "settingsShell.builder.use.backgroundAgentsNote":
    "Apporte des modifications de code depuis la production.",
  "settingsShell.builder.use.browserAutomationNote":
    "Permet à l’agent d’utiliser un navigateur en production.",
  "settingsShell.builder.use.designSystem": "Intelligence du design system",
  "settingsShell.builder.use.designSystemNote":
    "Garde les diapositives et designs générés fidèles à la marque.",
  "settingsShell.builder.use.embeddings": "Embeddings",
  "settingsShell.builder.use.embeddingsNote": "Recherche dans Brain.",
  "settingsShell.builder.use.fileStorageNote":
    "Les nouvelles importations sont stockées sur Builder.io.",
  "settingsShell.builder.use.images": "Génération d’images",
  "settingsShell.builder.use.imagesNote": "Slides et Design.",
  "settingsShell.builder.use.voice": "Saisie vocale",
  "settingsShell.builder.use.voiceNote": "Dictée dans chaque application.",
  "settingsShell.builder.usedFor": "Utilisé pour",
  "settingsShell.builder.usedForFootnote":
    "Choisissez ce qui s’exécute sur Builder.io dans {{link}}.",
  "settingsShell.builder.usedForLoadFailed":
    "Impossible de vérifier quels services s’exécutent sur Builder.io.",
  "settingsShell.builder.whatHappens": "Ce qui se passe",
  "settingsShell.channels.about.discord":
    "Lancez l'agent avec les commandes slash de Discord.",
  "settingsShell.channels.about.email":
    "Envoyez un e-mail à l'agent, et il répond dans le même fil.",
  "settingsShell.channels.about.googleDocs":
    "Mentionnez l'agent dans les commentaires Google Docs pour obtenir des réponses.",
  "settingsShell.channels.about.microsoftTeams":
    "Mentionnez l'agent dans Microsoft Teams, et il répond dans cette conversation.",
  "settingsShell.channels.about.page":
    "Là où l'on peut écrire à l'agent {{app}}. L'agent de chaque app se configure séparément.",
  "settingsShell.channels.about.slack":
    "Mentionnez l'agent avec @ dans un fil ou envoyez-lui un message privé, et il répond dans ce fil.",
  "settingsShell.channels.about.telegram":
    "Discutez avec votre agent via un bot Telegram.",
  "settingsShell.channels.about.whatsapp":
    "Connectez votre agent à WhatsApp Business.",
  "settingsShell.channels.action.manage": "Gérer",
  "settingsShell.channels.action.manageAria": "Gérer {{platform}}",
  "settingsShell.channels.action.setUp": "Configurer",
  "settingsShell.channels.action.setUpAria": "Configurer {{platform}}",
  "settingsShell.channels.action.view": "Voir",
  "settingsShell.channels.action.viewAria": "Voir {{platform}}",
  "settingsShell.channels.agentIn": "Agent dans {{platform}}",
  "settingsShell.channels.connection": "Connexion",
  "settingsShell.channels.copyServiceAccountEmail":
    "Copier l'e-mail du compte de service",
  "settingsShell.channels.copyWebhookUrl": "Copier l'URL du webhook",
  "settingsShell.channels.credentials": "Identifiants",
  "settingsShell.channels.developerSite": "Site développeur",
  "settingsShell.channels.documentation": "Documentation",
  "settingsShell.channels.empty": "Aucun canal n'est disponible dans {{app}}.",
  "settingsShell.channels.information": "Informations",
  "settingsShell.channels.loadFailed": "Impossible de charger les canaux.",
  "settingsShell.channels.membersFootnote":
    "Seuls les propriétaires et les admins peuvent configurer les canaux.",
  "settingsShell.channels.notFound":
    "Ce canal n'est pas disponible dans {{app}}.",
  "settingsShell.channels.open": "Ouvrir",
  "settingsShell.channels.openDocs": "Ouvrir la documentation",
  "settingsShell.channels.registerWebhook": "Enregistrer",
  "settingsShell.channels.removeCredentials.action": "Supprimer",
  "settingsShell.channels.removeCredentials.aria":
    "Supprimer les identifiants {{platform}}",
  "settingsShell.channels.removeCredentials.body":
    "L'agent cesse de répondre dans {{platform}} pour tout le monde, sauf si l'environnement de déploiement définit aussi ces clés.",
  "settingsShell.channels.removeCredentials.confirm": "Supprimer",
  "settingsShell.channels.removeCredentials.failed":
    "Impossible de supprimer les identifiants.",
  "settingsShell.channels.removeCredentials.removing": "Suppression…",
  "settingsShell.channels.removeCredentials.title":
    "Supprimer les identifiants {{platform}} ?",
  "settingsShell.channels.retry": "Réessayer",
  "settingsShell.channels.setup.addToEnvironment":
    "Ajoutez-la à l'environnement de déploiement",
  "settingsShell.channels.setup.body":
    "Ajoutez ces valeurs à ce déploiement, puis activez-le.",
  "settingsShell.channels.setup.close": "Fermer",
  "settingsShell.channels.setup.failed":
    "Impossible d'enregistrer les variables.",
  "settingsShell.channels.setup.optional": "Facultatif",
  "settingsShell.channels.setup.replace": "Remplacer",
  "settingsShell.channels.setup.replaceAria": "Remplacer {{key}}",
  "settingsShell.channels.setup.save": "Enregistrer",
  "settingsShell.channels.setup.saveAndTurnOn": "Enregistrer et activer",
  "settingsShell.channels.setup.saving": "Enregistrement…",
  "settingsShell.channels.setup.saved": "Enregistrée",
  "settingsShell.channels.setup.savedElsewhere":
    "Enregistrée en dehors de Canaux",
  "settingsShell.channels.setup.setInEnvironment":
    "À définir dans l'environnement du déploiement",
  "settingsShell.channels.setup.stillMissing":
    "Certaines variables obligatoires manquent encore.",
  "settingsShell.channels.setup.title": "Configurer {{platform}}",
  "settingsShell.channels.shareDocumentsWith": "Partagez les documents avec",
  "settingsShell.channels.state.notSetUp": "Non configuré",
  "settingsShell.channels.state.off": "Désactivé",
  "settingsShell.channels.state.on": "Activé",
  "settingsShell.channels.status": "Statut",
  "settingsShell.channels.toggleFailed":
    "Impossible de mettre à jour {{platform}}.",
  "settingsShell.channels.turnOnAria": "Activer {{platform}}",
  "settingsShell.channels.unavailable":
    "{{platform}} n'est pas disponible dans {{app}}.",
  "settingsShell.channels.webhookLocalOnly":
    "{{platform}} ne peut pas joindre cette adresse. Ouvrez cette page depuis l'adresse HTTPS publique de l'app pour obtenir une URL de webhook.",
  "settingsShell.channels.webhookRegistered": "Enregistré",
  "settingsShell.channels.webhookRegistration": "Webhook",
  "settingsShell.channels.webhookUrl": "URL du webhook",
  "settingsShell.channels.category": "Catégorie",
  "settingsShell.channels.developer": "Développeur",
  "settingsShell.channels.mentionAgent": "Mentionner l’agent",
  "settingsShell.channels.rowDescription": "{{about}} {{state}}.",
  "settingsShell.channels.separately":
    "L’agent de chaque app se configure séparément.",
  "settingsShell.channels.setUpLocked":
    "Seuls les propriétaires et les admins peuvent configurer ceci",
  "settingsShell.integrationDetail.access.none":
    "C’est un serveur public, il n’y a donc rien à quoi se connecter.",
  "settingsShell.integrationDetail.access.oauth":
    "L’agent agit avec vos autorisations {{name}}, il ne voit donc que ce que vous pouvez voir.",
  "settingsShell.integrationDetail.access.token":
    "L’agent utilise le jeton d’accès que vous ajoutez, il voit donc ce que ce jeton peut voir.",
  "settingsShell.integrationDetail.accessToken": "Jeton d’accès",
  "settingsShell.integrationDetail.addAccessToken": "Ajouter un jeton d’accès",
  "settingsShell.integrationDetail.callout.adminNeeded":
    "Un admin doit configurer ceci",
  "settingsShell.integrationDetail.callout.adminNeededBody":
    "Demandez à un propriétaire ou à un admin de {{org}} d’ajouter l’ID client et le secret de {{name}}. Vous pourrez ensuite connecter votre propre compte.",
  "settingsShell.integrationDetail.callout.beforeAnyone":
    "Avant que quiconque puisse se connecter",
  "settingsShell.integrationDetail.callout.beforeYouConnect":
    "Avant de vous connecter",
  "settingsShell.integrationDetail.callout.token":
    "Se connecte avec un jeton d’accès",
  "settingsShell.integrationDetail.callout.unavailable":
    "Pas encore disponible",
  "settingsShell.integrationDetail.category": "Catégorie",
  "settingsShell.integrationDetail.connected": "{{name}} est connecté",
  "settingsShell.integrationDetail.copyServerUrl": "Copier l’URL du serveur",
  "settingsShell.integrationDetail.developer": "Développeur",
  "settingsShell.integrationDetail.howToCreateToken": "Comment créer un jeton",
  "settingsShell.integrationDetail.justMe": "Moi uniquement",
  "settingsShell.integrationDetail.notFound":
    "Cette intégration ne figure pas dans le catalogue.",
  "settingsShell.integrationDetail.notFoundTitle": "Introuvable",
  "settingsShell.integrationDetail.prompt.amplitude.1":
    "Comment les utilisateurs actifs hebdomadaires ont-ils évolué ce mois-ci ?",
  "settingsShell.integrationDetail.prompt.amplitude.2":
    "Crée un entonnoir de l’inscription au premier enregistrement",
  "settingsShell.integrationDetail.prompt.amplitude.3":
    "Quelles cohortes ont la meilleure rétention ?",
  "settingsShell.integrationDetail.prompt.apollo.1":
    "Trouve les responsables design de startups en série B",
  "settingsShell.integrationDetail.prompt.apollo.2":
    "Enrichis cette liste d’e-mails",
  "settingsShell.integrationDetail.prompt.apollo.3":
    "Ajoute ces contacts à la séquence du T4",
  "settingsShell.integrationDetail.prompt.asana.1":
    "Qu’est-ce que je dois rendre cette semaine ?",
  "settingsShell.integrationDetail.prompt.asana.2":
    "Crée des tâches à partir des actions de cet enregistrement",
  "settingsShell.integrationDetail.prompt.asana.3":
    "Quels projets sont en retard ?",
  "settingsShell.integrationDetail.prompt.atlassian.1":
    "Crée un ticket Jira à partir des actions de cet enregistrement",
  "settingsShell.integrationDetail.prompt.atlassian.2":
    "Qu’est-ce qui bloque la release du T4 ?",
  "settingsShell.integrationDetail.prompt.atlassian.3":
    "Trouve la page Confluence sur l’onboarding",
  "settingsShell.integrationDetail.prompt.box.1":
    "Trouve le contrat signé pour Acme",
  "settingsShell.integrationDetail.prompt.box.2":
    "Partage le dossier du rapport du T3 avec la finance",
  "settingsShell.integrationDetail.prompt.box.3":
    "Qu’est-ce qui a changé dans le dossier juridique cette semaine ?",
  "settingsShell.integrationDetail.prompt.canva.1":
    "Crée une publication pour les réseaux sociaux à partir des temps forts de cet enregistrement",
  "settingsShell.integrationDetail.prompt.canva.2":
    "Trouve les couleurs de notre brand kit",
  "settingsShell.integrationDetail.prompt.canva.3":
    "Exporte la dernière présentation en PDF",
  "settingsShell.integrationDetail.prompt.cloudflare.1":
    "Quels enregistrements DNS pointent vers {{host}} ?",
  "settingsShell.integrationDetail.prompt.cloudflare.2":
    "Montre les erreurs Worker de la dernière heure",
  "settingsShell.integrationDetail.prompt.cloudflare.3":
    "Vide le cache pour cette URL",
  "settingsShell.integrationDetail.prompt.commonRoom.1":
    "Quelles entreprises montrent des signaux d’achat ?",
  "settingsShell.integrationDetail.prompt.commonRoom.2":
    "Qui chez Acme est actif dans notre communauté ?",
  "settingsShell.integrationDetail.prompt.commonRoom.3":
    "Résume l’activité de nos principaux comptes",
  "settingsShell.integrationDetail.prompt.context7.1":
    "Montre la documentation actuelle de React Router sur les loaders",
  "settingsShell.integrationDetail.prompt.context7.2":
    "Comment configurer les migrations Drizzle ?",
  "settingsShell.integrationDetail.prompt.context7.3":
    "Quoi de neuf dans la dernière version de Tailwind ?",
  "settingsShell.integrationDetail.prompt.exa.1":
    "Trouve des articles récents sur les apps agent-native",
  "settingsShell.integrationDetail.prompt.exa.2":
    "Recherche les concurrents de {{app}}",
  "settingsShell.integrationDetail.prompt.exa.3":
    "Récupère et résume cette page",
  "settingsShell.integrationDetail.prompt.figma.1":
    "Résume les composants de ce fichier Figma",
  "settingsShell.integrationDetail.prompt.figma.2":
    "Liste les variables de couleur de notre design system",
  "settingsShell.integrationDetail.prompt.figma.3":
    "Décris la mise en page de ce frame",
  "settingsShell.integrationDetail.prompt.fullstory.1":
    "Montre les sessions où des personnes ont cliqué frénétiquement sur Partager",
  "settingsShell.integrationDetail.prompt.fullstory.2":
    "Résume les points de friction sur la page de tarifs",
  "settingsShell.integrationDetail.prompt.fullstory.3":
    "Où les gens abandonnent-ils pendant l’onboarding ?",
  "settingsShell.integrationDetail.prompt.github.1":
    "Résume les pull requests qui attendent ma revue",
  "settingsShell.integrationDetail.prompt.github.2":
    "Trouve les issues sur les aperçus de liens Slack dans agent-native",
  "settingsShell.integrationDetail.prompt.github.3":
    "Qu’est-ce qui a changé dans packages/core cette semaine ?",
  "settingsShell.integrationDetail.prompt.gitlab.1":
    "Quelles merge requests ont échoué en CI aujourd’hui ?",
  "settingsShell.integrationDetail.prompt.gitlab.2":
    "Résume les issues ouvertes avec le label bug",
  "settingsShell.integrationDetail.prompt.gitlab.3":
    "Quels pipelines ont été les plus lents cette semaine ?",
  "settingsShell.integrationDetail.prompt.gong.1":
    "Résume mon dernier appel avec Acme",
  "settingsShell.integrationDetail.prompt.gong.2":
    "Quelles objections sont apparues ce mois-ci ?",
  "settingsShell.integrationDetail.prompt.gong.3":
    "Quels deals mentionnent des inquiétudes sur les prix ?",
  "settingsShell.integrationDetail.prompt.googleDocs.1":
    "@agent résume les commentaires de ce document",
  "settingsShell.integrationDetail.prompt.googleDocs.2":
    "@agent rédige une réponse à ce commentaire",
  "settingsShell.integrationDetail.prompt.googleDocs.3":
    "@agent transforme ces notes en checklist",
  "settingsShell.integrationDetail.prompt.grafana.1":
    "Trace la latence p95 de l’API sur la dernière journée",
  "settingsShell.integrationDetail.prompt.grafana.2":
    "Trouve les logs d’erreur vers 14 h",
  "settingsShell.integrationDetail.prompt.grafana.3":
    "Quelles alertes se sont déclenchées cette semaine ?",
  "settingsShell.integrationDetail.prompt.granola.1":
    "Qu’avons-nous décidé lors de la revue design d’hier ?",
  "settingsShell.integrationDetail.prompt.granola.2":
    "Liste mes actions ouvertes issues des réunions",
  "settingsShell.integrationDetail.prompt.granola.3":
    "Résume mes appels avec Acme",
  "settingsShell.integrationDetail.prompt.hubspot.1":
    "Passe le deal Acme en Closed won",
  "settingsShell.integrationDetail.prompt.hubspot.2":
    "Quels deals sont bloqués en négociation ?",
  "settingsShell.integrationDetail.prompt.hubspot.3":
    "Enregistre cet appel comme note sur le contact",
  "settingsShell.integrationDetail.prompt.intercom.1":
    "Résume les conversations ouvertes aujourd’hui",
  "settingsShell.integrationDetail.prompt.intercom.2":
    "Trouve des articles d’aide sur le SSO",
  "settingsShell.integrationDetail.prompt.intercom.3":
    "Sur quoi les clients posent-ils le plus de questions cette semaine ?",
  "settingsShell.integrationDetail.prompt.linear.1":
    "Crée une issue pour l’aperçu Slack cassé et assigne-la-moi",
  "settingsShell.integrationDetail.prompt.linear.2":
    "Que reste-t-il dans le cycle en cours ?",
  "settingsShell.integrationDetail.prompt.linear.3":
    "Résume les bugs signalés cette semaine",
  "settingsShell.integrationDetail.prompt.monday.1":
    "Qu’y a-t-il sur le board design pour ce sprint ?",
  "settingsShell.integrationDetail.prompt.monday.2":
    "Déplace cet élément dans Done",
  "settingsShell.integrationDetail.prompt.monday.3":
    "Quels éléments sont en retard ?",
  "settingsShell.integrationDetail.prompt.neon.1":
    "Crée une branche de la production pour les tests",
  "settingsShell.integrationDetail.prompt.neon.2":
    "Montre les requêtes les plus lentes cette semaine",
  "settingsShell.integrationDetail.prompt.neon.3":
    "Quelle est la taille de la base de données principale ?",
  "settingsShell.integrationDetail.prompt.netlify.1":
    "Pourquoi le dernier déploiement a-t-il échoué ?",
  "settingsShell.integrationDetail.prompt.netlify.2":
    "Quels sites ont eu des builds en échec cette semaine ?",
  "settingsShell.integrationDetail.prompt.netlify.3":
    "Reviens au déploiement de production précédent",
  "settingsShell.integrationDetail.prompt.notion.1":
    "Trouve notre checklist d’onboarding",
  "settingsShell.integrationDetail.prompt.notion.2":
    "Résume les notes de réunion de cette semaine",
  "settingsShell.integrationDetail.prompt.notion.3":
    "Ajoute ces actions au wiki de l’équipe",
  "settingsShell.integrationDetail.prompt.paypal.1":
    "Liste les factures en retard de paiement",
  "settingsShell.integrationDetail.prompt.paypal.2":
    "Résume les transactions de ce mois-ci",
  "settingsShell.integrationDetail.prompt.paypal.3":
    "Crée une facture pour Acme",
  "settingsShell.integrationDetail.prompt.pylon.1":
    "Quels comptes ont des issues urgentes ouvertes ?",
  "settingsShell.integrationDetail.prompt.pylon.2":
    "Résume le dernier ticket Acme",
  "settingsShell.integrationDetail.prompt.pylon.3":
    "Rédige une réponse à cette issue",
  "settingsShell.integrationDetail.prompt.semgrep.1":
    "Analyse packages/core pour trouver des problèmes de sécurité",
  "settingsShell.integrationDetail.prompt.semgrep.2":
    "Explique ce résultat et comment le corriger",
  "settingsShell.integrationDetail.prompt.semgrep.3":
    "Y a-t-il des secrets codés en dur dans ce dépôt ?",
  "settingsShell.integrationDetail.prompt.sentry.1":
    "Quelles sont les principales nouvelles erreurs depuis le déploiement d’hier ?",
  "settingsShell.integrationDetail.prompt.sentry.2":
    "Montre la stack trace du crash le plus fréquent",
  "settingsShell.integrationDetail.prompt.sentry.3":
    "Quelle release a introduit cette erreur ?",
  "settingsShell.integrationDetail.prompt.sigma.1":
    "Trouve le tableau de bord du chiffre d’affaires",
  "settingsShell.integrationDetail.prompt.sigma.2":
    "Qu’est-ce qui explique l’évolution du MRR le mois dernier ?",
  "settingsShell.integrationDetail.prompt.sigma.3":
    "Explique les principaux indicateurs de ce workbook",
  "settingsShell.integrationDetail.prompt.slack.1":
    "Résume #design pour cette semaine",
  "settingsShell.integrationDetail.prompt.slack.2":
    "Trouve le fil sur le changement de prix",
  "settingsShell.integrationDetail.prompt.slack.3":
    "Qu’a dit Camila à propos du lancement ?",
  "settingsShell.integrationDetail.prompt.stripe.1":
    "Quel chiffre d’affaires avons-nous réalisé le mois dernier ?",
  "settingsShell.integrationDetail.prompt.stripe.2":
    "Trouve le client de cette facture",
  "settingsShell.integrationDetail.prompt.stripe.3":
    "Quels abonnements n’ont pas pu être renouvelés ?",
  "settingsShell.integrationDetail.prompt.supabase.1":
    "Combien de personnes se sont inscrites cette semaine ?",
  "settingsShell.integrationDetail.prompt.supabase.2":
    "Montre le schéma de la table recordings",
  "settingsShell.integrationDetail.prompt.supabase.3":
    "Quelles edge functions ont échoué aujourd’hui ?",
  "settingsShell.integrationDetail.prompt.telegram.1":
    "Résume les enregistrements d’aujourd’hui",
  "settingsShell.integrationDetail.prompt.telegram.2":
    "Rappelle-moi la revue de 15 h",
  "settingsShell.integrationDetail.prompt.telegram.3":
    "Partage le lien de la démo d’hier",
  "settingsShell.integrationDetail.prompt.vercel.1":
    "Pourquoi le dernier déploiement de preview a-t-il échoué ?",
  "settingsShell.integrationDetail.prompt.vercel.2":
    "Montre les logs du déploiement de production",
  "settingsShell.integrationDetail.prompt.vercel.3":
    "Quels domaines pointent vers ce projet ?",
  "settingsShell.integrationDetail.prompt.webflow.1":
    "Mets à jour le titre de la page de tarifs",
  "settingsShell.integrationDetail.prompt.webflow.2":
    "Liste les éléments CMS publiés cette semaine",
  "settingsShell.integrationDetail.prompt.webflow.3":
    "Quelles pages n’ont pas de meta description ?",
  "settingsShell.integrationDetail.prompt.whatsapp.1":
    "Qu’y a-t-il dans mon agenda aujourd’hui ?",
  "settingsShell.integrationDetail.prompt.whatsapp.2":
    "Résume le dernier enregistrement",
  "settingsShell.integrationDetail.prompt.whatsapp.3":
    "Envoie-moi les notes de la revue design",
  "settingsShell.integrationDetail.prompt.zapier.1":
    "Publie les nouveaux enregistrements dans #design sur Slack",
  "settingsShell.integrationDetail.prompt.zapier.2":
    "Ajoute les nouvelles inscriptions à notre CRM",
  "settingsShell.integrationDetail.prompt.zapier.3":
    "Quels Zaps peux-tu exécuter ?",
  "settingsShell.integrationDetail.serverUrl": "URL du serveur",
  "settingsShell.integrationDetail.setUp": "Configurer",
  "settingsShell.integrationDetail.signIn": "Connexion",
  "settingsShell.integrationDetail.signInNone": "Aucune",
  "settingsShell.integrationDetail.tokenHint.figma":
    "Créez un jeton d’accès personnel dans Figma, puis collez-le ici.",
  "settingsShell.integrationDetail.tokenHint.github":
    "Créez un jeton d’accès personnel dans GitHub, puis collez-le ici.",
  "settingsShell.integrationDetail.tokenHint.sentry":
    "Créez un jeton d’authentification utilisateur dans Sentry, puis collez-le ici.",
  "settingsShell.integrationDetail.tokenHint.zapier":
    "Créez une connexion dans Zapier, puis collez son jeton bearer ici.",
  "settingsShell.integrationDetail.tokenPlaceholder":
    "Collez votre jeton {{name}}",
  "settingsShell.integrationDetail.who": "Qui peut l’utiliser",
  "settingsShell.integrationDetail.whoMember":
    "Seuls les propriétaires et les admins peuvent le partager avec {{org}}.",
  "settingsShell.integrationDetail.whoOrgOnly":
    "Se connecte une seule fois pour tout le monde dans {{org}}.",
  "settingsShell.integrationDetail.whoPersonal":
    "Chaque personne connecte son propre compte.",
  "settingsShell.integrationDetail.whoShared":
    "Une connexion partagée permet à tout le monde dans {{org}} d’utiliser votre accès.",
  "settingsShell.clearSearch": "Effacer la recherche",
  "settingsShell.group.account": "Compte",
  "settingsShell.group.agent": "Agent",
  "settingsShell.group.connections": "Connexions",
  "settingsShell.group.organization": "Organisation",
  "settingsShell.interfaceLanguage": "Langue de l’interface",
  "settingsShell.integrations.addCustom":
    "Ajouter une intégration personnalisée",
  "settingsShell.integrations.builderDescription":
    "Accès aux modèles, automatisation du navigateur, stockage de fichiers et identité de l’espace de travail. Offre gratuite disponible.",
  "settingsShell.integrations.builderStatusFailed":
    "Impossible de vérifier la connexion Builder.io.",
  "settingsShell.integrations.category.analytics": "Analytique",
  "settingsShell.integrations.category.design": "Design",
  "settingsShell.integrations.category.engineering": "Ingénierie",
  "settingsShell.integrations.category.finance": "Finance",
  "settingsShell.integrations.category.other": "Autres",
  "settingsShell.integrations.category.productivity": "Productivité",
  "settingsShell.integrations.category.sales": "Ventes",
  "settingsShell.integrations.category.support": "Support",
  "settingsShell.integrations.connectName": "Connecter {{name}}",
  "settingsShell.integrations.connectedEmptyDescription":
    "Connectez un outil ci-dessous pour que l'agent puisse l'utiliser dans le chat.",
  "settingsShell.integrations.connectedEmptyTitle":
    "Rien de connecté pour l'instant",
  "settingsShell.integrations.footnote":
    "Ce sont les outils que l’agent utilise. Pour utiliser {{app}} depuis Claude, ChatGPT ou Cursor, consultez {{link}}.",
  "settingsShell.integrations.moreActions": "Plus d'actions pour {{name}}",
  "settingsShell.integrations.noResults":
    "Aucune intégration ne correspond. Essayez un autre nom.",
  "settingsShell.integrations.remove": "Supprimer",
  "settingsShell.integrations.removeFailed":
    "Impossible de supprimer {{name}}.",
  "settingsShell.integrations.removePersonal":
    "L'agent n'utilisera plus {{name}} pour vous.",
  "settingsShell.integrations.removeTitle": "Supprimer {{name}} ?",
  "settingsShell.integrations.removeWorkspace":
    "L'agent n'utilisera plus {{name}} pour les membres de l'espace de travail.",
  "settingsShell.integrations.removing": "Suppression…",
  "settingsShell.integrations.retry": "Réessayer",
  "settingsShell.integrations.seeMoreMany":
    "Voir {{first}}, {{second}} et plus",
  "settingsShell.integrations.seeMoreOne": "Voir {{first}}",
  "settingsShell.integrations.seeMoreTwo": "Voir {{first}} et {{second}}",
  "settingsShell.integrations.serversLoadFailed":
    "Impossible de charger vos intégrations connectées.",
  "settingsShell.learnings": "Apprentissages",
  "settingsShell.loading": "Chargement des paramètres",
  "settingsShell.navLabel": "Paramètres",
  "settingsShell.noResults": "Aucun paramètre correspondant",
  "settingsShell.openNav": "Ouvrir le menu des paramètres",
  "settingsShell.page.apiKeys": "Clés API",
  "settingsShell.page.appGeneral": "Général",
  "settingsShell.page.apps": "Applications",
  "settingsShell.page.audit": "Journal d’audit",
  "settingsShell.page.auth": "Authentification",
  "settingsShell.page.automations": "Automatisations",
  "settingsShell.page.channels": "Canaux",
  "settingsShell.page.creativeContext": "Contexte créatif",
  "settingsShell.page.files": "Fichiers",
  "settingsShell.page.infra": "Infrastructure",
  "settingsShell.page.instructions": "Instructions",
  "settingsShell.page.integrations": "Intégrations",
  "settingsShell.page.labs": "Labs",
  "settingsShell.page.mcp": "Serveur MCP",
  "settingsShell.page.members": "Membres",
  "settingsShell.page.memory": "Mémoire",
  "settingsShell.page.model": "Modèle",
  "settingsShell.page.notifications": "Notifications",
  "settingsShell.page.orgGeneral": "Général",
  "settingsShell.page.preferences": "Préférences",
  "settingsShell.page.profile": "Profil",
  "settingsShell.page.security": "Sécurité",
  "settingsShell.page.skills": "Compétences",
  "settingsShell.page.subAgents": "Sous-agents",
  "settingsShell.page.usage": "Utilisation",
  "settingsShell.page.whatsNew": "Nouveautés",
  "settingsShell.pagePending": "Pas encore disponible",
  "settingsShell.resultsLabel": "Résultats de recherche dans les paramètres",
  "settingsShell.search.appDefaultModel": "Modèle par défaut de l'app",
  "settingsShell.search.backgroundAgents": "Agents en arrière-plan",
  "settingsShell.search.browserAutomation": "Automatisation du navigateur",
  "settingsShell.search.connectedAgents": "Agents connectés",
  "settingsShell.search.database": "Base de données",
  "settingsShell.search.defaultModel": "Modèle par défaut",
  "settingsShell.search.demoMode": "Mode démo",
  "settingsShell.search.email": "E-mail",
  "settingsShell.search.fileUploads": "Téléversement de fichiers et stockage",
  "settingsShell.search.hosting": "Hébergement",
  "settingsShell.search.maxIterations": "Nombre maximal d'itérations",
  "settingsShell.search.signInMethods": "Méthodes de connexion",
  "settingsShell.search.voiceTranscription": "Transcription vocale",
  "settingsShell.searchPlaceholder": "Rechercher dans les paramètres",
  "settingsShell.unread": "Nouveau",
  "settingsResources.personal": "Personnel",
  "settingsResources.organization": "Organisation",
  "settingsResources.fromDispatch": "Depuis Dispatch",
  "settingsResources.readOnly": "Lecture seule",
  "settingsResources.readOnlyHint":
    "Seuls les propriétaires et les administrateurs peuvent modifier ceci",
  "settingsResources.editInDispatch": "Modifiez-le dans Dispatch",
  "settingsResources.openDispatch": "Ouvrir Dispatch",
  "settingsResources.allApps": "Toutes les apps",
  "settingsResources.allAppsHint": "Dispatch partage ceci avec toutes les apps",
  "settingsResources.dispatchEmpty": "Rien n'est partagé depuis Dispatch",
  "settingsResources.loadFailed": "Impossible de charger ces ressources.",
  "settingsResources.moreActions": "Plus d'actions",
  "settingsResources.open": "Ouvrir",
  "settingsResources.download": "Télécharger",
  "settingsResources.remove": "Retirer",
  "settingsResources.removeTitle": "Retirer {{name}} ?",
  "settingsResources.removeFailed": "Impossible de retirer {{name}}.",
  "settingsResources.saveFailed": "Impossible d'enregistrer {{name}}.",
  "settingsResources.uploadFailed": "Impossible d'importer {{name}}.",
  "settingsResources.cancel": "Annuler",
  "settingsResources.save": "Enregistrer",
  "settingsResources.create": "Créer",
  "settingsResources.saving": "Enregistrement",
  "settingsResources.creating": "Création",
  "settingsResources.removing": "Retrait",
  "settingsResources.instructions.empty":
    "Dites à l'agent comment travailler avec vous.",
  "settingsResources.instructions.emptyTitle":
    "Aucune instruction pour l'instant",
  "settingsResources.instructions.orgEmpty":
    "Aucune instruction pour {{org}} pour l'instant",
  "settingsResources.instructions.add": "Ajouter des instructions",
  "settingsResources.instructions.fieldLabel":
    "Comment l'agent doit-il travailler avec vous ?",
  "settingsResources.instructions.placeholder":
    "Réponds brièvement. Utilise les unités métriques.",
  "settingsResources.instructions.savedAs":
    "Enregistré sous AGENTS.md dans vos ressources personnelles.",
  "settingsResources.memory.empty":
    "L'agent enregistre ici ce qu'il apprend sur vous.",
  "settingsResources.memory.emptyTitle": "Aucun souvenir pour l'instant",
  "settingsResources.memory.orgEmpty": "Aucun souvenir partagé pour l'instant",
  "settingsResources.memory.add": "Ajouter un souvenir",
  "settingsResources.learnings.empty":
    "Les corrections que vous donnez à l'agent sont enregistrées comme apprentissages.",
  "settingsResources.learnings.emptyTitle":
    "Aucun apprentissage pour l'instant",
  "settingsResources.learnings.add": "Ajouter un apprentissage",
  "settingsResources.skills.empty":
    "Enregistrez un workflow une fois et l'agent pourra le réutiliser.",
  "settingsResources.skills.emptyTitle": "Aucune compétence pour l'instant",
  "settingsResources.skills.orgEmpty":
    "Aucune compétence partagée pour l'instant",
  "settingsResources.skills.add": "Ajouter une compétence",
  "settingsResources.skills.describe": "La décrire à l'agent",
  "settingsResources.skills.upload": "Importer un fichier de compétence",
  "settingsResources.skills.describePlaceholder":
    "Une compétence qui vérifie les pull requests à la recherche de failles de sécurité",
  "settingsResources.files.empty":
    "Ajoutez un fichier pour donner plus de contexte à votre agent.",
  "settingsResources.files.emptyTitle": "Aucun fichier pour l'instant",
  "settingsResources.files.orgEmpty": "Aucun fichier partagé pour l'instant",
  "settingsResources.files.add": "Ajouter un fichier",
  "settingsResources.files.upload": "Importer un fichier",
  "settingsResources.files.create": "Créer un fichier",
  "settingsInfra.setup": "Configuration",
  "settingsInfra.services": "Services",
  "settingsInfra.environment": "Environnement",
  "settingsInfra.builderConnected":
    "Connecté. Les crédits de votre compte alimentent chaque service marqué Builder.io.",
  "settingsInfra.builderNotConnected":
    "Non connecté. Configurez chaque service vous-même, ou connectez Builder.io pour utiliser les crédits de votre compte.",
  "settingsInfra.builderUnknown":
    "Impossible de vérifier la connexion Builder.io.",
  "settingsInfra.manage": "Gérer",
  "settingsInfra.connect": "Connecter",
  "settingsInfra.connecting": "Connexion…",
  "settingsInfra.setUp": "Configurer",
  "settingsInfra.view": "Afficher",
  "settingsInfra.retry": "Réessayer",
  "settingsInfra.close": "Fermer",
  "settingsInfra.cancel": "Annuler",
  "settingsInfra.save": "Enregistrer",
  "settingsInfra.saving": "Enregistrement…",
  "settingsInfra.required": "Obligatoire",
  "settingsInfra.recommended": "Recommandé",
  "settingsInfra.optional": "Facultatif",
  "settingsInfra.builderRecommended":
    "Alimentez tous les services ci-dessous avec les crédits de votre compte Builder.io. Offre gratuite disponible.",
  "settingsInfra.builderOnly": "Builder.io uniquement",
  "settingsInfra.rowDescription": "{{source}} · {{use}}",
  "settingsInfra.notSetUp": "Non configuré",
  "settingsInfra.availableWithBuilder": "Disponible avec Builder.io",
  "settingsInfra.loadFailed": "Chargement impossible.",
  "settingsInfra.aiModel": "Modèle d'IA",
  "settingsInfra.useEveryApp": "Toutes les apps",
  "settingsInfra.storageBucket": "{{provider}}, bucket {{bucket}}",
  "settingsInfra.useUploads": "Envois dans toutes les apps",
  "settingsInfra.storageTitle": "Stockage de fichiers",
  "settingsInfra.storageIntro":
    "Les nouveaux envois vont dans votre bucket. Les fichiers existants restent où ils sont.",
  "settingsInfra.voice": "Saisie vocale",
  "settingsInfra.images": "Génération d'images",
  "settingsInfra.embeddings": "Embeddings",
  "settingsInfra.useVoice": "Dictée dans toutes les apps",
  "settingsInfra.useImages": "Slides et Design",
  "settingsInfra.useEmbeddings": "Recherche dans Brain",
  "settingsInfra.whyVoice":
    "Transforme la parole en texte. La saisie au clavier fonctionne toujours sans.",
  "settingsInfra.whyImages":
    "Génère des images pour les diapositives et les designs.",
  "settingsInfra.whyEmbeddings":
    "Améliore la recherche sémantique. La recherche par mots-clés fonctionne toujours sans.",
  "settingsInfra.designSystem": "Intelligence du système de design",
  "settingsInfra.whyDesignSystem":
    "Garde les diapositives et designs générés fidèles à votre marque.",
  "settingsInfra.whyBackground": "Modifie le code depuis la production.",
  "settingsInfra.whyBrowser":
    "Permet à l'agent d'utiliser un navigateur en production.",
  "settingsInfra.provider": "Fournisseur",
  "settingsInfra.keyOrg": "Utilise la clé {{provider}} de l'organisation.",
  "settingsInfra.manageKey": "Gérer la clé",
  "settingsInfra.keyPersonal":
    "Votre clé {{provider}} est personnelle. Les services ont besoin d'une clé de l'organisation.",
  "settingsInfra.keyNone":
    "Les services utilisent les clés de l'organisation, et il n'y a pas encore de clé {{provider}}.",
  "settingsInfra.keyUnavailable":
    "Impossible de vérifier la clé {{provider}} de l'organisation.",
  "settingsInfra.useBuilder": "Utiliser Builder.io",
  "settingsInfra.addNamed": "Ajouter {{provider}}",
  "settingsInfra.serviceSaved": "{{service}} utilise maintenant {{provider}}.",
  "settingsInfra.serviceSaveFailed": "Impossible de modifier {{service}}.",
  "settingsInfra.reindex":
    "Réindexez Brain pour que la recherche sémantique couvre les éléments existants.",
  "settingsInfra.variables": "Variables obligatoires",
  "settingsInfra.databaseHosted":
    "{{name}}, défini sur votre hébergeur. Toutes les apps la partagent.",
  "settingsInfra.databaseHostedSingle": "{{name}}, défini sur votre hébergeur.",
  "settingsInfra.databaseLocal":
    "{{name}} sur cet ordinateur. Définissez DATABASE_URL sur votre hébergeur avant de déployer.",
  "settingsInfra.databaseMissing":
    "Non défini. Définissez DATABASE_URL sur votre hébergeur.",
  "settingsInfra.hostingWorkspace":
    "{{host}}. L'espace de travail déploie chaque app à sa propre adresse.",
  "settingsInfra.hostingSingle": "{{host}}, à l'adresse {{address}}.",
  "settingsInfra.hostingPlain": "{{host}}.",
  "settingsInfra.hostOwnServer": "Votre propre serveur",
  "settingsInfra.hostThisComputer": "Cet ordinateur",
  "settingsInfra.variablesSet": "{{keys}} sont définies sur votre hébergeur.",
  "settingsInfra.variablesMissing": "Définissez {{keys}} sur votre hébergeur.",
  "settingsInfra.dbConnected": "Connectée",
  "settingsInfra.dbLocal": "Sur cet ordinateur",
  "settingsInfra.notSet": "Non défini",
  "settingsInfra.set": "Définie",
  "settingsInfra.dbIntro":
    "Chaque app lit la base de données avant de démarrer, elle est donc définie une seule fois sur votre hébergeur. Pour passer à une autre base de données :",
  "settingsInfra.dbStep1":
    "Créez une base de données Postgres sur Neon, Supabase ou tout hébergeur Postgres.",
  "settingsInfra.dbStep2":
    "Définissez {{key}} sur sa chaîne de connexion dans l'environnement de votre hébergeur.",
  "settingsInfra.dbStep3":
    "Redéployez. Les migrations s'exécutent pendant le déploiement.",
  "settingsInfra.dbOwn":
    "Pour donner à une app sa propre base de données, définissez sa propre variable, comme {{key}}.",
  "settingsInfra.hostIntroWorkspace":
    "L'espace de travail déploie chaque app, chacune à sa propre adresse. Pour héberger sur Vercel, Cloudflare ou votre propre serveur :",
  "settingsInfra.hostIntro":
    "Pour héberger sur Vercel, Cloudflare ou votre propre serveur :",
  "settingsInfra.hostStep1":
    "Choisissez la cible avec {{key}}, comme vercel, cloudflare_module ou node.",
  "settingsInfra.hostStep2":
    "Donnez au nouvel hébergeur le même environnement, y compris {{keys}}.",
  "settingsInfra.hostStep3":
    "Déployez. Pour un espace de travail, cela compile chaque app et affiche la commande de publication :",
  "settingsInfra.envIntro":
    "Chaque app les lit avant de démarrer. Définissez-les une fois sur votre hébergeur, puis redéployez.",
  "settingsInfra.varDatabaseUrl": "Votre chaîne de connexion Postgres.",
  "settingsInfra.varA2a":
    "Permet aux apps de cet espace de travail de s'appeler entre elles. Dans un espace de travail, il signe aussi les sessions de connexion quand BETTER_AUTH_SECRET n'est pas défini.",
  "settingsInfra.varBetterAuth":
    "Signe les sessions de connexion. Utilisez au moins 32 caractères aléatoires.",
  "settingsInfra.varAppUrl":
    "Nécessaire uniquement si l'hébergeur ne peut pas indiquer à l'app son URL publique.",
  "settingsInfra.varEncryption":
    "Chiffre les clés enregistrées dans les réglages. Sans elle, l'espace de travail en dérive une de A2A_SECRET.",
  "settingsInfra.varEncryptionSingle":
    "Chiffre les clés enregistrées dans les réglages. Sans elle, l'app en dérive une de BETTER_AUTH_SECRET.",
  "settingsInfra.varWeak":
    "Trop court. Utilisez au moins 32 caractères aléatoires.",
  "settingsInfra.varWeakLabel": "Trop court",
  "settingsInfra.generateSecret": "Pour générer un secret :",
  "settingsInfra.copy": "Copier",
  "settingsInfra.copied": "Copié",
  "settingsInfra.copyFailed": "Copie impossible.",
  "settingsApiKeys.addKey": "Ajouter une clé",
  "settingsApiKeys.adding": "Ajout…",
  "settingsApiKeys.availableTo": "Disponible pour",
  "settingsApiKeys.deleteKey": "Supprimer la clé",
  "settingsApiKeys.deleting": "Suppression…",
  "settingsApiKeys.deleteTitle": "Supprimer {{name}} ?",
  "settingsApiKeys.everyoneIn": "Tout le monde dans {{org}}",
  "settingsApiKeys.getKey": "Obtenir une clé",
  "settingsApiKeys.hideKeys": "Masquer les clés",
  "settingsApiKeys.justMe": "Moi uniquement",
  "settingsApiKeys.keyAdded": "Clé ajoutée",
  "settingsApiKeys.keyDeleted": "Clé supprimée",
  "settingsApiKeys.loadFailed": "Impossible de charger vos clés.",
  "settingsApiKeys.manageKey": "Gérer {{name}}",
  "settingsApiKeys.managedKeys": "Gérées par les intégrations",
  "settingsApiKeys.managedName": "{{owner}} gère cette clé.",
  "settingsApiKeys.managedTooltip":
    "Créée et renouvelée par {{owner}}. Déconnectez-la depuis cet endroit.",
  "settingsApiKeys.membersLocked":
    "Seuls les propriétaires et les administrateurs peuvent partager des clés avec {{org}}.",
  "settingsApiKeys.modelFootnote":
    "Pour utiliser votre propre fournisseur de modèles, {{link}}.",
  "settingsApiKeys.modelFootnoteLink": "ajoutez-le dans Modèle",
  "settingsApiKeys.name": "Nom",
  "settingsApiKeys.noKeys": "Aucune clé pour l'instant",
  "settingsApiKeys.noKeysDescription":
    "Ajoutez une clé pour que vos apps et l'agent puissent accéder à un service.",
  "settingsApiKeys.orgKeys": "Clés de l'organisation",
  "settingsApiKeys.providerInModel": "Ajoutez {{provider}} dans {{link}}.",
  "settingsApiKeys.replaceTitle": "Remplacer {{name}}",
  "settingsApiKeys.replaceValue": "Remplacer la valeur",
  "settingsApiKeys.saving": "Enregistrement…",
  "settingsApiKeys.showKeys_many": "Afficher {{count}} clés",
  "settingsApiKeys.showKeys_one": "Afficher {{count}} clé",
  "settingsApiKeys.showKeys_other": "Afficher {{count}} clés",
  "settingsApiKeys.test": "Tester",
  "settingsApiKeys.testPassed": "La valeur enregistrée fonctionne.",
  "settingsApiKeys.usedBy": "Utilisée par {{link}}",
  "settingsApiKeys.value": "Valeur",
  "settingsApiKeys.valueReplaced": "Valeur remplacée",
  "settingsApiKeys.yourKeys": "Vos clés",
  "settingsModel.addEndpoint": "Ajouter une URL de point de terminaison",
  "settingsModel.addNamed": "Ajouter {{provider}}",
  "settingsModel.addProvider": "Ajouter un fournisseur",
  "settingsModel.adding": "Ajout",
  "settingsModel.affectsOrg": "Cela concerne tout le monde dans {{org}}.",
  "settingsModel.affectsYou": "Cela ne concerne que vous.",
  "settingsModel.allApps": "Toutes les apps",
  "settingsModel.apiKey": "Clé API",
  "settingsModel.builderConnected": "Connecté · {{space}}",
  "settingsModel.builderConnectedPlain": "Connecté",
  "settingsModel.builderOrgNotConnectedAdmin":
    "Non connecté. Une fois connecté, tout le monde dans {{org}} peut l’utiliser.",
  "settingsModel.builderOrgNotConnectedMember":
    "Non connecté. Un propriétaire ou un administrateur peut le connecter.",
  "settingsModel.builderPersonalConnect":
    "Connectez votre propre compte pour utiliser vos crédits Builder.io.",
  "settingsModel.builderPersonalInsteadOfOrg":
    "Connectez votre propre compte pour l’utiliser à la place de celui de l’organisation.",
  "settingsModel.builderPersonalOverOrg":
    "Connecté · {{space}}. Utilisé à la place de la connexion de l’organisation.",
  "settingsModel.builderPersonalOverOrgPlain":
    "Connecté. Utilisé à la place de la connexion de l’organisation.",
  "settingsModel.builderUnknown":
    "Impossible de vérifier la connexion Builder.io.",
  "settingsModel.cancel": "Annuler",
  "settingsModel.change": "Modifier",
  "settingsModel.chatgptConnected": "Connecté",
  "settingsModel.chatgptDescription":
    "Utilisez le moteur Codex avec votre abonnement ChatGPT.",
  "settingsModel.chatgptPopupBlocked":
    "Autorisez les fenêtres pop-up pour ce site, puis réessayez.",
  "settingsModel.chatgptTitle": "Abonnement ChatGPT",
  "settingsModel.checkAgain": "Vérifier à nouveau",
  "settingsModel.checkedJustNow": "Vérifiée à l’instant.",
  "settingsModel.checkedOn": "Vérifiée le {{date}}.",
  "settingsModel.checking": "Vérification de votre clé auprès de {{provider}}",
  "settingsModel.checkingEndpoint": "Vérification du point de terminaison",
  "settingsModel.checkingOllama": "Vérification des modèles installés…",
  "settingsModel.checkingSaved": "Vérification de la clé enregistrée",
  "settingsModel.chooseModel": "Choisir un modèle",
  "settingsModel.clear": "Effacer",
  "settingsModel.connect": "Connecter",
  "settingsModel.connecting": "Connexion…",
  "settingsModel.defaultModelDescription":
    "Utilisé dans chaque app, sauf si l’app définit le sien.",
  "settingsModel.defaultModelNeedsProvider":
    "Ajoutez un fournisseur pour choisir un modèle par défaut.",
  "settingsModel.disconnect": "Déconnecter",
  "settingsModel.effectDefaultStops":
    "Les conversations s’arrêtent jusqu’à ce qu’un autre fournisseur soit configuré.",
  "settingsModel.effectDefaultSwitches":
    "Le modèle par défaut passe à {{next}}.",
  "settingsModel.effectKeepsOrg":
    "Continue de fonctionner avec la clé de l’organisation.",
  "settingsModel.effectKeepsVault":
    "Continue de fonctionner avec la clé du Vault.",
  "settingsModel.effectKeepsWorkspace":
    "Continue de fonctionner avec la clé de l’espace de travail.",
  "settingsModel.effectModelsLeave":
    "Les modèles {{provider}} disparaissent du sélecteur de modèles.",
  "settingsModel.emptyAskAdmin":
    "Demandez à un propriétaire ou à un administrateur d'en ajouter un.",
  "settingsModel.emptyDescription":
    "L'agent a besoin d'un fournisseur pour répondre.",
  "settingsModel.emptyDescriptionBuilder":
    "L'agent a besoin d'un fournisseur pour répondre. Nous recommandons Builder.io pour l'accès aux modèles, l'automatisation du navigateur, le stockage de fichiers et l'identité de l'espace de travail. Offre gratuite disponible.",
  "settingsModel.emptyTitle": "Ajoutez un fournisseur de modèles",
  "settingsModel.endpointFirst":
    "Saisissez d’abord l’URL du point de terminaison.",
  "settingsModel.endpointHint":
    "Facultatif. À utiliser pour LiteLLM ou une autre passerelle compatible OpenAI.",
  "settingsModel.endpointUrl": "URL du point de terminaison",
  "settingsModel.keyHint":
    "Créez-en une sur {{host}}. {{provider}} la facture directement.",
  "settingsModel.keyPlaceholder": "Collez votre clé {{provider}}",
  "settingsModel.labs": "Labs",
  "settingsModel.loadFailed": "Impossible de charger les fournisseurs.",
  "settingsModel.lockedTip":
    "Seuls les propriétaires et les administrateurs peuvent modifier ce paramètre.",
  "settingsModel.manage": "Gérer",
  "settingsModel.maxIterationsDescription":
    "Durée pendant laquelle une réponse peut travailler avant de se mettre en pause.",
  "settingsModel.maxIterationsInvalid":
    "Saisissez un nombre entier de {{min}} à {{max}}.",
  "settingsModel.modelCount_many": "{{count}} modèles",
  "settingsModel.modelCount_one": "{{count}} modèle",
  "settingsModel.modelCount_other": "{{count}} modèles",
  "settingsModel.modelOption": "{{model}} · {{provider}}",
  "settingsModel.models": "Modèles",
  "settingsModel.modelsHint":
    "Les modèles sélectionnés apparaissent dans le sélecteur de modèles.",
  "settingsModel.modelsHintService":
    "Les modèles de chat sont facultatifs. Laissez-les décochés pour utiliser cette clé uniquement pour {{service}}.",
  "settingsModel.modelsIdle":
    "Collez une clé pour voir les modèles qu’elle permet d’utiliser.",
  "settingsModel.modelsIdleOllama":
    "Saisissez l’URL du point de terminaison pour voir ses modèles installés.",
  "settingsModel.modelsSaveFailed":
    "La clé a été enregistrée, mais pas la liste des modèles. {{message}}",
  "settingsModel.noChatModels": "Aucun modèle de chat",
  "settingsModel.noModelsFound": "Aucun modèle trouvé.",
  "settingsModel.notSet": "Non défini",
  "settingsModel.nothingElse": "Rien d’autre n’utilise cette clé.",
  "settingsModel.ollamaHint": "Aucune clé API requise.",
  "settingsModel.orgProviders": "Fournisseurs de l’organisation",
  "settingsModel.orgSettings": "Paramètres de l’organisation",
  "settingsModel.organization": "Organisation",
  "settingsModel.pasteFirst": "Collez d’abord une clé.",
  "settingsModel.personal": "Personnel",
  "settingsModel.personalProviders": "Fournisseurs personnels",
  "settingsModel.previewFailed": "Impossible de vérifier ce que cela concerne.",
  "settingsModel.provider": "Fournisseur",
  "settingsModel.providerErrorHeadline":
    "{{provider}} n’a pas pu vérifier cette clé",
  "settingsModel.reasonEndpoint": "Vérifiez l’URL du point de terminaison.",
  "settingsModel.reasonOllamaUnreachable":
    "Vérifiez l’URL et qu’Ollama est en cours d’exécution.",
  "settingsModel.reasonPrefix":
    "Les clés {{provider}} commencent par {{prefix}}.",
  "settingsModel.reasonRejected":
    "Vérifiez que vous l’avez copiée en entier, ou créez-en une nouvelle.",
  "settingsModel.reasonTryAgain": "Réessayez dans un instant.",
  "settingsModel.reasonWrongProvider": "Cela ressemble à une clé {{provider}}.",
  "settingsModel.reasonWrongProviderVowel":
    "Cela ressemble à une clé {{provider}}.",
  "settingsModel.reconnect": "Reconnecter",
  "settingsModel.rejected":
    "{{provider}} a refusé cette clé le {{date}}. Les conversations qui l’utilisent s’arrêtent jusqu’à ce que vous la remplaciez.",
  "settingsModel.rejectedAskAdmin":
    "{{provider}} a refusé cette clé le {{date}}. Demandez à un propriétaire ou un administrateur de la remplacer.",
  "settingsModel.rejectedHeadline": "{{provider}} a refusé cette clé",
  "settingsModel.remove": "Supprimer",
  "settingsModel.removeProvider": "Supprimer le fournisseur",
  "settingsModel.removeTitle": "Supprimer {{provider}} ?",
  "settingsModel.removing": "Suppression",
  "settingsModel.replace": "Remplacer",
  "settingsModel.replaceKey": "Remplacer la clé",
  "settingsModel.restrictBody":
    "Les membres ne peuvent utiliser que les fournisseurs de l’organisation.",
  "settingsModel.restrictConfirm": "Restreindre les clés",
  "settingsModel.restrictDescription":
    "Les membres ne peuvent utiliser que les fournisseurs de l’organisation, et les clés qu’ils ont ajoutées cessent de fonctionner.",
  "settingsModel.restrictLabel": "Restreindre les clés API personnelles",
  "settingsModel.restrictMemberBuilder":
    "Sa connexion Builder.io personnelle cesse de fonctionner.",
  "settingsModel.restrictMemberChats":
    "Ses conversations passent aux fournisseurs de l’organisation.",
  "settingsModel.restrictMemberKeys_many":
    "Ses clés {{providers}} cessent de fonctionner.",
  "settingsModel.restrictMemberKeys_one":
    "Sa clé {{providers}} cesse de fonctionner.",
  "settingsModel.restrictMemberKeys_other":
    "Ses clés {{providers}} cessent de fonctionner.",
  "settingsModel.restrictNewKeysBody":
    "Les membres ne peuvent pas en ajouter. Les propriétaires et les administrateurs le peuvent toujours.",
  "settingsModel.restrictNewKeysTitle": "Nouvelles clés personnelles",
  "settingsModel.restrictTitle": "Restreindre les clés API personnelles ?",
  "settingsModel.restricted":
    "Les propriétaires et les administrateurs ont restreint les clés API personnelles.",
  "settingsModel.restrictedRow":
    "Non utilisée tant que les clés API personnelles sont restreintes.",
  "settingsModel.restricting": "Restriction",
  "settingsModel.retry": "Réessayer",
  "settingsModel.save": "Enregistrer",
  "settingsModel.savedRejected":
    "{{provider}} a refusé la clé enregistrée. Collez-en une nouvelle.",
  "settingsModel.saving": "Enregistrement",
  "settingsModel.selectAll": "Tout sélectionner",
  "settingsModel.settingLoadFailed": "Impossible de charger ce paramètre.",
  "settingsModel.unreachableHeadline": "Impossible de joindre {{provider}}",
  "settingsModel.view": "Afficher",
  "settingsModel.whatHappens": "Ce qui se passe",
  "settingsModel.who": "Qui peut l’utiliser",
  "settingsModel.whoHintAdmin":
    "Les fournisseurs personnels n’appartiennent qu’à vous. Les fournisseurs de l’organisation fonctionnent pour tout le monde dans {{org}}.",
  "settingsModel.whoHintMember":
    "Seuls les propriétaires et les administrateurs peuvent ajouter des fournisseurs de l’organisation.",
  "settingsModel.whoHintService":
    "Les services utilisent les clés de l’organisation.",
  "settingsSubAgents.connect": "Connecter un agent",
  "settingsSubAgents.orgApps": "Apps de {{org}}",
  "settingsSubAgents.workspaceApps": "Apps de l'espace de travail",
  "settingsSubAgents.external": "Agents externes",
  "settingsSubAgents.custom": "Agents personnalisés",
  "settingsSubAgents.managedByAdmins": "Géré par les administrateurs",
  "settingsSubAgents.appsEmpty": "Aucune app connectée pour l'instant",
  "settingsSubAgents.externalEmpty":
    "Connectez Foundry, Gemini Enterprise, Anthropic ou tout agent A2A.",
  "settingsSubAgents.externalEmptyTitle": "Aucun agent externe pour l'instant",
  "settingsSubAgents.customEmpty":
    "Définissez un agent ciblé auquel l'agent principal peut déléguer.",
  "settingsSubAgents.customEmptyTitle":
    "Aucun agent personnalisé pour l'instant",
  "settingsSubAgents.addAgent": "Ajouter un agent",
  "settingsSubAgents.describe": "Le décrire à l'agent",
  "settingsSubAgents.describePlaceholder":
    "Un agent de design qui critique les mises en page et propose une direction UI",
  "settingsSubAgents.write": "L'écrire vous-même",
  "settingsSubAgents.name": "Nom",
  "settingsSubAgents.description": "Description",
  "settingsSubAgents.instructions": "Instructions",
  "settingsSubAgents.loadFailed": "Impossible de charger les agents connectés.",
  "settingsSubAgents.statusUnreachable": "Inaccessible",
  "settingsSubAgents.edit": "Modifier",
  "settingsSubAgents.editTitle": "Modifier {{name}}",
  "settingsSubAgents.removeDescription":
    "L'agent ne délègue plus à {{name}} pour tout le monde dans {{org}}.",
  "settingsSubAgents.removeDescriptionSolo":
    "L'agent ne délègue plus à {{name}}.",
  "settingsSubAgents.directoryTitle": "Connecter un agent",
  "settingsSubAgents.anyAgent": "N'importe quel agent A2A",
  "settingsSubAgents.anyAgentHint": "Collez l'URL d'une carte d'agent.",
  "settingsSubAgents.registryLink": "Parcourir le Global A2A Registry",
  "settingsSubAgents.connectTitle": "Connecter {{name}}",
  "settingsSubAgents.close": "Fermer",
};

export default messages;
