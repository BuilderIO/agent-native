const messages = {
  intelligence: {
    title: "Intelligenz",
    description:
      "Wähle die Momente aus, die CRM in begrenzten Anrufbelegen erkennen soll. Intelligente Tracker werden über Ask CRM ausgewertet, niemals direkt in diesem Einstellungsbildschirm.",
    loading: "Tracker werden geladen…",
    kindKeyword: "Schlüsselwort",
    kindSmart: "Intelligent",
    enable: "Aktivieren",
    disable: "Deaktivieren",
    toggleTracker: "{{action}} {{name}}",
    emptyTitle: "Noch keine Signal-Tracker",
    emptyDescription:
      "Füge ein Schlüsselwort für deterministische Treffer oder ein intelligentes Kriterium zur Prüfung durch Ask CRM hinzu.",
    trackerDeleted: "Tracker gelöscht.",
    trackerEnabled: "Tracker aktiviert.",
    trackerDisabled: "Tracker deaktiviert.",
    trackerUpdateFailed: "Tracker konnte nicht aktualisiert werden.",
    trackerCreated: "Tracker erstellt.",
    trackerCreationFailed: "Tracker konnte nicht erstellt werden.",
    newTracker: "Neuer Tracker",
    createTitle: "Signal-Tracker erstellen",
    createDescription:
      "Verfolge deterministische Schlüsselwörter oder definiere ein begrenztes intelligentes Kriterium, das Ask CRM anhand von Anrufbelegen auswertet.",
    name: "Name",
    trackerDescription: "Beschreibung",
    detector: "Erkennung",
    keywords: "Schlüsselwörter",
    keywordsPlaceholder: "Preisgestaltung, Verlängerung, Sicherheitsprüfung",
    keywordsHelp: "Trenne bis zu 40 Schlüsselwörter mit Kommas.",
    classificationCriterion: "Klassifizierungskriterium",
    criterionPlaceholder:
      "Erkenne eine klare Sorge hinsichtlich des Umsetzungszeitplans.",
    creating: "Wird erstellt…",
    create: "Tracker erstellen",
    deleteTrackerAria: "{{name}} löschen",
    deleteTrackerTitle: "{{name}} löschen?",
    deleteTrackerDescription:
      "Künftige Signalläufe verwenden diesen Tracker nicht mehr. Bereits geprüfte Signale bleiben unverändert.",
    cancel: "Abbrechen",
    deleteTracker: "Tracker löschen",
    keywordsSummary: "Schlüsselwörter: {{keywords}}",
    noKeywordsConfigured: "Keine Schlüsselwörter konfiguriert.",
    evaluatedThroughAsk: "Über Ask CRM ausgewertet.",
  },
  recordActions: {
    evidenceAttached: "Anrufbeleg angehängt.",
    evidenceAttachFailed: "Beleg konnte nicht angehängt werden.",
    addEvidence: "Beleg hinzufügen",
    attachEvidenceTitle: "Clips-Beleg anhängen",
    attachEvidenceDescription:
      "Verwende einen dauerhaften Clips-Seitenlink. CRM speichert nur die Artefakt-Referenz, Seiten-URL und einen begrenzten Auszug, niemals Medien oder ein Transkript.",
    artifactId: "Artefakt-ID",
    clipsUrl: "Clips-URL",
    summary: "Zusammenfassung",
    shortExcerpt: "Kurzer Auszug",
    attachEvidence: "Beleg anhängen",
    automate: "Automatisieren",
    reviewNewClipsCalls: "Neue Clips-Anrufe prüfen",
    reviewDescription:
      "Bereite eine Prüfungsregel für diesen CRM-Datensatz vor, ohne Clips-Medien oder Transkripte zu kopieren.",
    disabledAutomationDescription:
      "Dies startet deaktiviert und bleibt an {{name}} gebunden. Nach ausdrücklicher Aktivierung darf jeder neue Clip diesem Datensatz nur seine zugriffsgeprüfte Aufzeichnungsseiten-Referenz anhängen.",
    handoffDescription:
      "Die Übergabe bewahrt nur eine undurchsichtige Clip-ID, eine dauerhafte {{path}}-Seiten-URL und den Aufnahmezeitpunkt. Sie lehnt Ereignis-URLs, Medien, Zugriffstoken, Transkripte, abgeleitete Datensätze und Provider-Schreibvorgänge ab.",
    manageAutomations: "Automatisierungen verwalten",
    configureWithAgent: "Mit Agent konfigurieren",
  },
  dashboard: {
    metaTitle: "Vertriebspipeline · CRM",
    pipeline: "Pipeline",
    ready: "Pipeline-Dashboard ist bereit.",
    installFailed: "Pipeline-Dashboard konnte nicht installiert werden.",
    loadingDescription:
      "Dein zugriffsbeschränktes Pipeline-Dashboard wird geladen…",
    emptyDescription:
      "Eine Live-Ansicht des Chancenwerts nach Phase, die Berechtigungen berücksichtigt.",
    installTitle: "Pipeline-Dashboard installieren",
    installDescription:
      "Es erstellt ein CRM-eigenes Datenprogramm und ein privates Dashboard für deinen aktuellen Arbeitsbereich.",
    installAction: "Pipeline-Dashboard installieren",
    liveDescription:
      "Live-Chancensummen verwenden den CRM-Zugriff der aktuellen Person und werden aus einem zwischengespeicherten Datenprogramm aktualisiert.",
    updating: "Wird aktualisiert…",
    updatePack: "Paket aktualisieren",
  },
};

export default messages;
