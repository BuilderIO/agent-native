import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["en-US"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "Create app in this workspace",
      suggestionCustomizeOperation: "Customize",
      reviewActionSuggestionLabel: "Review {{label}}",
      dismissActionSuggestion: "Dismiss {{label}}",
      reviewActionSuggestionTitle: "Review suggested action",
      cancelActionSuggestion: "Cancel",
      runActionSuggestion: "Run action",
      suggestionNullValue: "None",
      suggestionYesValue: "Yes",
      suggestionNoValue: "No",
      suggestionActionLabel: "Action",
      suggestionAppLabel: "App",
      openExistingApp: "Open app",
      openInBuilder: "Open in Builder",
      actionSuggestionAccepted: "Suggestion accepted.",
      actionSuggestionContinueInCode: "Continue in Code.",
      reviewActionSuggestionApproval: "Review approval",
      actionSuggestionApprovalRequired: "Approval is required for this action.",
      actionSuggestionUnconfirmed:
        "Could not confirm the suggested action. Check the app before trying again.",
    },
  },
};
