import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["hi-IN"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "इस वर्कस्पेस में ऐप बनाएँ",
      suggestionCustomizeOperation: "कस्टमाइज़ करें",
      reviewActionSuggestionLabel: "{{label}} की समीक्षा करें",
      dismissActionSuggestion: "{{label}} हटाएँ",
      reviewActionSuggestionTitle: "सुझाई गई कार्रवाई की समीक्षा करें",
      cancelActionSuggestion: "रद्द करें",
      runActionSuggestion: "कार्रवाई करें",
      suggestionNullValue: "कोई नहीं",
      suggestionYesValue: "हाँ",
      suggestionNoValue: "नहीं",
      suggestionActionLabel: "कार्रवाई",
      suggestionAppLabel: "ऐप",
      openExistingApp: "ऐप खोलें",
      openInBuilder: "Builder में खोलें",
      actionSuggestionAccepted: "सुझाव स्वीकार किया गया।",
      actionSuggestionContinueInCode: "Code में जारी रखें।",
      reviewActionSuggestionApproval: "मंज़ूरी के अनुरोध की समीक्षा करें",
      actionSuggestionApprovalRequired: "इस कार्रवाई के लिए मंज़ूरी चाहिए।",
      actionSuggestionUnconfirmed:
        "सुझाई गई कार्रवाई की पुष्टि नहीं हो सकी। फिर से कोशिश करने से पहले ऐप जाँचें।",
    },
  },
};
