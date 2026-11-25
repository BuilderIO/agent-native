import { messagesByLocale } from "../i18n-data";

const messages = messagesByLocale["ar-SA"];

export default {
  ...messages,
  dispatch: {
    ...messages.dispatch,
    pages: {
      ...messages.dispatch.pages,
      suggestionCreateAppOperation: "إنشاء تطبيق في مساحة العمل هذه",
      suggestionCustomizeOperation: "تخصيص",
      reviewActionSuggestionLabel: "مراجعة {{label}}",
      dismissActionSuggestion: "تجاهل {{label}}",
      reviewActionSuggestionTitle: "مراجعة الإجراء المقترح",
      cancelActionSuggestion: "إلغاء",
      runActionSuggestion: "تنفيذ الإجراء",
      suggestionNullValue: "لا شيء",
      suggestionYesValue: "نعم",
      suggestionNoValue: "لا",
      suggestionActionLabel: "الإجراء",
      suggestionAppLabel: "التطبيق",
      openExistingApp: "فتح التطبيق",
      openInBuilder: "فتح في Builder",
      actionSuggestionAccepted: "تم قبول الاقتراح.",
      actionSuggestionContinueInCode: "تابع في Code.",
      reviewActionSuggestionApproval: "مراجعة طلب الموافقة",
      actionSuggestionApprovalRequired: "يتطلب هذا الإجراء موافقة.",
      actionSuggestionUnconfirmed:
        "تعذّر تأكيد الإجراء المقترح. تحقّق من التطبيق قبل إعادة المحاولة.",
    },
  },
};
