const messages = {
  intelligence: {
    title: "Inteligencia",
    description:
      "Elige los momentos que CRM debe detectar en evidencia de llamadas limitada. Los rastreadores inteligentes se evalúan mediante Ask CRM, nunca directamente en esta pantalla.",
    loading: "Cargando rastreadores…",
    kindKeyword: "Palabra clave",
    kindSmart: "Inteligente",
    enable: "Activar",
    disable: "Desactivar",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "Aún no hay rastreadores de señales",
    emptyDescription:
      "Agrega una palabra clave para coincidencias deterministas o un criterio inteligente para que Ask CRM lo revise.",
    trackerDeleted: "Rastreador eliminado.",
    trackerEnabled: "Rastreador activado.",
    trackerDisabled: "Rastreador desactivado.",
    trackerUpdateFailed: "No se pudo actualizar el rastreador.",
    trackerCreated: "Rastreador creado.",
    trackerCreationFailed: "No se pudo crear el rastreador.",
    newTracker: "Nuevo rastreador",
    createTitle: "Crear rastreador de señales",
    createDescription:
      "Rastrea palabras clave deterministas o define un criterio inteligente limitado para que Ask CRM lo evalúe con evidencia de llamadas.",
    name: "Nombre",
    trackerDescription: "Descripción",
    detector: "Detector",
    keywords: "Palabras clave",
    keywordsPlaceholder: "precio, renovación, revisión de seguridad",
    keywordsHelp: "Separa hasta 40 palabras clave con comas.",
    classificationCriterion: "Criterio de clasificación",
    criterionPlaceholder:
      "Detecta una preocupación clara sobre el plazo de implementación.",
    creating: "Creando…",
    create: "Crear rastreador",
    deleteTrackerAria: "Eliminar {{name}}",
    deleteTrackerTitle: "¿Eliminar {{name}}?",
    deleteTrackerDescription:
      "Esto impide que futuras ejecuciones de señales usen este rastreador. Las señales revisadas existentes no cambian.",
    cancel: "Cancelar",
    deleteTracker: "Eliminar rastreador",
    keywordsSummary: "Palabras clave: {{keywords}}",
    noKeywordsConfigured: "No hay palabras clave configuradas.",
    evaluatedThroughAsk: "Evaluado mediante Ask CRM.",
  },
  recordActions: {
    evidenceAttached: "Evidencia de llamada adjuntada.",
    evidenceAttachFailed: "No se pudo adjuntar la evidencia.",
    addEvidence: "Agregar evidencia",
    attachEvidenceTitle: "Adjuntar evidencia de Clips",
    attachEvidenceDescription:
      "Usa un enlace duradero de la página de Clips. CRM solo guarda la referencia del artefacto, la URL de página y un extracto limitado, nunca archivos multimedia ni transcripciones.",
    artifactId: "ID de artefacto",
    clipsUrl: "URL de Clips",
    summary: "Resumen",
    shortExcerpt: "Extracto breve",
    attachEvidence: "Adjuntar evidencia",
    automate: "Automatizar",
    reviewNewClipsCalls: "Revisar nuevas llamadas de Clips",
    reviewDescription:
      "Prepara una receta de revisión para este registro de CRM sin copiar archivos multimedia ni transcripciones de Clips.",
    disabledAutomationDescription:
      "Esto comienza desactivado y permanece vinculado a {{name}}. Una vez activado explícitamente, cada clip nuevo solo puede adjuntar su referencia de página de grabación con acceso verificado a este registro.",
    handoffDescription:
      "La transferencia conserva solo un ID de clip opaco, una URL de página {{path}} duradera y la hora de captura. Rechaza URL de eventos, archivos multimedia, tokens de acceso, transcripciones, registros inferidos y escrituras en proveedores.",
    manageAutomations: "Administrar automatizaciones",
    configureWithAgent: "Configurar con agente",
  },
  dashboard: {
    metaTitle: "Canal · CRM",
    pipeline: "Canal",
    ready: "El panel del canal está listo.",
    installFailed: "No se pudo instalar el panel del canal.",
    loadingDescription: "Cargando tu panel de canal con alcance de acceso…",
    emptyDescription:
      "Una vista en vivo que respeta los permisos del valor de oportunidades por etapa.",
    installTitle: "Instalar el panel del canal",
    installDescription:
      "Crea un programa de datos propio de CRM y un panel privado para tu espacio de trabajo actual.",
    installAction: "Instalar panel del canal",
    liveDescription:
      "Los totales de oportunidades en vivo usan el acceso CRM del usuario actual y se actualizan desde un programa de datos en caché.",
    updating: "Actualizando…",
    updatePack: "Actualizar paquete",
  },
};

export default messages;
