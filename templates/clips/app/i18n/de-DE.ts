const messages = {
  common: {
    cancel: "Abbrechen",
    create: "Erstellen",
    save: "Speichern",
    saving: "Speichern…",
    saveChanges: "Änderungen speichern",
    connected: "Verbunden",
    notConnected: "Nicht verbunden",
    disconnect: "Trennen",
    disconnecting: "Wird getrennt...",
  },
  root: {
    commandActions: "Aktionen",
    commandSearch: "Suchen",
    commandAppearance: "Darstellung",
    toggleTheme: "Design wechseln",
    extensionSignedInTitle: "Angemeldet",
    extensionSignedInDescription:
      "Öffne die Clips-Erweiterung erneut, um mit der Aufnahme zu beginnen.",
    gotIt: "Verstanden",
  },
  navigation: {
    brand: "Clips",
    library: "Bibliothek",
    spaces: "Bereiche",
    meetings: "Meetings",
    dictate: "Diktieren",
    archive: "Archiv",
    trash: "Papierkorb",
    settings: "Einstellungen",
    notifications: "Benachrichtigungen",
    insights: "Einblicke",
    space: "Bereich",
    folder: "Ordner",
    extensions: "Erweiterungen",
    newRecording: "Neue Aufnahme",
    folders: "Ordner",
    newFolder: "Neuer Ordner",
    noSpaces: "Noch keine Bereiche",
    desktopCta: "Desktop-App laden",
    desktopTitle: "Hol dir die Clips-Desktop-App.",
    desktopBody:
      "Nimm über die Menüleiste auf, nutze ein globales Tastenkürzel und automatische Updates.",
    expandSidebar: "Seitenleiste erweitern",
    collapseSidebar: "Seitenleiste einklappen",
    agentEmptyState: "Wie kann ich dir mit deinen Aufnahmen helfen?",
    agentSuggestionSummary: "Fasse meine letzte Aufnahme zusammen",
    agentSuggestionPricing: "Finde, wo ich Preise erwähnt habe",
    agentSuggestionFiller: "Entferne Füllwörter aus diesem Clip",
    createFolderError: "Erstellen fehlgeschlagen",
    folderCreated: "Ordner erstellt",
    folderNamePlaceholder: "Ordnername",
  },
  empty: {
    library: {
      title: "Deine Bibliothek ist leer",
      body: "Nimm deine erste Bildschirmaufnahme auf; sie erscheint hier und ist bereit zum Teilen.",
      cta: "Ersten Clip aufnehmen",
    },
    folder: {
      title: "Dieser Ordner ist leer",
      body: "Ziehe Aufnahmen hinein oder starte eine Aufnahme, um in diesem Ordner etwas Neues zu beginnen.",
      cta: "Hier aufnehmen",
    },
    space: {
      title: "Noch keine Aufnahmen in diesem Bereich",
      body: "Teile eine Aufnahme mit dem Bereich oder nimm etwas Neues auf; dein Team sieht es dann hier.",
      cta: "Für diesen Bereich aufnehmen",
    },
    archive: {
      title: "Nichts archiviert",
      body: "Archivierte Aufnahmen werden aus der Bibliothek ausgeblendet, aber sicher aufbewahrt. Du kannst sie später jederzeit wiederherstellen.",
    },
    trash: {
      title: "Der Papierkorb ist leer",
      body: "Gelöschte Aufnahmen erscheinen hier 30 Tage lang, bevor sie endgültig entfernt werden.",
    },
    search: {
      title: "Keine Treffer",
      body: "Versuche einen anderen Suchbegriff oder prüfe deine Filter.",
    },
  },
  settings: {
    title: "Einstellungen",
    intro:
      "Einstellungen und verbundene Dienste für diesen Clips-Arbeitsbereich.",
    languageTitle: "Sprache",
    languageDescription:
      "Wähle die Oberflächensprache für dieses Konto. Clips merkt sie sich geräteübergreifend.",
    languageLabel: "Oberflächensprache",
    profile: "Profil",
    email: "E-Mail",
    displayName: "Anzeigename",
    displayNamePlaceholder: "Dein Name",
    playback: "Wiedergabe",
    defaultPlaybackSpeed: "Standard-Wiedergabegeschwindigkeit",
    playbackDescription:
      "Wird automatisch angewendet, wenn du eine Aufnahme öffnest.",
    transcript: "Transkript",
    transcriptCleanup: "Bereinigung im Hintergrund",
    transcriptCleanupDescription:
      "Zeige das native Transkript sofort an und bereinige es im Hintergrund, sobald es verfügbar ist.",
    notifications: "Benachrichtigungen",
    emailNotifications: "E-Mail-Benachrichtigungen",
    emailNotificationsDescription:
      "Erhalte eine E-Mail, wenn jemand eine Aufnahme kommentiert, reagiert oder mit dir teilt.",
    saved: "Einstellungen gespeichert",
    saveFailed: "Speichern fehlgeschlagen",
    builderConnectedToast: "Builder.io verbunden",
    videoStorage: "Videospeicher",
    videoStorageDescription:
      "Builder.io ist der primäre Speicherpfad für Clips-Uploads. S3 ist verfügbar, wenn du deinen eigenen Bucket verwenden musst.",
    checkingBuilder: "Builder.io wird geprüft",
    builderConnected: "Builder.io verbunden",
    connectBuilder: "Builder.io verbinden",
    builderConnectedFor: "Builder.io wird für {{orgName}} verwendet.",
    builderConnectedGeneric:
      "Neue Clips verwenden den verbundenen Builder.io-Anbieter.",
    builderIncludes:
      "Enthält Objektspeicher, Uploads und verwaltete Transkription für neue Clips.",
    s3Title: "S3-kompatibler Speicher",
    secondary: "Sekundär",
    active: "Aktiv",
    s3BuilderConnectedDescription:
      "Nur verwenden, wenn dieser Arbeitsbereich in deinen eigenen Bucket statt zu Builder.io hochladen soll.",
    s3CurrentProvider: "Aktuell wird {{providerName}} verwendet.",
    s3OwnBucketDescription:
      "Nutze deinen eigenen Bucket, wenn du keinen Builder.io-Speicher möchtest.",
    configureS3: "S3 konfigurieren",
    hideS3: "S3 ausblenden",
    saveStorage: "Speicher speichern",
    storageSaved: "Speichereinstellungen gespeichert",
    storageRequired:
      "Endpoint, bucket, access key und secret sind erforderlich.",
    apiSetup: "KI-Einrichtung",
    apiSetupDescription:
      "Builder.io ist der Standardpfad für verwaltete KI-Guthaben. Anbieter-Schlüssel sind optional und können hier hinzugefügt werden.",
    builderEasySetup: "Builder.io ist die einfachste Einrichtung",
    builderAiAvailable:
      "Enthaltene KI-Guthaben und verwaltete Transkription sind für Clips verfügbar.",
    builderAiDescription:
      "Verbinde zuerst Builder, um enthaltene KI-Guthaben, Objektspeicher, Uploads und verwaltete Transkription zu nutzen.",
    providerKeyTitle: "Eigenen Anbieter-Schlüssel verwenden",
    providerKeyDescription:
      "Füge Anthropic-, OpenAI-, Gemini-, Groq- oder OpenRouter-Schlüssel für anbieterseitig abgerechnete Nutzung hinzu.",
    providerKeysSet: "{{count}} gesetzt",
    checkingProviderKeys: "Anbieter-Schlüssel werden geprüft…",
    keySet: "Gesetzt",
    replaceKey: "Schlüssel ersetzen…",
    pasteProviderKey: "Füge zuerst einen Anbieter-Schlüssel ein.",
    apiKeySaved: "API-Schlüssel gespeichert",
    apiKeyFailed: "Schlüssel konnte nicht gespeichert werden",
    slackTitle: "Agent-Native Clips für Slack",
    slackDescription:
      "Teile einen öffentlichen Clip, füge den Link in Slack ein, und er wird direkt abgespielt, ohne zusätzliche Schritte für Betrachter. Verbinde jeden Arbeitsbereich einmal.",
    checkingSlack: "Slack wird geprüft",
    slackConnected_one: "{{count}} Arbeitsbereich verbunden",
    slackConnected_other: "{{count}} Arbeitsbereiche verbunden",
    slackOauthNeeded: "OAuth-Anmeldedaten erforderlich",
    slackPreviewDescription:
      "Öffentliche Clips-Links können als abspielbare Slack-Vorschauen angezeigt werden.",
    connectSlack: "Slack verbinden",
    slackClientMissing:
      "Setze SLACK_CLIENT_ID und SLACK_CLIENT_SECRET für dieses Deployment, bevor du Arbeitsbereiche verbindest.",
    slackSigningMissing:
      "Setze SLACK_SIGNING_SECRET, damit Slack-Ereignis-Callbacks überprüft werden können.",
    connectedBy: "Verbunden von {{email}}",
    disconnectSlackLabel: "{{team}} trennen",
    slackConnectedToast: "Slack verbunden",
    slackCheckedToast: "Slack-Verbindung geprüft",
    slackDisconnectedToast: "Slack getrennt",
    disconnectSlackTitle: "Slack trennen?",
    disconnectSlackDescription:
      "Clips löscht das gespeicherte Bot-Token für {{team}} und sendet keine abspielbaren Slack-Vorschauen mehr.",
    thisWorkspace: "dieser Arbeitsbereich",
  },
};

export default messages;
