import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["de-DE"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "App in diesem Arbeitsbereich erstellen",
      suggestionCustomizeOperation: "Anpassen",
      reviewActionSuggestionLabel: "„{{label}}“ prüfen",
      dismissActionSuggestion: "„{{label}}“ ausblenden",
      reviewActionSuggestionTitle: "Vorgeschlagene Aktion prüfen",
      cancelActionSuggestion: "Abbrechen",
      runActionSuggestion: "Aktion ausführen",
      suggestionNullValue: "Kein Wert",
      suggestionYesValue: "Ja",
      suggestionNoValue: "Nein",
      suggestionActionLabel: "Aktion",
      suggestionAppLabel: "App",
      openExistingApp: "App öffnen",
      openInBuilder: "In Builder öffnen",
      actionSuggestionAccepted: "Vorschlag akzeptiert.",
      actionSuggestionContinueInCode: "In Code fortfahren.",
      reviewActionSuggestionApproval: "Genehmigungsanfrage prüfen",
      actionSuggestionApprovalRequired:
        "Diese Aktion erfordert eine Genehmigung.",
      actionSuggestionUnconfirmed:
        "Die vorgeschlagene Aktion konnte nicht bestätigt werden. Prüfe die App, bevor du es erneut versuchst.",
    },
  },
};
