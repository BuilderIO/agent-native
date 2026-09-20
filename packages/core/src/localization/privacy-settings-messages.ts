import {
  DEFAULT_LOCALE,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface PrivacySettingsMessages {
  privacyTitle: string;
  privacyDescription: string;
  privacyManage: string;
  privacyRightsTitle: string;
  privacyRightsDescription: string;
  privacyRequestCopy: string;
  privacyRequestDeletion: string;
  privacyRequesting: string;
  privacyRequestRecorded: string;
  privacyRequestRecordedShort: string;
  privacyRequestError: string;
  privacyDeletionTitle: string;
  privacyDeletionDescription: string;
  privacyDocsLink: string;
}

export const PRIVACY_SETTINGS_MESSAGES: Record<
  BuiltinLocaleCode,
  PrivacySettingsMessages
> = {
  "en-US": {
    privacyTitle: "Privacy & data",
    privacyDescription:
      "Request a copy of your data or ask for your personal data to be deleted.",
    privacyManage: "Manage",
    privacyRightsTitle: "Your data rights",
    privacyRightsDescription:
      "Requests are recorded for review by a workspace administrator, who will verify your identity and follow up.",
    privacyRequestCopy: "Request a copy",
    privacyRequestDeletion: "Request deletion",
    privacyRequesting: "Recording request...",
    privacyRequestRecorded:
      "Request recorded. An administrator will follow up.",
    privacyRequestRecordedShort: "Request recorded",
    privacyRequestError: "Could not record your request. Please try again.",
    privacyDeletionTitle: "Request deletion of your data?",
    privacyDeletionDescription:
      "This records a deletion request; it does not delete data immediately. An administrator will verify your identity and complete the request under the deployment's retention and legal obligations.",
    privacyDocsLink: "Read privacy and data rights",
  },
  "es-ES": {
    privacyTitle: "Privacidad y datos",
    privacyDescription:
      "Solicita una copia de tus datos o pide que se eliminen tus datos personales.",
    privacyManage: "Administrar",
    privacyRightsTitle: "Tus derechos sobre los datos",
    privacyRightsDescription:
      "Las solicitudes se registran para que un administrador del espacio de trabajo las revise, verifique tu identidad y se ponga en contacto contigo.",
    privacyRequestCopy: "Solicitar una copia",
    privacyRequestDeletion: "Solicitar eliminación",
    privacyRequesting: "Registrando la solicitud...",
    privacyRequestRecorded:
      "Solicitud registrada. Un administrador se pondrá en contacto contigo.",
    privacyRequestRecordedShort: "Solicitud registrada",
    privacyRequestError:
      "No se pudo registrar la solicitud. Inténtalo de nuevo.",
    privacyDeletionTitle: "¿Solicitar la eliminación de tus datos?",
    privacyDeletionDescription:
      "Esto registra una solicitud de eliminación; los datos no se eliminan de inmediato. Un administrador verificará tu identidad y completará la solicitud según las obligaciones legales y de conservación de esta implementación.",
    privacyDocsLink: "Leer sobre privacidad y derechos sobre los datos",
  },
  "fr-FR": {
    privacyTitle: "Confidentialité et données",
    privacyDescription:
      "Demandez une copie de vos données ou la suppression de vos données personnelles.",
    privacyManage: "Gérer",
    privacyRightsTitle: "Vos droits sur vos données",
    privacyRightsDescription:
      "Les demandes sont enregistrées pour être examinées par un administrateur de l’espace de travail, qui vérifiera votre identité et vous recontactera.",
    privacyRequestCopy: "Demander une copie",
    privacyRequestDeletion: "Demander la suppression",
    privacyRequesting: "Enregistrement de la demande...",
    privacyRequestRecorded:
      "Demande enregistrée. Un administrateur vous recontactera.",
    privacyRequestRecordedShort: "Demande enregistrée",
    privacyRequestError: "Impossible d’enregistrer la demande. Réessayez.",
    privacyDeletionTitle: "Demander la suppression de vos données ?",
    privacyDeletionDescription:
      "Cette action enregistre une demande de suppression ; les données ne sont pas supprimées immédiatement. Un administrateur vérifiera votre identité et traitera la demande conformément aux obligations de conservation et aux obligations légales de ce déploiement.",
    privacyDocsLink:
      "Lire les informations sur la confidentialité et les droits sur les données",
  },
  "de-DE": {
    privacyTitle: "Datenschutz und Daten",
    privacyDescription:
      "Fordere eine Kopie deiner Daten an oder bitte um die Löschung deiner personenbezogenen Daten.",
    privacyManage: "Verwalten",
    privacyRightsTitle: "Deine Datenrechte",
    privacyRightsDescription:
      "Anfragen werden zur Prüfung durch eine Workspace-Administration gespeichert, die deine Identität bestätigt und sich bei dir meldet.",
    privacyRequestCopy: "Kopie anfordern",
    privacyRequestDeletion: "Löschung anfordern",
    privacyRequesting: "Anfrage wird gespeichert...",
    privacyRequestRecorded:
      "Anfrage gespeichert. Eine Administration meldet sich bei dir.",
    privacyRequestRecordedShort: "Anfrage gespeichert",
    privacyRequestError:
      "Anfrage konnte nicht gespeichert werden. Bitte versuche es erneut.",
    privacyDeletionTitle: "Löschung deiner Daten anfordern?",
    privacyDeletionDescription:
      "Damit wird eine Löschanfrage gespeichert; die Daten werden nicht sofort gelöscht. Eine Administration bestätigt deine Identität und bearbeitet die Anfrage gemäß den Aufbewahrungs- und gesetzlichen Pflichten dieses Deployments.",
    privacyDocsLink: "Datenschutz und Datenrechte lesen",
  },
  "pt-BR": {
    privacyTitle: "Privacidade e dados",
    privacyDescription:
      "Solicite uma cópia dos seus dados ou peça a exclusão dos seus dados pessoais.",
    privacyManage: "Gerenciar",
    privacyRightsTitle: "Seus direitos sobre os dados",
    privacyRightsDescription:
      "As solicitações são registradas para análise por um administrador do workspace, que verificará sua identidade e entrará em contato.",
    privacyRequestCopy: "Solicitar uma cópia",
    privacyRequestDeletion: "Solicitar exclusão",
    privacyRequesting: "Registrando solicitação...",
    privacyRequestRecorded:
      "Solicitação registrada. Um administrador entrará em contato.",
    privacyRequestRecordedShort: "Solicitação registrada",
    privacyRequestError:
      "Não foi possível registrar sua solicitação. Tente novamente.",
    privacyDeletionTitle: "Solicitar a exclusão dos seus dados?",
    privacyDeletionDescription:
      "Isso registra uma solicitação de exclusão; os dados não são excluídos imediatamente. Um administrador verificará sua identidade e concluirá a solicitação conforme as obrigações legais e de retenção desta implantação.",
    privacyDocsLink: "Ler sobre privacidade e direitos sobre os dados",
  },
  "zh-CN": {
    privacyTitle: "隐私与数据",
    privacyDescription: "请求获取您的数据副本，或请求删除您的个人数据。",
    privacyManage: "管理",
    privacyRightsTitle: "您的数据权利",
    privacyRightsDescription:
      "请求会记录下来，供工作区管理员审核、验证您的身份并与您跟进。",
    privacyRequestCopy: "请求副本",
    privacyRequestDeletion: "请求删除",
    privacyRequesting: "正在记录请求...",
    privacyRequestRecorded: "请求已记录。管理员会与您联系。",
    privacyRequestRecordedShort: "请求已记录",
    privacyRequestError: "无法记录请求。请重试。",
    privacyDeletionTitle: "请求删除您的数据？",
    privacyDeletionDescription:
      "这会记录删除请求，不会立即删除数据。管理员会验证您的身份，并根据此部署的保留期限和法律义务完成请求。",
    privacyDocsLink: "阅读隐私与数据权利",
  },
  "zh-TW": {
    privacyTitle: "隱私與資料",
    privacyDescription: "要求取得您的資料副本，或要求刪除您的個人資料。",
    privacyManage: "管理",
    privacyRightsTitle: "您的資料權利",
    privacyRightsDescription:
      "要求會記錄下來，供工作區管理員審查、驗證您的身分並與您聯絡。",
    privacyRequestCopy: "要求副本",
    privacyRequestDeletion: "要求刪除",
    privacyRequesting: "正在記錄要求...",
    privacyRequestRecorded: "要求已記錄。管理員會與您聯絡。",
    privacyRequestRecordedShort: "要求已記錄",
    privacyRequestError: "無法記錄要求。請再試一次。",
    privacyDeletionTitle: "要求刪除您的資料？",
    privacyDeletionDescription:
      "這會記錄刪除要求，不會立即刪除資料。管理員會驗證您的身分，並依照此部署的保留期限與法律義務完成要求。",
    privacyDocsLink: "閱讀隱私與資料權利",
  },
  "ja-JP": {
    privacyTitle: "プライバシーとデータ",
    privacyDescription:
      "データのコピーを請求するか、個人データの削除を依頼できます。",
    privacyManage: "管理",
    privacyRightsTitle: "データに関する権利",
    privacyRightsDescription:
      "リクエストはワークスペース管理者が確認できるよう記録され、本人確認後に連絡します。",
    privacyRequestCopy: "コピーを請求",
    privacyRequestDeletion: "削除を依頼",
    privacyRequesting: "リクエストを記録中...",
    privacyRequestRecorded: "リクエストを記録しました。管理者から連絡します。",
    privacyRequestRecordedShort: "リクエストを記録済み",
    privacyRequestError:
      "リクエストを記録できませんでした。もう一度お試しください。",
    privacyDeletionTitle: "データの削除を依頼しますか？",
    privacyDeletionDescription:
      "削除リクエストを記録します。データはすぐには削除されません。管理者が本人確認を行い、このデプロイの保持義務と法的義務に従って対応します。",
    privacyDocsLink: "プライバシーとデータに関する権利を読む",
  },
  "ko-KR": {
    privacyTitle: "개인정보 및 데이터",
    privacyDescription:
      "데이터 사본을 요청하거나 개인 데이터 삭제를 요청하세요.",
    privacyManage: "관리",
    privacyRightsTitle: "데이터 권리",
    privacyRightsDescription:
      "요청은 워크스페이스 관리자가 검토하고 신원을 확인한 후 후속 조치를 할 수 있도록 기록됩니다.",
    privacyRequestCopy: "사본 요청",
    privacyRequestDeletion: "삭제 요청",
    privacyRequesting: "요청 기록 중...",
    privacyRequestRecorded:
      "요청이 기록되었습니다. 관리자가 연락드릴 것입니다.",
    privacyRequestRecordedShort: "요청 기록됨",
    privacyRequestError: "요청을 기록할 수 없습니다. 다시 시도하세요.",
    privacyDeletionTitle: "데이터를 삭제하도록 요청하시겠습니까?",
    privacyDeletionDescription:
      "삭제 요청을 기록합니다. 데이터가 즉시 삭제되지는 않습니다. 관리자가 신원을 확인하고 이 배포의 보존 및 법적 의무에 따라 요청을 처리합니다.",
    privacyDocsLink: "개인정보 및 데이터 권리 읽기",
  },
  "hi-IN": {
    privacyTitle: "गोपनीयता और डेटा",
    privacyDescription:
      "अपने डेटा की कॉपी का अनुरोध करें या अपना निजी डेटा हटाने के लिए कहें।",
    privacyManage: "प्रबंधित करें",
    privacyRightsTitle: "आपके डेटा अधिकार",
    privacyRightsDescription:
      "अनुरोध कार्यक्षेत्र व्यवस्थापक की समीक्षा, आपकी पहचान सत्यापित करने और आपसे संपर्क करने के लिए दर्ज किए जाते हैं।",
    privacyRequestCopy: "कॉपी का अनुरोध करें",
    privacyRequestDeletion: "हटाने का अनुरोध करें",
    privacyRequesting: "अनुरोध दर्ज किया जा रहा है...",
    privacyRequestRecorded: "अनुरोध दर्ज हो गया। व्यवस्थापक आपसे संपर्क करेगा।",
    privacyRequestRecordedShort: "अनुरोध दर्ज",
    privacyRequestError: "अनुरोध दर्ज नहीं किया जा सका। फिर कोशिश करें।",
    privacyDeletionTitle: "अपना डेटा हटाने का अनुरोध करें?",
    privacyDeletionDescription:
      "यह हटाने का अनुरोध दर्ज करता है; डेटा तुरंत नहीं हटाया जाता। व्यवस्थापक आपकी पहचान सत्यापित करेगा और इस डिप्लॉयमेंट की डेटा-रिटेंशन तथा कानूनी बाध्यताओं के अनुसार अनुरोध पूरा करेगा।",
    privacyDocsLink: "गोपनीयता और डेटा अधिकार पढ़ें",
  },
  "ar-SA": {
    privacyTitle: "الخصوصية والبيانات",
    privacyDescription: "اطلب نسخة من بياناتك أو اطلب حذف بياناتك الشخصية.",
    privacyManage: "إدارة",
    privacyRightsTitle: "حقوقك في بياناتك",
    privacyRightsDescription:
      "تُسجَّل الطلبات ليراجعها مسؤول مساحة العمل ويتحقق من هويتك ويتابع معك.",
    privacyRequestCopy: "طلب نسخة",
    privacyRequestDeletion: "طلب الحذف",
    privacyRequesting: "جارٍ تسجيل الطلب...",
    privacyRequestRecorded: "تم تسجيل الطلب. سيتواصل معك مسؤول.",
    privacyRequestRecordedShort: "تم تسجيل الطلب",
    privacyRequestError: "تعذّر تسجيل الطلب. حاول مرة أخرى.",
    privacyDeletionTitle: "طلب حذف بياناتك؟",
    privacyDeletionDescription:
      "يسجّل هذا طلب حذف، ولا يحذف البيانات فورًا. سيتحقق مسؤول من هويتك وينفذ الطلب وفق التزامات الاحتفاظ والالتزامات القانونية لهذا النشر.",
    privacyDocsLink: "قراءة معلومات الخصوصية وحقوق البيانات",
  },
};

export function privacySettingsMessagesForLocale(
  locale: LocaleCode,
): PrivacySettingsMessages {
  return (
    PRIVACY_SETTINGS_MESSAGES[locale as BuiltinLocaleCode] ??
    PRIVACY_SETTINGS_MESSAGES[DEFAULT_LOCALE]
  );
}
