const messages = {
  root: {
    commandActions: "Aktionen",
    askPlan: "Plan fragen",
    openPlans: "Pläne öffnen",
    openRecaps: "Rückblicke öffnen",
    commandAppearance: "Darstellung",
    toggleTheme: "Design wechseln",
  },
  header: {
    plan: "Plan",
    settings: "Einstellungen",
    team: "Team",
    extensions: "Erweiterungen",
  },
  navigation: {
    settings: "Einstellungen",
    ask: "Fragen",
    plan: "Plan",
  },
  settings: {
    title: "Einstellungen",
    description: "Sprach- und Arbeitsbereichseinstellungen für diese App.",
    languageTitle: "Sprache",
    languageDescription:
      "Wähle die Sprache der Oberfläche. Diese Einstellung wird in deinem Konto gespeichert.",
    languageLabel: "Oberflächensprache",
    workspaceTitle: "Arbeitsbereich",
    workspaceDescription:
      "Verwalte Teammitglieder, Organisationszugriff und gemeinsame Arbeitsbereichseinstellungen.",
    openTeamSettings: "Teameinstellungen öffnen",
    openResourceSettings: "Ressourceneinstellungen öffnen",
    agentTitle: "Agent-Einstellungen",
    agentDescription:
      "Öffne die Agent-Einstellungen in der Seitenleiste für Modell, API-Schlüssel, Automatisierungen, Sprache und weitere Steuerungen.",
    openAgentSettings: "Agent-Einstellungen öffnen",
    editorTitle: "VS-Code-Erweiterung",
    editorDescription:
      "Öffne und prüfe Pläne in einem Seitenbereich in VS Code statt in einem separaten Browser-Tab.",
    openEditorExtension: "VS-Code-Erweiterung holen",
  },
  agent: {
    emptyState:
      "Bitte den Plan-Agenten, gemergte PR-Rückblicke zu suchen, dieses Dokument zu prüfen, Diagramme hinzuzufügen oder Codefragen als visuelle Pläne zu beantworten.",
    suggestionShipped: "Was wurde in der letzten Woche ausgeliefert?",
    suggestionUi: "Wie sieht diese Oberfläche aus?",
    suggestionApi: "Welche Struktur hat diese API?",
  },
  sidebar: {
    openNavigation: "Navigation öffnen",
    navigation: "Navigation",
    navigationDescription: "Navigationslinks der App",
    chats: "Chats",
    newPlanChat: "Neuer Plan-Chat",
    newChat: "Neuer Chat",
    renameChat: "Chat umbenennen",
    unpinChat: "Chat lösen",
    pinChat: "Chat anheften",
    archiveChat: "Chat archivieren",
    planSection: "Plan",
    newPlan: "Neuer Plan",
    signInCreatePlan: "Anmelden, um einen Plan zu erstellen",
    signInToCreate: "Zum Erstellen anmelden",
    signInKeepPlans: "Melde dich an, um Pläne zu erstellen und zu behalten.",
    noPlans: "Noch keine Pläne.",
    recapBadge: "Rückblick",
    viewAllPlans: "Alle Pläne anzeigen...",
    brandingSentLocal: "Branding-Anfrage an den lokalen Code-Agenten gesendet",
    brandingSent: "Branding-Anfrage an den Code-Agenten gesendet",
    customizePlanBranding: "Plan-Branding anpassen",
    customizeBranding: "Branding anpassen",
    customizeBrandingDescription:
      "Beschreibe die Branding-Änderungen für Plan.",
    customizeBrandingPlaceholder:
      "Unser Logo verwenden, App-Namen ändern, Farben aktualisieren...",
    expandSidebar: "Seitenleiste erweitern",
    collapseSidebar: "Seitenleiste einklappen",
    signIn: "Anmelden",
  },
  chat: {
    suggestionShipped: "Was wurde in der letzten Woche ausgeliefert?",
    suggestionUi: "Wie sieht die neue Checkout-Oberfläche aus?",
    suggestionAuth: "Wann hat sich die Auth-API geändert?",
    suggestionApi: "Wie ist die Billing-API aufgebaut?",
    emptyState: "Plan fragen",
    placeholder:
      "Frage, was ausgeliefert wurde, was sich geandert hat oder was der aktuelle Code zeigt...",
    heading: "Plan fragen",
    description:
      "Durchsuche Zusammenfassungen gemergter PRs, prufe visuelle Blocke und veroffentliche Code-Antworten als Diagramme, Wireframes, API-Spezifikationen und Datenmodelle.",
  },
  editor: {
    slash: {
      text: {
        title: "Text",
        description: "Einfacher Textabsatz",
      },
      heading1: {
        title: "Uberschrift 1",
        description: "Grosse Uberschrift",
      },
      heading2: {
        title: "Uberschrift 2",
        description: "Abschnittsuberschrift",
      },
      heading3: {
        title: "Uberschrift 3",
        description: "Untertitel",
      },
      bulletedList: {
        title: "Aufzahlung",
        description: "Ungeordnete Liste",
      },
      numberedList: {
        title: "Nummerierte Liste",
        description: "Geordnete Liste",
      },
      todoList: {
        title: "Aufgabenliste",
        description: "Checklisteneintrage",
      },
      quote: {
        title: "Zitat",
        description: "Blockzitat",
      },
      codeBlock: {
        title: "Codeblock",
        description: "Codeausschnitt",
      },
      divider: {
        title: "Trenner",
        description: "Horizontale Linie",
      },
      table: {
        title: "Tabelle",
        description: "Drei-mal-drei-Tabelle",
      },
      image: {
        title: "Bild",
        description: "Ein Bild einfugen",
      },
      structuredTable: {
        title: "Strukturierte Tabelle",
      },
    },
  },
  raw: {
    sidebar: {
      archiveChatFailed: "Chat konnte nicht archiviert werden.",
      renameChatFailed: "Chat konnte nicht umbenannt werden.",
    },
    canvas: {
      artboardCanvas: "Plan-Arbeitsflachen-Canvas",
      zoomIn: "Hereinzoomen",
      zoomOut: "Herauszoomen",
      markupSaveFailed:
        "Markup konnte nicht gespeichert werden. Versuche es erneut.",
    },
    document: {
      replaceImageFailed: "Bild konnte nicht ersetzt werden.",
      replacingImage: "Bild wird ersetzt…",
      imageReplaced: "Bild ersetzt.",
      htmlFragment: "HTML-Fragment",
      optionalCss: "Optionales CSS",
      invalidBlockDescription:
        "Dieser generierte Block passte nicht zum Plan-Schema und wurde ausgelassen, während der restliche Recap sichtbar blieb.",
      validationDetails: "Validierungsdetails",
    },
    localCodebase: {
      chooseCodebase: "Codebasis auswahlen",
      clearCodebase: "Codebasis loschen",
      syncCodebase: "Codebasis synchronisieren",
      codebaseSynced: "Codebasis synchronisiert",
      codebaseSyncFailed: "Codebasis-Synchronisierung fehlgeschlagen",
      chooseFolderFailed: "Ordner konnte nicht ausgewahlt werden",
      syncLocalFailed: "Lokale Codebasis konnte nicht synchronisiert werden.",
      folderUnavailable: "Ordnerzugriff ist in diesem Browser nicht verfugbar.",
      filesSynced: "{{count}} Dateien synchronisiert",
      lastSynced: "Zuletzt synchronisiert {{date}}",
      codebaseUnlinked: "Codebasis getrennt",
    },
    content: {
      addSummary: "Kurze Planzusammenfassung hinzufugen",
      changeStatistics: "Anderungsstatistiken",
      untitledPlan: "Unbenannter Plan",
      saveFailed: "Speichern fehlgeschlagen",
    },
    imageViewer: {
      actualSize: "Originalgrosse",
      closePreview: "Bildvorschau schliessen",
      copyImage: "Bild kopieren",
      downloadImage: "Bild herunterladen",
      download: "Herunterladen",
      editDetails: "Details bearbeiten",
      fitToScreen: "An Bildschirm anpassen",
      imageOptions: "Bildoptionen",
      more: "Mehr",
      openOriginal: "Original offnen",
      replaceImage: "Bild ersetzen",
      viewFullSize: "In voller Grosse anzeigen",
      uploadingImage: "Bild wird hochgeladen…",
      image: "Bild",
    },
    imageActions: {
      copiedUrl: "Bild-URL kopiert.",
      copyFailed: "Bild konnte nicht kopiert werden.",
      imageCopied: "Bild kopiert.",
      downloadStarted: "Bilddownload gestartet.",
      openedNewTab: "Bild in neuem Tab geoffnet.",
    },
    markdown: {
      copySectionLink: "Link zu diesem Abschnitt kopieren",
    },
    toc: {
      planSections: "Planabschnitte",
    },
    visual: {
      clearDesignSelection: "Designauswahl loschen",
      designElement: "Designelement",
      visualReviewMode: "Visueller Prufmodus",
      prototype: "Prototyp",
      design: "Design",
      wireframes: "Wireframes",
    },
    blocks: {
      describeChange: "Anderung beschreiben…",
      describeChangeTo: "Anderung an {{label}} beschreiben",
    },
    pages: {
      planActions: "Planaktionen",
    },
  },
  plansPage: {
    common: {
      cancel: "Stornieren",
      save: "speichern",
      delete: "löschen",
      deleting: "Löschen...",
    },
    nouns: {
      plan: "planen",
      recap: "Rezension",
    },
    status: {
      updateFailed: "Der Planstatus konnte nicht aktualisiert werden.",
      setPlanStatus: "Planstatus festlegen",
      setStatus: "Status festlegen",
      labels: {
        draft: "Entwurf",
        review: "Wird überprüft",
        approved: "Genehmigt",
        in_progress: "im Gange",
        complete: "Vollendet",
        archived: "Archiviert",
      },
    },
    localMode: {
      privacyDetails: "Details zum Datenschutz im lokalen Modus",
      badge: "Lokaler Modus",
      title: "100 % privater lokaler Modus",
      description:
        "Ihre Daten werden niemals in unserem Backend gespeichert und von uns nie eingesehen. Auf dieser Seite werden nur Ihre lokalen MDX-Dateien gerendert und bearbeitet.",
      openDocs: "Öffnen Sie das Dokument.",
    },
    reader: {
      openingFile: "Datei in Ihrem Editor öffnen",
      linksDisabled:
        "Links werden während der Überprüfung deaktiviert, sodass das Dokument erhalten bleibt.",
      visualPromptCopied: "Visuelle Aufnahmeaufforderung kopiert",
      sentAnswers: "Antworten an den Agenten gesendet",
      recapLinkCopied: "Zusammenfassungslink kopiert",
      planLinkCopied: "Plan Link kopiert",
      localPathCopied: "Lokaler Pfad kopiert",
      enterRepoFolder: "Geben Sie einen Repository-relativen Ordnerpfad ein.",
      localPlanAlreadySaved: "Der lokale Plan ist bereits im Repo gespeichert",
      savedLocalFiles: "{{count}} lokale Dateien in {{path}} gespeichert",
      localSourceUnavailable: "Die lokale Planquelle war noch nicht verfügbar.",
      localSourceFilesUnavailable:
        "Lokale Plan-Quelldateien waren noch nicht verfügbar.",
      exportUnavailable: "Plan-Export war nicht verfügbar.",
      desktopSyncUnavailable:
        "Die lokale Desktop-Dateisynchronisierung ist nicht verfügbar.",
      sourceFilesUnavailable: "Plan Quelldateien waren noch nicht verfügbar.",
      syncedLocalFiles: "Synchronisierte lokale {{count}}-Dateien",
      noSourceFiles: "Es wurden keine Plan-Quelldateien gefunden.",
      importedLocalSource: "Importierte lokale Quelldateien",
      enableLocalSyncFailed:
        "Die lokale Dateisynchronisierung konnte nicht aktiviert werden.",
      syncLocalFailed:
        "Der Plan konnte nicht mit lokalen Dateien synchronisiert werden.",
      planHtmlCopied: "Plan HTML kopiert",
      planMarkdownCopied: "Plan Markdown kopiert",
      planSourceDownloaded: "Plan Quelle heruntergeladen",
      archiveFailed: "Der Plan konnte nicht archiviert werden.",
      unarchiveFailed: "Der Plan konnte nicht dearchiviert werden.",
      recapMovedToDeleted: "Zusammenfassung wurde in „Gelöscht“ verschoben.",
      planMovedToDeleted: "Plan wurde in „Gelöscht“ verschoben.",
      recapRestored: "Zusammenfassung wiederhergestellt.",
      planRestored: "Plan wiederhergestellt.",
      recapPermanentlyDeleted: "Zusammenfassung endgültig gelöscht.",
      planPermanentlyDeleted: "Plan dauerhaft gelöscht.",
      saveAnswersFailed:
        "Antworten konnten nicht gespeichert werden – sie wurden nur an den Agenten-Chat gesendet.",
      sentCommentsWithScreenshots:
        "Kommentare und gezielte Screenshots an den Agenten gesendet",
      sentComments: "Kommentare an den Agenten gesendet",
      feedbackCopied: "Feedbackanweisungen kopiert",
      backToPlans: "Zurück zu den Plänen",
      openFullPlan: "Vollständigen Plan öffnen",
      openPrototypeWindow: "Öffnen Sie das Prototypenfenster",
      sending: "Senden",
      sendToAgent: "An den Agenten senden",
      sendFeedback: "Feedback senden",
      copyForAgent: "Kopie für Ihren Agenten",
      copyForAgentDescription:
        "Kopiert eine Eingabeaufforderung, die Sie in den Chat einfügen können.",
      sendToInlineAgent: "An Inline-Agent senden",
      sendToInlineAgentDescription:
        "Veröffentlicht offene Kommentare im App-Side-Agent.",
      localFiles: "Lokale Dateien",
      localFilesNoHosted:
        "Keine gehosteten Datenbankschreibvorgänge oder -freigaben.",
      copyLocalPath: "Lokalen Pfad kopieren",
      saveToRepo: "Als Repo speichern...",
      saveSourceToFolder: "Quelle im Ordner speichern...",
      hideComments: "Kommentare ausblenden",
      showComments: "Kommentare anzeigen",
      showAllComments: "Alle Kommentare anzeigen",
      fullPlan: "Kompletter Plan",
      appView: "App-Ansicht",
      fullScreen: "Vollbild",
      lightMode: "Lichtmodus",
      darkMode: "Dunkler Modus",
      cleanWireframes: "Wireframes reinigen",
      sketchyWireframes: "Skizzenhafte Wireframes",
      copyLink: "Link kopieren",
      openDocs: "Dokumente öffnen",
      downloadSourceZip: "Quelle herunterladen (.zip)",
      changeLocalFolder: "Lokalen Ordner ändern",
      linkLocalFolder: "Lokalen Ordner verknüpfen",
      syncToLocalFolder: "Mit lokalem Ordner synchronisieren",
      importLocalEdits: "Lokale Änderungen importieren",
      autoSyncChanges: "Änderungen automatisch synchronisieren",
      export: "Export",
      copyMarkdown: "Kopieren Markdown",
      downloadMarkdown: "Markdown herunterladen",
      copyHtml: "Kopieren HTML",
      downloadHtml: "HTML herunterladen",
      copyFeedback: "Feedback kopieren",
      saveLocalPlanToRepo: "Lokalen Plan im Repository speichern",
      chooseRepoFolder:
        "Wähle einen repository-relativen Ordner für diese MDX-Dateien.",
      repoFolder: "Repository-Ordner",
      replaceExistingFolder: "Vorhandenen Ordner ersetzen",
      toggleAgentSidebar: "Agenten-Seitenleiste umschalten",
      toggleSideChat: "Nebenchat umschalten",
      clickToComment:
        "Klicken Sie auf {{noun}} oder wählen Sie den Text zum Kommentieren aus",
      clickCanvasNote:
        "Klicken Sie auf die Leinwand, um eine Notiz zu platzieren",
      dragCanvasCallout:
        "Ziehen Sie auf der Leinwand, um eine Beschriftung zu zeichnen",
      reviewMarkupTools: "Sehen Sie sich Markup-Tools an",
      stopCommenting: "Hör auf zu kommentieren",
      pinComment: "Pinne einen Kommentar",
      runtimeOpen: "Offen",
      runtimeCloseCodePreview: "Codevorschau schließen",
      runtimeCommentAuthor: "Kommentarautor",
      runtimeComment: "Kommentar",
      runtimePlanComment: "Plan Kommentar",
      runtimeCommentCount_one: "{{count}} Kommentar",
      runtimeCommentCount_other: "{{count}} Kommentare",
      runtimeCommentBy: "{{countLabel}} von {{names}}: {{message}}",
      runtimeCommentTitle: "{{countLabel}}: {{message}}",
      clientHtmlWorkingPlan: "Arbeitsplan",
    },
    share: {
      linkCopied: "Der teilbare Link wurde kopiert",
      copyFailed: "Link konnte nicht kopiert werden",
      createAccountToPublish:
        "Erstellen Sie ein kostenloses Konto, um dieses {{noun}} zu veröffentlichen",
      linkLabel: "{{noun}}-Link",
      description:
        "Standardmäßig privat. Laden Sie Personen ein, teilen Sie sie mit Ihrer Organisation oder stellen Sie „Öffentlich“ ein, damit jeder, der über einen Link verfügt, eine Überprüfung durchführen kann.",
      peopleAccess: "Personen mit {{noun}}-Zugriff",
      generalAccess: "Allgemeiner {{noun}}-Zugriff",
      shareAria: "Teilen {{noun}}",
      share: "Teilen {{noun}}",
      shareThis: "Teilen Sie dies {{noun}}",
      hostedCopy:
        "Dieses lokale {{noun}} verfügt über eine gehostete Kopie zum Teilen. Öffnen Sie das gehostete {{noun}}, um den Zugriff zu verwalten.",
      publishDescription:
        "Erstellen Sie ein kostenloses Konto, um dieses {{noun}} in einem gemeinsam nutzbaren Link zu veröffentlichen. Sie können die Bearbeitung lokal mit Ihrem Codierungsagenten fortsetzen, bis Sie dies tun.",
      finishAccount:
        "Schließen Sie die Erstellung Ihres Kontos ab, kommen Sie dann zurück und wir werden den Link generieren.",
      checking: "Überprüfung",
      signedInRetry: "Ich bin angemeldet – versuchen Sie es erneut",
      updating: "Aktualisierung",
      updateLink: "Link aktualisieren",
      openHostedPlan: "Offener gehosteter Plan",
      creatingLink: "Link erstellen",
      createShareableLink: "Erstellen Sie einen gemeinsam nutzbaren Link",
      accessNote:
        "Jeder mit Bearbeitungszugriff kann {{noun}} ändern. Zum Ansehen eines öffentlichen {{noun}} ist kein Konto erforderlich, für das Kommentieren ist jedoch ein agentennatives Konto erforderlich.",
      visibility: {
        private: {
          label: "Privat",
          description:
            "Nur eingeladene Personen können dieses {{noun}} öffnen.",
        },
        org: {
          label: "Organisation",
          description:
            "Jeder in Ihrer Organisation, der über den Link verfügt, kann ihn ansehen",
        },
        public: {
          label: "Öffentlich",
          description: "Jeder mit dem Link kann es sehen",
        },
      },
    },
    report: {
      reportAria: "Bericht {{noun}}",
      report: "Bericht {{noun}}",
      description:
        "Sagen Sie uns, warum dieser öffentliche {{noun}} überprüft werden sollte.",
      reason: "Grund",
      details: "Details",
      detailsPlaceholder: "Fügen Sie eine kurze Notiz für Moderatoren hinzu",
      submit: "Bericht absenden",
      reasons: {
        spam: "Spam oder irreführend",
        harassment: "Belästigung",
        hate: "Hasserfüllter Inhalt",
        sexual: "Sexuelle Inhalte",
        violence: "Gewalt oder Drohungen",
        "self-harm": "Selbstverletzung",
        privacy: "Datenschutzbedenken",
        illegal: "Illegale Aktivität",
        other: "Etwas anderes",
      },
    },
    skeleton: {
      loadingRecap: "Zusammenfassung wird geladen",
      loadingPlan: "Ladeplan",
    },
    localPlanLoadError: {
      title: "Lokaler Plan nicht gefunden",
      message: "Der lokale Planordner „{{slug}}“ konnte nicht gelesen werden.",
    },
    overview: {
      title: "planen",
      documentCount_other: "{{count}} Dokumente",
      newPlan: "Neuer Plan",
      signInToCreate: "Melden Sie sich zum Erstellen an",
      tabs: {
        all: "alle",
        plans: "planen",
        recaps: "Rezension",
        archived: "Archiviert",
        deleted: "Gelöscht",
      },
      createdBy: "Schöpfer",
      allAuthors: "Alle Autoren",
      me: "ICH",
      searchPlaceholder: "Suchplan...",
      empty: {
        noMatch: "Es gibt keinen passenden Plan.",
        noArchived: "Es sind keine archivierten Pläne vorhanden.",
        noDeleted: "Es gibt keine gelöschten Pläne.",
        noPlans: "Hier gibt es noch keine Pläne.",
      },
      recapBadge: "Rezension",
      deletedBadge: "Gelöscht",
      deletedAt: "Gelöscht am {{date}}",
      planActions: "Planen Sie Operationen",
      restore: "genesen",
      deletePermanently: "Dauerhaft löschen",
      unarchive: "Dearchivieren",
      archive: "Archiv",
      delete: "löschen...",
      documentCount_one: "{{count}} Dokumente",
      documentCount: "Anzahl der Dokumente",
    },
    empty: {
      title: "Beginnen Sie mit einem visuellen Plan",
      description:
        "Erstellen Sie einen ausgefeilten Plan mit bearbeitbaren Dokumentationsblöcken, Diagrammen, Wireframes und Kommentaren, bevor Sie mit der Implementierung beginnen.",
      newPlan: "Neuer Plan",
      installPrefix:
        "Oder installieren Sie den Skill und verwenden Sie ihn in Ihrem Coding-Agent",
      installSuffix: "：",
    },
    loggedOut: {
      title: "Beginnen Sie mit /visual-plan",
      description:
        "Installieren Sie den Skill Plan in Ihrem Codierungsagenten und verwenden Sie dann den Slash-Befehl, um den ersten Prüfplan zu erstellen.",
      installCopied: "Installationsbefehl kopiert",
      installCopyFailed: "Der Installationsbefehl konnte nicht kopiert werden",
      copyInstallCommand: "Kopieren Sie den Installationsbefehl",
      copied: "Kopiert",
      copy: "Kopie",
      viewDocs: "Dokumentation ansehen",
    },
    skillDemos: {
      "visual-plan": {
        label: "Visuelle Planung",
        description:
          "Überprüfen Sie das Implementierungsformular, bevor Codeänderungen implementiert werden.",
        videoAriaLabel: "Video zur Demonstration visueller Planungsfähigkeiten",
      },
      "visual-recap": {
        label: "Visuelle Überprüfung",
        description:
          "Konvertieren Sie PR oder diff in eine gemeinsam nutzbare Rezension.",
        videoAriaLabel:
          "Video zur Demonstration der Fähigkeiten zur visuellen Überprüfung",
      },
    },
    history: {
      surface: {
        prototype: "Prototyp",
        canvas: "Leinwand",
        blocks_other: "{{count}} Blöcke",
        sections_other: "{{count}} Kapitel",
        blocks_one: "{{count}} Blöcke",
        sections_one: "{{count}} Kapitel",
        blocks: "Blöcke",
        sections: "Abschnitte",
      },
      restoreSuccess: "Die geplante Version wurde wiederhergestellt.",
      restoreFailed:
        "Die Version des Wiederherstellungsplans ist fehlgeschlagen.",
      back: "Zurück zur Geschichte",
      title: "Programmgeschichte",
      description:
        "Durchsuchen Sie gespeicherte Planversionen und stellen Sie frühere Snapshots wieder her.",
      untitled: "unbenannter Plan",
      snapshotUnavailable: "Schnappschuss ist nicht verfügbar",
      previewTitle: "Vorschau der Planversion",
      noPreview: "Dieser Schnappschuss enthält keinen Inhalt zur Vorschau.",
      restoreThisVersion: "Stellen Sie diese Version wieder her",
      savedFirst: "Die aktuelle Version wird zuerst im Verlauf gespeichert.",
      versionActions: "Versionsbetrieb",
      noVersions: "Es sind noch keine gespeicherten Versionen vorhanden",
      noVersionsDescription:
        "Die Version wird automatisch gespeichert, bevor der Plan in Zukunft bearbeitet wird.",
      restoreConfirmTitle: "Diese Version wiederherstellen?",
      restoreConfirmDescription:
        "Dadurch wird der aktuelle Plan durch einen Snapshot von {{date}} ersetzt. Die aktuelle Version wird zunächst im Verlauf gespeichert, sodass Sie sie rückgängig machen können.",
      restoring: "Wiederherstellung...",
      restore: "genesen",
    },
    create: {
      sourceOptions: {
        codex: "Codex",
        "claude-code": "Claude Code",
        cursor: "Cursor",
        pi: "Pi",
        manual: "Handbuch",
        imported: "Importiert",
      },
      kindOptions: {
        auto: {
          label: "automatisch",
          description: "Automatisch – wählt den geeigneten Planungspfad",
        },
        ui: {
          label: "UI Prozess",
          description: "UI-Prozess – Wireframes und Zustände",
        },
        questions: {
          label: "Visualisierungsproblem",
          description:
            "Visualisieren Sie das Problem – erfassen Sie Anforderungen übersichtlich",
        },
        visual: {
          label: "Allgemeine Visualisierung",
          description: "Allgemeine Visualisierung – Diagramme und Notizen",
        },
      },
      presets: {
        checkout: "Bestellvorgang",
        settings: "Neugestaltung des Setups",
        imported: "Importierter Plan",
      },
      presetPrompts: {
        checkout:
          "Plane einen Checkout-Review-Flow mit Desktop- und mobilen Wireframes, wichtigen Leer-/Lade-/Fehlerzuständen, Kommentarhinweisen und Implementierungsnotizen.",
        settings:
          "Erstelle einen UI-Flow-Plan für ein Settings-Redesign, einschließlich Navigationszuständen, riskanten Interaktionen, Review-Anmerkungen und Code-Handoff-Notizen.",
        imported:
          "# Implementierungsplan\n\nFüge hier den vorhandenen Codex- oder Claude Code-Plan ein und verwandle ihn in ein visuelles Review-Dokument.",
      },
      assessment: {
        ui: "Der UI-Status oder -Prozess wird automatisch erkannt; Der Agent erstellt zunächst einen Wireframe-Plan.",
        visual:
          "Ermöglicht Agenten automatisch die Erstellung umfassender technischer Pläne mit Diagrammen und Implementierungsdetails.",
      },
      autoWithLabel: "Automatisch: {{label}}",
      agentMissing:
        "Verbinden Sie den auszuführenden Agenten – fügen Sie den Schlüssel API hinzu oder verwenden Sie Builder.",
      describeFirst: "Bitte beschreiben Sie zunächst den Plan.",
      sent: "Wird an den Agenten Plan gesendet",
      title: "Lassen Sie den Agenten den Plan erstellen",
      description:
        "Beschreiben Sie den gewünschten Plan oder fügen Sie einen vorhandenen Codex/Claude-Plan ein. Der Plan-Agent generiert Wireframes und Review-Strukturen.",
      placeholder:
        "Bitte erstellen Sie einen UI-Prozess, ein Implementierungsdiagramm und Überprüfungsnotizen ...",
      advanced: "fortschrittlich",
      source: "Quelle",
      sourceHelp:
        "Wird nur als Quellenangabe verwendet, um zu erklären, wo der Plan beginnt.",
      planningStyle: "Agenturplanstil",
      planningHelp:
        "Der eingefügte Plan wird erkannt und mit dem Importkontext an den Agenten gesendet. Hält den regulären Planungsprozess automatisch aufrecht; Wenn Sie zunächst Anforderungen sammeln möchten, wählen Sie Visuelle Fragen.",
      importDetected:
        "Sieht aus wie ein bestehender Plan. Der Agent behält seine Absicht bei und fügt eine visuelle Überprüfungsstruktur hinzu.",
    },
    loadError: {
      genericMessage:
        "Dieser Plan kann nicht aus der aktuellen Sitzung geladen werden.",
      orgBody:
        "Dieses Programm gehört zu {{orgName}}. Sie müssen Mitglied von {{orgName}} sein, um es anzuzeigen.",
      orgTitle: "Melden Sie sich bei {{orgName}} an, um diesen Plan anzuzeigen",
      createAccountFailed: "Konto kann nicht erstellt werden.",
      emailSignInFailed: "Anmeldung per E-Mail nicht möglich.",
      verifyEmail:
        "Bitte überprüfen Sie Ihre E-Mails, um Ihr Konto zu bestätigen, und öffnen Sie diesen Link erneut.",
      notFoundTitle: "Plan nicht gefunden",
      requestAccessTitle: "Fordern Sie Zugriff auf dieses Programm an",
      signInTitle: "Melden Sie sich an, um diesen Plan anzuzeigen",
      didNotLoadTitle: "Plan nicht geladen",
      notFoundBody:
        "Dieses Programm existiert nicht oder es gehört einer anderen Organisation und Sie benötigen Zugriff.",
      noAccessBody:
        "Dieser Plan existiert, aber dieses Konto verfügt nicht über die Berechtigung, ihn anzuzeigen.",
      maybeOtherOrgBody:
        "Dieses Programm gehört möglicherweise zu einer anderen Organisation oder dieses Konto hat möglicherweise keinen Zugriff.",
      privateBody:
        "Dieses Programm ist privat. Bitte melden Sie sich mit einem Konto an, das über Zugriffsrechte verfügt.",
      signedInAs: "Derzeit angemeldet als",
      accessRequestSent:
        "Zugriffsanfrage gesendet. Sobald der Eigentümer den Zugriff gewährt, können Sie den Link öffnen.",
      retryHelp:
        "Versuchen Sie den Ladevorgang erneut oder melden Sie sich mit einem anderen Konto an, wenn es sich um einen Link zu einem privaten Plan handelt.",
      continueWithGoogle: "Verwenden Sie Google, um fortzufahren",
      switchAccount: "Konto wechseln",
      signInWithEmail: "Melden Sie sich per E-Mail an",
      email: "Post",
      password: "Passwort",
      createAccount: "Benutzerkonto erstellen",
      signIn: "Einloggen",
      haveAccount: "Ich habe bereits ein Konto",
      retry: "Versuchen Sie es erneut",
      sendFeedback: "Feedback senden",
      feedbackPlaceholder:
        "Beschreiben Sie, was vor diesem Planfehler passiert ist.",
      openGitHubIssue: "GitHub-Issue öffnen",
      joinedOrg: "Beigetreten {{orgName}}. Eröffnungsplan...",
      acceptingInvite: "Einladung annehmen",
      joiningOrg: "Beitritt zur Organisation",
      acceptInvite: "Einladung annehmen",
      joinOrg: "Treten Sie {{orgName}} bei",
      requestSent: "Anfrage gesendet",
      requestAccess: "Zugriff anfordern",
      inviteMessage:
        "Sie haben eine Einladung von {{orgName}}. Nehmen Sie die Einladung zum Öffnen dieses Programms an.",
      domainMessage:
        "Ihre @{{domain}}-E-Mail-Adresse kann zu {{orgName}} hinzugefügt werden. Sobald Sie beigetreten sind, können Sie das Programm öffnen.",
      joinMessage:
        "Sie können {{orgName}} beitreten, um dieses Programm zu öffnen.",
    },
    comments: {
      expectedResolver: "vorgesehenen Prozessor",
      agent: "Schauspiel",
      human: "Künstlich",
      toAgent: "An den Agenten senden",
      cancelComment: "Kommentar abbrechen",
      addPlaceholder: "Kommentar hinzufügen...",
      saving: "Sparen",
      saveFailed: "Speichern nicht möglich. Bitte versuchen Sie es erneut.",
      signInTitle: "Melden Sie sich an, um einen Kommentar abzugeben",
      signInDescription:
        "Erstellen Sie ein kostenloses Konto, um eine Bewertung zu diesem Programm abzugeben.",
      replyPlaceholder: "Antwort",
      sendReply: "Antwort senden",
      sendFailed: "Senden nicht möglich. Bitte versuchen Sie es erneut.",
      comment: "Kommentar",
      comments: "Kommentar",
      humanReview: "Manuelle Überprüfung",
      agentAction: "Agentenbetrieb",
      options: "Kommentarmöglichkeiten",
      reopenThread: "Öffne den Thread erneut",
      markResolved: "Als gelöst markieren",
      editFirstComment: "Bearbeiten Sie den ersten Kommentar",
      closeComment: "Kommentare schließen",
      editPlaceholder: "Kommentar des Herausgebers...",
      closeComments: "Kommentare schließen",
      open: "Offen",
      resolved: "Gelöst",
      noResolved: "Es liegen keine gelösten Kommentare vor.",
      commentUpdated: "Kommentar aktualisiert",
      replyAdded: "Antwort hinzugefügt",
      commentDeleted: "Kommentar gelöscht",
      commentResolved: "Kommentar gelöst",
      commentReopened: "Kommentar erneut geöffnet",
      mentionMember: "Organisationsmitglied erwähnen",
      searchingPeople: "Personen werden gesucht...",
      noMatchingMembers: "Keine passenden Organisationsmitglieder.",
      noOpen:
        "Es sind keine Kommentare geöffnet. Klicken Sie auf „Kommentare“ und dann auf „Kommentar platzieren“.",
      deleteThreadTitle: "Thread löschen?",
      deleteCommentTitle: "Kommentar löschen?",
      deleteThreadDescription_other:
        "Dadurch werden der Kommentar und die {{count}}-Antworten aus dem Plan entfernt.",
      deleteCommentDescription:
        "Dadurch wird der Kommentar aus dem Zeitplan entfernt.",
      deleteThread: "Thread löschen",
      deleteComment: "Kommentar löschen",
      deleteThreadDescription_one:
        "Dadurch werden der Kommentar und die {{count}}-Antworten aus dem Plan entfernt.",
      deleteThreadDescription: "Threadbeschreibung löschen",
    },
    deletePlan: {
      hardTitle: "Diesen {{noun}} dauerhaft löschen?",
      softTitle: "Diesen {{noun}} löschen?",
      description:
        "{{title}} wird nicht mehr in der regulären Planungsansicht angezeigt.",
      fallbackTitle: "Dieser Hosting-Plan",
      moveToDeleted: "In „Gelöscht“ verschieben",
      softOptionDescription:
        "Verstecken Sie sich sofort, stoppen Sie den öffentlichen Zugriff und behalten Sie die Wiederherstellungsfunktionen bei.",
      deletePermanently: "Dauerhaft löschen",
      hardOptionDescription:
        "Entfernen Sie verwaltete Zeilen und Referenzen. Diese Aktion kann nicht rückgängig gemacht werden.",
      softDescription:
        "Beim vorläufigen Löschen wird {{noun}} auf die Bezeichnung „Gelöscht“ verschoben. Direkte Links, öffentliche Freigaben, Kommentare und Proxy-Lesevorgänge funktionieren nicht mehr, bis Sie sie wiederherstellen.",
      permanentWarning:
        "Das dauerhafte Löschen kann nicht rückgängig gemacht werden.",
      permanentDescription:
        "Dadurch werden die gehosteten Asset-Datensätze {{noun}}, Kommentare, Freigaben, Aktivitäten, Versionen, Berichte und Plan SQL gelöscht. Die Lebenszyklusregeln für lokale Dateien und externe Upload-Anbieter sind unabhängig.",
      typePrefix: "eingeben",
      typeSuffix: "zu bestätigen",
    },
    wireframe: {
      emptyDiagram: "Der Diagramminhalt ist leer.",
      usageFree: "1 % verwendet · 198k frei",
      contextXray: "Kontext-Röntgen",
      contextXrayPopover: "Context X-Ray-Popover",
      pinnedZero: "Angeheftet 0",
      evictedZero: "Verdrängt 0",
      userMessage: "Benutzernachricht",
      toolResult: "Tool-Ergebnis",
      pinEvict: "Anheften / verdrängen",
      tokenMap: "Token-Karte",
      selectedTokens: "Ausgewählt 2.0k",
      chatMessages: "Chatnachrichten",
      thinkingStatus: "Denkstatus",
      appShell: "App-Shell",
      chatThread: "Chat-Thread",
      agentSidebar: "Agent-Seitenleiste",
      xray: "Röntgen",
    },
  },
  guest: {
    banner:
      "Du surfst als Gast. Melde dich an, um Plane zu erstellen, Kommentare zu hinterlassen und deine Arbeit zu behalten.",
    signIn: "Anmelden",
  },
};

export default messages;
