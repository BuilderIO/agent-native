import type { AgentChatTranslation } from "../core-messages.js";

const messages: AgentChatTranslation = {
  "composer.contextUrlLabel": "Dirección URL",
  "composer.contextInvalidUrl": "Introduce una URL HTTP o HTTPS válida.",
  "composer.contextAttach": "Adjuntar",
  "composer.menu.search": "Buscar…",
  "composer.contextPrevious": "Anterior",
  "composer.contextNext": "Siguiente",
  "composer.contextLoadFailed": "No se pudo cargar el contexto.",
  "composer.contextLinkRequired": "Introduce un enlace.",
  "composer.submitFailed": "No se pudo enviar. Inténtalo de nuevo.",
  "composer.addContext": "Añadir contexto",
  "composer.contextActionFailed": "No se pudo añadir el contexto.",
  "composer.contextBack": "Atrás",
  "composer.searchContext": "Buscar contexto…",
  "composer.noContextResults": "No hay contexto coincidente.",
  "composer.contextPending": "Contexto pendiente",
  "composer.contextError": "Error de contexto",
  "composer.retryContext": "Reintentar contexto {{name}}",
  "composer.contextLimitExceeded":
    "El contexto es demasiado grande. Quita un elemento o adjunta una selección más pequeña.",
  "activity.reasoning": "Razonamiento",
  "approval.alwaysAllow": "Permitir siempre",
  "approval.alwaysAllowHint": "Aprobar y permitir siempre este comando exacto",
  "approval.alwaysAllowAction": "Permitir siempre esta acción",
  "approval.alwaysAllowActionHint": "Aprobar y permitir siempre esta acción",
  "approval.approve": "Aprobar",
  "approval.approved": "Aprobado. Ejecutando {{tool}} de nuevo...",
  "approval.denied": "Denegado. {{tool}} no se ejecutó.",
  "approval.deny": "Denegar",
  "approval.moreOptions": "Más opciones de aprobación",
  "approval.question": "¿Aprobar la ejecución de {{tool}}?",
  "auth.expiredDescription":
    "Es posible que tu sesión haya caducado. Cierra sesión y vuelve a iniciarla para reconectarte.",
  "auth.expiredTitle": "Sesión caducada",
  "auth.logIn": "Iniciar sesión",
  "auth.logOut": "Cerrar sesión",
  "auth.refreshChat": "Actualizar chat",
  "auth.refreshDescription":
    "Has iniciado sesión, pero es necesario volver a conectar este chat.",
  "auth.refreshTitle": "Es necesario actualizar la sesión del chat",
  "auth.requiredDescription": "Debes iniciar sesión para usar el agente.",
  "auth.requiredTitle": "Autenticación requerida",
  "commands.act": "Volver al modo de actuación",
  "commands.available": "Comandos disponibles",
  "commands.clear":
    "Iniciar un chat nuevo (conserva el chat actual en el historial)",
  "commands.closeHelp": "Cerrar ayuda",
  "commands.help": "Mostrar esta lista de comandos",
  "commands.history": "Ver todos los chats",
  "commands.mention": "Mencionar archivos, agentes o recursos",
  "commands.new": "Igual que /clear",
  "commands.plan": "Cambiar a la planificación de solo lectura",
  "observability.viewDetails": "Ver detalles",
  "observability.hideDetails": "Ocultar detalles",
  "observability.input": "Entrada",
  "observability.output": "Salida",
  "observability.error": "Error",
  "observability.metadata": "Metadatos",
  "observability.notCaptured": "No capturado",
  "observability.openFullConversation": "Abrir conversación completa",
  "observability.learnAboutTab": "Más información sobre esta pestaña",
  "onboarding.back": "Atrás",
  "onboarding.chooseRole": "Elige tu rol",
  "onboarding.customizeRole": "Personalicemos esto para ti.",
  "onboarding.roleQuestion": "¿Qué describe mejor tu función?",
  "onboarding.roleHelperText": "Esto nos ayuda a personalizar tu experiencia",
  "onboarding.roleProduct": "Gerente de producto",
  "onboarding.roleDesign": "Diseñador",
  "onboarding.roleDeveloper": "Desarrollo",
  "onboarding.roleMarketing": "Marketing",
  "onboarding.roleSales": "Ventas",
  "onboarding.roleOps": "Operaciones",
  "onboarding.roleIndividual": "Individual",
  "onboarding.roleOther": "Otro",
  "onboarding.roleOtherInputLabel": "Describe tu función",
  "onboarding.skipForNow": "Omitir por ahora",
  "onboarding.saveRoleError": "No se pudo guardar tu rol.",
  "onboarding.builderCreateAccount": "Crear cuenta de Builder.io",
  "onboarding.builderSignInWithAccount":
    "Iniciar sesión con una cuenta de Builder.io",
  "onboarding.builderActivateDescription":
    "Crea o reutiliza tu cuenta de Builder.io y activa sus créditos gratuitos con un solo clic.",
  "onboarding.builderActiveCredits":
    "Incluido con créditos gratuitos activos de Builder.io",
  "onboarding.builderCredits":
    "Incluido con los créditos gratuitos de Builder.io",
  "onboarding.builderActivateTitle": "Activar créditos gratuitos",
  "onboarding.builderAccountExistsTitle": "Ya tienes una cuenta de Builder.io",
  "onboarding.builderAccountExistsDescription":
    "Inicia sesión para conectarla.",
  "onboarding.builderActivationDescription":
    "Crearemos automáticamente tu cuenta de Builder.io con un solo clic.",
  "onboarding.builderCreateAndActivate": "Crear y activar",
  "onboarding.builderConsentPrefix":
    "Al crear una cuenta de Builder.io, aceptas nuestros",
  "onboarding.builderTerms": "Términos de servicio",
  "onboarding.builderPrivacy": "Política de privacidad",
  "onboarding.builderConsentAnd": "y",
  "onboarding.builderExistingAccount": "Tengo una cuenta de Builder.io",
  "onboarding.builderActivating":
    "Activando los créditos gratuitos de Builder.io",
  "onboarding.builderConnecting":
    "Conectando los créditos gratuitos de Builder.io",
  "onboarding.builderProvisioningDescription":
    "Creando o reutilizando tu cuenta de Builder.io. Esto suele tardar unos segundos.",
  "onboarding.builderConnectionDescription":
    "Finaliza la conexión con un clic en la nueva ventana.",
  "onboarding.builderReadyWithCodeChanges":
    "Los créditos de IA y los cambios de código en la nube están listos para usarse.",
  "onboarding.builderReadyCreditsOnly":
    "Los créditos de IA están listos para usarse. Las ediciones de código en la nube requieren un proyecto de Builder en la configuración del agente en segundo plano.",
  "onboarding.openBackgroundAgentSettings":
    "Abrir la configuración del agente en segundo plano",
  "onboarding.capability.llm.keySummary": "Conecta tu propio modelo de IA",
  "onboarding.capability.fileStorage.keySummary":
    "Carga y almacenamiento de archivos",
  "onboarding.fileStorage.title": "Elige el almacenamiento de archivos",
  "onboarding.fileStorage.description":
    "Elige el almacenamiento administrado de Builder o tus propias claves para un bucket compatible con S3.",
  "onboarding.fileStorage.custom": "Usar claves de almacenamiento propias",
  "onboarding.fileStorage.customDescription":
    "Configura un bucket compatible con S3 con una URL pública estable.",
  "onboarding.capability.voiceInput.label": "Entrada de voz",
  "onboarding.capability.voiceInput.keySummary": "Entrada de voz",
  "onboarding.capability.voiceInput.why":
    "La entrada de voz convierte tus solicitudes habladas en texto; escribir siempre funciona.",
  "onboarding.capability.embeddings.label": "Vectores semánticos",
  "onboarding.capability.embeddings.keySummary": "Vectores semánticos",
  "onboarding.capability.embeddings.why":
    "Los vectores semánticos mejoran la búsqueda semántica. La búsqueda por palabras clave sigue funcionando sin ellos.",
  "onboarding.capability.assetsImageGeneration.label": "Generación de imágenes",
  "onboarding.capability.assetsImageGeneration.keySummary":
    "Créditos de Builder o una clave de proveedor de imágenes",
  "onboarding.capability.assetsImageGeneration.why":
    "La generación de imágenes es el flujo principal para crear recursos de marca.",
  "onboarding.capability.assetsVideoGeneration.label": "Generación de vídeo",
  "onboarding.capability.assetsVideoGeneration.keySummary":
    "Clave de API de Gemini",
  "onboarding.capability.assetsVideoGeneration.why":
    "La generación de vídeo es opcional; el flujo principal de Assets es la generación de imágenes.",
  "onboarding.capability.clipsObjectStorage.label": "Almacenamiento de objetos",
  "onboarding.capability.clipsObjectStorage.keySummary":
    "Almacenamiento de Builder o un bucket compatible con S3",
  "onboarding.capability.clipsObjectStorage.why":
    "Los vídeos grabados necesitan almacenamiento de objetos duradero antes de poder reproducirse o compartirse.",
  "onboarding.capability.clipsTranscription.keySummary":
    "Clave de proveedor de voz a texto",
  "onboarding.capability.about": "Acerca de {{label}}",
  "onboarding.capability.why": "Por qué se necesita {{label}}",
  "onboarding.openAiKeySettings": "Abrir la configuración de claves de IA",
  "aboutAgentNative.title": "Acerca de Agent-Native",
  "aboutAgentNative.version": "Versión",
  "aboutAgentNative.environment": "Entorno",
  "aboutAgentNative.build": "Compilación",
  "aboutAgentNative.copyDiagnostics": "Copiar diagnóstico",
  "aboutAgentNative.unknown": "Desconocida",
  "common.agent": "Agente",
  "agentPanel.mode": "Modo",
  "agentPanel.uiMode": "Interfaz de usuario",
  "agentPanel.keyScope": "Ámbito de la clave",
  "agentPanel.personalKeyScope": "Personal",
  "agentPanel.organizationKeyScope": "Organización",
  "agentPanel.personalKeyInEffect": "Se está usando tu clave personal.",
  "agentPanel.organizationKeyInEffect":
    "Se está usando la clave de la organización.",
  "agentPanel.sharedKeyInEffect": "Se está usando una clave compartida.",
  "agentPanel.useOrganizationKey": "Usar clave de la organización",
  "agentPanel.keyStatusUnavailable":
    "No se pudo consultar el estado de la clave.",
  "agentPanel.saveScopeRoleUnavailable":
    "No se pudo cargar tu rol en la organización, así que aún no se pueden guardar claves.",
  "agentPanel.chatgptSubscriptionPopupBlocked":
    "Permite las ventanas emergentes de este sitio y vuelve a intentarlo.",
  "agentPanel.chatgptSubscriptionTitle": "Suscripción de ChatGPT",
  "agentPanel.chatgptSubscriptionDescription":
    "Acceso experimental a Codex mediante tu suscripción de ChatGPT.",
  "agentPanel.chatgptSubscriptionInUse": "En uso",
  "agentPanel.chatgptSubscriptionConnected": "Conectado",
  "agentPanel.chatgptSubscriptionConnecting": "Conectando…",
  "agentPanel.chatgptSubscriptionReconnect": "Volver a conectar",
  "agentPanel.chatgptSubscriptionConnect": "Conectar ChatGPT",
  "agentPanel.chatgptSubscriptionUse": "Usar en el chat",
  "agentPanel.chatgptSubscriptionDisconnect": "Desconectar",
  "agentHostNudge.sidebarTitle": "Usa el chat de {{agent}}",
  "agentHostNudge.sidebarDescription":
    "Ya estás chateando con {{agent}}. Pídele que trabaje directamente con esta app.",
  "agentHostNudge.promptTitle": "Pregúntale a {{agent}} en su lugar",
  "agentHostNudge.promptDescription":
    "Puedes pedirle a {{agent}} que cree o cambie esto aquí.",
  "agentHostNudge.useThisChat": "Usar este chat",
  "agentHostNudge.useThisPrompt": "Usar este mensaje",
  "common.cancel": "Cancelar",
  "common.collapse": "Contraer",
  "common.connect": "Conectar",
  "common.continue": "Continuar",
  "common.copied": "Copiado",
  "common.copy": "Copiar",
  "common.details": "Detalles",
  "common.dismiss": "Descartar",
  "common.dismissError": "Descartar error",
  "common.expand": "Expandir",
  "common.loading": "Cargando...",
  "common.no": "No",
  "common.retry": "Reintentar",
  "common.chunkLoadFailed": "No se pudo cargar. Inténtalo de nuevo.",
  "common.save": "Guardar",
  "agents.hostedAgent": "Agente alojado",
  "agents.provider": "Proveedor",
  "agents.providerA2A": "Agente A2A (Foundry, Gemini o personalizado)",
  "agents.providerAnthropic": "Agentes administrados de Anthropic",
  "agents.agentId": "ID del agente",
  "agents.agentIdPlaceholder": "agent_...",
  "agents.environmentId": "ID del entorno",
  "agents.environmentIdPlaceholder": "env_...",
  "agents.apiBaseUrl": "URL base de la API (opcional)",
  "agents.apiBaseUrlPlaceholder": "https://api.anthropic.com",
  "agents.managedAgentIncomplete":
    "Completa los campos de Anthropic Managed Agents.",
  "agents.managedAgentCheck":
    "La conexión se comprueba cuando delegas desde el chat.",
  "agents.managedAgentSaved":
    "Anthropic Managed Agent guardado. Delega en él desde el chat.",
  "agents.cardUrl": "URL de la tarjeta del agente",
  "agents.cardUrlPlaceholder": "https://host.example/agent-card.json",
  "agents.authType": "Autenticación",
  "agents.authNone": "Sin autenticación",
  "agents.authBearer": "Token Bearer",
  "agents.authClientCredentials": "Credenciales de cliente OAuth",
  "agents.chooseCredential": "Elegir credencial",
  "agents.vault": "Bóveda",
  "agents.tokenUrl": "URL del token",
  "agents.clientId": "ID de cliente",
  "agents.scope": "Ámbito",
  "agents.authIncomplete":
    "Completa los campos de autenticación del agente alojado.",
  "agents.invalidUrl":
    "Las URL de los agentes deben usar HTTPS, salvo las URL de desarrollo localhost o de bucle local.",
  "agents.statusReachable": "Accesible",
  "agents.statusAuthRejected": "Autenticación rechazada",
  "agents.statusNoJsonRpc": "Sin JSON-RPC",
  "agents.directoryTab": "Directorio de agentes",
  "agents.directoryPageHint":
    "Encuentra un backend de agentes y conéctalo a tu espacio de trabajo.",
  "agents.directorySearch": "Buscar proveedores",
  "agents.directoryProviders": "Proveedores",
  "agents.directoryManual": "Añadir por URL",
  "agents.directoryA2A": "A2A",
  "agents.directoryManaged": "API administrada",
  "agents.directoryFoundry": "Microsoft Foundry",
  "agents.directoryFoundryHint": "Conecta un agente de Foundry mediante A2A.",
  "agents.directoryGemini": "Gemini Enterprise",
  "agents.directoryGeminiHint":
    "Conecta un agente de Gemini Enterprise mediante A2A.",
  "agents.directoryAnthropic": "Agentes administrados de Anthropic",
  "agents.directoryAnthropicHint":
    "Conecta sesiones y aprobaciones de Anthropic.",
  "agents.directoryNoMatches": "Ningún proveedor coincide con tu búsqueda.",
  "agents.directoryRegistry": "Registro global de A2A",
  "agents.directoryRegistryHint":
    "Explora Agent Cards públicas y verifícalas antes de conectar.",
  "agents.directoryBrowse": "Explorar registro",
  "agents.formName": "Nombre",
  "agents.formUrl": "URL",
  "agents.formUrlPlaceholder": "URL (p. ej., http://localhost:8085)",
  "agents.formDescription": "Descripción",
  "agents.formDescriptionPlaceholder": "Descripción (opcional)",
  "agents.formCheck": "Comprobar",
  "agents.formAdd": "Añadir",
  "agents.formAdding": "Añadiendo",
  "agents.formAddAnyway": "Añadir de todos modos",
  "agents.formRemove": "Quitar",
  "agents.formSaveFailed": "No se pudo guardar el agente.",
  "agents.formAddFailed": "No se pudo añadir el agente.",
  "agents.checkFailed": "La comprobación falló",
  "agents.checkFailedStatus": "La comprobación falló ({{status}})",
  "agents.checkNotReachable": "No accesible",
  "agents.checkLive": "Activo · {{scheme}}",
  "agents.checkNoAuthScheme": "no se anuncia ningún esquema de autenticación",
  "agents.checkTokenRejected":
    "el par rechazó nuestro token, así que las llamadas devolverán 401 en producción",
  "agents.checkTokenUnverified": "no se pudo verificar nuestro token",
  "agents.checkTokenUnverifiedReason":
    "no se pudo verificar nuestro token ({{reason}})",
  "agents.checkTokenWorks": "nuestro token funciona",
  "agents.checkReadsRequireAuth": "las lecturas requieren autenticación",
  "agents.checkPublicSkills": "habilidades públicas: {{count}}",
  "agents.unreachableHint":
    "Puede que la app aún no esté en ejecución. Puedes añadirla igualmente.",
  "agents.addedOneWay":
    "Se añadió {{name}} solo en tu lado. El registro es unidireccional, así que {{name}} no conocerá esta app hasta que la añadas allí también.",
  "agents.openPeerSettings": "Abrir la configuración de {{name}}",
  "agents.syncSecret": "Sincronizar el secreto con las apps",
  "agents.noSharedSecret": "Aún no hay un secreto compartido.",
  "agents.noSharedSecretLink": "Define uno primero en la página Equipo.",
  "agents.askOwnerSyncSecret":
    "Pide al propietario del espacio de trabajo que sincronice el secreto compartido.",
  "common.saveFailed": "Error al guardar",
  "common.saveFailedStatus": "Error al guardar ({{status}})",
  "common.saving": "Guardando...",
  "common.settings": "Configuración",
  "common.waiting": "Esperando...",
  "common.yes": "Sí",
  "composer.attachmentError": "No se pudo procesar el archivo adjunto.",
  "composer.dropToAttach": "Suelta para adjuntar",
  "composer.droppedFileError":
    "No se pudo añadir el archivo soltado. Prueba con otro formato.",
  "composer.openDesktop":
    "Abre la aplicación de escritorio para usar este chat.",
  "composer.removeAttachment": "Quitar {{name}}",
  "composer.scrollToBottom": "Desplazarse hasta el final",
  "composer.suggestedPrompts": "Indicaciones sugeridas",
  "composer.stopResponse": "Detener respuesta",
  "composer.subAgentReadOnly":
    "Envía mensajes al chat del orquestador; este subagente se ejecuta automáticamente",
  "empty.loadingChat": "Cargando chat...",
  "empty.prompt": "¿En qué puedo ayudarte?",
  "error.afterDuration": "{{headline}} después de {{duration}}",
  "error.failed": "El agente ha encontrado un error",
  "error.stopped": "El agente se detuvo antes de terminar",
  "header.switchToCli": "Cambiar a la CLI",
  "history.active": "Activo",
  "history.empty": "Todavía no hay chats",
  "history.loadOlder": "Cargar chats anteriores",
  "history.noMatches": "No hay chats coincidentes",
  "history.open": "Abrir",
  "history.pinned": "Fijado",
  "history.search": "Buscar chats...",
  "history.searching": "Buscando...",
  "history.untitledChat": "Chat",
  "history.yesterday": "Ayer",
  "integrations.availableSection": "Integraciones disponibles",
  "integrations.connectedSection": "Conectado",
  "integrations.goToApiKeys": "Ir a claves de API",
  "integrations.goToIntegrations": "Ir a integraciones",
  "integrations.lookingForApiKeys": "¿Buscas una clave de API en su lugar?",
  "integrations.lookingForProviders": "¿Buscas proveedores de OAuth o MCP?",
  "integrations.manage": "Administrar",
  "integrations.recommended": "Recomendado",
  "integrations.subtitle": "Conecta las herramientas que tu agente puede usar.",
  "mcpIntegrations.menuLabel": "Integraciones",
  "mcpIntegrations.menuDescription":
    "Conectar herramientas y servicios al agente",
  "mcpIntegrations.title": "Conectar integraciones",
  "mcpIntegrations.description":
    "Explora {{count}} integraciones de agente o añade una personalizada.",
  "mcpIntegrations.searchPlaceholder": "Buscar integraciones",
  "mcpIntegrations.addYourOwn": "Añadir la tuya",
  "mcpIntegrations.noMatches": "Ninguna integración coincide con tu búsqueda.",
  "mcpIntegrations.connected": "Conectada",
  "mcpIntegrations.connectionError": "Error de conexión",
  "mcpIntegrations.connectionErrorReason": "Motivo: {{reason}}",
  "mcpIntegrations.reconnect": "Volver a conectar",
  "mcpIntegrations.reconnecting": "Volviendo a conectar…",
  "mcpIntegrations.reconnectFailed": "No se pudo volver a conectar: {{error}}",
  "mcpIntegrations.configure": "Configurar",
  "mcpIntegrations.connect": "Conectar",
  "mcpIntegrations.connectWithOAuth": "Conectar",
  "mcpIntegrations.connecting": "Conectando…",
  "mcpIntegrations.useApiToken": "Usar token de API",
  "mcpIntegrations.customOAuthDefault": "Iniciar sesión con OAuth",
  "mcpIntegrations.customHeadersMode": "Usar una clave de API",
  "mcpIntegrations.useApiKeyInstead": "Usar una clave de API en su lugar",
  "mcpIntegrations.useOAuthInstead": "Usar OAuth en su lugar",
  "mcpIntegrations.connectSuggestion":
    "Conecta {{name}} para usarlo en el chat",
  "mcpIntegrations.connectSuggestionWithApiToken":
    "Conecta {{name}} con un token de API para usarlo en el chat",
  "mcpIntegrations.dismissSuggestion": "Descartar sugerencia de integración",
  "mcpIntegrations.backToIntegrations": "Volver a integraciones",
  "mcpIntegrations.customTitle": "Añadir integración de agente personalizada",
  "mcpIntegrations.configureTitle": "Configurar {{name}}",
  "mcpIntegrations.presetNoAuthDescription":
    "Los valores predefinidos ya están rellenados. Prueba el endpoint o conéctalo ahora.",
  "mcpIntegrations.presetAuthDescription":
    "Los valores predefinidos ya están rellenados. Añade los datos de autorización necesarios antes de conectar.",
  "mcpIntegrations.customDescription":
    "Pega un endpoint Streamable HTTP o SSE y, si quieres, encabezados.",
  "mcpIntegrations.oauthNotice":
    "Este proveedor suele requerir una configuración de OAuth. Sigue la documentación del proveedor o añade un encabezado Authorization si tu endpoint admite acceso mediante token.",
  "mcpIntegrations.providerSetupRequired":
    "Se requiere configurar el proveedor",
  "mcpIntegrations.providerSetupDescription":
    "Primero completa la configuración necesaria en {{name}}. Después vuelve aquí para conectar tu cuenta.",
  "mcpIntegrations.providerSetupFormDescription":
    "Completa la configuración del proveedor antes de conectar tu cuenta.",
  "mcpIntegrations.continueToConnect": "Conectar mi cuenta",
  "mcpIntegrations.setupTitle": "Conectar {{name}}",
  "mcpIntegrations.personal": "Personal",
  "mcpIntegrations.personalConnection": "Conexión personal",
  "mcpIntegrations.organization": "Organización",
  "mcpIntegrations.scopeQuestion": "¿Quién debería poder usar esta conexión?",
  "mcpIntegrations.scopeChoiceTitle": "¿Quién debería usarla?",
  "mcpIntegrations.scopeChoiceDescription":
    "Elige dónde está disponible esta conexión.",
  "mcpIntegrations.connectForMe": "Conectar para mí",
  "mcpIntegrations.setUpForWorkspace": "Configurar para el espacio de trabajo",
  "mcpIntegrations.workspaceAdminRequired":
    "Se requiere un propietario o administrador del espacio de trabajo.",
  "mcpIntegrations.workspaceJoinRequired":
    "Primero únete a un espacio de trabajo.",
  "mcpIntegrations.personalOnlyDescription":
    "Esta integración solo admite conexiones personales.",
  "mcpIntegrations.workspaceOnlyDescription":
    "Esta integración se conecta una sola vez para todo el espacio de trabajo, así que no se puede conectar solo a tu cuenta. Un propietario o administrador del espacio de trabajo puede configurarla.",
  "mcpIntegrations.loadingScopeMetadata": "Cargando el alcance de la conexión…",
  "mcpIntegrations.retry": "Reintentar",
  "mcpIntegrations.retrying": "Reintentando…",
  "mcpIntegrations.personalDescription": "Solo tú puedes usar esta conexión.",
  "mcpIntegrations.sharedWithWorkspace": "Compartida con el espacio de trabajo",
  "mcpIntegrations.organizationDescription":
    "Los miembros del espacio de trabajo con permiso pueden usar esta conexión. Se siguen aplicando los permisos del proveedor.",
  "mcpIntegrations.serverNameRequired":
    "Introduce un nombre para la integración antes de conectar con OAuth.",
  "mcpIntegrations.serverName": "Nombre de la integración",
  "mcpIntegrations.url": "URL",
  "mcpIntegrations.fieldDescription": "Descripción",
  "mcpIntegrations.headers": "Encabezados",
  "mcpIntegrations.serverNamePlaceholder": "Nombre de la integración",
  "mcpIntegrations.urlPlaceholder": "https://example.com/agent-integration",
  "mcpIntegrations.descriptionPlaceholder": "Descripción (opcional)",
  "mcpIntegrations.headersPlaceholder": "Authorization: Bearer <token>",
  "mcpIntegrations.openSetupDocs": "Abrir documentación de configuración",
  "mcpIntegrations.viewSetup": "Abrir guía de configuración",
  "mcpIntegrations.test": "Probar",
  "mcpIntegrations.testing": "Probando…",
  "mcpIntegrations.toolsAvailable_one": "{{count}} herramienta disponible",
  "mcpIntegrations.toolsAvailable_many": "{{count}} herramientas disponibles",
  "mcpIntegrations.toolsAvailable_other": "{{count}} herramientas disponibles",
  "mcpIntegrations.failed": "Error",
  "mcpIntegrations.docsLabel": "Ver la documentación de {{name}}",
  "mcpIntegrations.catalog.context7.description":
    "Obtén documentación actualizada de bibliotecas en los chats del agente.",
  "mcpIntegrations.catalog.context7.useCase":
    "Documentación, referencia técnica, documentación de API, guías de frameworks",
  "mcpIntegrations.catalog.sentry.description":
    "Inspecciona incidencias, eventos y datos de depuración.",
  "mcpIntegrations.catalog.sentry.useCase":
    "Monitorización de errores, depuración, rendimiento, informes de fallos",
  "mcpIntegrations.catalog.fullstory.description":
    "Consulta analítica de comportamiento e inspecciona reproducciones de sesiones.",
  "mcpIntegrations.catalog.fullstory.useCase":
    "Analítica de producto, reproducción de sesiones, comportamiento cualitativo, investigación de usuarios",
  "mcpIntegrations.catalog.fullstory.setupNote":
    "FullStory MCP está en beta y requiere que un administrador de la organización de FullStory active las funciones de StoryAI y la opción Model Context Protocol.",
  "mcpIntegrations.catalog.amplitude.description":
    "Consulta y trabaja con la analítica de producto de Amplitude.",
  "mcpIntegrations.catalog.amplitude.useCase":
    "Analítica de producto, gráficos, paneles, cohortes, experimentos",
  "mcpIntegrations.catalog.amplitude.setupNote":
    "Amplitude MCP usa OAuth sobre HTTP en streaming. El endpoint predeterminado es para la residencia de datos en EE. UU.; usa el endpoint de la UE de Amplitude si la cuenta requiere residencia en la UE.",
  "mcpIntegrations.catalog.sigma.description":
    "Busca, explora y analiza libros de trabajo y paneles de Sigma.",
  "mcpIntegrations.catalog.sigma.useCase":
    "Analítica, paneles, libros de trabajo, exploración de datos, inteligencia empresarial",
  "mcpIntegrations.catalog.sigma.setupNote":
    "La URL de MCP de Sigma es específica de cada organización. En Sigma, abre Profile > Integrations > Connect Sigma to AI tools, copia la URL y pégala aquí. Sigma MCP admite actualmente búsqueda, exploración de metadatos y análisis; esta conexión no permite crear ni importar paneles o libros de trabajo.",
  "mcpIntegrations.catalog.notion.description":
    "Busca páginas y conocimiento del equipo.",
  "mcpIntegrations.catalog.notion.useCase":
    "Documentación, gestión del conocimiento, notas, creación de contenido",
  "mcpIntegrations.catalog.notion.setupNote":
    "La integración de Notion usa OAuth de usuario. Los espacios de trabajo Enterprise pueden auditar el uso de integraciones y permitir o bloquear clientes; vuelve a conectar después de que cambie la política del administrador.",
  "mcpIntegrations.catalog.granola.description":
    "Busca notas de reuniones, transcripciones y tareas pendientes.",
  "mcpIntegrations.catalog.granola.useCase":
    "Notas de reuniones, grabaciones, transcripciones, tareas pendientes, seguimientos",
  "mcpIntegrations.catalog.granola.setupNote":
    "La integración de Granola usa OAuth en el navegador. Autoriza la cuenta de Granola con la que has iniciado sesión y revisa a qué notas de reuniones y transcripciones puede acceder el agente.",
  "mcpIntegrations.catalog.gong.description":
    "Busca llamadas de Gong y genera información sobre cuentas y oportunidades.",
  "mcpIntegrations.catalog.gong.useCase":
    "Llamadas de ventas, transcripciones, información sobre oportunidades, resúmenes de cuentas",
  "mcpIntegrations.catalog.gong.setupNote":
    "Gong requiere que un administrador técnico cree una integración MCP y elija una autorización personal o compartida. El ID de cliente y el secreto generados deben configurarse antes de conectar.",
  "mcpIntegrations.catalog.semgrep.description":
    "Analiza el código en busca de problemas de seguridad.",
  "mcpIntegrations.catalog.semgrep.useCase":
    "Análisis de seguridad, detección de vulnerabilidades, análisis de código",
  "mcpIntegrations.catalog.linear.description":
    "Lee y escribe incidencias de Linear.",
  "mcpIntegrations.catalog.linear.useCase":
    "Gestión de proyectos, seguimiento de incidencias, planificación, informes de errores",
  "mcpIntegrations.catalog.apollo.description":
    "Busca, enriquece y gestiona datos GTM de Apollo.",
  "mcpIntegrations.catalog.apollo.useCase":
    "Prospección, enriquecimiento, contactos, secuencias, investigación de cuentas",
  "mcpIntegrations.catalog.apollo.setupNote":
    "Apollo MCP usa OAuth de usuario y no requiere una clave de API de Apollo. Se siguen aplicando los permisos del plan de Apollo, los créditos y las restricciones del proveedor sobre el entrenamiento de modelos.",
  "mcpIntegrations.catalog.commonRoom.description":
    "Investiga señales de compradores, contactos y organizaciones.",
  "mcpIntegrations.catalog.commonRoom.useCase":
    "Inteligencia de compradores, señales de producto, intención, enriquecimiento de contactos",
  "mcpIntegrations.catalog.commonRoom.setupNote":
    "Common Room MCP usa OAuth por usuario y respeta el rol en el espacio de trabajo del usuario autorizado. Puede que un administrador tenga que activar la conexión MCP para la instancia.",
  "mcpIntegrations.catalog.exa.description":
    "Busca en la web y obtén páginas con Exa.",
  "mcpIntegrations.catalog.exa.useCase":
    "Búsqueda web, investigación, búsqueda de código, obtención de páginas",
  "mcpIntegrations.catalog.exa.setupNote":
    "El endpoint MCP remoto de Exa admite un uso básico gratuito sin clave. Añade una clave de API de Exa en la configuración de encabezados del proveedor si necesitas límites más altos o más herramientas.",
  "mcpIntegrations.catalog.supabase.description":
    "Gestiona datos, autenticación y servicios de backend.",
  "mcpIntegrations.catalog.supabase.useCase":
    "Base de datos, autenticación, almacenamiento, funciones edge",
  "mcpIntegrations.catalog.neon.description":
    "Trabaja con proyectos de Postgres serverless.",
  "mcpIntegrations.catalog.neon.useCase":
    "Gestión de bases de datos, Postgres serverless, almacenamiento de datos",
  "mcpIntegrations.catalog.stripe.description":
    "Gestiona pagos, suscripciones y clientes.",
  "mcpIntegrations.catalog.stripe.useCase":
    "Pagos, suscripciones, facturación, gestión de clientes",
  "mcpIntegrations.catalog.atlassian.description":
    "Lee y escribe incidencias de Jira y contenido de Confluence.",
  "mcpIntegrations.catalog.atlassian.useCase":
    "Gestión de proyectos, seguimiento de incidencias, documentación, colaboración en equipo",
  "mcpIntegrations.catalog.atlassian.setupNote":
    "Pide al administrador de Atlassian que permita el dominio de la app Clips y active Rovo/MCP con permisos de lectura, escritura y búsqueda para tu sitio de Jira.",
  "mcpIntegrations.catalog.cloudflare.description":
    "Busca y opera servicios de Cloudflare mediante su integración.",
  "mcpIntegrations.catalog.cloudflare.useCase":
    "DNS, Workers, dominios, seguridad, observabilidad, API de la plataforma",
  "mcpIntegrations.catalog.cloudflare.setupNote":
    "El directorio de integraciones gestionadas de Cloudflare incluye integraciones específicas de cada producto y también la integración general de la API. Revisa los alcances y elige el endpoint más restringido que se ajuste a tu flujo de trabajo.",
  "mcpIntegrations.catalog.grafana.description":
    "Consulta métricas, registros y datos de observabilidad de Grafana Cloud.",
  "mcpIntegrations.catalog.grafana.useCase":
    "Observabilidad, métricas, registros, trazas, paneles",
  "mcpIntegrations.catalog.grafana.setupNote":
    "Grafana Cloud MCP está en versión preliminar pública y requiere acceso MCP de Grafana Cloud Assistant. Solo funciona con Grafana Cloud alojado; Grafana autoalojado necesita el servidor MCP local.",
  "mcpIntegrations.catalog.gitlab.description":
    "Lee y gestiona proyectos, incidencias y merge requests de GitLab.",
  "mcpIntegrations.catalog.gitlab.useCase":
    "Repositorios, incidencias, merge requests, CI/CD, analítica de código",
  "mcpIntegrations.catalog.gitlab.setupNote":
    "La integración de GitLab está en beta. En GitLab.com, un administrador de un grupo de nivel superior debe permitir el acceso a la integración para que OAuth pueda completarse; las instancias autogestionadas tienen un ajuste de instancia equivalente.",
  "mcpIntegrations.catalog.figma.description":
    "Lleva el contexto de diseño y las acciones del lienzo de Figma a un agente.",
  "mcpIntegrations.catalog.figma.useCase":
    "Archivos de diseño, componentes, variables, sistemas de diseño, lienzo",
  "mcpIntegrations.catalog.figma.setupNote":
    "La integración de Figma solo permite los clientes que aparecen en el catálogo de integraciones de Figma, así que este endpoint remoto aún no puede conectarse desde Agent-Native. Usa como alternativa la API REST de Figma con un token de acceso personal para leer el contexto de archivos y nodos; las acciones del lienzo no estarán disponibles hasta que Figma apruebe Agent-Native.",
  "mcpIntegrations.catalog.canva.description":
    "Busca, crea y actualiza diseños y recursos de Canva.",
  "mcpIntegrations.catalog.canva.useCase":
    "Diseños, plantillas, recursos, kits de marca, exportaciones, colaboración",
  "mcpIntegrations.catalog.canva.setupNote":
    "La integración de Canva usa OAuth por usuario y requiere que los clientes permitan los dominios canva.com y canva.ai de Canva. Confirma la configuración actual de redirección y del cliente en la documentación de integración de Canva antes de conectar.",
  "mcpIntegrations.catalog.vercel.description":
    "Busca en la documentación de Vercel e inspecciona proyectos, despliegues y registros.",
  "mcpIntegrations.catalog.vercel.useCase":
    "Despliegues, proyectos, registros, dominios, alojamiento, documentación",
  "mcpIntegrations.catalog.vercel.setupNote":
    "La integración de Vercel solo acepta clientes de IA revisados y aprobados. Agent-Native debe añadirse a la lista de clientes compatibles de Vercel para que funcione una conexión genérica del framework.",
  "mcpIntegrations.catalog.github.description":
    "Lee repositorios, incidencias, pull requests y contexto del código.",
  "mcpIntegrations.catalog.github.useCase":
    "Repositorios, incidencias, pull requests, código, analítica de ingeniería",
  "mcpIntegrations.catalog.github.setupNote":
    "El proveedor de inicio de sesión de GitHub no permite que las apps se registren solas, así que el botón Conectar no puede completar OAuth. Conecta con un token de acceso personal de GitHub y ten en cuenta que las organizaciones pueden aplicar políticas de acceso de apps OAuth.",
  "mcpIntegrations.catalog.slack.description":
    "Busca conversaciones de Slack y realiza acciones en el espacio de trabajo mediante su integración.",
  "mcpIntegrations.catalog.slack.useCase":
    "Mensajes, canales, personas, memoria de la empresa, flujos de trabajo",
  "mcpIntegrations.catalog.slack.setupNote":
    "La integración de Slack requiere una app de Slack registrada con un ID de app fijo. No se admite el registro dinámico de clientes y solo pueden conectarse apps de Slack Marketplace o internas. Usa el flujo de OAuth de mensajería gestionado de Slack para los flujos de trabajo de Agent-Native.",
  "mcpIntegrations.catalog.asana.description":
    "Busca y gestiona tareas, proyectos y datos del gráfico de trabajo de Asana.",
  "mcpIntegrations.catalog.asana.useCase":
    "Tareas, proyectos, carteras, planificación, carga de trabajo",
  "mcpIntegrations.catalog.asana.setupNote":
    "La integración de agente de Asana requiere una app OAuth registrada previamente y no admite el registro dinámico de clientes. Configura un cliente de app de Asana antes de conectar.",
  "mcpIntegrations.catalog.hubspot.description":
    "Busca y actualiza registros del CRM de HubSpot mediante su integración.",
  "mcpIntegrations.catalog.hubspot.useCase":
    "CRM, contactos, empresas, negocios, tickets, analítica de clientes",
  "mcpIntegrations.catalog.hubspot.setupNote":
    "Si hay una HubSpot MCP Auth App gestionada por el espacio de trabajo, cualquier miembro puede conectar una cuenta personal de HubSpot con OAuth y PKCE. Si no, crea la app en HubSpot Developer Platform antes de conectar; el conector OAuth de HubSpot existente sigue disponible para las acciones de la app.",
  "mcpIntegrations.catalog.pylon.description":
    "Busca y actualiza datos de soporte de Pylon.",
  "mcpIntegrations.catalog.pylon.useCase":
    "Atención al cliente, incidencias, cuentas, contactos, conversaciones",
  "mcpIntegrations.catalog.pylon.setupNote":
    "Activa el acceso MCP de Pylon para los usuarios correspondientes y activa el servidor MCP en Pylon antes de conectar. Pylon requiere una licencia de Member o Admin y solo usa OAuth de usuario.",
  "mcpIntegrations.catalog.intercom.description":
    "Busca conversaciones y conocimiento de atención al cliente.",
  "mcpIntegrations.catalog.intercom.useCase":
    "Atención al cliente, conversaciones, contactos, contenido del centro de ayuda",
  "mcpIntegrations.catalog.intercom.setupNote":
    "La integración de Intercom usa OAuth y está disponible para espacios de trabajo alojados en EE. UU. Confirma la región del espacio de trabajo y los alcances solicitados durante la autorización.",
  "mcpIntegrations.catalog.monday.description":
    "Trabaja con tableros, elementos y flujos de trabajo del equipo.",
  "mcpIntegrations.catalog.monday.useCase":
    "Gestión del trabajo, tableros, proyectos, tareas, operaciones del equipo",
  "mcpIntegrations.catalog.monday.setupNote":
    "La integración de monday.com usa OAuth sobre Streamable HTTP. Elige el espacio de trabajo y los permisos que quieres compartir durante la autorización.",
  "mcpIntegrations.catalog.webflow.description":
    "Lee y actualiza sitios y contenido de Webflow.",
  "mcpIntegrations.catalog.webflow.useCase":
    "Sitios web, CMS, contenido del sitio, publicación, flujos de trabajo de diseño",
  "mcpIntegrations.catalog.webflow.setupNote":
    "La integración de Webflow usa OAuth. Las funciones del Designer pueden instalar la Bridge App de Webflow durante la autorización; el acceso a Data API está disponible por separado.",
  "mcpIntegrations.catalog.paypal.description":
    "Trabaja con pagos, facturas y datos comerciales de PayPal.",
  "mcpIntegrations.catalog.paypal.useCase":
    "Pagos, facturas, transacciones, operaciones de comercios",
  "mcpIntegrations.catalog.paypal.setupNote":
    "PayPal ofrece descubrimiento e inicio de sesión de OAuth para su integración de agente remota. Agent-Native usa el endpoint /sse activo actualmente; revisa los permisos del comercio antes de autorizar.",
  "mcpIntegrations.catalog.box.description":
    "Busca y gestiona archivos y carpetas en Box.",
  "mcpIntegrations.catalog.box.useCase":
    "Archivos, carpetas, contenido empresarial, búsqueda, colaboración",
  "mcpIntegrations.catalog.box.setupNote":
    "La integración de Box está en beta y requiere que un administrador la active. Los clientes personalizados también necesitan Box Integration Credentials, un URI de redirección y alcances aprobados.",
  "mcpIntegrations.catalog.builder.description":
    "Busca contenido de Builder Publish y Hybrid Space.",
  "mcpIntegrations.catalog.builder.useCase":
    "Modelos de contenido, páginas, entradas, Publish y Hybrid Spaces",
  "mcpIntegrations.catalog.builder.setupNote":
    "Builder CMS MCP usa OAuth con registro dinámico de clientes. Solo se conecta a Publish o Hybrid Spaces, y el flujo de autorización te pide que selecciones el Space.",
  "mcpIntegrations.catalog.netlify.description":
    "Inspecciona y opera sitios y despliegues de Netlify.",
  "mcpIntegrations.catalog.netlify.useCase":
    "Sitios, despliegues, compilaciones, dominios, operaciones de alojamiento",
  "mcpIntegrations.catalog.netlify.setupNote":
    "Netlify documenta una configuración de integración remota para los clientes compatibles. Revisa los permisos del sitio y del equipo antes de completar OAuth.",
  "mcpIntegrations.catalog.zapier.description":
    "Conecta herramientas a miles de acciones de apps.",
  "mcpIntegrations.catalog.zapier.useCase":
    "Automatización, flujos de trabajo, acciones de apps, operaciones entre servicios",
  "mcpIntegrations.catalog.zapier.setupNote":
    "La integración de agente de Zapier usa una conexión y un token creados por el usuario para los clientes no incluidos en su lista. Crea la conexión en Zapier y pega el token bearer generado en el campo de encabezado.",
  "mcpIntegrations.auth.none": "Sin autenticación",
  "mcpIntegrations.auth.headers": "Encabezado",
  "mcpIntegrations.auth.oauth": "OAuth",
  "mcpIntegrations.status.beta": "Beta",
  "mcpIntegrations.status.setupRequired": "Configuración del proveedor",
  "mcpIntegrations.status.clientRestricted": "Solo clientes aprobados",
  "mcpIntegrations.status.verified": "Verificada",
  "mcpIntegrations.status.preflightOnly": "Solo comprobación previa",
  "mcpIntegrations.status.restricted": "Restringida",
  "limit.account": "tu cuenta",
  "limit.descriptionAll":
    "El agente ha utilizado todos los pasos disponibles. Continúa en una interacción nueva o aumenta primero el límite de {{scope}}.",
  "limit.descriptionWithCount":
    "El agente ha utilizado {{formattedCount}} pasos. Continúa en una interacción nueva o aumenta primero el límite de {{scope}}.",
  "limit.keepGoing": "Continuar",
  "limit.maxSteps": "Máximo de pasos",
  "limit.namedOrganization": "organización {{organization}}",
  "limit.organization": "la organización",
  "limit.ownerOnly":
    "Solo los propietarios y administradores de la organización pueden cambiar este límite.",
  "limit.reached": "Se alcanzó el límite de pasos",
  "limit.saveAndContinue": "Guardar y continuar",
  "message.actions": "Acciones del mensaje",
  "message.copyMessage": "Copiar mensaje",
  "message.copyRequestId": "Copiar ID de solicitud",
  "message.requestIdUnavailable": "ID de solicitud no disponible",
  "message.edit": "Editar mensaje",
  "message.forkChat": "Bifurcar chat",
  "message.missingFinal":
    "El agente se detuvo sin enviar un mensaje final. Pídele que continúe o vuelve a intentarlo.",
  "message.messages": "Mensajes",
  "message.nextBranch": "Rama siguiente",
  "message.noRestoreRun":
    "Este mensaje no tiene ninguna ejecución que restaurar.",
  "message.previousBranch": "Rama anterior",
  "message.regenerate": "Regenerar respuesta",
  "message.restoreFailed": "Error al restaurar ({{status}}).",
  "message.restoreQuestion": "¿Restaurar hasta aquí?",
  "message.revertQuestion":
    "¿Volver a este punto? Se perderán los cambios posteriores.",
  "message.restoreRequestFailed": "Error en la solicitud de restauración.",
  "message.threadNotFound":
    "Este hilo de chat ya no está disponible. Inicia un chat nuevo o inténtalo de nuevo si esto no era esperado.",
  "message.restoring": "Restaurando...",
  "message.revertHere": "Revertir hasta aquí",
  "message.revertToBeginning": "Volver al inicio",
  "message.sentAt": "Enviado a las {{time}}",
  "plan.act": "Actuar",
  "plan.implement": "Implementar",
  "plan.mode": "Modo de planificación",
  "plan.ready": "Plan listo",
  "plan.switchToAct": "Cambiar al modo Actuar",
  "queue.count": "{{count}} en cola",
  "queue.followUp": "Enviar un mensaje de seguimiento...",
  "queue.followUpWithCount":
    "{{count}} en cola — enviar un mensaje de seguimiento...",
  "queue.remove": "Quitar de la cola",
  "queue.sendNow": "Enviar ahora",
  "queue.sendNowHint": "Enviar ahora (detiene la respuesta actual)",
  "queue.steer": "Dirigir",
  "queue.steerHint": "Enviar este mensaje a continuación",
  "queue.moreActions": "Más acciones",
  "queue.moveToTop": "Mover arriba",
  "recovery.connectingBuilder": "Conectando con Builder.io",
  "recovery.copyDebug": "Copiar información de depuración",
  "recovery.copyFailed": "Error al copiar",
  "recovery.credentialRejected":
    "La credencial actual de Builder.io o del proveedor de modelos fue rechazada. Vuelve a conectar Builder.io y reintenta este mensaje.",
  "recovery.diagnoseRetry": "Diagnosticar y reintentar",
  "recovery.forkDescription":
    "Bifurca esta conversación en un hilo de chat independiente.",
  "recovery.forkFailed":
    "No se pudo bifurcar este chat. Prueba a iniciar un chat nuevo.",
  "recovery.forking": "Bifurcando...",
  "recovery.newChatHint":
    "Si el reintento produce el mismo error, inicia una sesión de chat nueva y continúa a partir de los cambios ya realizados.",
  "recovery.backgroundTimeout":
    "La ejecución anterior del agente en segundo plano alcanzó el límite de tiempo antes de terminar. El trabajo parcial se conservó; continúa o reintenta desde aquí.",
  "recovery.noProgress":
    "La ejecución anterior del agente dejó de mostrar progreso durante la recuperación y se detuvo antes de que pudiera seguir en bucle.",
  "recovery.statusCheckFailed":
    "No se pudo contactar con el servidor para comprobar si el agente sigue trabajando. Vuelve a enviar el mensaje para reintentarlo.",
  "recovery.streamEnded":
    "El flujo anterior del agente terminó durante la recuperación. Continúa o reintenta para volver a conectar con la ejecución.",
  "recovery.reconnectBuilder": "Volver a conectar Builder.io",
  "secrets.addCustomKeyNamed": 'Agregar "{{name}}" como clave personalizada',
  "secrets.chooseKey": "Elige una clave",
  "secrets.customKey": "Clave personalizada",
  "secrets.customKeyHint": "Agrega cualquier clave por nombre",
  "secrets.emptyHint": "Agrega una clave para usar tus propias cuentas.",
  "secrets.emptyMore":
    "y {{count}} más en Nuevo, o agrega cualquier clave personalizada",
  "secrets.emptyTitle": "Aún no hay claves.",
  "secrets.fromEnvironment": "Proporcionado por el entorno de implementación.",
  "secrets.managedInVault":
    "Se administra en el Vault del espacio de trabajo. Todas las apps de este espacio de trabajo usan este valor.",
  "secrets.openVault": "Abrir Vault",
  "secrets.managedByOwner": "Gestionado en {{owner}}",
  "secrets.removeCredentials": "Quitar credenciales",
  "secrets.confirmRemove": "Quitar",
  "secrets.sharedKeysKept":
    "Algunas claves compartidas no se quitaron. Solo los administradores del espacio de trabajo pueden quitarlas.",
  "secrets.newKey": "Nuevo",
  "secrets.noKeysFound": "No se encontraron claves.",
  "secrets.overridesVault":
    "Esta clave personal reemplaza el valor del Vault del espacio de trabajo. Elimínala para usar la clave del Vault.",
  "secrets.overridesWorkspace":
    "Esta clave personal reemplaza el valor del espacio de trabajo. Elimínala para usar la clave compartida.",
  "secrets.setForWorkspace":
    "Configurado para todos en este espacio de trabajo.",
  "secrets.sourceEnvironment": "Entorno",
  "secrets.sourceVault": "Vault",
  "secrets.sourceWorkspace": "Espacio de trabajo",
  "secrets.statusUnavailable": "No disponible",
  "secrets.required": "Obligatorio",
  "secrets.searchKeys": "Buscar claves...",
  "secrets.usePersonalKey": "Usar una clave personal en su lugar",
  "selection.attached":
    "{{formattedCount}} caracteres de la selección adjuntados",
  "selection.clear": "Borrar el contexto de la selección",
  "setup.addOwnKeys": "Añadir tus propias claves",
  "setup.builderCredits":
    "Builder.io incluye créditos gratuitos, o puedes usar tu propia clave de API.",
  "setup.builderOrOwnKeys":
    "Usa Builder.io (créditos gratuitos) o añade las claves de tu propio proveedor.",
  "setup.connectAi": "Conectar IA",
  "setup.connectBuilder": "Conectar Builder.io",
  "setup.connectPlaceholder": "Conecta la IA para empezar a chatear...",
  "setup.connectToChat": "Conectar la IA al chat",
  "setup.connectToStart": "Conecta la IA para empezar a chatear",
  "setup.connected": "Conectado",
  "setup.connectedOrganization": "Conectado — {{organization}}",
  "setup.connectedTo": "Conectado a {{organization}}",
  "setup.freeCredits":
    "Créditos gratuitos para LLM, alojamiento y mucho más, sin necesidad de clave de API",
  "setup.keyProvider": "Proveedor de claves de API",
  "setup.keySaveFailed": "No se pudo guardar la clave.",
  "setup.storedSecurely":
    "Almacenado de forma segura solo para esta aplicación.",
  "status.resuming": "Reanudando",
  "status.stillWorking": "Sigue trabajando",
  "status.thinking": "Pensando",
  "status.working": "Trabajando",
  "shell.chat": "Chat",
  "shell.loadingTerminal": "Cargando terminal...",
  "shell.toggleAgent": "Mostrar u ocultar agente",
  "status.contactingModel": "Contactando con el modelo",
  "status.starting": "Iniciando {{activity}}...",
  "status.preparing": "Preparando {{activity}}...",
  "status.writing": "Escribiendo {{activity}}...",
  "status.stillGenerating": "Sigue generando {{activity}}",
  "status.runningTool": "Ejecutando {{activity}}",
  "tabs.allChats": "Todos los chats",
  "tabs.closeTab": "Cerrar pestaña",
  "tabs.main": "Principal",
  "tabs.newChat": "Chat nuevo",
  "tabs.subAgent": "Subagente...",
  "tool.askedAgent": "Se consultó a {{agent}}",
  "tool.askingAgent": "Consultando a {{agent}}...",
  "tool.elapsed": "{{duration}} transcurridos",
  "tool.askingAgentFailed": "Error al consultar a {{agent}}",
  "tool.input": "Entrada",
  "tool.inputWithLabel": "Entrada - {{label}}",
  "tool.interrupted":
    "Se interrumpió antes de informar de la finalización; puede que haya terminado o no. Compruébalo antes de reintentarlo.",
  "tool.longRunning":
    "Sigue trabajando. Las actualizaciones grandes pueden tardar uno o dos minutos.",
  "tool.ranTools": "Se ejecutaron {{count}} herramientas",
  "tool.rawOutput":
    "Salida sin procesar de la llamada a la herramienta {{tool}}",
  "tool.repeated": "Repetido {{count}} veces",
  "tool.result": "Resultado",
  "tool.subAgentTask": "Tarea del subagente",
  "thinking.collapsed": "Contraído",
  "thinking.display": "Razonamiento",
  "thinking.expanded": "Expandido",
  "thinking.hidden": "Oculto",
  "tool.thought": "Razonamiento",
  "tool.thoughtFor": "Razonó durante {{duration}}",
  "tool.viewOutput": "Ver la salida de {{tool}}",
  "tool.worked": "Trabajó",
  "tool.workedFor": "Trabajó durante {{duration}}",
  "widget.chart": "Gráfico",
  "widget.dataChart": "Gráfico de datos",
  "widget.dataInsights": "Información sobre los datos",
  "widget.dataTable": "Tabla de datos",
  "widget.downloadCsv": "Descargar CSV",
  "widget.connectProvider": "Conectar {{provider}}",
  "widget.loadingToolResult": "Cargando el resultado de la herramienta",
  "widget.noRows": "No hay filas",
  "widget.points": "{{formattedCount}} puntos",
  "widget.rows": "{{formattedCount}} filas",
  "widget.sampled": "muestreado",
  "commands.clearShort": "Iniciar un nuevo chat",
  "commands.newShort": "Iniciar un nuevo chat",
  "composer.actDescription": "Usa herramientas y realiza los cambios aprobados",
  "composer.activeAppContext": "Contexto de aplicación activa",
  "composer.actMode": "Modo actuar",
  "composer.add": "Agregar...",
  "composer.addOwnKeys": "Claves personalizadas",
  "composer.assets.closePicker": "Cerrar selector de imágenes",
  "composer.assets.contextTitle": "Imagen: {{title}}",
  "composer.assets.generatedImage": "Imagen generada",
  "composer.assets.generateImage": "Generar imagen",
  "composer.assets.invalidUrl":
    "La URL del selector de imágenes configurada no es válida.",
  "composer.assets.loadingPicker": "Cargando el selector Assets",
  "composer.assets.openPicker": "Abrir el selector de imágenes Assets",
  "composer.assets.openSecurely":
    "Abre Assets en una pestaña nueva para iniciar sesión y elegir una imagen de forma segura.",
  "composer.assets.pickerTitle": "Selector de imágenes de Assets",
  "composer.auto": "Auto",
  "composer.builderModelCredits":
    "Créditos gratuitos para Claude, OpenAI y Gemini",
  "composer.chatGptSubscription": "Suscripción a ChatGPT",
  "composer.closePreview": "Cerrar vista previa",
  "composer.configureProviderKeys":
    "Configurar Anthropic, OpenAI u otro proveedor",
  "composer.connectAbove":
    "Conecta arriba un proveedor de IA para continuar...",
  "composer.connectBuilder": "Conectar Builder.io",
  "composer.connectKeys": "Conectar claves",
  "composer.connectingBuilder": "Conectando Builder.io…",
  "composer.costHigher": "Mayor costo",
  "composer.costLower": "Menor costo",
  "composer.costMedium": "Costo medio",
  "composer.createAutomation": "Crear automatización",
  "composer.createAutomationPrefix": "Crear una automatización: ",
  "composer.createExtension": "Crear extensión",
  "composer.createExtensionPrefix": "Crear una extensión: ",
  "composer.createSkill": "Crear habilidad",
  "composer.createSkillPrefix": "Crear una habilidad: ",
  "composer.currentDraft": "Borrador actual",
  "composer.defaultModel": "Modelo predeterminado",
  "composer.describeAutomation": "Describe lo que quieres automatizar...",
  "composer.describeExtension":
    "Describe la extensión interactiva que deseas crear...",
  "composer.describeSchedule": "Describe qué debería suceder y cuándo...",
  "composer.describeSkill": "Describe la habilidad que quieres crear...",
  "composer.documentTooLarge":
    '"{{name}}" ocupa {{size}} MB. {{label}} tienen un límite de {{maxSize}} MB para no superar el tamaño máximo del mensaje. Reduce el archivo o divídelo en partes más pequeñas.',
  "composer.requestTooLarge":
    "Este mensaje y sus archivos adjuntos son demasiado grandes para enviarse. Quita un archivo adjunto o acorta el mensaje.",
  "composer.file": "archivo",
  "composer.imageModel": "Modelo de imagen",
  "composer.imagePreview": "Vista previa de la imagen",
  "composer.loadingModels": "Cargando modelos",
  "composer.loadingModelsProgress": "Cargando modelos…",
  "composer.menu.createAutomation": "Crear automatización",
  "composer.menu.createAutomationDescription":
    "Configurar una regla del tipo «si X, hacer Y»",
  "composer.menu.createExtension": "Crear extensión",
  "composer.menu.createExtensionDescription":
    "Crear una extensión de miniaplicación",
  "composer.menu.createSkill": "Crear habilidad",
  "composer.menu.createSkillDescription":
    "Enseñar al agente una nueva habilidad",
  "composer.menu.generateImage": "Generar imagen",
  "composer.menu.generateImageDescription":
    "Abrir el selector de imágenes de Assets",
  "composer.menu.integrations": "Integraciones",
  "composer.menu.integrationsDescription":
    "Conectar herramientas y servicios al agente",
  "composer.menu.scheduleTask": "Programar tarea",
  "composer.menu.scheduleTaskDescription": "Ejecutar algo según un horario",
  "composer.menu.uploadFile": "Cargar archivo",
  "composer.menu.uploadFileDescription":
    "Imágenes, PDFs, texto/código, JSON, CSV",
  "composer.messageAgent": "Escribe al agente...",
  "composer.model": "Modelo",
  "composer.needsApiKey": "requiere una clave de API",
  "composer.pageTitle": "Título de la página",
  "composer.pastedImageError":
    "No se pudo adjuntar la imagen pegada. Prueba con otro formato.",
  "composer.pastedTextError": "No se pudo adjuntar el texto pegado.",
  "composer.plan": "Plan",
  "composer.planDescription":
    "Investigación y aprobación de solo lectura primero",
  "composer.planDesktopRequired":
    "Abre Agent-Native Desktop para usar el modo Plan.",
  "composer.previewAttachment": "Vista previa {{name}}",
  "composer.reasoning": "Razonamiento",
  "composer.reasoningEffort.auto": "Auto",
  "composer.reasoningEffort.high": "Alto",
  "composer.reasoningEffort.low": "Bajo",
  "composer.reasoningEffort.max": "máx.",
  "composer.reasoningEffort.medium": "Medio",
  "composer.reasoningEffort.minimal": "Mínimo",
  "composer.reasoningEffort.none": "Ninguno",
  "composer.reasoningEffort.xhigh": "extra alto",
  "composer.reasoningExtraHighShort": "Muy alto",
  "composer.reasoningMediumShort": "Med.",
  "composer.reasoningMinimalShort": "Mín.",
  "composer.removeContext": "Eliminar contexto {{name}}",
  "composer.removeReference": "Eliminar la referencia {{name}}",
  "composer.route": "Ruta",
  "composer.scheduleTask": "Programar tarea",
  "composer.scheduleTaskPrefix": "Crear un trabajo recurrente: ",
  "composer.selectedReferences": "Referencias seleccionadas",
  "composer.sendMessage": "Enviar mensaje",
  "composer.skill.added": 'Habilidad "{{name}}" agregada',
  "composer.skill.back": "Atrás",
  "composer.skill.content": "Contenido",
  "composer.skill.createDescription":
    "Describe una habilidad y deja que el agente la redacte",
  "composer.skill.createNew": "Crear nueva habilidad",
  "composer.skill.name": "Nombre de la habilidad",
  "composer.skill.review":
    "Revisa el contenido de {{name}} antes de guardarlo.",
  "composer.skill.savedAt": "Guardado en",
  "composer.skill.saveFailed": "No se pudo guardar el archivo de habilidades",
  "composer.skill.selectedFile": "el archivo seleccionado",
  "composer.skill.uploadDescription": "Importar un archivo SKILL.md existente",
  "composer.skill.uploadFailedStatus": "Error al cargar ({{status}})",
  "composer.skill.uploadFile": "Subir archivo de habilidad",
  "composer.upload": "Subir",
  "composer.uploadFailed": "No se pudo cargar el archivo seleccionado.",
  "composer.useAttachedContext": "Usa el contexto adjunto.",
  "mentions.commands": "Comandos",
  "mentions.learnMore": "Más información",
  "mentions.noResults": "No se encontraron resultados",
  "mentions.noSkills": "No hay habilidades disponibles",
  "mentions.sections.agents": "Agentes",
  "mentions.sections.connectedAgents": "Agentes conectados",
  "mentions.sections.files": "Archivos",
  "mentions.sections.other": "Otro",
  "mentions.skills": "Habilidades",
  "mentions.typeToSearch": "Escribe para buscar...",
  "pastedText.characters": "{{formattedCount}} caracteres",
  "pastedText.characters_many": "{{formattedCount}} caracteres",
  "pastedText.characters_one": "{{formattedCount}} carácter",
  "pastedText.characters_other": "{{formattedCount}} caracteres",
  "pastedText.lines": "{{formattedCount}} líneas",
  "pastedText.lines_many": "{{formattedCount}} líneas",
  "pastedText.lines_one": "{{formattedCount}} línea",
  "pastedText.lines_other": "{{formattedCount}} líneas",
  "pastedText.preview": "Vista previa del texto pegado",
  "pastedText.remove": "Eliminar texto pegado",
  "pastedText.title": "Texto pegado",
  "voice.dictation.cancel": "Cancelar (Esc)",
  "voice.dictation.cancelRecording": "Cancelar grabación",
  "voice.dictation.start": "Dictar ({{shortcut}})",
  "voice.dictation.stopRecording": "Detener grabación",
  "voice.dictation.transcribing": "Transcribiendo…",
  "voiceMode.connectBuilder": "Conectar Builder.io",
  "voiceMode.end": "Finalizar el modo de voz",
  "voiceMode.entryButtonLabel": "Usar micrófono",
  "voiceMode.errors.channelDisconnected":
    "El canal de control de voz en tiempo real se desconectó.",
  "voiceMode.errors.connectionFailed":
    "La conexión de voz en tiempo real falló.",
  "voiceMode.errors.connectionTimedOut":
    "La conexión de voz en tiempo real expiró.",
  "voiceMode.errors.offerFailed": "El navegador no creó una oferta de audio.",
  "voiceMode.errors.responseFailed":
    "OpenAI no pudo completar la respuesta de voz.",
  "voiceMode.errors.sessionFailed":
    "La sesión de voz en tiempo real encontró un error.",
  "voiceMode.errors.unsupported":
    "Este navegador no admite conversaciones de voz en tiempo real.",
  "voiceMode.hideChat": "Ocultar chat",
  "voiceMode.keepDictating": "Dictar un mensaje",
  "voiceMode.promptDescription":
    "El modo de voz sigue escuchando mientras el agente navega y realiza acciones.",
  "voiceMode.promptTitle": "Usa tu voz",
  "voiceMode.rememberPreference": "Recordar mi preferencia",
  "voiceMode.settings.autoLanguage": "Auto",
  "voiceMode.settings.defaultMicrophone": "Valor predeterminado del sistema",
  "voiceMode.settings.intelligence": "Inteligencia",
  "voiceMode.settings.intelligenceLevels.balanced": "Equilibrado",
  "voiceMode.settings.intelligenceLevels.deep": "Profundo",
  "voiceMode.settings.intelligenceLevels.instant": "Instantáneo",
  "voiceMode.settings.language": "Idioma",
  "voiceMode.settings.languages.de": "Alemán",
  "voiceMode.settings.languages.en": "Inglés",
  "voiceMode.settings.languages.es": "Español",
  "voiceMode.settings.languages.fr": "Francés",
  "voiceMode.settings.languages.it": "Italiano",
  "voiceMode.settings.languages.ja": "Japonés",
  "voiceMode.settings.languages.ko": "Coreano",
  "voiceMode.settings.languages.pt": "Portugués",
  "voiceMode.settings.languages.zh": "Chino",
  "voiceMode.settings.microphone": "Micrófono",
  "voiceMode.settings.microphoneNumber": "Micrófono {{number}}",
  "voiceMode.settings.microphoneSwitchFailed":
    "No se pudo cambiar de micrófono. Tu micrófono actual sigue activo.",
  "voiceMode.settings.voiceChangePending":
    "La nueva voz se aplicará la próxima vez que inicies el modo de voz.",
  "voiceMode.settings.voiceDescriptions.alloy": "Equilibrado y neutral",
  "voiceMode.settings.voiceDescriptions.ash": "Suave y confiado",
  "voiceMode.settings.voiceDescriptions.ballad": "Cálido y expresivo",
  "voiceMode.settings.voiceDescriptions.cedar": "Claro y fundamentado",
  "voiceMode.settings.voiceDescriptions.coral": "Amable y brillante",
  "voiceMode.settings.voiceDescriptions.echo": "Claro y directo",
  "voiceMode.settings.voiceDescriptions.marin": "Cálido y natural",
  "voiceMode.settings.voiceDescriptions.sage": "Tranquilo y reflexivo",
  "voiceMode.settings.voiceDescriptions.shimmer": "Ligero y optimista",
  "voiceMode.settings.voiceDescriptions.verse": "Expresivo y versátil",
  "voiceMode.settings.voiceStyle": "Estilo de voz",
  "voiceMode.setupDescription":
    "Conecta Builder.io para usar el servicio de voz administrado con créditos gratuitos o añade tus propias claves.",
  "voiceMode.setupTitle": "Configurar el modo de voz",
  "voiceMode.showChat": "Mostrar chat",
  "voiceMode.start": "Iniciar chat de voz",
  "voiceMode.startWithOpenAiKey": "Iniciar con una clave de OpenAI",
  "voiceMode.status.connecting": "Conectando",
  "voiceMode.status.ending": "Finalizar el modo de voz",
  "voiceMode.status.error": "El modo de voz necesita atención",
  "voiceMode.status.listening": "Escuchando",
  "voiceMode.status.speaking": "Hablando",
  "voiceMode.status.working": "Trabajando",
  "voiceMode.useOpenAiKey": "Añade tus propias claves",
  "voiceMode.voiceSettings": "Ajustes de voz",
  "duration.hourShort": "h",
  "duration.minuteShort": "min",
  "duration.secondShort": "s",
  "limit.descriptionWithCount_one":
    "El agente utilizó {{formattedCount}} paso. Continúa en un nuevo turno o aumenta primero el límite de {{scope}}.",
  "limit.descriptionWithCount_many":
    "El agente utilizó {{formattedCount}} pasos. Continúa en un nuevo turno o aumenta primero el límite de {{scope}}.",
  "limit.descriptionWithCount_other":
    "El agente utilizó {{formattedCount}} pasos. Continúa en un nuevo turno o aumenta primero el límite de {{scope}}.",
  "selection.attached_one": "{{formattedCount}} carácter de selección adjunto",
  "selection.attached_many":
    "{{formattedCount}} caracteres de selección adjuntos",
  "selection.attached_other":
    "{{formattedCount}} caracteres de selección adjuntos",
  "tool.ranTools_one": "Se ejecutó {{count}} herramienta",
  "tool.ranTools_many": "Se ejecutaron {{count}} herramientas",
  "tool.ranTools_other": "Se ejecutaron {{count}} herramientas",
  "widget.points_one": "{{formattedCount}} punto",
  "widget.points_many": "{{formattedCount}} puntos",
  "widget.points_other": "{{formattedCount}} puntos",
  "widget.rows_one": "{{formattedCount}} fila",
  "widget.rows_many": "{{formattedCount}} filas",
  "widget.rows_other": "{{formattedCount}} filas",
  "errorMessages.agentConnection":
    "Se interrumpió la conexión con el agente. Comprueba tu conexión y vuelve a intentarlo.",
  "errorMessages.attachmentPasswordProtected":
    "Este PDF está protegido con contraseña y no se puede leer. Quita la protección con contraseña o pega el texto relevante, y vuelve a intentarlo.",
  "errorMessages.builderAuthentication":
    "Builder rechazó las credenciales conectadas. Vuelve a conectar Builder.io en Ajustes e inténtalo de nuevo.",
  "errorMessages.builderModelUnauthorized":
    "El proveedor de este modelo rechazó la solicitud. Elige otro modelo y vuelve a intentarlo.",
  "errorMessages.errorPrefix": "Error: {{message}}",
  "errorMessages.gatewayInternalError":
    "La pasarela del modelo tuvo un error interno antes de que el agente pudiera responder. Vuelve a intentarlo en un momento e indica el id de error de abajo si sigue ocurriendo.",
  "errorMessages.gatewayNoDetails":
    "La pasarela del modelo no devolvió detalles del error y el chat no pudo recuperarse. Espera un momento y vuelve a intentarlo. Si el problema continúa, inicia un chat nuevo.",
  "errorMessages.creditsLimitReached":
    "Has alcanzado el límite de créditos de IA.",
  "errorMessages.inactivityTimeout":
    "La conexión del agente expiró antes de que pudiera finalizar. Puedes continuar desde el trabajo parcial o volver a intentarlo.",
  "errorMessages.invalidToolSchema":
    "El esquema de una herramienta no era válido, así que el modelo rechazó la solicitud antes de iniciarla. Puedes omitir la herramienta no válida y volver a intentarlo.",
  "errorMessages.malformedRequest":
    "El proveedor del modelo rechazó esta solicitud por estar mal formada, así que no se reintentó. Vuelve a intentarlo o inicia un chat nuevo si sigue ocurriendo.",
  "errorMessages.malformedRequestAttachment":
    "El modelo rechazó un archivo adjunto, así que este mensaje nunca se envió. Quita el adjunto y vuelve a intentarlo: un PDF, un archivo de texto plano o una imagen JPEG, PNG, GIF o WebP se leen directamente; los demás formatos deben subirse y enlazarse.",
  "errorMessages.noProviderConnected":
    "No hay ningún proveedor de LLM conectado. Abre Configuración > Agente > Proveedores de IA y, a continuación, conecta Builder.io (nivel gratuito disponible) o añade una clave de proveedor.",
  "errorMessages.openBuilderSpaceSettings":
    "Abrir los ajustes del espacio de Builder",
  "errorMessages.providerAuthentication":
    "El proveedor del modelo rechazó la clave de API guardada. Actualízala en Ajustes → Integraciones → Claves de API y vuelve a intentarlo.",
  "errorMessages.providerConfiguration":
    "Este modelo no puede usar herramientas con los ajustes actuales. Cambia de modelo en Ajustes y vuelve a intentarlo.",
  "errorMessages.providerHtml":
    "El proveedor devolvió una página de error HTML.",
  "errorMessages.providerNetwork":
    "No se pudo contactar con el proveedor del modelo. Comprueba tu conexión y vuelve a intentarlo.",
  "errorMessages.providerRateLimit":
    "El proveedor del modelo está limitando temporalmente este chat. Espera un momento y vuelve a intentarlo.",
  "errorMessages.providerTransientRejection":
    "El proveedor de IA rechazó temporalmente esta solicitud. Esto suele resolverse en menos de un minuto: vuelve a intentarlo.",
  "errorMessages.startNewChat": "Iniciar un chat nuevo",
  "errorMessages.addCreditsInBuilder": "Añadir créditos en Builder",
  "feedback.inaccurate": "Impreciso",
  "feedback.keyboardHint": "{{shortcut}} Enter para enviar",
  "feedback.notHelpful": "Poco útil",
  "feedback.placeholder": "Cuéntanos qué salió mal...",
  "feedback.submit": "Enviar",
  "feedback.submitted": "Comentarios enviados",
  "feedback.thumbsDown": "No me gusta",
  "feedback.thumbsUp": "Me gusta",
  "feedback.tooSlow": "Demasiado lento",
  "feedback.whatWentWrong": "¿Qué salió mal?",
  "feedback.wrongTool": "Herramienta incorrecta",
  "contextMeter.ariaLabel":
    "Contexto {{percent}} %, {{totalTokens}}{{breakdown}}. Abrir el análisis de contexto.",
  "contextMeter.breakdown":
    " en total: {{systemTokens}} del sistema + {{conversationTokens}} de la conversación",
  "contextMeter.summary": "Contexto {{percent}}% · {{totalTokens}}",
  "contextMeter.summaryBreakdown":
    " ({{systemTokens}} del sistema + {{conversationTokens}} de la conversación)",
  "contextXray.advisory": "Orientativo",
  "contextXray.conversation": "{{count}} conversación",
  "contextXray.currentStatus": "Estado actual",
  "contextXray.estimated": "estimado",
  "contextXray.estimatedPrefix": " estimado",
  "contextXray.estimatedSuffix": " · estimado",
  "contextXray.evict": "Retirar",
  "contextXray.evicted": "{{count}} retirados",
  "contextXray.evictSegment": "Retirar segmento",
  "contextXray.framework": "Marco",
  "contextXray.free": "{{count}} libres",
  "contextXray.governance.inherited": "Heredado",
  "contextXray.governance.required": "Requerido",
  "contextXray.governance.user": "Tu contexto",
  "contextXray.groups.conversation": "Conversación",
  "contextXray.groups.evicted": "Retirados",
  "contextXray.groups.filesRead": "Archivos leídos",
  "contextXray.groups.pinned": "Fijados",
  "contextXray.groups.taskInstructions": "Tarea e instrucciones",
  "contextXray.groups.thinking": "Pensamiento",
  "contextXray.groups.toolResults": "Resultados de herramientas",
  "contextXray.inspect": "Inspeccionar {{name}}",
  "contextXray.list": "Lista",
  "contextXray.loading": "Cargando contexto...",
  "contextXray.map": "Mapa",
  "contextXray.messageIndex": "índice de mensajes",
  "contextXray.noActiveSegments": "No hay segmentos activos",
  "contextXray.panelTitle": "Radiografía de contexto",
  "contextXray.partIndex": "índice de partes",
  "contextXray.pin": "Fijar",
  "contextXray.pinned": "{{count}} fijados",
  "contextXray.pinSegment": "Fijar segmento",
  "contextXray.protectedDescription":
    "Este segmento forma parte del turno activo y todavía no se puede retirar.",
  "contextXray.protectedDuringTurn": "Protegido durante el turno activo",
  "contextXray.recordEvictionIntent": "Registrar intención de retirada",
  "contextXray.restore": "Restaurar",
  "contextXray.restoreSegment": "Restaurar segmento",
  "contextXray.segment": "Segmento",
  "contextXray.showList": "Mostrar lista de contexto",
  "contextXray.showMap": "Mostrar mapa de contexto",
  "contextXray.status.active": "Activo",
  "contextXray.status.evicted": "Retirado",
  "contextXray.status.pinned": "Fijado",
  "contextXray.status.protected": "Protegido",
  "contextXray.status.summarized": "Resumido",
  "contextXray.system": "{{count}} del sistema",
  "contextXray.systemOrdered": "Sistema · ordenado, no se puede retirar",
  "contextXray.tokens": "tokens",
  "contextXray.tokensShare": "tokens · {{share}} %",
  "contextXray.unpin": "Desfijar",
  "contextXray.unpinSegment": "Desanclar segmento",
  "share.add": "Añadir",
  "share.addPeopleEmail": "Añadir personas por correo electrónico",
  "share.addPeopleOrganization": "Añade personas de tu organización",
  "share.admin": "Administrador",
  "share.adminDescription": "Puede editar y gestionar el acceso",
  "share.commenter": "Comentador",
  "share.commenterDescription": "Puede ver y añadir comentarios",
  "share.advanced": "Avanzado",
  "share.advancedAccess": "Acceso avanzado",
  "share.advancedDescription":
    "Controla cómo aparece el acceso de la organización en la búsqueda.",
  "share.copied": "Copiado",
  "share.copy": "Copiar",
  "share.shareWithAgents": "Compartir con agentes",
  "share.agentContext": "Enlace de contexto del agente",
  "share.agentContextDescription":
    "Contexto de solo lectura para un agente externo.",
  "share.preparingAgentLink": "Preparando el enlace del agente...",
  "share.agentLinkUnavailable": "No se pudo crear el enlace del agente.",
  "share.retryAgentLink": "Reintentar",
  "share.editor": "Editor",
  "share.editorDescription": "Puede editar",
  "share.generalAccess": "Acceso general",
  "share.hideInSearch": "Ocultar en la búsqueda",
  "share.linkCanStillOpen": "Las personas con el enlace aún pueden abrirlo.",
  "share.loading": "Cargando...",
  "share.loadMore": "Cargar más",
  "share.loadFailed": "No se pudo cargar la configuración de uso compartido.",
  "share.loadPeopleFailed": "No se pudieron cargar las personas.",
  "share.noAccess": "Nadie tiene acceso todavía.",
  "share.noMatches": "Sin coincidencias.",
  "share.noPeopleFound": "No se encontraron personas.",
  "share.notifyPeople": "Notificar a las personas",
  "share.message": "Mensaje",
  "share.addMessage": "Añadir un mensaje",
  "share.hideMessage": "Ocultar mensaje",
  "share.messagePlaceholder": "Añade una nota breve (opcional)",
  "share.organization": "Organización",
  "share.organizationDescription":
    "Cualquier persona de tu organización puede verlo",
  "share.owner": "Propietario",
  "share.peopleWithAccess": "Personas con acceso",
  "share.private": "Privado",
  "share.privateDescription": "Solo las personas con acceso pueden verlo",
  "share.public": "Público",
  "share.publicDescription": "Cualquier persona con el enlace puede verlo",
  "share.remove": "Eliminar",
  "share.role": "Rol",
  "share.searching": "Buscando...",
  "share.share": "Compartir",
  "share.shareLink": "Compartir enlace",
  "share.shareOptions": "Opciones para compartir",
  "share.titleWithResource": 'Compartir "{{title}}"',
  "share.titleWithType": "Compartir {{type}}",
  "share.triggerWithVisibility": "Compartir ({{visibility}})",
  "share.unknownPerson": "Persona desconocida",
  "share.viewer": "Lector",
  "share.viewerDescription": "Puede ver",
  "share.userGroup": "Grupo de usuarios",
  "settings.emailTitle": "Correo electrónico",
  "settings.emailChange": "Cambiar correo electrónico",
  "settings.emailChanging": "Enviando...",
  "settings.emailChangeSent": "Revisa tu correo para confirmar este cambio.",
  "settings.emailChangeError": "No se pudo enviar la confirmación.",
  "settings.emailNewLabel": "Correo electrónico nuevo",
  "settings.emailNewPlaceholder": "Introduce un correo nuevo",
  "usage.builderCredits": "Créditos de Builder",
  "usage.inviteFriends": "Invita a tus amigos",
  "usage.inviteCredits":
    "Gana {{amount}} créditos de Builder cuando un amigo se suscriba.",
  "usage.copyInviteLink": "Copiar enlace de invitación",
  "usage.inviteLinkCopied": "Enlace de invitación copiado",
  "usage.creditBalance": "Saldo del espacio de trabajo",
  "usage.monthlyPlan": "Plan mensual",
  "usage.dailyFreeLimit": "Límite diario gratuito",
  "usage.creditUsedOfLimit": "{{used}} de {{limit}} usados",
  "usage.creditRemaining": "Quedan {{amount}}",
  "usage.creditUsageUnavailable":
    "No se pudo cargar el uso de créditos de Builder.",
  "usage.estimatedBuilderCredits": "~{{amount}} créditos estimados",
  "usage.otherUsdSpend": "{{amount}} USD adicional",
  "usage.noBuilderCredits": "0 créditos de Builder",
  "usage.otherUnclassifiedSpend": "Gasto en USD adicional o sin clasificar",
  "usage.providerSpendDetail":
    "Uso de proveedores o llamadas antiguas fuera de la facturación de Builder",
  "usage.providerSpendToday": "Uso adicional o sin clasificar hoy: {{amount}}",
  "usage.driverCreditsAndUsd": "Créditos de Builder / USD",
  "settings.usage.tabsLabel": "Vistas de uso",
  "settings.usage.tabOverview": "Resumen",
  "settings.usage.tabActivity": "Actividad",
  "settings.usage.rangeLabel": "Periodo",
  "settings.usage.range7": "Últimos 7 días",
  "settings.usage.range30": "Últimos 30 días",
  "settings.usage.range90": "Últimos 90 días",
  "settings.usage.appFilterLabel": "App",
  "settings.usage.allApps": "Todas las apps",
  "settings.usage.unattributedApp": "Sin atribuir",
  "settings.usage.peopleFilterLabel": "Personas",
  "settings.usage.everyone": "Todos",
  "settings.usage.justYou": "Solo tú",
  "settings.usage.estimatedSpend": "Gasto estimado",
  "settings.usage.creditSpend": "Gasto en créditos de Builder.io",
  "settings.usage.yourEstimatedSpend": "Tu gasto estimado",
  "settings.usage.yourCreditSpend": "Tu gasto en créditos de Builder.io",
  "settings.usage.calls": "Llamadas",
  "settings.usage.tokens": "Tokens",
  "settings.usage.activePeople": "Personas activas",
  "settings.usage.history": "Historial de uso",
  "settings.usage.historyDimensionLabel": "Agrupar historial de uso",
  "settings.usage.byFeature": "Por función",
  "settings.usage.byApp": "Por app",
  "settings.usage.byModel": "Por modelo",
  "settings.usage.bySurface": "Por superficie",
  "settings.usage.historyChartLabel": "Uso diario",
  "settings.usage.noUsage": "Sin uso en este periodo.",
  "settings.usage.total": "Total",
  "settings.usage.featureChat": "Chat",
  "settings.usage.featureSubAgents": "Subagentes",
  "settings.usage.featureAutomations": "Automatizaciones",
  "settings.usage.other": "Otros",
  "settings.usage.unknownModel": "Modelo desconocido",
  "settings.usage.surfaceApp": "En la app",
  "settings.usage.topChats": "Chats principales",
  "settings.usage.untitledChat": "Chat sin título",
  "settings.usage.titleUnavailable": "No se pudo cargar el título",
  "settings.usage.showAll": "Mostrar todo",
  "settings.usage.showLess": "Mostrar menos",
  "settings.usage.topPeople": "Personas principales",
  "settings.usage.you": "Tú",
  "settings.usage.toolCalls": "Llamadas a herramientas",
  "settings.usage.toolCallsChartLabel": "Llamadas a herramientas por día",
  "settings.usage.noToolCalls": "Sin llamadas a herramientas en este periodo.",
  "settings.usage.toolCallsUnavailable":
    "No se pudieron cargar las llamadas a herramientas.",
  "settings.usage.modelCalls": "Llamadas al modelo",
  "settings.usage.modelCallsDimensionLabel": "Agrupar llamadas al modelo",
  "settings.usage.modelCallsChartLabel": "Llamadas al modelo por día",
  "settings.usage.noModelCalls": "Sin llamadas al modelo en este periodo.",
  "settings.usage.recentPrompts": "Prompts recientes",
  "settings.usage.promptNotCaptured": "Prompt no registrado",
  "settings.usage.promptUnavailable": "No se pudo cargar el prompt",
  "settings.usage.loadError": "No se pudo cargar el uso.",
  "settings.usage.yourAlerts": "Tus alertas",
  "settings.usage.alertsLoadError": "No se pudieron cargar las alertas.",
  "settings.usage.alertDailySpend": "Gasto diario",
  "settings.usage.alertMonthlySpend": "Gasto mensual",
  "settings.usage.alertDailyTokens": "Tokens diarios",
  "settings.usage.alertMonthlyTokens": "Tokens mensuales",
  "settings.usage.alertOnTrack": "Dentro del límite",
  "settings.usage.alertOverLimit": "Por encima del límite",
  "settings.usage.alertDismissed": "Descartada",
  "settings.usage.alertOff": "Desactivada",
  "settings.usage.alertProgressDay": "{{current}} de {{limit}} hoy",
  "settings.usage.alertProgressMonth": "{{current}} de {{limit}} este mes",
  "settings.usage.alertChannelsBoth": "En la app y por correo",
  "settings.usage.alertChannelInApp": "En la app",
  "settings.usage.alertChannelEmail": "Correo",
  "settings.usage.alertDefault": "Predeterminada",
  "settings.usage.alertEdit": "Editar",
  "settings.usage.alertDialogTitle": "Alerta de {{name}}",
  "settings.usage.alertThreshold": "Avisarme al llegar a",
  "settings.usage.alertHintDayAll": "Por día, en todas las apps.",
  "settings.usage.alertHintMonthAll": "Por mes, en todas las apps.",
  "settings.usage.alertHintDayApp": "Por día, en {{app}}.",
  "settings.usage.alertHintMonthApp": "Por mes, en {{app}}.",
  "settings.usage.alertNotify": "Avisar por",
  "settings.usage.alertEnabled": "Alerta activada",
  "settings.usage.alertReset": "Restablecer valor predeterminado",
  "settings.usage.alertInvalidLimit": "Introduce un importe mayor que cero.",
  "settings.usage.alertNoChannel": "Elige al menos una forma de aviso.",
  "settings.usage.alertSaveError": "No se pudo guardar la alerta.",
  "settings.usage.unitUsd": "USD",
  "settings.usage.unitCredits": "créditos",
  "settings.usage.unitTokens": "tokens",
  "settings.usage.creditAmount_one": "{{amount}} crédito",
  "settings.usage.creditAmount_many": "{{amount}} créditos",
  "settings.usage.creditAmount_other": "{{amount}} créditos",
  "settings.usage.tokenAmount_one": "{{amount}} token",
  "settings.usage.tokenAmount_many": "{{amount}} tokens",
  "settings.usage.tokenAmount_other": "{{amount}} tokens",
  "settings.storage.provider": "Proveedor",
  "settings.storage.providerOther": "Otro compatible con S3",
  "settings.storage.endpoint": "URL del endpoint",
  "settings.storage.bucket": "Bucket",
  "settings.storage.accessKeyId": "ID de clave de acceso",
  "settings.storage.secretAccessKey": "Clave de acceso secreta",
  "settings.storage.region": "Región",
  "settings.storage.publicUrl": "URL pública",
  "settings.storage.optional": "Opcional",
  "settings.storage.saved": "Guardada",
  "settings.storage.hintAws": "Usa el endpoint de la región de tu bucket.",
  "settings.storage.hintR2":
    "Lo encontrarás en la configuración de tu bucket de R2.",
  "settings.storage.hintSupabase":
    "Lo encontrarás en la configuración de Storage de tu proyecto.",
  "settings.storage.hintOther":
    "También funcionan MinIO, Backblaze B2, Wasabi y DigitalOcean Spaces.",
  "settings.storage.save": "Guardar",
  "settings.storage.saving": "Guardando…",
  "settings.storage.cancel": "Cancelar",
  "settings.storage.clear": "Borrar credenciales",
  "settings.storage.clearing": "Borrando…",
  "settings.storage.clearTitle": "¿Borrar las credenciales de almacenamiento?",
  "settings.storage.clearBuilder":
    "Las nuevas subidas irán al almacenamiento de Builder.io.",
  "settings.storage.clearNoFallback":
    "Las subidas fallarán hasta que vuelvas a configurar el almacenamiento.",
  "settings.storage.clearExisting":
    "Los archivos existentes se quedan en {{bucket}}.",
  "settings.storage.clearExistingGeneric":
    "Los archivos existentes se quedan en tu bucket.",
  "settings.storage.invalidUrl":
    "Usa una URL que empiece por https:// o http://.",
  "settings.storage.invalidBucket":
    "Los nombres de bucket usan letras, números, puntos, guiones y guiones bajos.",
  "settings.storage.savedNotice":
    "Almacenamiento de archivos guardado. Las nuevas subidas irán a {{bucket}}.",
  "settings.storage.cleared": "Credenciales de almacenamiento borradas.",
  "settings.storage.clearedBuilder":
    "Credenciales de almacenamiento borradas. Las nuevas subidas irán a Builder.io.",
  "settings.storage.saveFailed":
    "No se pudo guardar el almacenamiento de archivos.",
  "settings.storage.clearFailed":
    "No se pudieron borrar las credenciales de almacenamiento.",
  "settings.storage.loadFailed":
    "No se pudo cargar la configuración del almacenamiento de archivos.",
  "settings.storage.retry": "Reintentar",
  "settings.storage.adminOnly":
    "Solo los propietarios y administradores de la organización pueden cambiar el almacenamiento de archivos.",
  "settings.audit.action": "Acción",
  "settings.audit.allApps": "Todas las apps",
  "settings.audit.app": "App",
  "settings.audit.changedBy": "Cambiado por",
  "settings.audit.close": "Cerrar",
  "settings.audit.empty": "No hay cambios en este periodo.",
  "settings.audit.emptyDescription":
    "Aquí aparecen los cambios que hacen las personas y el agente.",
  "settings.audit.failed": "Error",
  "settings.audit.input": "Entrada",
  "settings.audit.inputLoadFailed": "No se pudo cargar la entrada.",
  "settings.audit.last30Days": "Últimos 30 días",
  "settings.audit.last7Days": "Últimos 7 días",
  "settings.audit.last90Days": "Últimos 90 días",
  "settings.audit.loadFailed": "No se pudo cargar el registro de auditoría.",
  "settings.audit.loading": "Cargando registro de auditoría",
  "settings.audit.onBehalfOf": "En nombre de",
  "settings.audit.range": "Periodo",
  "settings.audit.refused": "Rechazado",
  "settings.audit.result": "Resultado",
  "settings.audit.showMore": "Mostrar {{count}} más",
  "settings.audit.succeeded": "Correcto",
  "settings.audit.system": "Sistema",
  "settings.audit.target": "Destino",
  "settings.audit.when": "Fecha",
  "accountMenu.label": "Cuenta",
  "accountMenu.loading": "Cargando cuenta",
  "accountMenu.triggerLabel": "{{name}}, {{organization}}",
  "accountMenu.triggerLabelDemo": "{{name}}, {{organization}}, modo demo",
  "accountMenu.personal": "Cuenta personal",
  "accountMenu.demoMode": "Modo demo",
  "accountMenu.demoModeOn": "El modo demo está activado",
  "accountMenu.demoModeDescription":
    "Los correos mostrados y los gráficos compatibles se ajustan para presentaciones. Tu cuenta y tus permisos no cambian.",
  "accountMenu.turnOffDemoMode": "Desactivar el modo demo",
  "accountMenu.invitations": "Invitaciones",
  "accountMenu.joinYourTeam": "Únete a tu equipo",
  "accountMenu.join": "Unirse",
  "accountMenu.yourWorkspace": "Tu espacio de trabajo",
  "accountMenu.createOrganization": "Crear organización",
  "accountMenu.organizationName": "Nombre de la organización",
  "accountMenu.create": "Crear",
  "accountMenu.usage": "Uso",
  "accountMenu.getApps": "Obtener apps y extensiones",
  "accountMenu.back": "Atrás",
  "settingsOrg.general.organization": "Organización",
  "settingsOrg.general.name": "Nombre",
  "settingsOrg.general.nameLocked":
    "Los propietarios y administradores pueden cambiar el nombre.",
  "settingsOrg.general.membership": "Membresía",
  "settingsOrg.general.yourRole": "Tu rol",
  "settingsOrg.general.deleteDescription":
    "Elimina de forma permanente {{name}}, sus miembros y sus datos.",
  "settingsOrg.members.removeTitle": "¿Quitar a {{name}}?",
  "settingsOrg.members.removeDescription":
    "Pierde el acceso a {{org}}. Lo que le pertenece pasa a la persona que elijas.",
  "settingsOrg.members.roleFor": "Rol de {{name}}",
  "settingsOrg.members.moreActions": "Más acciones para {{name}}",
  "settingsOrg.members.removing": "Quitando…",
  "settingsOrg.members.groupsEmpty":
    "Agrupa a los miembros para gestionar juntos el acceso a las apps.",
  "settingsOrg.auth.signIn": "Inicio de sesión",
  "settingsOrg.auth.joining": "Unirse",
  "settingsOrg.auth.betweenApps": "Entre apps",
  "settingsOrg.auth.methodsEmailOnly": "Correo y contraseña.",
  "settingsOrg.auth.methodsEmailAndOne": "Correo y contraseña, y {{method}}.",
  "settingsOrg.auth.methodsEmailAndTwo":
    "Correo y contraseña, {{first}} y {{second}}.",
  "settingsOrg.auth.emailPassword": "Correo y contraseña",
  "settingsOrg.auth.emailPasswordNote": "Activo en todas las implementaciones.",
  "settingsOrg.auth.methodConfigured":
    "Configurado en tu host con estas variables.",
  "settingsOrg.auth.methodNotConfigured":
    "Sin configurar. Añade estas variables en tu host y vuelve a implementar.",
  "settingsOrg.auth.methodOn": "Activado",
  "settingsOrg.auth.methodOff": "Desactivado",
  "settingsOrg.auth.requireHint":
    "Para exigir uno de estos a todos en {{org}}, usa Inicio de sesión de la organización.",
  "settingsOrg.auth.view": "Ver",
  "settingsOrg.auth.close": "Cerrar",
  "settingsOrg.apps.access": "Acceso",
  "settingsOrg.apps.browse": "Explorar apps",
  "settingsOrg.apps.defaults": "Valores predeterminados",
  "settingsOrg.search.domainAutoJoin": "Unión automática por dominio de correo",
  "settingsOrg.search.roles": "Roles de los miembros",
  "settingsOrg.learnMore": "Más información",
  "settingsOrg.moreInformation": "Más detalles",
  "settingsOrg.general.workspaceUrl": "URL del espacio de trabajo",
  "settingsOrg.general.workspaceUrlDescription":
    "Envía a los miembros a este espacio de trabajo desde otra implementación.",
  "settingsOrg.general.workspaceUrlHelp":
    "Los miembros que lleguen a otra implementación irán a este espacio de trabajo en lugar de a una app vacía.",
  "settingsOrg.general.editWorkspaceUrl":
    "Editar la URL del espacio de trabajo",
  "settingsOrg.general.removeWorkspaceUrl":
    "Quitar la URL del espacio de trabajo",
  "settingsOrg.general.setWorkspaceUrl": "Definir URL",
  "settingsOrg.auth.domainDescription":
    "Añade automáticamente a las personas con un correo @{{domain}}.",
  "settingsOrg.auth.domainDescriptionNoDomain":
    "Añade automáticamente a las personas con el dominio de tu correo de trabajo.",
  "settingsOrg.auth.domainHelp":
    "Quien se registre con un correo de este dominio se une a la organización. Solo puedes usar tu propio dominio de correo y no se permiten proveedores de correo gratuitos.",
  "settingsOrg.auth.editDomain": "Editar dominio",
  "settingsOrg.auth.removeDomain": "Quitar dominio",
  "settingsOrg.auth.sharedSecret": "Secreto compartido",
  "settingsOrg.auth.sharedSecretSet":
    "Definido. Permite que las apps de este espacio de trabajo se verifiquen entre sí.",
  "settingsOrg.auth.sharedSecretNotSet":
    "Sin definir. Permite que las apps de este espacio de trabajo se verifiquen entre sí.",
  "settingsOrg.auth.secretNotSetValue": "Sin definir",
  "settingsOrg.auth.manage": "Gestionar",
  "settingsOrg.auth.reveal": "Mostrar",
  "settingsOrg.auth.hide": "Ocultar",
  "settingsOrg.auth.regenerate": "Regenerar",
  "settingsOrg.auth.syncToApps": "Sincronizar con las apps",
  "settingsOrg.auth.pasteSecret": "Pegar secreto",
  "settingsOrg.auth.pasteSecretLabel": "Pega un secreto compartido",
  "settingsOrg.auth.syncing": "Sincronizando con las apps…",
  "settingsOrg.auth.syncErrorStatus": "HTTP {{status}}",
  "settingsOrg.invite.emails": "Direcciones de correo",
  "settingsOrg.invite.emailPlaceholder": "nombre@empresa.com",
  "settingsOrg.invite.note":
    "Cada persona inicia sesión con este correo exacto para aceptar.",
  "settingsOrg.invite.noteNoEmail":
    "Las invitaciones no se enviarán por correo, así que pide a cada persona que inicie sesión con este correo exacto.",
  "settingsOrg.invite.role": "Rol",
  "settingsOrg.invite.member": "Miembro",
  "settingsOrg.invite.admin": "Administrador",
  "settingsOrg.invite.ownerOnlyAdmin":
    "Solo el propietario de la organización puede invitar a administradores.",
  "settingsOrg.invite.removeRow": "Quitar",
  "settingsOrg.invite.addAnother": "Añadir otro",
  "settingsOrg.invite.pasteMany": "Pegar varios",
  "settingsOrg.invite.importCsv": "Importar CSV",
  "settingsOrg.invite.pasteLabel":
    "Pega correos separados por comas, espacios o saltos de línea.",
  "settingsOrg.invite.addAsMembers": "Añadir como miembros",
  "settingsOrg.invite.addAsAdmins": "Añadir como administradores",
  "settingsOrg.invite.add": "Añadir",
  "settingsOrg.invite.send": "Enviar invitaciones",
  "settingsOrg.invite.sending": "Enviando…",
  "settingsOrg.invite.csvNoEmails":
    "No se encontraron correos válidos en este CSV.",
  "settingsOrg.auth.synced_one": "Sincronizado con {{count}} app.",
  "settingsOrg.auth.synced_many": "Sincronizado con {{count}} apps.",
  "settingsOrg.auth.synced_other": "Sincronizado con {{count}} apps.",
  "settingsOrg.auth.syncedPartial_one":
    "Sincronizado con {{succeeded}} de {{count}} app. {{failed}} con error.",
  "settingsOrg.auth.syncedPartial_many":
    "Sincronizado con {{succeeded}} de {{count}} apps. {{failed}} con error.",
  "settingsOrg.auth.syncedPartial_other":
    "Sincronizado con {{succeeded}} de {{count}} apps. {{failed}} con error.",
  "settingsOrg.invite.sent_one": "Se envió {{count}} invitación.",
  "settingsOrg.invite.sent_many": "Se enviaron {{count}} invitaciones.",
  "settingsOrg.invite.sent_other": "Se enviaron {{count}} invitaciones.",
  "settingsOrg.invite.saved_one":
    "Se guardó {{count}} invitación. La verá al iniciar sesión.",
  "settingsOrg.invite.saved_many":
    "Se guardaron {{count}} invitaciones. Las verán al iniciar sesión.",
  "settingsOrg.invite.saved_other":
    "Se guardaron {{count}} invitaciones. Las verán al iniciar sesión.",
  "settingsShell.account.addPassword": "Añadir contraseña",
  "settingsShell.account.authenticatorCode": "Código de autenticación",
  "settingsShell.account.change": "Cambiar",
  "settingsShell.account.changeEmail": "Cambiar correo electrónico",
  "settingsShell.account.changePassword": "Cambiar contraseña",
  "settingsShell.account.confirmPassword": "Confirmar nueva contraseña",
  "settingsShell.account.currentPassword": "Contraseña actual",
  "settingsShell.account.deletionDialogDescription":
    "Se enviará una solicitud de eliminación a un administrador. Tus datos se conservan hasta que la revise.",
  "settingsShell.account.done": "Listo",
  "settingsShell.account.email": "Correo electrónico",
  "settingsShell.account.emailChangeError":
    "No se pudo enviar la confirmación.",
  "settingsShell.account.emailChangeSent":
    "Revisa tu correo para ver cómo confirmar este cambio.",
  "settingsShell.account.languageAndRegion": "Idioma y región",
  "settingsShell.account.languageDescription":
    "Se aplica en todos tus dispositivos.",
  "settingsShell.account.manage": "Gestionar",
  "settingsShell.account.name": "Nombre",
  "settingsShell.account.nameDescription":
    "Se usa para referirse a ti en las aplicaciones de Agent-Native.",
  "settingsShell.account.namePlaceholder": "Tu nombre",
  "settingsShell.account.nameSaveError": "No se pudo actualizar tu nombre.",
  "settingsShell.account.nameSaved": "Nombre actualizado",
  "settingsShell.account.newEmail": "Nuevo correo electrónico",
  "settingsShell.account.newPassword": "Nueva contraseña",
  "settingsShell.account.password": "Contraseña",
  "settingsShell.account.passwordDescription":
    "Añade una contraseña para tener otra forma de iniciar sesión en tu cuenta.",
  "settingsShell.account.passwordLoadError":
    "No se pudieron cargar tus métodos de inicio de sesión.",
  "settingsShell.account.passwordMinLength":
    "Elige una contraseña de al menos {{count}} caracteres.",
  "settingsShell.account.passwordMismatch": "Las contraseñas no coinciden.",
  "settingsShell.account.passwordSaveError":
    "No se pudo actualizar la contraseña.",
  "settingsShell.account.passwordSaved": "Contraseña actualizada",
  "settingsShell.account.photoError": "No se pudo actualizar la foto.",
  "settingsShell.account.photoUpdated": "Foto actualizada",
  "settingsShell.account.profilePhoto": "Foto de perfil",
  "settingsShell.account.requestCopyDescription":
    "Un administrador verifica tu identidad y hace el seguimiento.",
  "settingsShell.account.requestCopyLabel": "Solicitar una copia de tus datos",
  "settingsShell.account.requestDeletionDescription":
    "Tus datos se conservan hasta que un administrador complete la solicitud.",
  "settingsShell.account.requestDeletionLabel":
    "Solicitar la eliminación de datos",
  "settingsShell.account.savePassword": "Guardar contraseña",
  "settingsShell.account.sendConfirmation": "Enviar confirmación",
  "settingsShell.account.sending": "Enviando...",
  "settingsShell.account.setUpTwoFactor": "Configurar dos factores",
  "settingsShell.account.settingUp": "Configurando...",
  "settingsShell.account.signIn": "Inicio de sesión",
  "settingsShell.account.timezone": "Zona horaria",
  "settingsShell.account.timezoneDescription":
    "Se usa para las marcas de tiempo y las automatizaciones programadas.",
  "settingsShell.account.turnOffTwoFactor": "Desactivar dos factores",
  "settingsShell.account.turningOff": "Desactivando...",
  "settingsShell.account.twoFactor": "Autenticación de dos factores",
  "settingsShell.account.twoFactorBackupCodes":
    "Guarda estos códigos de respaldo en un lugar seguro. Cada uno se puede usar una vez si pierdes el acceso a tu autenticador.",
  "settingsShell.account.twoFactorCodeError":
    "Introduce el código de seis dígitos de tu aplicación de autenticación.",
  "settingsShell.account.twoFactorDescription":
    "Usa una aplicación de autenticación para añadir un segundo paso de inicio de sesión a tu cuenta.",
  "settingsShell.account.twoFactorDisableError":
    "No se pudo desactivar la autenticación de dos factores.",
  "settingsShell.account.twoFactorEnabled":
    "La autenticación de dos factores está activada.",
  "settingsShell.account.twoFactorLoadError":
    "No se pudo cargar la configuración de dos factores.",
  "settingsShell.account.twoFactorQrLabel":
    "Código QR de configuración de dos factores",
  "settingsShell.account.twoFactorSaved":
    "Autenticación de dos factores activada",
  "settingsShell.account.twoFactorScan":
    "Escanea este código QR con tu aplicación de autenticación y luego introduce el código que te muestre.",
  "settingsShell.account.twoFactorSetupError":
    "No se pudo actualizar la configuración de dos factores.",
  "settingsShell.account.twoFactorSetupTitle":
    "Configurar la autenticación de dos factores",
  "settingsShell.account.uploading": "Subiendo...",
  "settingsShell.account.verifyAndEnable": "Verificar y activar",
  "settingsShell.account.verifying": "Verificando...",
  "settingsShell.account.voiceBatch": "Por lotes",
  "settingsShell.account.voiceDescription":
    "Elige cómo se transcribe la entrada de voz.",
  "settingsShell.account.voiceGoogleRealtime": "Google en tiempo real",
  "settingsShell.account.voiceInput": "Entrada de voz",
  "settingsShell.account.voiceLoadError":
    "No se pudo cargar tu configuración de transcripción de voz.",
  "settingsShell.account.voiceMacNative": "Nativo de Mac",
  "settingsShell.account.voiceSaveError":
    "No se pudo guardar tu configuración de transcripción de voz.",
  "settingsShell.account.yourData": "Tus datos",
  "settingsShell.appFallbackName": "Aplicación",
  "settingsShell.appGroup.adminOnly":
    "Solo los propietarios y administradores pueden cambiar esto",
  "settingsShell.appGroup.automationsCreateTitle": "¿Qué debe pasar y cuándo?",
  "settingsShell.appGroup.defaultModel": "Modelo predeterminado",
  "settingsShell.appGroup.defaultModelDescription":
    "Se usa en los chats nuevos con el agente en {{app}}. El predeterminado es {{model}}.",
  "settingsShell.appGroup.defaultModelDescriptionUnset":
    "Se usa en los chats nuevos con el agente en {{app}}.",
  "settingsShell.appGroup.defaultModelLoadError":
    "No se pudo cargar el modelo predeterminado.",
  "settingsShell.appGroup.defaultModelSaveError":
    "No se pudo guardar el modelo predeterminado. Inténtalo de nuevo.",
  "settingsShell.appGroup.demoMode": "Modo demo",
  "settingsShell.appGroup.demoModeDescription":
    "Usa datos de ejemplo en este navegador para presentaciones.",
  "settingsShell.appGroup.labsFootnote":
    "Estas funciones nuevas e inestables pueden tener errores.",
  "settingsShell.appGroup.labsLoadError": "No se pudieron cargar tus Labs.",
  "settingsShell.appGroup.labsSaveError":
    "No se pudo cambiar {{lab}}. Inténtalo de nuevo.",
  "settingsShell.appGroup.mcpAbout":
    "Conecta {{app}} con Claude, ChatGPT, Cursor o cualquier app de IA compatible con MCP. Esa app podrá trabajar en {{app}} por ti. Solo ve lo que tú puedes ver.",
  "settingsShell.appGroup.mcpFootnote":
    "Para las herramientas que usa el propio agente, consulta {{integrations}}.",
  "settingsShell.appGroup.newAutomation": "Nueva automatización",
  "settingsShell.appGroup.retry": "Reintentar",
  "settingsShell.appGroup.thisBrowser": "Este navegador",
  "settingsShell.appGroup.useDefault": "Usar el predeterminado",
  "settingsShell.appGroup.whatsNewChip":
    "Novedades de {{app}}. Cada app tiene su propio registro de cambios.",
  "settingsShell.appGroup.whatsNewEmpty": "Aún no hay novedades.",
  "settingsShell.appGroup.whatsNewShowFewer": "Mostrar menos novedades",
  "settingsShell.appGroup.whatsNewViewAll": "Ver todas las novedades",
  "settingsShell.backToApp": "Volver a {{app}}",
  "settingsShell.breadcrumbLabel": "Ruta de navegación",
  "settingsShell.builder.connect": "Conectar",
  "settingsShell.builder.connected": "Conectado",
  "settingsShell.builder.connectedTo": "Conectado · {{space}}",
  "settingsShell.builder.connection": "Conexión",
  "settingsShell.builder.disconnect": "Desconectar",
  "settingsShell.builder.disconnecting": "Desconectando…",
  "settingsShell.builder.disconnectBody":
    "Afecta a todas las personas de {{org}} que no hayan conectado su propia cuenta.",
  "settingsShell.builder.disconnectFailed":
    "No se pudo desconectar Builder.io.",
  "settingsShell.builder.disconnectTitle": "¿Desconectar Builder.io?",
  "settingsShell.builder.grantsFailed":
    "No se pudieron leer las conexiones de Builder.io.",
  "settingsShell.builder.loss.defaultStops":
    "Los chats se detienen hasta que añadas un proveedor de la organización.",
  "settingsShell.builder.loss.defaultSwitches":
    "El modelo predeterminado cambia a {{next}}.",
  "settingsShell.builder.loss.modelPicker":
    "Los modelos de Builder.io desaparecen del selector de modelos.",
  "settingsShell.builder.loss.serviceStops":
    "Deja de funcionar hasta que se configure otro proveedor.",
  "settingsShell.builder.loss.stops": "Deja de funcionar.",
  "settingsShell.builder.loss.uploadsFail":
    "Las subidas fallan hasta que configures el almacenamiento.",
  "settingsShell.builder.manage": "Gestionar",
  "settingsShell.builder.needsReconnect": "Hay que volver a conectarlo.",
  "settingsShell.builder.orgFallback": "tu organización",
  "settingsShell.builder.orgNotConnectedAdmin":
    "No conectado. Cuando lo conectes, todas las personas de {{org}} podrán usarlo.",
  "settingsShell.builder.orgNotConnectedMember":
    "No conectado. Una persona propietaria o administradora puede conectarlo.",
  "settingsShell.builder.organization": "Organización",
  "settingsShell.builder.personal": "Personal",
  "settingsShell.builder.personalConnected": "Conectado. Solo lo usas tú.",
  "settingsShell.builder.personalConnectedOverOrg":
    "Conectado. Solo lo usas tú, en lugar de la conexión de la organización.",
  "settingsShell.builder.personalConnectedTo":
    "Conectado · {{space}}. Solo lo usas tú.",
  "settingsShell.builder.personalConnectedToOverOrg":
    "Conectado · {{space}}. Solo lo usas tú, en lugar de la conexión de la organización.",
  "settingsShell.builder.personalNotConnected":
    "Conecta tu propia cuenta. Solo la usas tú.",
  "settingsShell.builder.personalRestricted":
    "Las personas propietarias y administradoras restringieron las claves de API personales.",
  "settingsShell.builder.personalRestrictedUnused":
    "No se usa mientras las claves de API personales estén restringidas.",
  "settingsShell.builder.reconnect": "Volver a conectar",
  "settingsShell.builder.retry": "Reintentar",
  "settingsShell.builder.use.aiModel": "Modelo de IA",
  "settingsShell.builder.use.aiModelDefaultNote":
    "El modelo predeterminado, {{model}}.",
  "settingsShell.builder.use.aiModelNote":
    "Los modelos de Builder.io están en el selector de modelos.",
  "settingsShell.builder.use.backgroundAgentsNote":
    "Hace cambios de código desde producción.",
  "settingsShell.builder.use.browserAutomationNote":
    "Permite que el agente use un navegador en producción.",
  "settingsShell.builder.use.designSystem":
    "Inteligencia del sistema de diseño",
  "settingsShell.builder.use.designSystemNote":
    "Mantiene las diapositivas y los diseños generados fieles a la marca.",
  "settingsShell.builder.use.embeddings": "Embeddings",
  "settingsShell.builder.use.embeddingsNote": "Búsqueda en Brain.",
  "settingsShell.builder.use.fileStorageNote":
    "Las nuevas subidas se guardan en Builder.io.",
  "settingsShell.builder.use.images": "Generación de imágenes",
  "settingsShell.builder.use.imagesNote": "Slides y Design.",
  "settingsShell.builder.use.voice": "Entrada de voz",
  "settingsShell.builder.use.voiceNote": "Dictado en todas las apps.",
  "settingsShell.builder.usedFor": "Se usa para",
  "settingsShell.builder.usedForFootnote":
    "Elige qué se ejecuta en Builder.io en {{link}}.",
  "settingsShell.builder.usedForLoadFailed":
    "No se pudo comprobar qué servicios se ejecutan en Builder.io.",
  "settingsShell.builder.whatHappens": "Qué pasa",
  "settingsShell.channels.about.discord":
    "Ejecuta el agente con comandos de barra de Discord.",
  "settingsShell.channels.about.email":
    "Envía un correo al agente y responderá en el mismo hilo.",
  "settingsShell.channels.about.googleDocs":
    "Etiqueta al agente en comentarios de Google Docs para recibir respuestas.",
  "settingsShell.channels.about.microsoftTeams":
    "Menciona al agente en Microsoft Teams y responderá en esa conversación.",
  "settingsShell.channels.about.page":
    "Dónde pueden escribir al agente de {{app}}. El agente de cada app se configura por separado.",
  "settingsShell.channels.about.slack":
    "Menciona al agente con @ en un hilo o envíale un mensaje directo, y responderá en ese hilo.",
  "settingsShell.channels.about.telegram":
    "Chatea con tu agente a través de un bot de Telegram.",
  "settingsShell.channels.about.whatsapp":
    "Conecta tu agente a WhatsApp Business.",
  "settingsShell.channels.action.manage": "Gestionar",
  "settingsShell.channels.action.manageAria": "Gestionar {{platform}}",
  "settingsShell.channels.action.setUp": "Configurar",
  "settingsShell.channels.action.setUpAria": "Configurar {{platform}}",
  "settingsShell.channels.action.view": "Ver",
  "settingsShell.channels.action.viewAria": "Ver {{platform}}",
  "settingsShell.channels.agentIn": "Agente en {{platform}}",
  "settingsShell.channels.connection": "Conexión",
  "settingsShell.channels.copyServiceAccountEmail":
    "Copiar el correo de la cuenta de servicio",
  "settingsShell.channels.copyWebhookUrl": "Copiar URL del webhook",
  "settingsShell.channels.credentials": "Credenciales",
  "settingsShell.channels.developerSite": "Sitio para desarrolladores",
  "settingsShell.channels.documentation": "Documentación",
  "settingsShell.channels.empty": "No hay canales disponibles en {{app}}.",
  "settingsShell.channels.information": "Información",
  "settingsShell.channels.loadFailed": "No se pudieron cargar los canales.",
  "settingsShell.channels.membersFootnote":
    "Solo los propietarios y administradores pueden configurar canales.",
  "settingsShell.channels.notFound":
    "Este canal no está disponible en {{app}}.",
  "settingsShell.channels.open": "Abrir",
  "settingsShell.channels.openDocs": "Abrir documentación",
  "settingsShell.channels.registerWebhook": "Registrar",
  "settingsShell.channels.removeCredentials.action": "Quitar",
  "settingsShell.channels.removeCredentials.aria":
    "Quitar las credenciales de {{platform}}",
  "settingsShell.channels.removeCredentials.body":
    "El agente deja de responder en {{platform}} para todos, salvo que el entorno de despliegue también defina estas claves.",
  "settingsShell.channels.removeCredentials.confirm": "Quitar",
  "settingsShell.channels.removeCredentials.failed":
    "No se pudieron quitar las credenciales.",
  "settingsShell.channels.removeCredentials.removing": "Quitando…",
  "settingsShell.channels.removeCredentials.title":
    "¿Quitar las credenciales de {{platform}}?",
  "settingsShell.channels.retry": "Reintentar",
  "settingsShell.channels.setup.addToEnvironment":
    "Añádela al entorno de despliegue",
  "settingsShell.channels.setup.body":
    "Añade estos valores a esta implementación y después actívalo.",
  "settingsShell.channels.setup.close": "Cerrar",
  "settingsShell.channels.setup.failed":
    "No se pudieron guardar las variables.",
  "settingsShell.channels.setup.optional": "Opcional",
  "settingsShell.channels.setup.replace": "Reemplazar",
  "settingsShell.channels.setup.replaceAria": "Reemplazar {{key}}",
  "settingsShell.channels.setup.save": "Guardar",
  "settingsShell.channels.setup.saveAndTurnOn": "Guardar y activar",
  "settingsShell.channels.setup.saving": "Guardando…",
  "settingsShell.channels.setup.saved": "Guardada",
  "settingsShell.channels.setup.savedElsewhere": "Guardada fuera de Canales",
  "settingsShell.channels.setup.setInEnvironment":
    "Se define en el entorno de la implementación",
  "settingsShell.channels.setup.stillMissing":
    "Todavía faltan algunas variables obligatorias.",
  "settingsShell.channels.setup.title": "Configurar {{platform}}",
  "settingsShell.channels.shareDocumentsWith": "Comparte los documentos con",
  "settingsShell.channels.state.notSetUp": "Sin configurar",
  "settingsShell.channels.state.off": "Desactivado",
  "settingsShell.channels.state.on": "Activado",
  "settingsShell.channels.status": "Estado",
  "settingsShell.channels.toggleFailed": "No se pudo actualizar {{platform}}.",
  "settingsShell.channels.turnOnAria": "Activar {{platform}}",
  "settingsShell.channels.unavailable":
    "{{platform}} no está disponible en {{app}}.",
  "settingsShell.channels.webhookLocalOnly":
    "{{platform}} no puede acceder a esta dirección. Abre esta página desde la dirección HTTPS pública de la app para obtener una URL de webhook.",
  "settingsShell.channels.webhookRegistered": "Registrado",
  "settingsShell.channels.webhookRegistration": "Webhook",
  "settingsShell.channels.webhookUrl": "URL del webhook",
  "settingsShell.channels.category": "Categoría",
  "settingsShell.channels.developer": "Desarrollador",
  "settingsShell.channels.mentionAgent": "Mencionar al agente",
  "settingsShell.channels.rowDescription": "{{about}} {{state}}.",
  "settingsShell.channels.separately":
    "El agente de cada app se configura por separado.",
  "settingsShell.channels.setUpLocked":
    "Solo los propietarios y administradores pueden configurarlo",
  "settingsShell.integrationDetail.access.none":
    "Es un servidor público, así que no hay que iniciar sesión en nada.",
  "settingsShell.integrationDetail.access.oauth":
    "El agente actúa con tus permisos de {{name}}, así que solo ve lo que tú puedes ver.",
  "settingsShell.integrationDetail.access.token":
    "El agente usa el token de acceso que añadas, así que ve lo que ese token puede ver.",
  "settingsShell.integrationDetail.accessToken": "Token de acceso",
  "settingsShell.integrationDetail.addAccessToken": "Añadir token de acceso",
  "settingsShell.integrationDetail.callout.adminNeeded":
    "Un administrador tiene que configurarlo",
  "settingsShell.integrationDetail.callout.adminNeededBody":
    "Pide a un propietario o administrador de {{org}} que añada el ID de cliente y el secreto de {{name}}. Después podrás conectar tu propia cuenta.",
  "settingsShell.integrationDetail.callout.beforeAnyone":
    "Antes de que nadie pueda conectarse",
  "settingsShell.integrationDetail.callout.beforeYouConnect":
    "Antes de conectarte",
  "settingsShell.integrationDetail.callout.token":
    "Se conecta con un token de acceso",
  "settingsShell.integrationDetail.callout.unavailable":
    "Aún no está disponible",
  "settingsShell.integrationDetail.category": "Categoría",
  "settingsShell.integrationDetail.connected": "{{name}} conectado",
  "settingsShell.integrationDetail.copyServerUrl": "Copiar URL del servidor",
  "settingsShell.integrationDetail.developer": "Desarrollador",
  "settingsShell.integrationDetail.howToCreateToken": "Cómo crear un token",
  "settingsShell.integrationDetail.justMe": "Solo yo",
  "settingsShell.integrationDetail.notFound":
    "Esta integración no está en el catálogo.",
  "settingsShell.integrationDetail.notFoundTitle": "No encontrado",
  "settingsShell.integrationDetail.prompt.amplitude.1":
    "¿Cómo evolucionaron los usuarios activos semanales este mes?",
  "settingsShell.integrationDetail.prompt.amplitude.2":
    "Crea un embudo desde el registro hasta la primera grabación",
  "settingsShell.integrationDetail.prompt.amplitude.3":
    "¿Qué cohortes tienen mejor retención?",
  "settingsShell.integrationDetail.prompt.apollo.1":
    "Busca responsables de diseño en startups de serie B",
  "settingsShell.integrationDetail.prompt.apollo.2":
    "Enriquece esta lista de correos",
  "settingsShell.integrationDetail.prompt.apollo.3":
    "Añade estos contactos a la secuencia del cuarto trimestre",
  "settingsShell.integrationDetail.prompt.asana.1":
    "¿Qué tengo pendiente esta semana?",
  "settingsShell.integrationDetail.prompt.asana.2":
    "Crea tareas a partir de las acciones de esta grabación",
  "settingsShell.integrationDetail.prompt.asana.3":
    "¿Qué proyectos van con retraso?",
  "settingsShell.integrationDetail.prompt.atlassian.1":
    "Crea un ticket de Jira con las tareas de esta grabación",
  "settingsShell.integrationDetail.prompt.atlassian.2":
    "¿Qué está bloqueando el lanzamiento del cuarto trimestre?",
  "settingsShell.integrationDetail.prompt.atlassian.3":
    "Busca la página de Confluence sobre el onboarding",
  "settingsShell.integrationDetail.prompt.box.1":
    "Busca el contrato firmado de Acme",
  "settingsShell.integrationDetail.prompt.box.2":
    "Comparte la carpeta del informe del tercer trimestre con finanzas",
  "settingsShell.integrationDetail.prompt.box.3":
    "¿Qué cambió en la carpeta legal esta semana?",
  "settingsShell.integrationDetail.prompt.canva.1":
    "Crea una publicación para redes sociales con lo más destacado de esta grabación",
  "settingsShell.integrationDetail.prompt.canva.2":
    "Busca los colores de nuestro kit de marca",
  "settingsShell.integrationDetail.prompt.canva.3":
    "Exporta la última presentación como PDF",
  "settingsShell.integrationDetail.prompt.cloudflare.1":
    "¿Qué registros DNS apuntan a {{host}}?",
  "settingsShell.integrationDetail.prompt.cloudflare.2":
    "Muestra los errores de Worker de la última hora",
  "settingsShell.integrationDetail.prompt.cloudflare.3":
    "Purga la caché de esta URL",
  "settingsShell.integrationDetail.prompt.commonRoom.1":
    "¿Qué empresas muestran señales de compra?",
  "settingsShell.integrationDetail.prompt.commonRoom.2":
    "¿Quién de Acme está activo en nuestra comunidad?",
  "settingsShell.integrationDetail.prompt.commonRoom.3":
    "Resume la actividad de nuestras cuentas principales",
  "settingsShell.integrationDetail.prompt.context7.1":
    "Muestra la documentación actual de React Router sobre loaders",
  "settingsShell.integrationDetail.prompt.context7.2":
    "¿Cómo configuro las migraciones de Drizzle?",
  "settingsShell.integrationDetail.prompt.context7.3":
    "¿Qué hay de nuevo en la última versión de Tailwind?",
  "settingsShell.integrationDetail.prompt.exa.1":
    "Busca artículos recientes sobre apps agent-native",
  "settingsShell.integrationDetail.prompt.exa.2":
    "Investiga a los competidores de {{app}}",
  "settingsShell.integrationDetail.prompt.exa.3": "Obtén y resume esta página",
  "settingsShell.integrationDetail.prompt.figma.1":
    "Resume los componentes de este archivo de Figma",
  "settingsShell.integrationDetail.prompt.figma.2":
    "Enumera las variables de color de nuestro sistema de diseño",
  "settingsShell.integrationDetail.prompt.figma.3":
    "Describe el diseño de este frame",
  "settingsShell.integrationDetail.prompt.fullstory.1":
    "Muestra sesiones en las que la gente hizo clics de frustración en Compartir",
  "settingsShell.integrationDetail.prompt.fullstory.2":
    "Resume las fricciones en la página de precios",
  "settingsShell.integrationDetail.prompt.fullstory.3":
    "¿Dónde abandona la gente durante el onboarding?",
  "settingsShell.integrationDetail.prompt.github.1":
    "Resume las pull requests que esperan mi revisión",
  "settingsShell.integrationDetail.prompt.github.2":
    "Busca issues sobre las vistas previas de enlaces de Slack en agent-native",
  "settingsShell.integrationDetail.prompt.github.3":
    "¿Qué cambió en packages/core esta semana?",
  "settingsShell.integrationDetail.prompt.gitlab.1":
    "¿Qué merge requests fallaron en CI hoy?",
  "settingsShell.integrationDetail.prompt.gitlab.2":
    "Resume las issues abiertas con la etiqueta bug",
  "settingsShell.integrationDetail.prompt.gitlab.3":
    "¿Qué pipelines fueron los más lentos esta semana?",
  "settingsShell.integrationDetail.prompt.gong.1":
    "Resume mi última llamada con Acme",
  "settingsShell.integrationDetail.prompt.gong.2":
    "¿Qué objeciones surgieron este mes?",
  "settingsShell.integrationDetail.prompt.gong.3":
    "¿Qué deals mencionan dudas sobre el precio?",
  "settingsShell.integrationDetail.prompt.googleDocs.1":
    "@agent resume los comentarios de este documento",
  "settingsShell.integrationDetail.prompt.googleDocs.2":
    "@agent redacta una respuesta a este comentario",
  "settingsShell.integrationDetail.prompt.googleDocs.3":
    "@agent convierte estas notas en una lista de verificación",
  "settingsShell.integrationDetail.prompt.grafana.1":
    "Grafica la latencia p95 de la API del último día",
  "settingsShell.integrationDetail.prompt.grafana.2":
    "Busca logs de errores de alrededor de las 14:00",
  "settingsShell.integrationDetail.prompt.grafana.3":
    "¿Qué alertas se dispararon esta semana?",
  "settingsShell.integrationDetail.prompt.granola.1":
    "¿Qué decidimos en la revisión de diseño de ayer?",
  "settingsShell.integrationDetail.prompt.granola.2":
    "Enumera mis tareas pendientes de las reuniones",
  "settingsShell.integrationDetail.prompt.granola.3":
    "Resume mis llamadas con Acme",
  "settingsShell.integrationDetail.prompt.hubspot.1":
    "Mueve el deal de Acme a Closed won",
  "settingsShell.integrationDetail.prompt.hubspot.2":
    "¿Qué deals están estancados en negociación?",
  "settingsShell.integrationDetail.prompt.hubspot.3":
    "Registra esta llamada como nota en el contacto",
  "settingsShell.integrationDetail.prompt.intercom.1":
    "Resume las conversaciones abiertas de hoy",
  "settingsShell.integrationDetail.prompt.intercom.2":
    "Busca artículos de ayuda sobre SSO",
  "settingsShell.integrationDetail.prompt.intercom.3":
    "¿Qué es lo que más preguntan los clientes esta semana?",
  "settingsShell.integrationDetail.prompt.linear.1":
    "Crea una issue para la vista previa de Slack rota y asígnamela",
  "settingsShell.integrationDetail.prompt.linear.2":
    "¿Qué queda en el ciclo actual?",
  "settingsShell.integrationDetail.prompt.linear.3":
    "Resume los bugs reportados esta semana",
  "settingsShell.integrationDetail.prompt.monday.1":
    "¿Qué hay en el tablero de diseño este sprint?",
  "settingsShell.integrationDetail.prompt.monday.2":
    "Mueve este elemento a Done",
  "settingsShell.integrationDetail.prompt.monday.3":
    "¿Qué elementos están vencidos?",
  "settingsShell.integrationDetail.prompt.neon.1":
    "Crea una rama de producción para pruebas",
  "settingsShell.integrationDetail.prompt.neon.2":
    "Muestra las consultas más lentas de esta semana",
  "settingsShell.integrationDetail.prompt.neon.3":
    "¿Qué tamaño tiene la base de datos principal?",
  "settingsShell.integrationDetail.prompt.netlify.1":
    "¿Por qué falló el último despliegue?",
  "settingsShell.integrationDetail.prompt.netlify.2":
    "¿Qué sitios tuvieron builds fallidos esta semana?",
  "settingsShell.integrationDetail.prompt.netlify.3":
    "Vuelve al despliegue de producción anterior",
  "settingsShell.integrationDetail.prompt.notion.1":
    "Busca nuestra lista de verificación de onboarding",
  "settingsShell.integrationDetail.prompt.notion.2":
    "Resume las notas de las reuniones de esta semana",
  "settingsShell.integrationDetail.prompt.notion.3":
    "Añade estas tareas a la wiki del equipo",
  "settingsShell.integrationDetail.prompt.paypal.1":
    "Enumera las facturas vencidas",
  "settingsShell.integrationDetail.prompt.paypal.2":
    "Resume las transacciones de este mes",
  "settingsShell.integrationDetail.prompt.paypal.3":
    "Crea una factura para Acme",
  "settingsShell.integrationDetail.prompt.pylon.1":
    "¿Qué cuentas tienen issues urgentes abiertas?",
  "settingsShell.integrationDetail.prompt.pylon.2":
    "Resume el último ticket de Acme",
  "settingsShell.integrationDetail.prompt.pylon.3":
    "Redacta una respuesta a esta issue",
  "settingsShell.integrationDetail.prompt.semgrep.1":
    "Analiza packages/core en busca de problemas de seguridad",
  "settingsShell.integrationDetail.prompt.semgrep.2":
    "Explica este hallazgo y cómo solucionarlo",
  "settingsShell.integrationDetail.prompt.semgrep.3":
    "¿Hay secretos codificados en este repositorio?",
  "settingsShell.integrationDetail.prompt.sentry.1":
    "¿Cuáles son los principales errores nuevos desde el despliegue de ayer?",
  "settingsShell.integrationDetail.prompt.sentry.2":
    "Muestra la traza del fallo más frecuente",
  "settingsShell.integrationDetail.prompt.sentry.3":
    "¿Qué versión introdujo este error?",
  "settingsShell.integrationDetail.prompt.sigma.1":
    "Busca el panel de ingresos",
  "settingsShell.integrationDetail.prompt.sigma.2":
    "¿Qué provocó el cambio del MRR el mes pasado?",
  "settingsShell.integrationDetail.prompt.sigma.3":
    "Explica las métricas principales de este workbook",
  "settingsShell.integrationDetail.prompt.slack.1":
    "Resume #design de esta semana",
  "settingsShell.integrationDetail.prompt.slack.2":
    "Busca el hilo sobre el cambio de precios",
  "settingsShell.integrationDetail.prompt.slack.3":
    "¿Qué dijo Camila sobre el lanzamiento?",
  "settingsShell.integrationDetail.prompt.stripe.1":
    "¿Cuántos ingresos tuvimos el mes pasado?",
  "settingsShell.integrationDetail.prompt.stripe.2":
    "Busca el cliente de esta factura",
  "settingsShell.integrationDetail.prompt.stripe.3":
    "¿Qué suscripciones no se pudieron renovar?",
  "settingsShell.integrationDetail.prompt.supabase.1":
    "¿Cuántas personas se registraron esta semana?",
  "settingsShell.integrationDetail.prompt.supabase.2":
    "Muestra el esquema de la tabla recordings",
  "settingsShell.integrationDetail.prompt.supabase.3":
    "¿Qué edge functions fallaron hoy?",
  "settingsShell.integrationDetail.prompt.telegram.1":
    "Resume las grabaciones de hoy",
  "settingsShell.integrationDetail.prompt.telegram.2":
    "Recuérdame la revisión de las 15:00",
  "settingsShell.integrationDetail.prompt.telegram.3":
    "Comparte el enlace de la demo de ayer",
  "settingsShell.integrationDetail.prompt.vercel.1":
    "¿Por qué falló el último despliegue de vista previa?",
  "settingsShell.integrationDetail.prompt.vercel.2":
    "Muestra los logs del despliegue de producción",
  "settingsShell.integrationDetail.prompt.vercel.3":
    "¿Qué dominios apuntan a este proyecto?",
  "settingsShell.integrationDetail.prompt.webflow.1":
    "Actualiza el titular de la página de precios",
  "settingsShell.integrationDetail.prompt.webflow.2":
    "Enumera los elementos del CMS publicados esta semana",
  "settingsShell.integrationDetail.prompt.webflow.3":
    "¿Qué páginas no tienen meta descripción?",
  "settingsShell.integrationDetail.prompt.whatsapp.1":
    "¿Qué tengo hoy en el calendario?",
  "settingsShell.integrationDetail.prompt.whatsapp.2":
    "Resume la última grabación",
  "settingsShell.integrationDetail.prompt.whatsapp.3":
    "Envíame las notas de la revisión de diseño",
  "settingsShell.integrationDetail.prompt.zapier.1":
    "Publica las grabaciones nuevas en #design en Slack",
  "settingsShell.integrationDetail.prompt.zapier.2":
    "Añade los nuevos registros a nuestro CRM",
  "settingsShell.integrationDetail.prompt.zapier.3":
    "¿Qué Zaps puedes ejecutar?",
  "settingsShell.integrationDetail.serverUrl": "URL del servidor",
  "settingsShell.integrationDetail.setUp": "Configurar",
  "settingsShell.integrationDetail.signIn": "Inicio de sesión",
  "settingsShell.integrationDetail.signInNone": "Ninguno",
  "settingsShell.integrationDetail.tokenHint.figma":
    "Crea un token de acceso personal en Figma y pégalo aquí.",
  "settingsShell.integrationDetail.tokenHint.github":
    "Crea un token de acceso personal en GitHub y pégalo aquí.",
  "settingsShell.integrationDetail.tokenHint.sentry":
    "Crea un token de autenticación de usuario en Sentry y pégalo aquí.",
  "settingsShell.integrationDetail.tokenHint.zapier":
    "Crea una conexión en Zapier y pega aquí su token bearer.",
  "settingsShell.integrationDetail.tokenPlaceholder":
    "Pega tu token de {{name}}",
  "settingsShell.integrationDetail.who": "Quién puede usarlo",
  "settingsShell.integrationDetail.whoMember":
    "Solo los propietarios y administradores pueden compartirlo con {{org}}.",
  "settingsShell.integrationDetail.whoOrgOnly":
    "Se conecta una sola vez para todos en {{org}}.",
  "settingsShell.integrationDetail.whoPersonal":
    "Cada persona conecta su propia cuenta.",
  "settingsShell.integrationDetail.whoShared":
    "Una conexión compartida permite que todos en {{org}} usen tu acceso.",
  "settingsShell.clearSearch": "Borrar búsqueda",
  "settingsShell.group.account": "Cuenta",
  "settingsShell.group.agent": "Agente",
  "settingsShell.group.connections": "Conexiones",
  "settingsShell.group.organization": "Organización",
  "settingsShell.interfaceLanguage": "Idioma de la interfaz",
  "settingsShell.integrations.addCustom": "Añadir integración personalizada",
  "settingsShell.integrations.builderDescription":
    "Acceso a modelos, automatización del navegador, almacenamiento de archivos e identidad del espacio de trabajo. Hay un plan gratuito.",
  "settingsShell.integrations.builderStatusFailed":
    "No se pudo comprobar la conexión de Builder.io.",
  "settingsShell.integrations.category.analytics": "Analítica",
  "settingsShell.integrations.category.design": "Diseño",
  "settingsShell.integrations.category.engineering": "Ingeniería",
  "settingsShell.integrations.category.finance": "Finanzas",
  "settingsShell.integrations.category.other": "Otras",
  "settingsShell.integrations.category.productivity": "Productividad",
  "settingsShell.integrations.category.sales": "Ventas",
  "settingsShell.integrations.category.support": "Soporte",
  "settingsShell.integrations.connectName": "Conectar {{name}}",
  "settingsShell.integrations.connectedEmptyDescription":
    "Conecta una herramienta abajo y el agente podrá usarla en el chat.",
  "settingsShell.integrations.connectedEmptyTitle": "Aún no hay nada conectado",
  "settingsShell.integrations.footnote":
    "Estas son las herramientas que usa el agente. Para usar {{app}} desde Claude, ChatGPT o Cursor, consulta {{link}}.",
  "settingsShell.integrations.moreActions": "Más acciones para {{name}}",
  "settingsShell.integrations.noResults":
    "Ninguna integración coincide. Prueba con otro nombre.",
  "settingsShell.integrations.remove": "Quitar",
  "settingsShell.integrations.removeFailed": "No se pudo quitar {{name}}.",
  "settingsShell.integrations.removePersonal":
    "El agente dejará de usar {{name}} para ti.",
  "settingsShell.integrations.removeTitle": "¿Quitar {{name}}?",
  "settingsShell.integrations.removeWorkspace":
    "El agente dejará de usar {{name}} para todos en el espacio de trabajo.",
  "settingsShell.integrations.removing": "Quitando…",
  "settingsShell.integrations.retry": "Reintentar",
  "settingsShell.integrations.seeMoreMany": "Ver {{first}}, {{second}} y más",
  "settingsShell.integrations.seeMoreOne": "Ver {{first}}",
  "settingsShell.integrations.seeMoreTwo": "Ver {{first}} y {{second}}",
  "settingsShell.integrations.serversLoadFailed":
    "No se pudieron cargar tus integraciones conectadas.",
  "settingsShell.learnings": "Aprendizajes",
  "settingsShell.loading": "Cargando configuración",
  "settingsShell.navLabel": "Configuración",
  "settingsShell.noResults": "No hay ajustes que coincidan",
  "settingsShell.openNav": "Abrir menú de configuración",
  "settingsShell.page.apiKeys": "Claves de API",
  "settingsShell.page.appGeneral": "General",
  "settingsShell.page.apps": "Aplicaciones",
  "settingsShell.page.audit": "Registro de auditoría",
  "settingsShell.page.auth": "Autenticación",
  "settingsShell.page.automations": "Automatizaciones",
  "settingsShell.page.channels": "Canales",
  "settingsShell.page.creativeContext": "Contexto creativo",
  "settingsShell.page.files": "Archivos",
  "settingsShell.page.infra": "Infraestructura",
  "settingsShell.page.instructions": "Instrucciones",
  "settingsShell.page.integrations": "Integraciones",
  "settingsShell.page.labs": "Labs",
  "settingsShell.page.mcp": "Servidor MCP",
  "settingsShell.page.members": "Miembros",
  "settingsShell.page.memory": "Memoria",
  "settingsShell.page.model": "Modelo",
  "settingsShell.page.notifications": "Notificaciones",
  "settingsShell.page.orgGeneral": "General",
  "settingsShell.page.preferences": "Preferencias",
  "settingsShell.page.profile": "Perfil",
  "settingsShell.page.security": "Seguridad",
  "settingsShell.page.skills": "Habilidades",
  "settingsShell.page.subAgents": "Subagentes",
  "settingsShell.page.usage": "Uso",
  "settingsShell.page.whatsNew": "Novedades",
  "settingsShell.pagePending": "Aún no disponible",
  "settingsShell.resultsLabel": "Resultados de búsqueda en la configuración",
  "settingsShell.search.appDefaultModel": "Modelo predeterminado de la app",
  "settingsShell.search.backgroundAgents": "Agentes en segundo plano",
  "settingsShell.search.browserAutomation": "Automatización del navegador",
  "settingsShell.search.connectedAgents": "Agentes conectados",
  "settingsShell.search.database": "Base de datos",
  "settingsShell.search.defaultModel": "Modelo predeterminado",
  "settingsShell.search.demoMode": "Modo de demostración",
  "settingsShell.search.email": "Correo electrónico",
  "settingsShell.search.fileUploads": "Subida de archivos y almacenamiento",
  "settingsShell.search.hosting": "Alojamiento",
  "settingsShell.search.maxIterations": "Máximo de iteraciones",
  "settingsShell.search.signInMethods": "Métodos de inicio de sesión",
  "settingsShell.search.voiceTranscription": "Transcripción de voz",
  "settingsShell.searchPlaceholder": "Buscar en la configuración",
  "settingsShell.unread": "Nuevo",
  "settingsResources.personal": "Personal",
  "settingsResources.organization": "Organización",
  "settingsResources.fromDispatch": "Desde Dispatch",
  "settingsResources.readOnly": "Solo lectura",
  "settingsResources.readOnlyHint":
    "Solo los propietarios y administradores pueden cambiar esto",
  "settingsResources.editInDispatch": "Edítalo en Dispatch",
  "settingsResources.openDispatch": "Abrir Dispatch",
  "settingsResources.allApps": "Todas las apps",
  "settingsResources.allAppsHint": "Dispatch comparte esto con todas las apps",
  "settingsResources.dispatchEmpty": "No se comparte nada desde Dispatch",
  "settingsResources.loadFailed": "No se pudieron cargar estos recursos.",
  "settingsResources.moreActions": "Más acciones",
  "settingsResources.open": "Abrir",
  "settingsResources.download": "Descargar",
  "settingsResources.remove": "Quitar",
  "settingsResources.removeTitle": "¿Quitar {{name}}?",
  "settingsResources.removeFailed": "No se pudo quitar {{name}}.",
  "settingsResources.saveFailed": "No se pudo guardar {{name}}.",
  "settingsResources.uploadFailed": "No se pudo subir {{name}}.",
  "settingsResources.cancel": "Cancelar",
  "settingsResources.save": "Guardar",
  "settingsResources.create": "Crear",
  "settingsResources.saving": "Guardando",
  "settingsResources.creating": "Creando",
  "settingsResources.removing": "Quitando",
  "settingsResources.instructions.empty":
    "Dile al agente cómo trabajar contigo.",
  "settingsResources.instructions.emptyTitle": "Aún no hay instrucciones",
  "settingsResources.instructions.orgEmpty":
    "Aún no hay instrucciones para {{org}}",
  "settingsResources.instructions.add": "Añadir instrucciones",
  "settingsResources.instructions.fieldLabel":
    "¿Cómo debe trabajar el agente contigo?",
  "settingsResources.instructions.placeholder":
    "Responde de forma breve. Usa unidades métricas.",
  "settingsResources.instructions.savedAs":
    "Se guarda como AGENTS.md en tus recursos personales.",
  "settingsResources.memory.empty":
    "Aquí el agente guarda lo que aprende de ti.",
  "settingsResources.memory.emptyTitle": "Aún no hay memorias",
  "settingsResources.memory.orgEmpty": "Aún no hay memorias compartidas",
  "settingsResources.memory.add": "Añadir memoria",
  "settingsResources.learnings.empty":
    "Las correcciones que le das al agente se guardan como aprendizajes.",
  "settingsResources.learnings.emptyTitle": "Aún no hay aprendizajes",
  "settingsResources.learnings.add": "Añadir aprendizaje",
  "settingsResources.skills.empty":
    "Guarda un flujo de trabajo una vez y el agente podrá reutilizarlo.",
  "settingsResources.skills.emptyTitle": "Aún no hay habilidades",
  "settingsResources.skills.orgEmpty": "Aún no hay habilidades compartidas",
  "settingsResources.skills.add": "Añadir habilidad",
  "settingsResources.skills.describe": "Descríbesela al agente",
  "settingsResources.skills.upload": "Subir un archivo de habilidad",
  "settingsResources.skills.describePlaceholder":
    "Una habilidad que revisa pull requests en busca de problemas de seguridad",
  "settingsResources.files.empty":
    "Añade un archivo para darle más contexto a tu agente.",
  "settingsResources.files.emptyTitle": "Aún no hay archivos",
  "settingsResources.files.orgEmpty": "Aún no hay archivos compartidos",
  "settingsResources.files.add": "Añadir archivo",
  "settingsResources.files.upload": "Subir archivo",
  "settingsResources.files.create": "Crear archivo",
  "settingsInfra.setup": "Configuración",
  "settingsInfra.services": "Servicios",
  "settingsInfra.environment": "Entorno",
  "settingsInfra.builderConnected":
    "Conectado. Los créditos de tu cuenta alimentan cada servicio marcado con Builder.io.",
  "settingsInfra.builderNotConnected":
    "No conectado. Configura cada servicio por tu cuenta o conecta Builder.io para usar los créditos de tu cuenta.",
  "settingsInfra.builderUnknown":
    "No se pudo comprobar la conexión con Builder.io.",
  "settingsInfra.manage": "Gestionar",
  "settingsInfra.connect": "Conectar",
  "settingsInfra.connecting": "Conectando…",
  "settingsInfra.setUp": "Configurar",
  "settingsInfra.view": "Ver",
  "settingsInfra.retry": "Reintentar",
  "settingsInfra.close": "Cerrar",
  "settingsInfra.cancel": "Cancelar",
  "settingsInfra.save": "Guardar",
  "settingsInfra.saving": "Guardando…",
  "settingsInfra.required": "Obligatorio",
  "settingsInfra.recommended": "Recomendado",
  "settingsInfra.optional": "Opcional",
  "settingsInfra.builderRecommended":
    "Usa los créditos de tu cuenta de Builder.io para todos los servicios de abajo. Hay un plan gratuito.",
  "settingsInfra.builderOnly": "Solo con Builder.io",
  "settingsInfra.rowDescription": "{{source}} · {{use}}",
  "settingsInfra.notSetUp": "Sin configurar",
  "settingsInfra.availableWithBuilder": "Disponible con Builder.io",
  "settingsInfra.loadFailed": "No se pudo cargar.",
  "settingsInfra.aiModel": "Modelo de IA",
  "settingsInfra.useEveryApp": "Todas las apps",
  "settingsInfra.storageBucket": "{{provider}}, bucket {{bucket}}",
  "settingsInfra.useUploads": "Subidas en todas las apps",
  "settingsInfra.storageTitle": "Almacenamiento de archivos",
  "settingsInfra.storageIntro":
    "Las nuevas subidas van a tu bucket. Los archivos existentes se quedan donde están.",
  "settingsInfra.voice": "Entrada de voz",
  "settingsInfra.images": "Generación de imágenes",
  "settingsInfra.embeddings": "Embeddings",
  "settingsInfra.useVoice": "Dictado en todas las apps",
  "settingsInfra.useImages": "Slides y Design",
  "settingsInfra.useEmbeddings": "Búsqueda en Brain",
  "settingsInfra.whyVoice":
    "Convierte la voz en texto. Escribir siempre funciona sin ella.",
  "settingsInfra.whyImages": "Genera imágenes para diapositivas y diseños.",
  "settingsInfra.whyEmbeddings":
    "Mejora la búsqueda semántica. La búsqueda por palabras clave sigue funcionando sin ella.",
  "settingsInfra.designSystem": "Inteligencia del sistema de diseño",
  "settingsInfra.whyDesignSystem":
    "Mantiene las diapositivas y los diseños generados fieles a tu marca.",
  "settingsInfra.whyBackground": "Hace cambios en el código desde producción.",
  "settingsInfra.whyBrowser":
    "Permite que el agente use un navegador en producción.",
  "settingsInfra.provider": "Proveedor",
  "settingsInfra.keyOrg": "Usa la clave de {{provider}} de la organización.",
  "settingsInfra.manageKey": "Gestionar clave",
  "settingsInfra.keyPersonal":
    "Tu clave de {{provider}} es personal. Los servicios necesitan una clave de la organización.",
  "settingsInfra.keyNone":
    "Los servicios usan claves de la organización y todavía no hay una clave de {{provider}}.",
  "settingsInfra.keyUnavailable":
    "No se pudo comprobar la clave de {{provider}} de la organización.",
  "settingsInfra.useBuilder": "Usar Builder.io",
  "settingsInfra.addNamed": "Añadir {{provider}}",
  "settingsInfra.serviceSaved": "{{service}} ahora usa {{provider}}.",
  "settingsInfra.serviceSaveFailed": "No se pudo cambiar {{service}}.",
  "settingsInfra.reindex":
    "Vuelve a indexar Brain para que la búsqueda semántica incluya los elementos existentes.",
  "settingsInfra.variables": "Variables obligatorias",
  "settingsInfra.databaseHosted":
    "{{name}}, configurada en tu host. Todas las apps la comparten.",
  "settingsInfra.databaseHostedSingle": "{{name}}, configurada en tu host.",
  "settingsInfra.databaseLocal":
    "{{name}} en este equipo. Configura DATABASE_URL en tu host antes de desplegar.",
  "settingsInfra.databaseMissing":
    "Sin configurar. Configura DATABASE_URL en tu host.",
  "settingsInfra.hostingWorkspace":
    "{{host}}. El espacio de trabajo despliega cada app en su propia dirección.",
  "settingsInfra.hostingSingle": "{{host}}, en {{address}}.",
  "settingsInfra.hostingPlain": "{{host}}.",
  "settingsInfra.hostOwnServer": "Tu propio servidor",
  "settingsInfra.hostThisComputer": "Este equipo",
  "settingsInfra.variablesSet": "{{keys}} están configuradas en tu host.",
  "settingsInfra.variablesMissing": "Configura {{keys}} en tu host.",
  "settingsInfra.dbConnected": "Conectada",
  "settingsInfra.dbLocal": "En este equipo",
  "settingsInfra.notSet": "Sin configurar",
  "settingsInfra.set": "Configurada",
  "settingsInfra.dbIntro":
    "Cada app lee la base de datos antes de iniciarse, así que se configura una vez en tu host. Para cambiar a otra base de datos:",
  "settingsInfra.dbStep1":
    "Crea una base de datos Postgres en Neon, Supabase o cualquier host de Postgres.",
  "settingsInfra.dbStep2":
    "Configura {{key}} con su cadena de conexión en el entorno de tu host.",
  "settingsInfra.dbStep3":
    "Vuelve a desplegar. Las migraciones se ejecutan durante el despliegue.",
  "settingsInfra.dbOwn":
    "Para dar a una app su propia base de datos, configura su propia variable, como {{key}}.",
  "settingsInfra.hostIntroWorkspace":
    "El espacio de trabajo despliega cada app, cada una en su propia dirección. Para alojar en Vercel, Cloudflare o tu propio servidor:",
  "settingsInfra.hostIntro":
    "Para alojar en Vercel, Cloudflare o tu propio servidor:",
  "settingsInfra.hostStep1":
    "Elige el destino con {{key}}, como vercel, cloudflare_module o node.",
  "settingsInfra.hostStep2":
    "Da al nuevo host el mismo entorno, incluidas {{keys}}.",
  "settingsInfra.hostStep3":
    "Despliega. En un espacio de trabajo, esto compila cada app y muestra el comando de publicación:",
  "settingsInfra.envIntro":
    "Cada app las lee antes de iniciarse. Configúralas una vez en tu host y vuelve a desplegar.",
  "settingsInfra.varDatabaseUrl": "Tu cadena de conexión de Postgres.",
  "settingsInfra.varA2a":
    "Permite que las apps de este espacio de trabajo se llamen entre sí. En un espacio de trabajo, también firma las sesiones de inicio de sesión cuando BETTER_AUTH_SECRET no está configurada.",
  "settingsInfra.varBetterAuth":
    "Firma las sesiones de inicio de sesión. Usa al menos 32 caracteres aleatorios.",
  "settingsInfra.varAppUrl":
    "Solo hace falta si el host no puede indicar a la app su URL pública.",
  "settingsInfra.varEncryption":
    "Cifra las claves guardadas en Ajustes. Sin ella, el espacio de trabajo deriva una de A2A_SECRET.",
  "settingsInfra.varEncryptionSingle":
    "Cifra las claves guardadas en Ajustes. Sin ella, la app deriva una de BETTER_AUTH_SECRET.",
  "settingsInfra.varWeak":
    "Demasiado corta. Usa al menos 32 caracteres aleatorios.",
  "settingsInfra.varWeakLabel": "Demasiado corta",
  "settingsInfra.generateSecret": "Para generar un secreto:",
  "settingsInfra.copy": "Copiar",
  "settingsInfra.copied": "Copiado",
  "settingsInfra.copyFailed": "No se pudo copiar.",
  "settingsApiKeys.addKey": "Añadir clave",
  "settingsApiKeys.adding": "Añadiendo…",
  "settingsApiKeys.availableTo": "Disponible para",
  "settingsApiKeys.deleteKey": "Eliminar clave",
  "settingsApiKeys.deleting": "Eliminando…",
  "settingsApiKeys.deleteTitle": "¿Eliminar {{name}}?",
  "settingsApiKeys.everyoneIn": "Todos en {{org}}",
  "settingsApiKeys.getKey": "Obtener clave",
  "settingsApiKeys.hideKeys": "Ocultar claves",
  "settingsApiKeys.justMe": "Solo yo",
  "settingsApiKeys.keyAdded": "Clave añadida",
  "settingsApiKeys.keyDeleted": "Clave eliminada",
  "settingsApiKeys.loadFailed": "No se pudieron cargar tus claves.",
  "settingsApiKeys.manageKey": "Gestionar {{name}}",
  "settingsApiKeys.managedKeys": "Gestionadas por integraciones",
  "settingsApiKeys.managedName": "{{owner}} gestiona esta clave.",
  "settingsApiKeys.managedTooltip":
    "Creada y rotada por {{owner}}. Desconéctala allí.",
  "settingsApiKeys.membersLocked":
    "Solo los propietarios y administradores pueden compartir claves con {{org}}.",
  "settingsApiKeys.modelFootnote":
    "Para usar tu propio proveedor de modelos, {{link}}.",
  "settingsApiKeys.modelFootnoteLink": "añádelo en Modelo",
  "settingsApiKeys.name": "Nombre",
  "settingsApiKeys.noKeys": "Aún no hay claves",
  "settingsApiKeys.noKeysDescription":
    "Añade una clave para que tus apps y el agente puedan acceder a un servicio.",
  "settingsApiKeys.orgKeys": "Claves de la organización",
  "settingsApiKeys.providerInModel": "Añade {{provider}} en {{link}}.",
  "settingsApiKeys.replaceTitle": "Reemplazar {{name}}",
  "settingsApiKeys.replaceValue": "Reemplazar valor",
  "settingsApiKeys.saving": "Guardando…",
  "settingsApiKeys.showKeys_many": "Mostrar {{count}} claves",
  "settingsApiKeys.showKeys_one": "Mostrar {{count}} clave",
  "settingsApiKeys.showKeys_other": "Mostrar {{count}} claves",
  "settingsApiKeys.test": "Probar",
  "settingsApiKeys.testPassed": "El valor guardado funciona.",
  "settingsApiKeys.usedBy": "Usada por {{link}}",
  "settingsApiKeys.value": "Valor",
  "settingsApiKeys.valueReplaced": "Valor reemplazado",
  "settingsApiKeys.yourKeys": "Tus claves",
  "settingsModel.addEndpoint": "Añadir una URL de endpoint",
  "settingsModel.addNamed": "Añadir {{provider}}",
  "settingsModel.addProvider": "Añadir proveedor",
  "settingsModel.adding": "Añadiendo",
  "settingsModel.affectsOrg": "Esto afecta a todas las personas de {{org}}.",
  "settingsModel.affectsYou": "Esto solo te afecta a ti.",
  "settingsModel.allApps": "Todas las apps",
  "settingsModel.apiKey": "Clave de API",
  "settingsModel.builderConnected": "Conectado · {{space}}",
  "settingsModel.builderConnectedPlain": "Conectado",
  "settingsModel.builderOrgNotConnectedAdmin":
    "No conectado. Cuando lo conectes, todas las personas de {{org}} podrán usarlo.",
  "settingsModel.builderOrgNotConnectedMember":
    "No conectado. Un propietario o administrador puede conectarlo.",
  "settingsModel.builderPersonalConnect":
    "Conecta tu propia cuenta para usar tus créditos de Builder.io.",
  "settingsModel.builderPersonalInsteadOfOrg":
    "Conecta tu propia cuenta para usarla en lugar de la de la organización.",
  "settingsModel.builderPersonalOverOrg":
    "Conectado · {{space}}. Se usa en lugar de la conexión de la organización.",
  "settingsModel.builderPersonalOverOrgPlain":
    "Conectado. Se usa en lugar de la conexión de la organización.",
  "settingsModel.builderUnknown":
    "No se pudo comprobar la conexión de Builder.io.",
  "settingsModel.cancel": "Cancelar",
  "settingsModel.change": "Cambiar",
  "settingsModel.chatgptConnected": "Conectado",
  "settingsModel.chatgptDescription":
    "Usa el motor Codex con tu plan de ChatGPT.",
  "settingsModel.chatgptPopupBlocked":
    "Permite las ventanas emergentes para este sitio y vuelve a intentarlo.",
  "settingsModel.chatgptTitle": "Suscripción a ChatGPT",
  "settingsModel.checkAgain": "Volver a comprobar",
  "settingsModel.checkedJustNow": "Comprobada hace un momento.",
  "settingsModel.checkedOn": "Comprobada el {{date}}.",
  "settingsModel.checking": "Comprobando tu clave con {{provider}}",
  "settingsModel.checkingEndpoint": "Comprobando el endpoint",
  "settingsModel.checkingOllama": "Comprobando los modelos instalados…",
  "settingsModel.checkingSaved": "Comprobando la clave guardada",
  "settingsModel.chooseModel": "Elige un modelo",
  "settingsModel.clear": "Borrar",
  "settingsModel.connect": "Conectar",
  "settingsModel.connecting": "Conectando…",
  "settingsModel.defaultModelDescription":
    "Se usa en todas las apps, salvo que la app defina el suyo.",
  "settingsModel.defaultModelNeedsProvider":
    "Añade un proveedor para elegir un modelo predeterminado.",
  "settingsModel.disconnect": "Desconectar",
  "settingsModel.effectDefaultStops":
    "Los chats se detienen hasta que se configure otro proveedor.",
  "settingsModel.effectDefaultSwitches":
    "El modelo predeterminado cambia a {{next}}.",
  "settingsModel.effectKeepsOrg":
    "Sigue funcionando con la clave de la organización.",
  "settingsModel.effectKeepsVault": "Sigue funcionando con la clave del Vault.",
  "settingsModel.effectKeepsWorkspace":
    "Sigue funcionando con la clave del espacio de trabajo.",
  "settingsModel.effectModelsLeave":
    "Los modelos de {{provider}} salen del selector de modelos.",
  "settingsModel.emptyAskAdmin":
    "Pide a un propietario o administrador que añada uno.",
  "settingsModel.emptyDescription":
    "El agente necesita un proveedor para responder.",
  "settingsModel.emptyDescriptionBuilder":
    "El agente necesita un proveedor para responder. Te recomendamos Builder.io para el acceso a modelos, la automatización del navegador, el almacenamiento de archivos y la identidad del espacio de trabajo. Hay un plan gratuito.",
  "settingsModel.emptyTitle": "Añade un proveedor de modelos",
  "settingsModel.endpointFirst": "Primero introduce la URL del endpoint.",
  "settingsModel.endpointHint":
    "Opcional. Úsala para LiteLLM u otra pasarela compatible con OpenAI.",
  "settingsModel.endpointUrl": "URL del endpoint",
  "settingsModel.keyHint":
    "Crea una en {{host}}. {{provider}} la factura directamente.",
  "settingsModel.keyPlaceholder": "Pega tu clave de {{provider}}",
  "settingsModel.labs": "Labs",
  "settingsModel.loadFailed": "No se pudieron cargar los proveedores.",
  "settingsModel.lockedTip":
    "Solo los propietarios y administradores pueden cambiar esto.",
  "settingsModel.manage": "Gestionar",
  "settingsModel.maxIterationsDescription":
    "Cuánto tiempo puede trabajar una respuesta antes de pausarse.",
  "settingsModel.maxIterationsInvalid":
    "Introduce un número entero de {{min}} a {{max}}.",
  "settingsModel.modelCount_many": "{{count}} modelos",
  "settingsModel.modelCount_one": "{{count}} modelo",
  "settingsModel.modelCount_other": "{{count}} modelos",
  "settingsModel.modelOption": "{{model}} · {{provider}}",
  "settingsModel.models": "Modelos",
  "settingsModel.modelsHint":
    "Los modelos seleccionados aparecen en el selector de modelos.",
  "settingsModel.modelsHintService":
    "Los modelos de chat son opcionales. Déjalos sin marcar para usar esta clave solo para {{service}}.",
  "settingsModel.modelsIdle":
    "Pega una clave para ver los modelos que puede usar.",
  "settingsModel.modelsIdleOllama":
    "Introduce la URL del endpoint para ver sus modelos instalados.",
  "settingsModel.modelsSaveFailed":
    "La clave se guardó, pero la lista de modelos no. {{message}}",
  "settingsModel.noChatModels": "Sin modelos de chat",
  "settingsModel.noModelsFound": "No se encontraron modelos.",
  "settingsModel.notSet": "Sin definir",
  "settingsModel.nothingElse": "Nada más usa esta clave.",
  "settingsModel.ollamaHint": "No se necesita clave de API.",
  "settingsModel.orgProviders": "Proveedores de la organización",
  "settingsModel.orgSettings": "Ajustes de la organización",
  "settingsModel.organization": "Organización",
  "settingsModel.pasteFirst": "Primero pega una clave.",
  "settingsModel.personal": "Personal",
  "settingsModel.personalProviders": "Proveedores personales",
  "settingsModel.previewFailed": "No se pudo comprobar a qué afecta.",
  "settingsModel.provider": "Proveedor",
  "settingsModel.providerErrorHeadline":
    "{{provider}} no pudo comprobar esta clave",
  "settingsModel.reasonEndpoint": "Comprueba la URL del endpoint.",
  "settingsModel.reasonOllamaUnreachable":
    "Comprueba la URL y que Ollama esté en ejecución.",
  "settingsModel.reasonPrefix":
    "Las claves de {{provider}} empiezan por {{prefix}}.",
  "settingsModel.reasonRejected":
    "Comprueba que la copiaste entera o crea una nueva.",
  "settingsModel.reasonTryAgain": "Vuelve a intentarlo en un momento.",
  "settingsModel.reasonWrongProvider": "Parece una clave de {{provider}}.",
  "settingsModel.reasonWrongProviderVowel": "Parece una clave de {{provider}}.",
  "settingsModel.reconnect": "Volver a conectar",
  "settingsModel.rejected":
    "{{provider}} rechazó esta clave el {{date}}. Los chats que la usan se detienen hasta que la sustituyas.",
  "settingsModel.rejectedAskAdmin":
    "{{provider}} rechazó esta clave el {{date}}. Pide a un propietario o administrador que la sustituya.",
  "settingsModel.rejectedHeadline": "{{provider}} rechazó esta clave",
  "settingsModel.remove": "Quitar",
  "settingsModel.removeProvider": "Quitar proveedor",
  "settingsModel.removeTitle": "¿Quitar {{provider}}?",
  "settingsModel.removing": "Quitando",
  "settingsModel.replace": "Sustituir",
  "settingsModel.replaceKey": "Sustituir clave",
  "settingsModel.restrictBody":
    "Los miembros solo pueden usar proveedores de la organización.",
  "settingsModel.restrictConfirm": "Restringir claves",
  "settingsModel.restrictDescription":
    "Los miembros solo pueden usar proveedores de la organización, y las claves que añadieron dejan de funcionar.",
  "settingsModel.restrictLabel": "Restringir claves de API personales",
  "settingsModel.restrictMemberBuilder":
    "Su conexión personal de Builder.io deja de funcionar.",
  "settingsModel.restrictMemberChats":
    "Sus chats pasan a usar proveedores de la organización.",
  "settingsModel.restrictMemberKeys_many":
    "Sus claves de {{providers}} dejan de funcionar.",
  "settingsModel.restrictMemberKeys_one":
    "Su clave de {{providers}} deja de funcionar.",
  "settingsModel.restrictMemberKeys_other":
    "Sus claves de {{providers}} dejan de funcionar.",
  "settingsModel.restrictNewKeysBody":
    "Los miembros no pueden añadirlas. Los propietarios y administradores sí pueden.",
  "settingsModel.restrictNewKeysTitle": "Nuevas claves personales",
  "settingsModel.restrictTitle": "¿Restringir claves de API personales?",
  "settingsModel.restricted":
    "Los propietarios y administradores restringieron las claves de API personales.",
  "settingsModel.restrictedRow":
    "No se usa mientras las claves de API personales estén restringidas.",
  "settingsModel.restricting": "Restringiendo",
  "settingsModel.retry": "Reintentar",
  "settingsModel.save": "Guardar",
  "settingsModel.savedRejected":
    "{{provider}} rechazó la clave guardada. Pega una nueva.",
  "settingsModel.saving": "Guardando",
  "settingsModel.selectAll": "Seleccionar todo",
  "settingsModel.settingLoadFailed": "No se pudo cargar este ajuste.",
  "settingsModel.unreachableHeadline": "No se pudo conectar con {{provider}}",
  "settingsModel.view": "Ver",
  "settingsModel.whatHappens": "Qué ocurre",
  "settingsModel.who": "Quién puede usarlo",
  "settingsModel.whoHintAdmin":
    "Los proveedores personales solo son tuyos. Los proveedores de la organización funcionan para todas las personas de {{org}}.",
  "settingsModel.whoHintMember":
    "Solo los propietarios y administradores pueden añadir proveedores de la organización.",
  "settingsModel.whoHintService":
    "Los servicios usan claves de la organización.",
  "settingsSubAgents.connect": "Conectar agente",
  "settingsSubAgents.orgApps": "Apps de {{org}}",
  "settingsSubAgents.workspaceApps": "Apps del espacio de trabajo",
  "settingsSubAgents.external": "Agentes externos",
  "settingsSubAgents.custom": "Agentes personalizados",
  "settingsSubAgents.managedByAdmins": "Gestionado por administradores",
  "settingsSubAgents.appsEmpty": "Aún no hay apps conectadas",
  "settingsSubAgents.externalEmpty":
    "Conecta Foundry, Gemini Enterprise, Anthropic o cualquier agente A2A.",
  "settingsSubAgents.externalEmptyTitle": "Aún no hay agentes externos",
  "settingsSubAgents.customEmpty":
    "Define un agente especializado en el que el agente principal pueda delegar.",
  "settingsSubAgents.customEmptyTitle": "Aún no hay agentes personalizados",
  "settingsSubAgents.addAgent": "Añadir agente",
  "settingsSubAgents.describe": "Descríbelo al agente",
  "settingsSubAgents.describePlaceholder":
    "Un agente de diseño que critica maquetaciones y sugiere una dirección de UI",
  "settingsSubAgents.write": "Escríbelo tú",
  "settingsSubAgents.name": "Nombre",
  "settingsSubAgents.description": "Descripción",
  "settingsSubAgents.instructions": "Instrucciones",
  "settingsSubAgents.loadFailed":
    "No se pudieron cargar los agentes conectados.",
  "settingsSubAgents.statusUnreachable": "No accesible",
  "settingsSubAgents.edit": "Editar",
  "settingsSubAgents.editTitle": "Editar {{name}}",
  "settingsSubAgents.removeDescription":
    "El agente deja de delegar en {{name}} para todos en {{org}}.",
  "settingsSubAgents.removeDescriptionSolo":
    "El agente deja de delegar en {{name}}.",
  "settingsSubAgents.directoryTitle": "Conectar un agente",
  "settingsSubAgents.anyAgent": "Cualquier agente A2A",
  "settingsSubAgents.anyAgentHint": "Pega la URL de una tarjeta de agente.",
  "settingsSubAgents.registryLink": "Explorar el Global A2A Registry",
  "settingsSubAgents.connectTitle": "Conectar {{name}}",
  "settingsSubAgents.close": "Cerrar",
};

export default messages;
