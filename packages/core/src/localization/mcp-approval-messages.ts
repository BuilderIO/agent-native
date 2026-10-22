import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

/**
 * Copy for the page where a person approves or denies an MCP action call.
 * `{action}`, `{time}`, `{client}`, `{email}`, `{count}` and `{url}` are filled
 * in by the page or prompt; `{time}` in the reader's own time zone.
 */
export interface McpApprovalMessages {
  documentTitle: string;
  approve: string;
  deny: string;
  reaches: string;
  details: string;
  argumentsNotStored: string;
  argumentsUnreadable: string;
  decideBy: string;
  priorCompleted: string;
  priorUnknown: string;
  approved: string;
  used: string;
  denied: string;
  closed: string;
  expired: string;
  notFound: string;
  otherOrganization: string;
  saving: string;
  saveFailed: string;
  signInToReview: string;
  pageOutOfDate: string;
  yes: string;
  no: string;
  requestedThrough: string;
  connectedClient: string;
  unnamedClient: string;
  requestedAs: string;
  prompt: string;
  promptLink: string;
  decisionTitle: string;
  decisionHelp: string;
  noTimeZone: string;
  calendarTimeZone: string;
  moreRecipients: string;
  moreFields: string;
  valuesShortened: string;
  argumentsCut: string;
  reviewWhole: string;
}

export const MCP_APPROVAL_MESSAGES: Record<
  BuiltinLocaleCode,
  McpApprovalMessages
> = {
  "en-US": {
    documentTitle: "Approve {action}?",
    approve: "Approve",
    deny: "Deny",
    reaches: "Reaches",
    details: "Details",
    argumentsNotStored:
      "This request's arguments weren't saved, so they can't be shown.",
    argumentsUnreadable: "This request's arguments can't be read.",
    decideBy:
      "Decide by {time}. If you approve, your agent can run this exact request once.",
    priorCompleted:
      "This exact request already ran at {time}. Approving runs it again.",
    priorUnknown:
      "This exact request started at {time} and may have finished. Approving runs it again.",
    approved:
      "Approved. Go back to your agent and ask it to try again before {time}.",
    used: "This request was approved and has run.",
    denied: "Denied. Nothing ran.",
    closed:
      "This request is closed, and nothing ran. Ask your agent to try again to get a new link.",
    expired:
      "This request expired, and nothing ran. Ask your agent to try again to get a new link.",
    notFound:
      "No request at this link belongs to {email} in this organization. If your agent is connected as another account or organization, switch to it and open the link again.",
    otherOrganization:
      "This request belongs to {email} in another organization. Switch to the organization this request came from, then open the link again.",
    saving: "Saving…",
    saveFailed: "Your decision wasn't saved. Try again.",
    signInToReview: "Sign in to review this request.",
    pageOutOfDate: "This page is out of date. Reload it and decide again.",
    yes: "Yes",
    no: "No",
    requestedThrough: "Requested through",
    connectedClient: "{client}, connected {time}",
    unnamedClient: "An unnamed app",
    requestedAs: "{time} as requested",
    prompt:
      "{action} needs your approval before it runs. Check what it will do, then choose Approve or Deny.",
    promptLink:
      "{action} needs your approval before it runs. Open the review page, check what it will do, then choose Approve or Deny.",
    decisionTitle: "Run {action}?",
    decisionHelp:
      "Approve runs this exact request once. Deny means it won't run.",
    noTimeZone: "no time zone given",
    calendarTimeZone: "in the calendar's time zone",
    moreRecipients: "and {count} more",
    moreFields: "Fields not shown here: {count}",
    valuesShortened: "Long values are shortened here.",
    argumentsCut:
      "Part of this request was too large to keep, so not all of it can be shown, and the list of who it reaches may be incomplete.",
    reviewWhole: "See all of it on the review page: {url}",
  },
  "zh-CN": {
    documentTitle: "批准 {action}？",
    approve: "批准",
    deny: "拒绝",
    reaches: "涉及人员",
    details: "详细信息",
    argumentsNotStored: "此请求的参数未保存，因此无法显示。",
    argumentsUnreadable: "无法读取此请求的参数。",
    decideBy:
      "请在 {time} 前决定。批准后，你的智能体可以运行一次这个完全相同的请求。",
    priorCompleted: "这个完全相同的请求已于 {time} 运行过。批准会再次运行它。",
    priorUnknown:
      "这个完全相同的请求已于 {time} 开始运行，可能已经完成。批准会再次运行它。",
    approved: "已批准。请回到你的智能体，让它在 {time} 前重试。",
    used: "此请求已获批准并已运行。",
    denied: "已拒绝。没有运行任何操作。",
    closed: "此请求已关闭，没有运行任何操作。请让你的智能体重试以获取新链接。",
    expired: "此请求已过期，没有运行任何操作。请让你的智能体重试以获取新链接。",
    notFound:
      "此链接中没有属于 {email}（当前组织）的请求。如果你的智能体使用的是其他账户或组织，请切换过去后再次打开链接。",
    otherOrganization:
      "此请求属于另一个组织中的 {email}。请切换到发起此请求的组织，然后再次打开链接。",
    saving: "正在保存…",
    saveFailed: "你的决定未能保存。请重试。",
    signInToReview: "请登录以审核此请求。",
    pageOutOfDate: "此页面已过期。请重新加载后再做决定。",
    yes: "是",
    no: "否",
    requestedThrough: "请求来源",
    connectedClient: "{client}，连接于 {time}",
    unnamedClient: "未命名的应用",
    requestedAs: "请求中为 {time}",
    prompt:
      "{action} 需要你的批准才能运行。请查看它将执行的操作，然后选择“批准”或“拒绝”。",
    promptLink:
      "{action} 需要你的批准才能运行。请打开审核页面，查看它将执行的操作，然后选择“批准”或“拒绝”。",
    decisionTitle: "运行 {action}？",
    decisionHelp: "批准后，这个完全相同的请求会运行一次。拒绝则不会运行。",
    noTimeZone: "未指定时区",
    calendarTimeZone: "使用日历的时区",
    moreRecipients: "以及另外 {count} 个",
    moreFields: "此处未显示的字段：{count}",
    valuesShortened: "较长的值在此处已缩短。",
    argumentsCut:
      "此请求有一部分过大，无法保存，因此无法全部显示，涉及人员列表也可能不完整。",
    reviewWhole: "在审核页面查看完整内容：{url}",
  },
  "zh-TW": {
    documentTitle: "核准 {action}？",
    approve: "核准",
    deny: "拒絕",
    reaches: "涉及人員",
    details: "詳細資料",
    argumentsNotStored: "此請求的參數未儲存，因此無法顯示。",
    argumentsUnreadable: "無法讀取此請求的參數。",
    decideBy:
      "請在 {time} 前決定。核准後，你的代理可以執行一次這個完全相同的請求。",
    priorCompleted: "這個完全相同的請求已於 {time} 執行過。核准會再次執行。",
    priorUnknown:
      "這個完全相同的請求已於 {time} 開始執行，可能已經完成。核准會再次執行。",
    approved: "已核准。請回到你的代理，請它在 {time} 前重試。",
    used: "此請求已獲核准並已執行。",
    denied: "已拒絕。沒有執行任何動作。",
    closed: "此請求已關閉，沒有執行任何動作。請讓你的代理重試以取得新連結。",
    expired: "此請求已過期，沒有執行任何動作。請讓你的代理重試以取得新連結。",
    notFound:
      "此連結中沒有屬於 {email}（目前組織）的請求。如果你的代理使用其他帳戶或組織，請切換後再次開啟連結。",
    otherOrganization:
      "此請求屬於另一個組織中的 {email}。請切換到發出此請求的組織，然後再次開啟連結。",
    saving: "正在儲存…",
    saveFailed: "你的決定未能儲存。請再試一次。",
    signInToReview: "請登入以審核此請求。",
    pageOutOfDate: "此頁面已過期。請重新載入後再做決定。",
    yes: "是",
    no: "否",
    requestedThrough: "請求來源",
    connectedClient: "{client}，連線於 {time}",
    unnamedClient: "未命名的應用程式",
    requestedAs: "請求中為 {time}",
    prompt:
      "{action} 需要你的核准才能執行。請查看它將執行的動作，然後選擇「核准」或「拒絕」。",
    promptLink:
      "{action} 需要你的核准才能執行。請開啟審核頁面，查看它將執行的動作，然後選擇「核准」或「拒絕」。",
    decisionTitle: "執行 {action}？",
    decisionHelp: "核准後，這個完全相同的請求會執行一次。拒絕則不會執行。",
    noTimeZone: "未指定時區",
    calendarTimeZone: "使用日曆的時區",
    moreRecipients: "以及另外 {count} 個",
    moreFields: "此處未顯示的欄位：{count}",
    valuesShortened: "較長的值在此處已縮短。",
    argumentsCut:
      "此請求有一部分過大，無法儲存，因此無法全部顯示，涉及人員清單也可能不完整。",
    reviewWhole: "在審核頁面查看完整內容：{url}",
  },
  "es-ES": {
    documentTitle: "¿Aprobar {action}?",
    approve: "Aprobar",
    deny: "Denegar",
    reaches: "Afecta a",
    details: "Detalles",
    argumentsNotStored:
      "Los argumentos de esta solicitud no se guardaron, así que no se pueden mostrar.",
    argumentsUnreadable: "No se pueden leer los argumentos de esta solicitud.",
    decideBy:
      "Decide antes de las {time}. Si apruebas, tu agente podrá ejecutar esta misma solicitud una vez.",
    priorCompleted:
      "Esta misma solicitud ya se ejecutó a las {time}. Si apruebas, se ejecutará de nuevo.",
    priorUnknown:
      "Esta misma solicitud empezó a las {time} y puede que haya terminado. Si apruebas, se ejecutará de nuevo.",
    approved:
      "Aprobada. Vuelve a tu agente y pídele que lo intente de nuevo antes de las {time}.",
    used: "Esta solicitud se aprobó y ya se ejecutó.",
    denied: "Denegada. No se ejecutó nada.",
    closed:
      "Esta solicitud está cerrada y no se ejecutó nada. Pide a tu agente que lo intente de nuevo para obtener un enlace nuevo.",
    expired:
      "Esta solicitud caducó y no se ejecutó nada. Pide a tu agente que lo intente de nuevo para obtener un enlace nuevo.",
    notFound:
      "En este enlace no hay ninguna solicitud de {email} en esta organización. Si tu agente está conectado con otra cuenta u organización, cambia a ella y vuelve a abrir el enlace.",
    otherOrganization:
      "Esta solicitud pertenece a {email} en otra organización. Cambia a la organización de la que procede esta solicitud y vuelve a abrir el enlace.",
    saving: "Guardando…",
    saveFailed: "No se guardó tu decisión. Inténtalo de nuevo.",
    signInToReview: "Inicia sesión para revisar esta solicitud.",
    pageOutOfDate:
      "Esta página está desactualizada. Vuelve a cargarla y decide de nuevo.",
    yes: "Sí",
    no: "No",
    requestedThrough: "Solicitado a través de",
    connectedClient: "{client}, conectado el {time}",
    unnamedClient: "Una aplicación sin nombre",
    requestedAs: "{time} según la solicitud",
    prompt:
      "{action} necesita tu aprobación para ejecutarse. Comprueba lo que hará y elige Aprobar o Denegar.",
    promptLink:
      "{action} necesita tu aprobación para ejecutarse. Abre la página de revisión, comprueba lo que hará y elige Aprobar o Denegar.",
    decisionTitle: "¿Ejecutar {action}?",
    decisionHelp:
      "Aprobar ejecuta esta solicitud exacta una vez. Denegar hace que no se ejecute.",
    noTimeZone: "sin zona horaria",
    calendarTimeZone: "en la zona horaria del calendario",
    moreRecipients: "y {count} más",
    moreFields: "Campos que no se muestran aquí: {count}",
    valuesShortened: "Los valores largos aparecen abreviados aquí.",
    argumentsCut:
      "Parte de esta solicitud era demasiado grande para guardarla, así que no se puede mostrar entera y la lista de personas a las que afecta puede estar incompleta.",
    reviewWhole:
      "Consulta la solicitud completa en la página de revisión: {url}",
  },
  "fr-FR": {
    documentTitle: "Approuver {action} ?",
    approve: "Approuver",
    deny: "Refuser",
    reaches: "Destinataires",
    details: "Détails",
    argumentsNotStored:
      "Les arguments de cette demande n’ont pas été enregistrés ; ils ne peuvent donc pas être affichés.",
    argumentsUnreadable: "Les arguments de cette demande sont illisibles.",
    decideBy:
      "Décidez avant {time}. Si vous approuvez, votre agent pourra exécuter cette demande identique une seule fois.",
    priorCompleted:
      "Cette demande identique a déjà été exécutée à {time}. L’approuver l’exécutera de nouveau.",
    priorUnknown:
      "Cette demande identique a démarré à {time} et s’est peut-être terminée. L’approuver l’exécutera de nouveau.",
    approved:
      "Approuvée. Retournez dans votre agent et demandez-lui de réessayer avant {time}.",
    used: "Cette demande a été approuvée et exécutée.",
    denied: "Refusée. Rien n’a été exécuté.",
    closed:
      "Cette demande est fermée et rien n’a été exécuté. Demandez à votre agent de réessayer pour obtenir un nouveau lien.",
    expired:
      "Cette demande a expiré et rien n’a été exécuté. Demandez à votre agent de réessayer pour obtenir un nouveau lien.",
    notFound:
      "Aucune demande de {email} dans cette organisation ne correspond à ce lien. Si votre agent est connecté avec un autre compte ou une autre organisation, basculez dessus et rouvrez le lien.",
    otherOrganization:
      "Cette demande appartient à {email} dans une autre organisation. Basculez vers l’organisation d’où vient cette demande, puis rouvrez le lien.",
    saving: "Enregistrement…",
    saveFailed: "Votre décision n’a pas été enregistrée. Réessayez.",
    signInToReview: "Connectez-vous pour examiner cette demande.",
    pageOutOfDate:
      "Cette page n’est plus à jour. Rechargez-la et décidez à nouveau.",
    yes: "Oui",
    no: "Non",
    requestedThrough: "Demandé via",
    connectedClient: "{client}, connecté le {time}",
    unnamedClient: "Une application sans nom",
    requestedAs: "{time} dans la demande",
    prompt:
      "{action} a besoin de votre approbation pour s'exécuter. Vérifiez ce qu'elle va faire, puis choisissez Approuver ou Refuser.",
    promptLink:
      "{action} a besoin de votre approbation pour s'exécuter. Ouvrez la page de vérification, vérifiez ce qu'elle va faire, puis choisissez Approuver ou Refuser.",
    decisionTitle: "Exécuter {action} ?",
    decisionHelp:
      "Approuver exécute cette demande exacte une seule fois. Refuser empêche son exécution.",
    noTimeZone: "aucun fuseau horaire indiqué",
    calendarTimeZone: "dans le fuseau horaire du calendrier",
    moreRecipients: "et {count} de plus",
    moreFields: "Champs non affichés ici : {count}",
    valuesShortened: "Les valeurs longues sont raccourcies ici.",
    argumentsCut:
      "Une partie de cette demande était trop volumineuse pour être conservée ; elle ne peut donc pas être affichée en entier, et la liste des destinataires peut être incomplète.",
    reviewWhole:
      "Consultez la demande complète sur la page de vérification : {url}",
  },
  "de-DE": {
    documentTitle: "{action} genehmigen?",
    approve: "Genehmigen",
    deny: "Ablehnen",
    reaches: "Betrifft",
    details: "Details",
    argumentsNotStored:
      "Die Argumente dieser Anfrage wurden nicht gespeichert und können nicht angezeigt werden.",
    argumentsUnreadable:
      "Die Argumente dieser Anfrage können nicht gelesen werden.",
    decideBy:
      "Entscheide bis {time}. Wenn du genehmigst, kann dein Agent genau diese Anfrage einmal ausführen.",
    priorCompleted:
      "Genau diese Anfrage wurde bereits um {time} ausgeführt. Wenn du genehmigst, wird sie erneut ausgeführt.",
    priorUnknown:
      "Genau diese Anfrage wurde um {time} gestartet und ist möglicherweise abgeschlossen. Wenn du genehmigst, wird sie erneut ausgeführt.",
    approved:
      "Genehmigt. Kehre zu deinem Agent zurück und bitte ihn, es vor {time} erneut zu versuchen.",
    used: "Diese Anfrage wurde genehmigt und ausgeführt.",
    denied: "Abgelehnt. Es wurde nichts ausgeführt.",
    closed:
      "Diese Anfrage ist geschlossen, und es wurde nichts ausgeführt. Bitte deinen Agent, es erneut zu versuchen, um einen neuen Link zu erhalten.",
    expired:
      "Diese Anfrage ist abgelaufen, und es wurde nichts ausgeführt. Bitte deinen Agent, es erneut zu versuchen, um einen neuen Link zu erhalten.",
    notFound:
      "Unter diesem Link gibt es keine Anfrage von {email} in dieser Organisation. Wenn dein Agent mit einem anderen Konto oder einer anderen Organisation verbunden ist, wechsle dorthin und öffne den Link erneut.",
    otherOrganization:
      "Diese Anfrage gehört zu {email} in einer anderen Organisation. Wechsle zu der Organisation, aus der diese Anfrage stammt, und öffne den Link erneut.",
    saving: "Wird gespeichert…",
    saveFailed:
      "Deine Entscheidung wurde nicht gespeichert. Versuche es erneut.",
    signInToReview: "Melde dich an, um diese Anfrage zu prüfen.",
    pageOutOfDate:
      "Diese Seite ist nicht mehr aktuell. Lade sie neu und entscheide erneut.",
    yes: "Ja",
    no: "Nein",
    requestedThrough: "Angefragt über",
    connectedClient: "{client}, verbunden am {time}",
    unnamedClient: "Eine unbenannte App",
    requestedAs: "{time} laut Anfrage",
    prompt:
      "{action} braucht deine Genehmigung, bevor es ausgeführt wird. Prüfe, was passiert, und wähle dann Genehmigen oder Ablehnen.",
    promptLink:
      "{action} braucht deine Genehmigung, bevor es ausgeführt wird. Öffne die Prüfseite, prüfe, was passiert, und wähle dann Genehmigen oder Ablehnen.",
    decisionTitle: "{action} ausführen?",
    decisionHelp:
      "Genehmigen führt genau diese Anfrage einmal aus. Ablehnen bedeutet, dass sie nicht ausgeführt wird.",
    noTimeZone: "keine Zeitzone angegeben",
    calendarTimeZone: "in der Zeitzone des Kalenders",
    moreRecipients: "und {count} weitere",
    moreFields: "Hier nicht angezeigte Felder: {count}",
    valuesShortened: "Lange Werte sind hier gekürzt.",
    argumentsCut:
      "Ein Teil dieser Anfrage war zu groß zum Speichern. Sie kann daher nicht vollständig angezeigt werden, und die Liste der Betroffenen ist möglicherweise unvollständig.",
    reviewWhole: "Die vollständige Anfrage findest du auf der Prüfseite: {url}",
  },
  "ja-JP": {
    documentTitle: "{action} を承認しますか？",
    approve: "承認",
    deny: "拒否",
    reaches: "対象者",
    details: "詳細",
    argumentsNotStored:
      "このリクエストの引数は保存されていないため、表示できません。",
    argumentsUnreadable: "このリクエストの引数を読み取れません。",
    decideBy:
      "{time} までに決定してください。承認すると、エージェントはこれとまったく同じリクエストを 1 回だけ実行できます。",
    priorCompleted:
      "これとまったく同じリクエストは {time} にすでに実行されています。承認すると再度実行されます。",
    priorUnknown:
      "これとまったく同じリクエストは {time} に開始され、完了している可能性があります。承認すると再度実行されます。",
    approved:
      "承認しました。エージェントに戻り、{time} までにもう一度実行するよう依頼してください。",
    used: "このリクエストは承認され、実行されました。",
    denied: "拒否しました。何も実行されていません。",
    closed:
      "このリクエストは終了しており、何も実行されていません。新しいリンクを取得するには、エージェントにもう一度実行するよう依頼してください。",
    expired:
      "このリクエストは期限切れで、何も実行されていません。新しいリンクを取得するには、エージェントにもう一度実行するよう依頼してください。",
    notFound:
      "このリンクには、この組織の {email} のリクエストはありません。エージェントが別のアカウントまたは組織で接続している場合は、そちらに切り替えてからリンクを開き直してください。",
    otherOrganization:
      "このリクエストは、別の組織の {email} のものです。このリクエストの送信元の組織に切り替えてから、リンクを開き直してください。",
    saving: "保存しています…",
    saveFailed: "決定を保存できませんでした。もう一度お試しください。",
    signInToReview: "このリクエストを確認するにはサインインしてください。",
    pageOutOfDate:
      "このページは古くなっています。再読み込みしてから、もう一度決定してください。",
    yes: "はい",
    no: "いいえ",
    requestedThrough: "リクエスト元",
    connectedClient: "{client}（{time} に接続）",
    unnamedClient: "名前のないアプリ",
    requestedAs: "リクエストでは {time}",
    prompt:
      "{action} を実行するには承認が必要です。内容を確認してから、「承認」または「拒否」を選んでください。",
    promptLink:
      "{action} を実行するには承認が必要です。確認ページを開いて内容を確認してから、「承認」または「拒否」を選んでください。",
    decisionTitle: "{action} を実行しますか？",
    decisionHelp:
      "承認すると、このリクエストがそのまま 1 回だけ実行されます。拒否すると実行されません。",
    noTimeZone: "タイムゾーンの指定なし",
    calendarTimeZone: "カレンダーのタイムゾーン",
    moreRecipients: "ほか {count} 件",
    moreFields: "ここに表示されていない項目：{count}",
    valuesShortened: "長い値はここでは省略されています。",
    argumentsCut:
      "このリクエストの一部は大きすぎて保存できなかったため、すべてを表示することはできません。対象者の一覧も不完全な可能性があります。",
    reviewWhole: "確認ページですべての内容を確認できます：{url}",
  },
  "ko-KR": {
    documentTitle: "{action}을(를) 승인할까요?",
    approve: "승인",
    deny: "거부",
    reaches: "대상",
    details: "세부정보",
    argumentsNotStored: "이 요청의 인수가 저장되지 않아 표시할 수 없습니다.",
    argumentsUnreadable: "이 요청의 인수를 읽을 수 없습니다.",
    decideBy:
      "{time}까지 결정하세요. 승인하면 에이전트가 이 요청을 그대로 한 번 실행할 수 있습니다.",
    priorCompleted:
      "이와 동일한 요청이 이미 {time}에 실행되었습니다. 승인하면 다시 실행됩니다.",
    priorUnknown:
      "이와 동일한 요청이 {time}에 시작되었으며 이미 완료되었을 수 있습니다. 승인하면 다시 실행됩니다.",
    approved:
      "승인되었습니다. 에이전트로 돌아가 {time} 전에 다시 시도하도록 요청하세요.",
    used: "이 요청은 승인되어 실행되었습니다.",
    denied: "거부되었습니다. 아무것도 실행되지 않았습니다.",
    closed:
      "이 요청은 종료되었으며 아무것도 실행되지 않았습니다. 새 링크를 받으려면 에이전트에게 다시 시도하도록 요청하세요.",
    expired:
      "이 요청은 만료되었으며 아무것도 실행되지 않았습니다. 새 링크를 받으려면 에이전트에게 다시 시도하도록 요청하세요.",
    notFound:
      "이 링크에는 이 조직의 {email} 요청이 없습니다. 에이전트가 다른 계정이나 조직으로 연결되어 있다면 해당 계정이나 조직으로 전환한 후 링크를 다시 여세요.",
    otherOrganization:
      "이 요청은 다른 조직의 {email} 요청입니다. 이 요청을 보낸 조직으로 전환한 후 링크를 다시 여세요.",
    saving: "저장 중…",
    saveFailed: "결정이 저장되지 않았습니다. 다시 시도하세요.",
    signInToReview: "이 요청을 검토하려면 로그인하세요.",
    pageOutOfDate:
      "이 페이지는 최신 상태가 아닙니다. 새로고침한 후 다시 결정하세요.",
    yes: "예",
    no: "아니요",
    requestedThrough: "요청 경로",
    connectedClient: "{client}, {time}에 연결됨",
    unnamedClient: "이름 없는 앱",
    requestedAs: "요청상 {time}",
    prompt:
      "{action}을(를) 실행하려면 승인이 필요합니다. 수행할 작업을 확인한 다음 승인 또는 거부를 선택하세요.",
    promptLink:
      "{action}을(를) 실행하려면 승인이 필요합니다. 검토 페이지를 열어 수행할 작업을 확인한 다음 승인 또는 거부를 선택하세요.",
    decisionTitle: "{action}을(를) 실행할까요?",
    decisionHelp:
      "승인하면 이 요청이 그대로 한 번 실행됩니다. 거부하면 실행되지 않습니다.",
    noTimeZone: "시간대 지정 없음",
    calendarTimeZone: "캘린더 시간대 기준",
    moreRecipients: "외 {count}개",
    moreFields: "여기에 표시되지 않은 항목: {count}",
    valuesShortened: "긴 값은 여기에서 줄여서 표시됩니다.",
    argumentsCut:
      "이 요청의 일부가 너무 커서 저장할 수 없었기 때문에 전체를 표시할 수 없으며, 대상 목록도 불완전할 수 있습니다.",
    reviewWhole: "검토 페이지에서 전체 내용을 확인하세요: {url}",
  },
  "pt-BR": {
    documentTitle: "Aprovar {action}?",
    approve: "Aprovar",
    deny: "Negar",
    reaches: "Atinge",
    details: "Detalhes",
    argumentsNotStored:
      "Os argumentos desta solicitação não foram salvos, então não podem ser exibidos.",
    argumentsUnreadable: "Não é possível ler os argumentos desta solicitação.",
    decideBy:
      "Decida até {time}. Se você aprovar, seu agente poderá executar esta mesma solicitação uma vez.",
    priorCompleted:
      "Esta mesma solicitação já foi executada às {time}. Aprovar a executará novamente.",
    priorUnknown:
      "Esta mesma solicitação começou às {time} e pode ter terminado. Aprovar a executará novamente.",
    approved:
      "Aprovada. Volte ao seu agente e peça que ele tente de novo antes das {time}.",
    used: "Esta solicitação foi aprovada e executada.",
    denied: "Negada. Nada foi executado.",
    closed:
      "Esta solicitação foi encerrada e nada foi executado. Peça ao seu agente para tentar de novo e receber um novo link.",
    expired:
      "Esta solicitação expirou e nada foi executado. Peça ao seu agente para tentar de novo e receber um novo link.",
    notFound:
      "Não há nenhuma solicitação de {email} nesta organização neste link. Se o seu agente estiver conectado com outra conta ou organização, mude para ela e abra o link novamente.",
    otherOrganization:
      "Esta solicitação pertence a {email} em outra organização. Mude para a organização de onde veio esta solicitação e abra o link novamente.",
    saving: "Salvando…",
    saveFailed: "Sua decisão não foi salva. Tente novamente.",
    signInToReview: "Entre para revisar esta solicitação.",
    pageOutOfDate:
      "Esta página está desatualizada. Recarregue-a e decida novamente.",
    yes: "Sim",
    no: "Não",
    requestedThrough: "Solicitado por meio de",
    connectedClient: "{client}, conectado em {time}",
    unnamedClient: "Um app sem nome",
    requestedAs: "{time} na solicitação",
    prompt:
      "{action} precisa da sua aprovação para ser executado. Confira o que ele vai fazer e escolha Aprovar ou Negar.",
    promptLink:
      "{action} precisa da sua aprovação para ser executado. Abra a página de revisão, confira o que ele vai fazer e escolha Aprovar ou Negar.",
    decisionTitle: "Executar {action}?",
    decisionHelp:
      "Aprovar executa esta solicitação exata uma vez. Negar faz com que ela não seja executada.",
    noTimeZone: "sem fuso horário informado",
    calendarTimeZone: "no fuso horário da agenda",
    moreRecipients: "e mais {count}",
    moreFields: "Campos não exibidos aqui: {count}",
    valuesShortened: "Valores longos aparecem abreviados aqui.",
    argumentsCut:
      "Parte desta solicitação era grande demais para ser salva, então ela não pode ser exibida por inteiro, e a lista de quem ela atinge pode estar incompleta.",
    reviewWhole: "Veja a solicitação completa na página de revisão: {url}",
  },
  "hi-IN": {
    documentTitle: "{action} को मंज़ूरी दें?",
    approve: "मंज़ूरी दें",
    deny: "अस्वीकार करें",
    reaches: "किन तक पहुंचेगा",
    details: "विवरण",
    argumentsNotStored:
      "इस अनुरोध के आर्गुमेंट सहेजे नहीं गए थे, इसलिए उन्हें दिखाया नहीं जा सकता।",
    argumentsUnreadable: "इस अनुरोध के आर्गुमेंट पढ़े नहीं जा सकते।",
    decideBy:
      "{time} तक फ़ैसला करें। मंज़ूरी देने पर आपका एजेंट ठीक यही अनुरोध एक बार चला सकता है।",
    priorCompleted:
      "ठीक यही अनुरोध {time} पर पहले ही चल चुका है। मंज़ूरी देने पर यह फिर से चलेगा।",
    priorUnknown:
      "ठीक यही अनुरोध {time} पर शुरू हुआ था और शायद पूरा हो चुका है। मंज़ूरी देने पर यह फिर से चलेगा।",
    approved:
      "मंज़ूरी दे दी गई। अपने एजेंट पर वापस जाएं और उससे {time} से पहले फिर से कोशिश करने को कहें।",
    used: "इस अनुरोध को मंज़ूरी मिली और यह चल चुका है।",
    denied: "अस्वीकार किया गया। कुछ भी नहीं चला।",
    closed:
      "यह अनुरोध बंद हो चुका है और कुछ भी नहीं चला। नया लिंक पाने के लिए अपने एजेंट से फिर से कोशिश करने को कहें।",
    expired:
      "यह अनुरोध समाप्त हो चुका है और कुछ भी नहीं चला। नया लिंक पाने के लिए अपने एजेंट से फिर से कोशिश करने को कहें।",
    notFound:
      "इस लिंक पर इस संगठन में {email} का कोई अनुरोध नहीं है। अगर आपका एजेंट किसी दूसरे खाते या संगठन से जुड़ा है, तो उस पर स्विच करें और लिंक फिर से खोलें।",
    otherOrganization:
      "यह अनुरोध किसी दूसरे संगठन में {email} का है। जिस संगठन से यह अनुरोध आया है, उस पर स्विच करें और लिंक फिर से खोलें।",
    saving: "सहेजा जा रहा है…",
    saveFailed: "आपका फ़ैसला सहेजा नहीं गया। फिर से कोशिश करें।",
    signInToReview: "इस अनुरोध की समीक्षा करने के लिए साइन इन करें।",
    pageOutOfDate: "यह पेज पुराना हो गया है। इसे फिर से लोड करें और दोबारा फ़ैसला करें।",
    yes: "हां",
    no: "नहीं",
    requestedThrough: "इसके ज़रिए अनुरोध किया गया",
    connectedClient: "{client}, {time} को कनेक्ट किया गया",
    unnamedClient: "बिना नाम का ऐप",
    requestedAs: "अनुरोध में {time}",
    prompt:
      "{action} चलाने से पहले आपकी मंज़ूरी चाहिए। देखें कि यह क्या करेगा, फिर मंज़ूरी दें या अस्वीकार करें चुनें।",
    promptLink:
      "{action} चलाने से पहले आपकी मंज़ूरी चाहिए। समीक्षा पेज खोलें, देखें कि यह क्या करेगा, फिर मंज़ूरी दें या अस्वीकार करें चुनें।",
    decisionTitle: "{action} चलाएं?",
    decisionHelp:
      "मंज़ूरी देने पर यही अनुरोध एक बार चलेगा। अस्वीकार करने पर यह नहीं चलेगा।",
    noTimeZone: "कोई टाइम ज़ोन नहीं दिया गया",
    calendarTimeZone: "कैलेंडर के टाइम ज़ोन में",
    moreRecipients: "और {count} अन्य",
    moreFields: "यहां न दिखाए गए फ़ील्ड: {count}",
    valuesShortened: "लंबे मान यहां छोटे करके दिखाए गए हैं।",
    argumentsCut:
      "इस अनुरोध का एक हिस्सा सहेजने के लिए बहुत बड़ा था, इसलिए इसे पूरा नहीं दिखाया जा सकता, और यह किन तक पहुंचेगा, उसकी सूची अधूरी हो सकती है।",
    reviewWhole: "पूरा अनुरोध समीक्षा पेज पर देखें: {url}",
  },
  "ar-SA": {
    documentTitle: "الموافقة على {action}؟",
    approve: "موافقة",
    deny: "رفض",
    reaches: "يصل إلى",
    details: "التفاصيل",
    argumentsNotStored: "لم تُحفظ وسيطات هذا الطلب، لذا لا يمكن عرضها.",
    argumentsUnreadable: "تتعذر قراءة وسيطات هذا الطلب.",
    decideBy:
      "اتخذ قرارك قبل {time}. إذا وافقت، يمكن لوكيلك تشغيل هذا الطلب نفسه مرة واحدة.",
    priorCompleted:
      "سبق تشغيل هذا الطلب نفسه في {time}. ستؤدي الموافقة إلى تشغيله مرة أخرى.",
    priorUnknown:
      "بدأ تشغيل هذا الطلب نفسه في {time} وربما اكتمل. ستؤدي الموافقة إلى تشغيله مرة أخرى.",
    approved:
      "تمت الموافقة. ارجع إلى وكيلك واطلب منه إعادة المحاولة قبل {time}.",
    used: "تمت الموافقة على هذا الطلب وتم تشغيله.",
    denied: "تم الرفض. لم يُشغَّل أي شيء.",
    closed:
      "هذا الطلب مغلق ولم يُشغَّل أي شيء. اطلب من وكيلك إعادة المحاولة للحصول على رابط جديد.",
    expired:
      "انتهت صلاحية هذا الطلب ولم يُشغَّل أي شيء. اطلب من وكيلك إعادة المحاولة للحصول على رابط جديد.",
    notFound:
      "لا يوجد في هذا الرابط طلب يخص {email} في هذه المؤسسة. إذا كان وكيلك متصلاً بحساب أو مؤسسة أخرى، فانتقل إليها وافتح الرابط مرة أخرى.",
    otherOrganization:
      "ينتمي هذا الطلب إلى {email} في مؤسسة أخرى. انتقل إلى المؤسسة التي جاء منها هذا الطلب، ثم افتح الرابط مرة أخرى.",
    saving: "جارٍ الحفظ…",
    saveFailed: "لم يتم حفظ قرارك. حاول مرة أخرى.",
    signInToReview: "سجّل الدخول لمراجعة هذا الطلب.",
    pageOutOfDate: "هذه الصفحة قديمة. أعد تحميلها واتخذ قرارك مرة أخرى.",
    yes: "نعم",
    no: "لا",
    requestedThrough: "مطلوب عبر",
    connectedClient: "{client}، تم الاتصال في {time}",
    unnamedClient: "تطبيق بلا اسم",
    requestedAs: "{time} حسب الطلب",
    prompt:
      "يحتاج {action} إلى موافقتك قبل تشغيله. تحقق مما سيفعله، ثم اختر موافقة أو رفض.",
    promptLink:
      "يحتاج {action} إلى موافقتك قبل تشغيله. افتح صفحة المراجعة وتحقق مما سيفعله، ثم اختر موافقة أو رفض.",
    decisionTitle: "هل تريد تشغيل {action}؟",
    decisionHelp:
      "تؤدي الموافقة إلى تشغيل هذا الطلب نفسه مرة واحدة. ويعني الرفض أنه لن يعمل.",
    noTimeZone: "لم تُحدَّد منطقة زمنية",
    calendarTimeZone: "حسب المنطقة الزمنية للتقويم",
    moreRecipients: "و{count} آخرين",
    moreFields: "حقول غير معروضة هنا: {count}",
    valuesShortened: "القيم الطويلة مختصرة هنا.",
    argumentsCut:
      "كان جزء من هذا الطلب أكبر من أن يُحفظ، لذا لا يمكن عرضه كاملًا، وقد تكون قائمة من يصل إليهم غير مكتملة.",
    reviewWhole: "اطّلع على الطلب كاملًا في صفحة المراجعة: {url}",
  },
};

export function mcpApprovalMessagesForLocale(
  locale: LocaleCode,
): McpApprovalMessages {
  return MCP_APPROVAL_MESSAGES[isLocaleCode(locale) ? locale : DEFAULT_LOCALE];
}
