import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["fr-FR"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation:
        "Créer une application dans cet espace de travail",
      suggestionCustomizeOperation: "Personnaliser",
      reviewActionSuggestionLabel: "Vérifier « {{label}} »",
      dismissActionSuggestion: "Ignorer « {{label}} »",
      reviewActionSuggestionTitle: "Vérifier l’action suggérée",
      cancelActionSuggestion: "Annuler",
      runActionSuggestion: "Exécuter l’action",
      suggestionNullValue: "Aucun",
      suggestionYesValue: "Oui",
      suggestionNoValue: "Non",
      suggestionActionLabel: "Action",
      suggestionAppLabel: "Application",
      openExistingApp: "Ouvrir l’application",
      openInBuilder: "Ouvrir dans Builder",
      actionSuggestionAccepted: "Suggestion acceptée.",
      actionSuggestionContinueInCode: "Continuer dans Code.",
      reviewActionSuggestionApproval: "Examiner la demande d’approbation",
      actionSuggestionApprovalRequired:
        "Cette action nécessite une approbation.",
      actionSuggestionUnconfirmed:
        "Impossible de confirmer l’action suggérée. Vérifiez l’application avant de réessayer.",
    },
  },
};
