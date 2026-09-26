const messages = {
  "composer.contextUrlLabel": "URL",
  "composer.contextInvalidUrl": "Enter a valid HTTP or HTTPS URL.",
  "composer.contextAttach": "Attach",
  "composer.menu.search": "Search…",
  "composer.contextPrevious": "Previous",
  "composer.contextNext": "Next",
  "composer.contextLoadFailed": "Could not load context.",
  "composer.contextLinkRequired": "Enter a link.",
  "composer.submitFailed": "Could not submit. Try again.",
  "composer.addContext": "Add context",
  "composer.contextActionFailed": "Could not add context.",
  "composer.contextBack": "Back",
  "composer.searchContext": "Search context…",
  "composer.noContextResults": "No matching context.",
  "composer.contextPending": "Context pending",
  "composer.contextError": "Context failed",
  "composer.retryContext": "Retry {{name}} context",
  "composer.contextLimitExceeded":
    "Context is too large. Remove an item or attach a smaller selection.",
  "activity.reasoning": "Reasoning",
  "approval.alwaysAllow": "Always allow",
  "approval.alwaysAllowHint": "Approve and always allow this exact command",
  "approval.alwaysAllowAction": "Always allow this action",
  "approval.alwaysAllowActionHint": "Approve and always allow this action",
  "approval.approve": "Approve",
  "approval.approved": "Approved. Re-running {{tool}}...",
  "approval.denied": "Denied. {{tool}} did not run.",
  "approval.deny": "Deny",
  "approval.moreOptions": "More approval options",
  "approval.question": "Approve to run {{tool}}?",
  "auth.expiredDescription":
    "Your session may have expired. Log out and log back in to reconnect.",
  "auth.expiredTitle": "Session expired",
  "auth.logIn": "Log in",
  "auth.logOut": "Log out",
  "auth.refreshChat": "Refresh chat",
  "auth.refreshDescription":
    "You're signed in, but this chat connection needs to reconnect.",
  "auth.refreshTitle": "Chat session needs refresh",
  "auth.requiredDescription": "You need to log in to use the agent.",
  "auth.requiredTitle": "Authentication required",
  "commands.act": "Switch back to acting",
  "commands.available": "Available commands",
  "commands.clear": "Start a new chat (keeps current chat in history)",
  "commands.closeHelp": "Close help",
  "commands.help": "Show this list of commands",
  "commands.history": "Browse all chats",
  "commands.mention": "Mention files, agents, or resources",
  "commands.new": "Same as /clear",
  "commands.plan": "Switch to read-only planning",
  "observability.viewDetails": "View details",
  "observability.hideDetails": "Hide details",
  "observability.input": "Input",
  "observability.output": "Output",
  "observability.error": "Error",
  "observability.metadata": "Metadata",
  "observability.notCaptured": "Not captured",
  "observability.openFullConversation": "Open full conversation",
  "observability.learnAboutTab": "Learn about this tab",
  "onboarding.back": "Back",
  "onboarding.chooseRole": "Choose your role",
  "onboarding.customizeRole": "Let’s customize this for you.",
  "onboarding.roleQuestion": "What best describes your role?",
  "onboarding.roleHelperText": "This helps us personalize your experience",
  "onboarding.roleProduct": "Product Manager",
  "onboarding.roleDesign": "Designer",
  "onboarding.roleDeveloper": "Developer",
  "onboarding.roleMarketing": "Marketing",
  "onboarding.roleSales": "Sales",
  "onboarding.roleOps": "Ops",
  "onboarding.roleIndividual": "Individual",
  "onboarding.roleOther": "Other",
  "onboarding.roleOtherInputLabel": "Describe your role",
  "onboarding.skipForNow": "Skip for now",
  "onboarding.saveRoleError": "Could not save your role.",
  "onboarding.builderCreateAccount": "Create Builder.io account",
  "onboarding.builderSignInWithAccount": "Sign in with Builder.io account",
  "onboarding.builderActivateDescription":
    "Create or reuse your Builder.io account and activate its free credits in one click.",
  "onboarding.builderActiveCredits":
    "Included with active Builder.io free credits",
  "onboarding.builderCredits": "Included with Builder.io free credits",
  "onboarding.builderActivateTitle": "Activate free credits",
  "onboarding.builderAccountExistsTitle":
    "You already have a Builder.io account",
  "onboarding.builderAccountExistsDescription": "Log in to connect it.",
  "onboarding.builderActivationDescription":
    "We'll automatically create your Builder.io account for you in one click.",
  "onboarding.builderCreateAndActivate": "Create and activate",
  "onboarding.builderConsentPrefix":
    "By creating a Builder.io account, you agree to our",
  "onboarding.builderTerms": "Terms of Service",
  "onboarding.builderPrivacy": "Privacy Policy",
  "onboarding.builderConsentAnd": "and",
  "onboarding.builderExistingAccount": "I have a Builder.io account",
  "onboarding.builderActivating": "Activating Builder.io free credits",
  "onboarding.builderConnecting": "Connecting Builder.io free credits",
  "onboarding.builderProvisioningDescription":
    "Creating or reusing your Builder.io account. This usually takes a few seconds.",
  "onboarding.builderConnectionDescription":
    "Finish the one-click connection in the new window.",
  "onboarding.builderReadyWithCodeChanges":
    "AI credits and cloud code changes are ready to use.",
  "onboarding.builderReadyCreditsOnly":
    "AI credits are ready to use. Cloud code edits require a Builder project in Background Agent settings.",
  "onboarding.openBackgroundAgentSettings": "Open Background Agent settings",
  "onboarding.capability.llm.keySummary": "Connect your own AI model",
  "onboarding.capability.fileStorage.keySummary": "File uploads and storage",
  "onboarding.fileStorage.title": "Choose file storage",
  "onboarding.fileStorage.description":
    "Choose Builder.io for managed file storage, or use custom storage keys for your own S3-compatible bucket.",
  "onboarding.fileStorage.custom": "Use custom storage keys",
  "onboarding.fileStorage.customDescription":
    "Configure an S3-compatible bucket with a stable public URL.",
  "onboarding.capability.voiceInput.label": "Voice input",
  "onboarding.capability.voiceInput.keySummary": "Voice input",
  "onboarding.capability.voiceInput.why":
    "Voice input turns spoken requests into text; typing always works without it.",
  "onboarding.capability.embeddings.label": "Embeddings",
  "onboarding.capability.embeddings.keySummary": "Embeddings",
  "onboarding.capability.embeddings.why":
    "Embeddings improve semantic search. Keyword search still works without them.",
  "onboarding.capability.assetsImageGeneration.label": "Image generation",
  "onboarding.capability.assetsImageGeneration.keySummary":
    "Builder credits or an image provider key",
  "onboarding.capability.assetsImageGeneration.why":
    "Image generation is the core workflow for creating on-brand assets.",
  "onboarding.capability.assetsVideoGeneration.label": "Video generation",
  "onboarding.capability.assetsVideoGeneration.keySummary": "Gemini API key",
  "onboarding.capability.assetsVideoGeneration.why":
    "Video generation is optional; the core Assets workflow is image generation.",
  "onboarding.capability.clipsObjectStorage.label": "Object storage",
  "onboarding.capability.clipsObjectStorage.keySummary":
    "Builder storage or an S3-compatible bucket",
  "onboarding.capability.clipsObjectStorage.why":
    "Recorded videos need durable object storage before they can be played back or shared.",
  "onboarding.capability.clipsTranscription.keySummary":
    "Speech-to-text provider key",
  "onboarding.capability.about": "About {{label}}",
  "onboarding.capability.why": "Why {{label}} is needed",
  "onboarding.openAiKeySettings": "Open AI key settings",
  "aboutAgentNative.title": "About Agent-Native",
  "aboutAgentNative.version": "Version",
  "aboutAgentNative.environment": "Environment",
  "aboutAgentNative.build": "Build",
  "aboutAgentNative.copyDiagnostics": "Copy diagnostics",
  "aboutAgentNative.unknown": "Unknown",
  "common.agent": "Agent",
  "agentPanel.mode": "Mode",
  "agentPanel.uiMode": "UI",
  "agentPanel.keyScope": "Key scope",
  "agentPanel.personalKeyScope": "Personal",
  "agentPanel.organizationKeyScope": "Organization",
  "agentPanel.personalKeyInEffect": "Your personal key is in effect.",
  "agentPanel.organizationKeyInEffect": "Organization key is in effect.",
  "agentPanel.sharedKeyInEffect": "A shared key is in effect.",
  "agentPanel.useOrganizationKey": "Use organization key",
  "agentPanel.keyStatusUnavailable": "Key status is unavailable.",
  "agentPanel.saveScopeRoleUnavailable":
    "Couldn't load your organization role, so keys can't be saved yet.",
  "agentPanel.chatgptSubscriptionPopupBlocked":
    "Allow pop-ups for this site, then try again.",
  "agentPanel.chatgptSubscriptionTitle": "ChatGPT subscription",
  "agentPanel.chatgptSubscriptionDescription":
    "Experimental Codex access through your ChatGPT subscription.",
  "agentPanel.chatgptSubscriptionInUse": "In use",
  "agentPanel.chatgptSubscriptionConnected": "Connected",
  "agentPanel.chatgptSubscriptionConnecting": "Connecting…",
  "agentPanel.chatgptSubscriptionReconnect": "Reconnect",
  "agentPanel.chatgptSubscriptionConnect": "Connect ChatGPT",
  "agentPanel.chatgptSubscriptionUse": "Use in chat",
  "agentPanel.chatgptSubscriptionDisconnect": "Disconnect",
  "agentHostNudge.sidebarTitle": "Use {{agent}}'s chat",
  "agentHostNudge.sidebarDescription":
    "You're already chatting with {{agent}}. Ask it to work with this app directly.",
  "agentHostNudge.promptTitle": "Ask {{agent}} instead",
  "agentHostNudge.promptDescription":
    "You can prompt {{agent}} to create or change this here.",
  "agentHostNudge.useThisChat": "Use this chat",
  "agentHostNudge.useThisPrompt": "Use this prompt",
  "common.cancel": "Cancel",
  "common.collapse": "Collapse",
  "common.connect": "Connect",
  "common.continue": "Continue",
  "common.copied": "Copied",
  "common.copy": "Copy",
  "common.details": "Details",
  "common.dismiss": "Dismiss",
  "common.dismissError": "Dismiss error",
  "common.expand": "Expand",
  "common.loading": "Loading...",
  "common.no": "No",
  "common.retry": "Retry",
  "common.chunkLoadFailed": "Couldn't load this. Please try again.",
  "common.save": "Save",
  "agents.hostedAgent": "Hosted agent",
  "agents.provider": "Provider",
  "agents.providerA2A": "A2A (Foundry, Gemini, or custom)",
  "agents.providerAnthropic": "Anthropic Managed Agents",
  "agents.agentId": "Agent ID",
  "agents.agentIdPlaceholder": "agent_...",
  "agents.environmentId": "Environment ID",
  "agents.environmentIdPlaceholder": "env_...",
  "agents.apiBaseUrl": "API base URL (optional)",
  "agents.apiBaseUrlPlaceholder": "https://api.anthropic.com",
  "agents.managedAgentIncomplete":
    "Complete the Anthropic Managed Agents fields.",
  "agents.managedAgentCheck":
    "Connection is checked when you delegate from chat.",
  "agents.managedAgentSaved":
    "Anthropic Managed Agent saved. Delegate to it from chat.",
  "agents.cardUrl": "Agent card URL",
  "agents.cardUrlPlaceholder": "https://host.example/agent-card.json",
  "agents.authType": "Authentication",
  "agents.authNone": "No authentication",
  "agents.authBearer": "Bearer token",
  "agents.authClientCredentials": "OAuth client credentials",
  "agents.chooseCredential": "Choose credential",
  "agents.vault": "Vault",
  "agents.tokenUrl": "Token URL",
  "agents.clientId": "Client ID",
  "agents.scope": "Scope",
  "agents.authIncomplete": "Complete the hosted agent authentication fields.",
  "agents.invalidUrl":
    "Use HTTPS for agent URLs, except for localhost or loopback development URLs.",
  "agents.statusReachable": "Reachable",
  "agents.statusAuthRejected": "Auth rejected",
  "agents.statusNoJsonRpc": "No JSON-RPC",
  "agents.directoryTab": "Agent directory",
  "agents.directoryPageHint":
    "Find an agent backend and connect it to your workspace.",
  "agents.directorySearch": "Search providers",
  "agents.directoryProviders": "Providers",
  "agents.directoryManual": "Add by URL",
  "agents.directoryA2A": "A2A",
  "agents.directoryManaged": "Managed API",
  "agents.directoryFoundry": "Microsoft Foundry",
  "agents.directoryFoundryHint": "Connect a Foundry agent over A2A.",
  "agents.directoryGemini": "Gemini Enterprise",
  "agents.directoryGeminiHint": "Connect a Gemini Enterprise agent over A2A.",
  "agents.directoryAnthropic": "Anthropic Managed Agents",
  "agents.directoryAnthropicHint":
    "Connect sessions and approvals from Anthropic.",
  "agents.directoryNoMatches": "No providers match your search.",
  "agents.directoryRegistry": "Global A2A Registry",
  "agents.directoryRegistryHint":
    "Browse public Agent Cards, then verify before connecting.",
  "agents.directoryBrowse": "Browse registry",
  "agents.formName": "Name",
  "agents.formUrl": "URL",
  "agents.formUrlPlaceholder": "URL (e.g. http://localhost:8085)",
  "agents.formDescription": "Description",
  "agents.formDescriptionPlaceholder": "Description (optional)",
  "agents.formCheck": "Check",
  "agents.formAdd": "Add",
  "agents.formAdding": "Adding",
  "agents.formAddAnyway": "Add anyway",
  "agents.formRemove": "Remove",
  "agents.formSaveFailed": "Couldn't save the agent.",
  "agents.formAddFailed": "Couldn't add the agent.",
  "agents.checkFailed": "Check failed",
  "agents.checkFailedStatus": "Check failed ({{status}})",
  "agents.checkNotReachable": "Not reachable",
  "agents.checkLive": "Live · {{scheme}}",
  "agents.checkNoAuthScheme": "no auth scheme advertised",
  "agents.checkTokenRejected":
    "the peer rejected our token, so calls will return 401 in production",
  "agents.checkTokenUnverified": "couldn't verify our token",
  "agents.checkTokenUnverifiedReason": "couldn't verify our token ({{reason}})",
  "agents.checkTokenWorks": "our token works",
  "agents.checkReadsRequireAuth": "reads require auth",
  "agents.checkPublicSkills": "public skills: {{count}}",
  "agents.unreachableHint":
    "The app may not be running yet. You can still add it.",
  "agents.addedOneWay":
    "Added {{name}} on your side only. Registration is one-way, so {{name}} won't know about this app until you add it there too.",
  "agents.openPeerSettings": "Open {{name}} settings",
  "agents.syncSecret": "Sync secret to apps",
  "agents.noSharedSecret": "No shared secret set yet.",
  "agents.noSharedSecretLink": "Set one on the Team page first.",
  "agents.askOwnerSyncSecret":
    "Ask your workspace owner to sync the shared secret.",
  "common.saveFailed": "Save failed",
  "common.saveFailedStatus": "Save failed ({{status}})",
  "common.saving": "Saving...",
  "common.settings": "Settings",
  "common.waiting": "Waiting...",
  "common.yes": "Yes",
  "composer.attachmentError": "Attachment could not be processed.",
  "composer.dropToAttach": "Drop to attach",
  "composer.droppedFileError":
    "Could not add the dropped file. Try a different format.",
  "composer.openDesktop": "Open Desktop to use this chat.",
  "composer.removeAttachment": "Remove {{name}}",
  "composer.scrollToBottom": "Scroll to bottom",
  "composer.suggestedPrompts": "Suggested prompts",
  "composer.stopResponse": "Stop response",
  "composer.subAgentReadOnly":
    "Send messages to the orchestrator chat — this sub-agent runs automatically",
  "commands.clearShort": "Start a new chat",
  "commands.newShort": "Start a new chat",
  "composer.actDescription": "Use tools and make approved changes",
  "composer.activeAppContext": "Active app context",
  "composer.actMode": "Act mode",
  "composer.add": "Add...",
  "composer.addOwnKeys": "Custom keys",
  "composer.assets.closePicker": "Close image picker",
  "composer.assets.contextTitle": "Image: {{title}}",
  "composer.assets.generatedImage": "Generated image",
  "composer.assets.generateImage": "Generate image",
  "composer.assets.invalidUrl": "The configured image picker URL is not valid.",
  "composer.assets.loadingPicker": "Loading Assets picker",
  "composer.assets.openPicker": "Open Assets image picker",
  "composer.assets.openSecurely":
    "Open Assets in a new tab to sign in and choose an image securely.",
  "composer.assets.pickerTitle": "Assets image picker",
  "composer.auto": "Auto",
  "composer.builderModelCredits": "Free credits for Claude, OpenAI & Gemini",
  "composer.chatGptSubscription": "ChatGPT subscription",
  "composer.closePreview": "Close preview",
  "composer.configureProviderKeys":
    "Configure Anthropic, OpenAI, or another provider",
  "composer.connectAbove": "Connect AI above to continue...",
  "composer.connectBuilder": "Connect Builder.io",
  "composer.connectKeys": "Connect keys",
  "composer.connectingBuilder": "Connecting Builder.io…",
  "composer.costHigher": "Higher cost",
  "composer.costLower": "Lower cost",
  "composer.costMedium": "Medium cost",
  "composer.createAutomation": "Create Automation",
  "composer.createAutomationPrefix": "Create an automation: ",
  "composer.createExtension": "Create Extension",
  "composer.createExtensionPrefix": "Create an extension: ",
  "composer.createSkill": "Create Skill",
  "composer.createSkillPrefix": "Create a skill: ",
  "composer.currentDraft": "Current draft",
  "composer.defaultModel": "Default model",
  "composer.describeAutomation": "Describe what you want to automate...",
  "composer.describeExtension":
    "Describe the interactive extension you want to build...",
  "composer.describeSchedule": "Describe what should happen and when...",
  "composer.describeSkill": "Describe the skill you want to create...",
  "composer.documentTooLarge":
    '"{{name}}" is {{size}} MB. {{label}} are capped at {{maxSize}} MB to stay within message limits. Please reduce the file size or split it into smaller parts.',
  "composer.requestTooLarge":
    "This message and its attachments are too large to send. Remove an attachment or shorten the message.",
  "composer.file": "file",
  "composer.imageModel": "Image model",
  "composer.imagePreview": "Image preview",
  "composer.loadingModels": "Loading models",
  "composer.loadingModelsProgress": "Loading models…",
  "composer.menu.createAutomation": "Create Automation",
  "composer.menu.createAutomationDescription": "Set up a when-X-do-Y rule",
  "composer.menu.createExtension": "Create Extension",
  "composer.menu.createExtensionDescription": "Build a mini app extension",
  "composer.menu.createSkill": "Create Skill",
  "composer.menu.createSkillDescription": "Teach the agent a new ability",
  "composer.menu.generateImage": "Generate Image",
  "composer.menu.generateImageDescription": "Open the Assets image picker",
  "composer.menu.integrations": "Integrations",
  "composer.menu.integrationsDescription":
    "Connect tools and services to the agent",
  "composer.menu.scheduleTask": "Schedule Task",
  "composer.menu.scheduleTaskDescription": "Run something on a schedule",
  "composer.menu.uploadFile": "Upload File",
  "composer.menu.uploadFileDescription": "Images, PDFs, text/code, JSON, CSV",
  "composer.messageAgent": "Message agent...",
  "composer.model": "Model",
  "composer.needsApiKey": "needs API key",
  "composer.pageTitle": "Page title",
  "composer.pastedImageError":
    "Could not attach the pasted image. Try a different format.",
  "composer.pastedTextError": "Could not attach the pasted text.",
  "composer.plan": "Plan",
  "composer.planDescription": "Read-only research and approval first",
  "composer.planDesktopRequired": "Open Agent-Native Desktop to use Plan mode.",
  "composer.previewAttachment": "Preview {{name}}",
  "composer.reasoning": "Reasoning",
  "composer.reasoningEffort.auto": "Auto",
  "composer.reasoningEffort.high": "High",
  "composer.reasoningEffort.low": "Low",
  "composer.reasoningEffort.max": "Max",
  "composer.reasoningEffort.medium": "Medium",
  "composer.reasoningEffort.minimal": "Minimal",
  "composer.reasoningEffort.none": "None",
  "composer.reasoningEffort.xhigh": "Extra high",
  "composer.reasoningExtraHighShort": "XHigh",
  "composer.reasoningMediumShort": "Med",
  "composer.reasoningMinimalShort": "Min",
  "composer.removeContext": "Remove {{name}} context",
  "composer.removeReference": "Remove {{name}} reference",
  "composer.route": "Route",
  "composer.scheduleTask": "Schedule Task",
  "composer.scheduleTaskPrefix": "Create a recurring job: ",
  "composer.selectedReferences": "Selected references",
  "composer.sendMessage": "Send message",
  "composer.skill.added": 'Skill "{{name}}" added',
  "composer.skill.back": "Back",
  "composer.skill.content": "Content",
  "composer.skill.createDescription":
    "Describe a skill and let the agent draft it",
  "composer.skill.createNew": "Create new skill",
  "composer.skill.name": "Skill name",
  "composer.skill.review": "Review the content from {{name}} before saving.",
  "composer.skill.savedAt": "Saved at",
  "composer.skill.saveFailed": "Failed to save skill file",
  "composer.skill.selectedFile": "the selected file",
  "composer.skill.uploadDescription": "Import an existing SKILL.md file",
  "composer.skill.uploadFailedStatus": "Upload failed ({{status}})",
  "composer.skill.uploadFile": "Upload skill file",
  "composer.upload": "Upload",
  "composer.uploadFailed": "Could not upload the selected file.",
  "composer.useAttachedContext": "Use the attached context.",
  "mentions.commands": "Commands",
  "mentions.learnMore": "Learn more",
  "mentions.noResults": "No results found",
  "mentions.noSkills": "No skills available",
  "mentions.sections.agents": "Agents",
  "mentions.sections.connectedAgents": "Connected Agents",
  "mentions.sections.files": "Files",
  "mentions.sections.other": "Other",
  "mentions.skills": "Skills",
  "mentions.typeToSearch": "Type to search...",
  "pastedText.characters": "{{formattedCount}} chars",
  "pastedText.characters_one": "{{formattedCount}} char",
  "pastedText.characters_other": "{{formattedCount}} chars",
  "pastedText.lines": "{{formattedCount}} lines",
  "pastedText.lines_one": "{{formattedCount}} line",
  "pastedText.lines_other": "{{formattedCount}} lines",
  "pastedText.preview": "Preview pasted text",
  "pastedText.remove": "Remove pasted text",
  "pastedText.title": "Pasted text",
  "voice.dictation.cancel": "Cancel (Esc)",
  "voice.dictation.cancelRecording": "Cancel recording",
  "voice.dictation.start": "Dictate ({{shortcut}})",
  "voice.dictation.stopRecording": "Stop recording",
  "voice.dictation.transcribing": "Transcribing…",
  "voiceMode.connectBuilder": "Connect Builder.io",
  "voiceMode.end": "End voice mode",
  "voiceMode.entryButtonLabel": "Use microphone",
  "voiceMode.errors.channelDisconnected":
    "The realtime voice control channel disconnected.",
  "voiceMode.errors.connectionFailed": "The realtime voice connection failed.",
  "voiceMode.errors.connectionTimedOut":
    "The realtime voice connection timed out.",
  "voiceMode.errors.offerFailed": "The browser did not create an audio offer.",
  "voiceMode.errors.responseFailed":
    "OpenAI could not complete the voice response.",
  "voiceMode.errors.sessionFailed":
    "The realtime voice session encountered an error.",
  "voiceMode.errors.unsupported":
    "This browser does not support realtime voice conversations.",
  "voiceMode.hideChat": "Hide chat",
  "voiceMode.keepDictating": "Dictate a message",
  "voiceMode.promptDescription":
    "Voice mode keeps listening while the agent navigates and takes actions.",
  "voiceMode.promptTitle": "Use your voice",
  "voiceMode.rememberPreference": "Remember my preference",
  "voiceMode.settings.autoLanguage": "Auto",
  "voiceMode.settings.defaultMicrophone": "System default",
  "voiceMode.settings.intelligence": "Intelligence",
  "voiceMode.settings.intelligenceLevels.balanced": "Balanced",
  "voiceMode.settings.intelligenceLevels.deep": "Deep",
  "voiceMode.settings.intelligenceLevels.instant": "Instant",
  "voiceMode.settings.language": "Language",
  "voiceMode.settings.languages.de": "German",
  "voiceMode.settings.languages.en": "English",
  "voiceMode.settings.languages.es": "Spanish",
  "voiceMode.settings.languages.fr": "French",
  "voiceMode.settings.languages.it": "Italian",
  "voiceMode.settings.languages.ja": "Japanese",
  "voiceMode.settings.languages.ko": "Korean",
  "voiceMode.settings.languages.pt": "Portuguese",
  "voiceMode.settings.languages.zh": "Chinese",
  "voiceMode.settings.microphone": "Microphone",
  "voiceMode.settings.microphoneNumber": "Microphone {{number}}",
  "voiceMode.settings.microphoneSwitchFailed":
    "Could not switch microphones. Your current microphone is still active.",
  "voiceMode.settings.voiceChangePending":
    "Your new voice will apply next time you start voice mode.",
  "voiceMode.settings.voiceDescriptions.alloy": "Balanced and neutral",
  "voiceMode.settings.voiceDescriptions.ash": "Smooth and confident",
  "voiceMode.settings.voiceDescriptions.ballad": "Warm and expressive",
  "voiceMode.settings.voiceDescriptions.cedar": "Clear and grounded",
  "voiceMode.settings.voiceDescriptions.coral": "Friendly and bright",
  "voiceMode.settings.voiceDescriptions.echo": "Clear and direct",
  "voiceMode.settings.voiceDescriptions.marin": "Warm and natural",
  "voiceMode.settings.voiceDescriptions.sage": "Calm and thoughtful",
  "voiceMode.settings.voiceDescriptions.shimmer": "Light and upbeat",
  "voiceMode.settings.voiceDescriptions.verse": "Expressive and versatile",
  "voiceMode.settings.voiceStyle": "Voice style",
  "voiceMode.setupDescription":
    "Connect Builder.io to use managed voice with free credits, or add your own keys.",
  "voiceMode.setupTitle": "Set up voice mode",
  "voiceMode.showChat": "Show chat",
  "voiceMode.start": "Start voice chat",
  "voiceMode.startWithOpenAiKey": "Start with OpenAI key",
  "voiceMode.status.connecting": "Connecting",
  "voiceMode.status.ending": "Ending voice mode",
  "voiceMode.status.error": "Voice mode needs attention",
  "voiceMode.status.listening": "Listening",
  "voiceMode.status.speaking": "Speaking",
  "voiceMode.status.working": "Working",
  "voiceMode.useOpenAiKey": "Add your own keys",
  "voiceMode.voiceSettings": "Voice settings",
  "duration.hourShort": "h",
  "duration.minuteShort": "m",
  "duration.secondShort": "s",
  "empty.loadingChat": "Loading chat...",
  "empty.prompt": "How can I help you?",
  "error.afterDuration": "{{headline}} after {{duration}}",
  "error.failed": "The agent hit an error",
  "error.stopped": "The agent stopped before finishing",
  "errorMessages.agentConnection":
    "The agent connection was interrupted. Check your connection and retry.",
  "errorMessages.attachmentPasswordProtected":
    "This PDF is password-protected, so it can't be read. Remove the password protection or paste the relevant text, then retry.",
  "errorMessages.builderAuthentication":
    "Builder rejected the connected credentials. Reconnect Builder.io in Settings, then retry.",
  "errorMessages.builderModelUnauthorized":
    "The provider behind this model rejected the request. Pick a different model, then retry.",
  "errorMessages.errorPrefix": "Error: {{message}}",
  "errorMessages.gatewayInternalError":
    "The model gateway hit an internal error before the agent could answer. Retry in a moment, and quote the error id below if it keeps happening.",
  "errorMessages.gatewayNoDetails":
    "The model gateway returned no error details and the chat couldn't recover. Wait a moment and retry, or start a new chat if it keeps happening.",
  "errorMessages.creditsLimitReached": "You've reached your AI credits limit.",
  "errorMessages.inactivityTimeout":
    "The agent connection timed out before it could finish. You can continue from the partial work or retry.",
  "errorMessages.invalidToolSchema":
    "A tool schema was invalid, so the model rejected the request before it started. The invalid tool can be skipped and the request retried.",
  "errorMessages.malformedRequest":
    "The model provider rejected this request as malformed, so it was not retried. Retry, or start a new chat if it keeps happening.",
  "errorMessages.malformedRequestAttachment":
    "The model rejected an attached file, so this message was never sent. Remove the attachment and retry — a PDF, a plain-text file, or a JPEG, PNG, GIF, or WebP image is read directly; other formats have to be uploaded and linked instead.",
  "errorMessages.noProviderConnected":
    "No LLM provider is connected. Open Settings > Agent > AI providers, then connect Builder.io (free tier available) or add a provider key.",
  "errorMessages.openBuilderSpaceSettings": "Open Builder space settings",
  "errorMessages.providerAuthentication":
    "The model provider rejected the saved API key. Update the key in Settings → Integrations → API keys, then retry.",
  "errorMessages.providerConfiguration":
    "This model can't use tools with the current settings. Switch models in Settings, then retry.",
  "errorMessages.providerHtml": "The provider returned an HTML error page.",
  "errorMessages.providerNetwork":
    "The model provider could not be reached. Check your connection and retry.",
  "errorMessages.providerRateLimit":
    "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
  "errorMessages.providerTransientRejection":
    "The AI provider temporarily refused this request. This usually clears within a minute — retry.",
  "errorMessages.startNewChat": "Start new chat",
  "errorMessages.addCreditsInBuilder": "Add credits in Builder",
  "feedback.inaccurate": "Inaccurate",
  "feedback.keyboardHint": "{{shortcut}} Enter to send",
  "feedback.notHelpful": "Not helpful",
  "feedback.placeholder": "Tell us what went wrong...",
  "feedback.submit": "Submit",
  "feedback.submitted": "Feedback submitted",
  "feedback.thumbsDown": "Thumbs down",
  "feedback.thumbsUp": "Thumbs up",
  "feedback.tooSlow": "Too slow",
  "feedback.whatWentWrong": "What went wrong?",
  "feedback.wrongTool": "Wrong tool",
  "header.switchToCli": "Switch to CLI",
  "history.active": "Active",
  "history.empty": "No chats yet",
  "history.loadOlder": "Load older chats",
  "history.noMatches": "No matching chats",
  "history.open": "Open",
  "history.pinned": "Pinned",
  "history.search": "Search chats...",
  "history.searching": "Searching...",
  "history.untitledChat": "Chat",
  "history.yesterday": "Yesterday",
  "integrations.availableSection": "Available integrations",
  "integrations.connectedSection": "Connected",
  "integrations.goToApiKeys": "Go to API keys",
  "integrations.goToIntegrations": "Go to Integrations",
  "integrations.lookingForApiKeys": "Looking for an API key instead?",
  "integrations.lookingForProviders": "Looking for OAuth or MCP providers?",
  "integrations.manage": "Manage",
  "integrations.recommended": "Recommended",
  "integrations.subtitle": "Connect the tools your agent can use.",
  "mcpIntegrations.menuLabel": "Integrations",
  "mcpIntegrations.menuDescription": "Connect tools and services to the agent",
  "mcpIntegrations.title": "Connect integrations",
  "mcpIntegrations.description":
    "Browse {{count}} agent integrations or add a custom one.",
  "mcpIntegrations.searchPlaceholder": "Search integrations",
  "mcpIntegrations.addYourOwn": "Add your own",
  "mcpIntegrations.noMatches": "No integrations match that search.",
  "mcpIntegrations.connected": "Connected",
  "mcpIntegrations.connectionError": "Connection error",
  "mcpIntegrations.connectionErrorReason": "Reason: {{reason}}",
  "mcpIntegrations.reconnect": "Reconnect",
  "mcpIntegrations.reconnecting": "Reconnecting…",
  "mcpIntegrations.reconnectFailed": "Reconnect failed: {{error}}",
  "mcpIntegrations.configure": "Configure",
  "mcpIntegrations.connect": "Connect",
  "mcpIntegrations.connectWithOAuth": "Connect",
  "mcpIntegrations.connecting": "Connecting…",
  "mcpIntegrations.useApiToken": "Use API token",
  "mcpIntegrations.customOAuthDefault": "Sign in with OAuth",
  "mcpIntegrations.customHeadersMode": "Use an API key",
  "mcpIntegrations.useApiKeyInstead": "Use an API key instead",
  "mcpIntegrations.useOAuthInstead": "Use OAuth instead",
  "mcpIntegrations.connectSuggestion": "Connect {{name}} to use it in chat",
  "mcpIntegrations.connectSuggestionWithApiToken":
    "Connect {{name}} with an API token to use it in chat",
  "mcpIntegrations.dismissSuggestion": "Dismiss integration suggestion",
  "mcpIntegrations.backToIntegrations": "Back to integrations",
  "mcpIntegrations.customTitle": "Add custom agent integration",
  "mcpIntegrations.configureTitle": "Configure {{name}}",
  "mcpIntegrations.presetNoAuthDescription":
    "Preset values are filled in. Test the endpoint or connect it now.",
  "mcpIntegrations.presetAuthDescription":
    "Preset values are filled in. Add any required authorization details before connecting.",
  "mcpIntegrations.customDescription":
    "Paste a Streamable HTTP or SSE endpoint and optional headers.",
  "mcpIntegrations.oauthNotice":
    "This provider usually requires an OAuth setup. Follow the provider docs, or add an Authorization header if your endpoint supports token-based access.",
  "mcpIntegrations.providerSetupRequired": "Provider setup required",
  "mcpIntegrations.providerSetupDescription":
    "Complete the required setup in {{name}} first. Then return here to connect your account.",
  "mcpIntegrations.providerSetupFormDescription":
    "Complete provider setup before connecting your account.",
  "mcpIntegrations.continueToConnect": "Connect my account",
  "mcpIntegrations.setupTitle": "Connect {{name}}",
  "mcpIntegrations.personal": "Personal",
  "mcpIntegrations.personalConnection": "Personal connection",
  "mcpIntegrations.organization": "Organization",
  "mcpIntegrations.scopeQuestion": "Who should be able to use this connection?",
  "mcpIntegrations.scopeChoiceTitle": "Who should use this?",
  "mcpIntegrations.scopeChoiceDescription":
    "Choose where this connection is available.",
  "mcpIntegrations.connectForMe": "Connect for me",
  "mcpIntegrations.setUpForWorkspace": "Set up for workspace",
  "mcpIntegrations.workspaceAdminRequired":
    "Workspace owner or admin required.",
  "mcpIntegrations.workspaceJoinRequired": "Join a workspace first.",
  "mcpIntegrations.personalOnlyDescription":
    "Only personal connections are supported for this integration.",
  "mcpIntegrations.workspaceOnlyDescription":
    "This integration connects once for the whole workspace, so it cannot be connected to just your account. A workspace owner or admin can set it up.",
  "mcpIntegrations.loadingScopeMetadata": "Loading connection scope…",
  "mcpIntegrations.retry": "Retry",
  "mcpIntegrations.retrying": "Retrying…",
  "mcpIntegrations.personalDescription": "Only you can use this connection.",
  "mcpIntegrations.sharedWithWorkspace": "Shared with workspace",
  "mcpIntegrations.organizationDescription":
    "Permitted workspace members can use this connection. Provider permissions still apply.",
  "mcpIntegrations.serverNameRequired":
    "Enter an integration name before connecting with OAuth.",
  "mcpIntegrations.serverName": "Integration name",
  "mcpIntegrations.url": "URL",
  "mcpIntegrations.fieldDescription": "Description",
  "mcpIntegrations.headers": "Headers",
  "mcpIntegrations.serverNamePlaceholder": "Integration name",
  "mcpIntegrations.urlPlaceholder": "https://example.com/agent-integration",
  "mcpIntegrations.descriptionPlaceholder": "Description (optional)",
  "mcpIntegrations.headersPlaceholder": "Authorization: Bearer <token>",
  "mcpIntegrations.openSetupDocs": "Open setup docs",
  "mcpIntegrations.viewSetup": "Open setup guide",
  "mcpIntegrations.test": "Test",
  "mcpIntegrations.testing": "Testing…",
  "mcpIntegrations.toolsAvailable_one": "{{count}} tool available",
  "mcpIntegrations.toolsAvailable_other": "{{count}} tools available",
  "mcpIntegrations.failed": "Failed",
  "mcpIntegrations.docsLabel": "View {{name}} docs",
  "mcpIntegrations.catalog.context7.description":
    "Fetch current library docs in agent chats.",
  "mcpIntegrations.catalog.context7.useCase":
    "Documentation, technical reference, API docs, framework guides",
  "mcpIntegrations.catalog.sentry.description":
    "Inspect issues, events, and debugging data.",
  "mcpIntegrations.catalog.sentry.useCase":
    "Error monitoring, debugging, performance, crash reports",
  "mcpIntegrations.catalog.fullstory.description":
    "Read behavioral analytics and inspect session replays.",
  "mcpIntegrations.catalog.fullstory.useCase":
    "Product analytics, session replay, qualitative behavior, user research",
  "mcpIntegrations.catalog.fullstory.setupNote":
    "FullStory MCP is currently beta and requires StoryAI features plus the Model Context Protocol toggle to be enabled by a FullStory organization admin.",
  "mcpIntegrations.catalog.amplitude.description":
    "Read and work with Amplitude product analytics.",
  "mcpIntegrations.catalog.amplitude.useCase":
    "Product analytics, charts, dashboards, cohorts, experiments",
  "mcpIntegrations.catalog.amplitude.setupNote":
    "Amplitude MCP uses OAuth over streaming HTTP. The default endpoint is for US data residency; use Amplitude's EU endpoint when the account requires EU residency.",
  "mcpIntegrations.catalog.sigma.description":
    "Search, explore, and analyze Sigma workbooks and dashboards.",
  "mcpIntegrations.catalog.sigma.useCase":
    "Analytics, dashboards, workbooks, data exploration, business intelligence",
  "mcpIntegrations.catalog.sigma.setupNote":
    "Sigma's MCP URL is organization-specific. In Sigma, open Profile > Integrations > Connect Sigma to AI tools, copy the URL, and paste it here. Sigma MCP currently supports search, metadata exploration, and analysis; dashboard or workbook creation and import are not exposed by this connection.",
  "mcpIntegrations.catalog.notion.description":
    "Search pages and team knowledge.",
  "mcpIntegrations.catalog.notion.useCase":
    "Documentation, knowledge management, notes, content creation",
  "mcpIntegrations.catalog.notion.setupNote":
    "The Notion integration uses user OAuth. Enterprise workspaces can audit integration usage and allow or block clients; reconnect after admin policy changes.",
  "mcpIntegrations.catalog.granola.description":
    "Search meeting notes, transcripts, and action items.",
  "mcpIntegrations.catalog.granola.useCase":
    "Meeting notes, recordings, transcripts, action items, follow-ups",
  "mcpIntegrations.catalog.granola.setupNote":
    "The Granola integration uses browser OAuth. Authorize the signed-in Granola account and review which meeting notes and transcripts the agent can access.",
  "mcpIntegrations.catalog.gong.description":
    "Search Gong calls and generate account and deal insights.",
  "mcpIntegrations.catalog.gong.useCase":
    "Sales calls, transcripts, deal insights, account summaries",
  "mcpIntegrations.catalog.gong.setupNote":
    "Gong requires a tech admin to create an MCP integration and choose personal or shared authorization. The generated client ID and secret must be configured before connecting.",
  "mcpIntegrations.catalog.semgrep.description":
    "Scan code for security findings.",
  "mcpIntegrations.catalog.semgrep.useCase":
    "Security scanning, vulnerability detection, code analysis",
  "mcpIntegrations.catalog.linear.description": "Read and write Linear issues.",
  "mcpIntegrations.catalog.linear.useCase":
    "Project management, issue tracking, planning, bug reports",
  "mcpIntegrations.catalog.apollo.description":
    "Search, enrich, and manage Apollo GTM data.",
  "mcpIntegrations.catalog.apollo.useCase":
    "Prospecting, enrichment, contacts, sequences, account research",
  "mcpIntegrations.catalog.apollo.setupNote":
    "Apollo MCP uses user OAuth and does not require an Apollo API key. Apollo plan permissions, credits, and the provider's model-training restrictions still apply.",
  "mcpIntegrations.catalog.commonRoom.description":
    "Research buyer signals, contacts, and organizations.",
  "mcpIntegrations.catalog.commonRoom.useCase":
    "Buyer intelligence, product signals, intent, contact enrichment",
  "mcpIntegrations.catalog.commonRoom.setupNote":
    "Common Room MCP uses per-user OAuth and respects the authorized user's workspace role. An administrator may need to enable the MCP connection for the instance.",
  "mcpIntegrations.catalog.exa.description":
    "Search the web and fetch pages with Exa.",
  "mcpIntegrations.catalog.exa.useCase":
    "Web search, research, code search, page fetching",
  "mcpIntegrations.catalog.exa.setupNote":
    "Exa's remote MCP endpoint supports basic free usage without a key. Add an Exa API key through the provider's header configuration when higher limits or additional tools are needed.",
  "mcpIntegrations.catalog.supabase.description":
    "Manage data, auth, and backend services.",
  "mcpIntegrations.catalog.supabase.useCase":
    "Database, authentication, storage, edge functions",
  "mcpIntegrations.catalog.neon.description":
    "Work with serverless Postgres projects.",
  "mcpIntegrations.catalog.neon.useCase":
    "Database management, serverless Postgres, data storage",
  "mcpIntegrations.catalog.stripe.description":
    "Manage payments, subscriptions, and customers.",
  "mcpIntegrations.catalog.stripe.useCase":
    "Payments, subscriptions, invoicing, customer management",
  "mcpIntegrations.catalog.atlassian.description":
    "Read and write Jira issues and Confluence content.",
  "mcpIntegrations.catalog.atlassian.useCase":
    "Project management, issue tracking, documentation, team collaboration",
  "mcpIntegrations.catalog.atlassian.setupNote":
    "Ask your Atlassian admin to allow the Clips app domain and enable Rovo/MCP with Read, Write, and Search permissions for your Jira site.",
  "mcpIntegrations.catalog.cloudflare.description":
    "Search and operate Cloudflare services through its integration.",
  "mcpIntegrations.catalog.cloudflare.useCase":
    "DNS, Workers, domains, security, observability, platform APIs",
  "mcpIntegrations.catalog.cloudflare.setupNote":
    "Cloudflare's managed integration directory contains product-specific integrations as well as the broad API integration. Review the scopes and choose the narrowest endpoint that fits your workflow.",
  "mcpIntegrations.catalog.grafana.description":
    "Query Grafana Cloud metrics, logs, and observability data.",
  "mcpIntegrations.catalog.grafana.useCase":
    "Observability, metrics, logs, traces, dashboards",
  "mcpIntegrations.catalog.grafana.setupNote":
    "Grafana Cloud MCP is in public preview and requires Grafana Cloud Assistant MCP access. It is hosted Grafana Cloud only; self-hosted Grafana needs the local MCP server.",
  "mcpIntegrations.catalog.gitlab.description":
    "Read and manage GitLab projects, issues, and merge requests.",
  "mcpIntegrations.catalog.gitlab.useCase":
    "Repositories, issues, merge requests, CI/CD, code analytics",
  "mcpIntegrations.catalog.gitlab.setupNote":
    "The GitLab integration is currently beta. On GitLab.com, a top-level group admin must allow integration access before OAuth can complete; self-managed instances have an equivalent instance setting.",
  "mcpIntegrations.catalog.figma.description":
    "Bring Figma design context and canvas actions into an agent.",
  "mcpIntegrations.catalog.figma.useCase":
    "Design files, components, variables, design systems, canvas",
  "mcpIntegrations.catalog.figma.setupNote":
    "The Figma integration only allows clients listed in Figma's integration catalog, so this remote endpoint cannot connect from Agent-Native yet. Use the Figma REST API fallback with a personal access token for reading file and node context; canvas actions remain unavailable until Figma approves Agent-Native.",
  "mcpIntegrations.catalog.canva.description":
    "Search, create, and update Canva designs and assets.",
  "mcpIntegrations.catalog.canva.useCase":
    "Designs, templates, assets, brand kits, exports, collaboration",
  "mcpIntegrations.catalog.canva.setupNote":
    "The Canva integration uses per-user OAuth and requires clients to allow Canva's canva.com and canva.ai domains. Confirm the current redirect and client setup in Canva's integration documentation before connecting.",
  "mcpIntegrations.catalog.vercel.description":
    "Search Vercel docs and inspect projects, deployments, and logs.",
  "mcpIntegrations.catalog.vercel.useCase":
    "Deployments, projects, logs, domains, hosting, documentation",
  "mcpIntegrations.catalog.vercel.setupNote":
    "The Vercel integration only accepts reviewed and approved AI clients. Agent-Native must be added to Vercel's supported-client list before a generic framework connection will work.",
  "mcpIntegrations.catalog.github.description":
    "Read repositories, issues, pull requests, and code context.",
  "mcpIntegrations.catalog.github.useCase":
    "Repositories, issues, pull requests, code, engineering analytics",
  "mcpIntegrations.catalog.github.setupNote":
    "GitHub's sign-in provider does not let apps register themselves, so the Connect button cannot complete OAuth. Connect with a GitHub personal access token instead, and note that organizations may enforce OAuth App Access Policies.",
  "mcpIntegrations.catalog.slack.description":
    "Search Slack conversations and take workspace actions through its integration.",
  "mcpIntegrations.catalog.slack.useCase":
    "Messages, channels, people, company memory, workflows",
  "mcpIntegrations.catalog.slack.setupNote":
    "The Slack integration requires a registered Slack app with a fixed app ID. Dynamic client registration is not supported, and only Slack Marketplace or internal apps may connect. Use Slack's managed messaging OAuth flow for Agent-Native workflows.",
  "mcpIntegrations.catalog.asana.description":
    "Search and manage Asana tasks, projects, and work graph data.",
  "mcpIntegrations.catalog.asana.useCase":
    "Tasks, projects, portfolios, planning, workload",
  "mcpIntegrations.catalog.asana.setupNote":
    "Asana's agent integration requires a pre-registered OAuth app and does not support dynamic client registration. Configure an Asana app client before connecting.",
  "mcpIntegrations.catalog.hubspot.description":
    "Search and update HubSpot CRM records through its integration.",
  "mcpIntegrations.catalog.hubspot.useCase":
    "CRM, contacts, companies, deals, tickets, customer analytics",
  "mcpIntegrations.catalog.hubspot.setupNote":
    "When a workspace-managed HubSpot MCP Auth App is configured, any member can connect a personal HubSpot account with OAuth and PKCE. Otherwise, create the app in the HubSpot Developer Platform before connecting; the existing HubSpot OAuth connector remains available to app actions.",
  "mcpIntegrations.catalog.pylon.description":
    "Search and update Pylon support data.",
  "mcpIntegrations.catalog.pylon.useCase":
    "Customer support, issues, accounts, contacts, conversations",
  "mcpIntegrations.catalog.pylon.setupNote":
    "Enable Pylon MCP access for the relevant users and turn on the MCP server in Pylon before connecting. Pylon requires a Member or Admin seat and uses user OAuth only.",
  "mcpIntegrations.catalog.intercom.description":
    "Search conversations and customer support knowledge.",
  "mcpIntegrations.catalog.intercom.useCase":
    "Customer support, conversations, contacts, help center content",
  "mcpIntegrations.catalog.intercom.setupNote":
    "The Intercom integration uses OAuth and is available for US-hosted workspaces. Confirm the workspace region and requested scopes during authorization.",
  "mcpIntegrations.catalog.monday.description":
    "Work with boards, items, and team workflows.",
  "mcpIntegrations.catalog.monday.useCase":
    "Work management, boards, projects, tasks, team operations",
  "mcpIntegrations.catalog.monday.setupNote":
    "The monday.com integration uses OAuth over Streamable HTTP. Choose the workspace and permissions to share during authorization.",
  "mcpIntegrations.catalog.webflow.description":
    "Read and update Webflow sites and content.",
  "mcpIntegrations.catalog.webflow.useCase":
    "Websites, CMS, site content, publishing, design workflows",
  "mcpIntegrations.catalog.webflow.setupNote":
    "The Webflow integration uses OAuth. Designer capabilities may install Webflow's Bridge App during authorization; Data API access is available separately.",
  "mcpIntegrations.catalog.paypal.description":
    "Work with PayPal payments, invoices, and commerce data.",
  "mcpIntegrations.catalog.paypal.useCase":
    "Payments, invoices, transactions, merchant operations",
  "mcpIntegrations.catalog.paypal.setupNote":
    "PayPal exposes OAuth discovery and login for its remote agent integration. Agent-Native uses the currently live /sse endpoint; review the merchant permissions before authorizing.",
  "mcpIntegrations.catalog.box.description":
    "Search and manage files and folders in Box.",
  "mcpIntegrations.catalog.box.useCase":
    "Files, folders, enterprise content, search, collaboration",
  "mcpIntegrations.catalog.box.setupNote":
    "The Box integration is beta and requires an administrator to enable it. Custom clients also need Box Integration Credentials, a redirect URI, and approved scopes.",
  "mcpIntegrations.catalog.builder.description":
    "Search Builder Publish and Hybrid Space content.",
  "mcpIntegrations.catalog.builder.useCase":
    "Content models, pages, entries, Publish and Hybrid Spaces",
  "mcpIntegrations.catalog.builder.setupNote":
    "Builder CMS MCP uses OAuth with dynamic client registration. It only connects to Publish or Hybrid Spaces, and the authorization flow asks you to select the Space.",
  "mcpIntegrations.catalog.netlify.description":
    "Inspect and operate Netlify sites and deployments.",
  "mcpIntegrations.catalog.netlify.useCase":
    "Sites, deployments, builds, domains, hosting operations",
  "mcpIntegrations.catalog.netlify.setupNote":
    "Netlify documents a remote integration setup for supported clients. Review the site and team permissions before completing OAuth.",
  "mcpIntegrations.catalog.zapier.description":
    "Connect tools to thousands of app actions.",
  "mcpIntegrations.catalog.zapier.useCase":
    "Automation, workflows, app actions, cross-service operations",
  "mcpIntegrations.catalog.zapier.setupNote":
    "Zapier's agent integration uses a user-created connection and token for unlisted clients. Create the connection in Zapier, then paste its generated bearer token into the header field.",
  "mcpIntegrations.auth.none": "No auth",
  "mcpIntegrations.auth.headers": "Header",
  "mcpIntegrations.auth.oauth": "OAuth",
  "mcpIntegrations.status.beta": "Beta",
  "mcpIntegrations.status.setupRequired": "Provider setup",
  "mcpIntegrations.status.clientRestricted": "Approved clients only",
  "mcpIntegrations.status.verified": "Verified",
  "mcpIntegrations.status.preflightOnly": "Preflight only",
  "mcpIntegrations.status.restricted": "Restricted",
  "limit.account": "your account",
  "limit.descriptionAll":
    "The agent used all available steps. Keep going in a fresh turn, or raise the {{scope}} limit first.",
  "limit.descriptionWithCount":
    "The agent used {{formattedCount}} steps. Keep going in a fresh turn, or raise the {{scope}} limit first.",
  "limit.descriptionWithCount_one":
    "The agent used {{formattedCount}} step. Keep going in a fresh turn, or raise the {{scope}} limit first.",
  "limit.descriptionWithCount_other":
    "The agent used {{formattedCount}} steps. Keep going in a fresh turn, or raise the {{scope}} limit first.",
  "limit.keepGoing": "Keep going",
  "limit.maxSteps": "Max steps",
  "limit.namedOrganization": "{{organization}} organization",
  "limit.organization": "organization",
  "limit.ownerOnly":
    "Only organization owners and admins can change this limit.",
  "limit.reached": "Step limit reached",
  "limit.saveAndContinue": "Save and keep going",
  "message.actions": "Message actions",
  "message.copyMessage": "Copy message",
  "message.copyRequestId": "Copy request ID",
  "message.requestIdUnavailable": "Request ID unavailable",
  "message.edit": "Edit message",
  "message.forkChat": "Fork chat",
  "message.missingFinal":
    "The agent stopped without sending a final message. Ask it to continue or retry.",
  "message.messages": "Messages",
  "message.nextBranch": "Next branch",
  "message.noRestoreRun": "This message has no run to restore to.",
  "message.previousBranch": "Previous branch",
  "message.regenerate": "Regenerate response",
  "message.restoreFailed": "Restore failed ({{status}}).",
  "message.restoreQuestion": "Restore to here?",
  "message.revertQuestion":
    "Revert to this point? Changes made after this point will be lost.",
  "message.restoreRequestFailed": "Restore request failed.",
  "message.threadNotFound":
    "This chat thread is no longer available. Start a new chat or retry if this was unexpected.",
  "message.restoring": "Restoring...",
  "message.revertHere": "Revert to here",
  "message.revertToBeginning": "Revert to beginning",
  "message.sentAt": "Sent {{time}}",
  "contextMeter.ariaLabel":
    "Context {{percent}}%, {{totalTokens}}{{breakdown}}. Open Context X-Ray.",
  "contextMeter.breakdown":
    " total: {{systemTokens}} system + {{conversationTokens}} conversation",
  "contextMeter.summary": "Context {{percent}}% · {{totalTokens}}",
  "contextMeter.summaryBreakdown":
    " ({{systemTokens}} system + {{conversationTokens}} conversation)",
  "contextXray.advisory": "advisory",
  "contextXray.conversation": "{{count}} conversation",
  "contextXray.currentStatus": "current status",
  "contextXray.estimated": "estimated",
  "contextXray.estimatedPrefix": " estimated",
  "contextXray.estimatedSuffix": " · estimated",
  "contextXray.evict": "Evict",
  "contextXray.evicted": "{{count}} evicted",
  "contextXray.evictSegment": "Evict segment",
  "contextXray.framework": "framework",
  "contextXray.free": "{{count}} free",
  "contextXray.governance.inherited": "Inherited",
  "contextXray.governance.required": "Required",
  "contextXray.governance.user": "Your context",
  "contextXray.groups.conversation": "Conversation",
  "contextXray.groups.evicted": "Evicted",
  "contextXray.groups.filesRead": "Files read",
  "contextXray.groups.pinned": "Pinned",
  "contextXray.groups.taskInstructions": "Task & instructions",
  "contextXray.groups.thinking": "Thinking",
  "contextXray.groups.toolResults": "Tool results",
  "contextXray.inspect": "Inspect {{name}}",
  "contextXray.list": "List",
  "contextXray.loading": "Loading context...",
  "contextXray.map": "Map",
  "contextXray.messageIndex": "message index",
  "contextXray.noActiveSegments": "No active segments",
  "contextXray.panelTitle": "Context X-Ray",
  "contextXray.partIndex": "part index",
  "contextXray.pin": "Pin",
  "contextXray.pinned": "{{count}} pinned",
  "contextXray.pinSegment": "Pin segment",
  "contextXray.protectedDescription":
    "This segment is part of the active turn and cannot be evicted yet.",
  "contextXray.protectedDuringTurn": "Protected during active turn",
  "contextXray.recordEvictionIntent": "Record eviction intent",
  "contextXray.restore": "Restore",
  "contextXray.restoreSegment": "Restore segment",
  "contextXray.segment": "Segment",
  "contextXray.showList": "Show context list",
  "contextXray.showMap": "Show context map",
  "contextXray.status.active": "Active",
  "contextXray.status.evicted": "Evicted",
  "contextXray.status.pinned": "Pinned",
  "contextXray.status.protected": "Protected",
  "contextXray.status.summarized": "Summarized",
  "contextXray.system": "{{count}} system",
  "contextXray.systemOrdered": "System · ordered, not evictable",
  "contextXray.tokens": "tokens",
  "contextXray.tokensShare": "tokens · {{share}}%",
  "contextXray.unpin": "Unpin",
  "contextXray.unpinSegment": "Unpin segment",
  "plan.act": "Act",
  "plan.implement": "Implement",
  "plan.mode": "Plan mode",
  "plan.ready": "Plan ready",
  "plan.switchToAct": "Switch to Act mode",
  "queue.count": "{{count}} queued",
  "queue.followUp": "Send a follow-up...",
  "queue.followUpWithCount": "{{count}} queued — send a follow-up...",
  "queue.remove": "Remove from queue",
  "queue.sendNow": "Send now",
  "queue.sendNowHint": "Send now (stops the current response)",
  "queue.steer": "Steer",
  "queue.steerHint": "Send this message next",
  "queue.moreActions": "More actions",
  "queue.moveToTop": "Move to top",
  "recovery.connectingBuilder": "Connecting Builder.io",
  "recovery.copyDebug": "Copy debug",
  "recovery.copyFailed": "Copy failed",
  "recovery.credentialRejected":
    "The current Builder.io or model-provider credential was rejected. Reconnect Builder.io, then retry this message.",
  "recovery.diagnoseRetry": "Diagnose and retry",
  "recovery.forkDescription":
    "Fork this conversation into a separate chat thread.",
  "recovery.forkFailed": "Could not fork this chat. Try starting a new chat.",
  "recovery.forking": "Forking...",
  "recovery.newChatHint":
    "If retry lands on the same error, start a new chat session and continue from what already changed.",
  "recovery.backgroundTimeout":
    "The previous background agent run reached its time limit before finishing. The partial work was preserved; continue or retry to pick up from here.",
  "recovery.noProgress":
    "The previous agent run stopped producing visible progress during recovery, so it was stopped before it could keep looping.",
  "recovery.statusCheckFailed":
    "Couldn't reach the server to check whether the agent is still working. Send your message again to retry.",
  "recovery.streamEnded":
    "The previous agent stream ended while the run was recovering. Continue or retry to reconnect to the run.",
  "recovery.reconnectBuilder": "Reconnect Builder.io",
  "secrets.addCustomKeyNamed": "Add “{{name}}” as a custom key",
  "secrets.chooseKey": "Choose a key",
  "secrets.customKey": "Custom key",
  "secrets.customKeyHint": "Add any key by name",
  "secrets.emptyHint": "Add a key to use your own accounts.",
  "secrets.emptyMore": "and {{count}} more under New, or add any custom key",
  "secrets.emptyTitle": "No keys yet.",
  "secrets.fromEnvironment": "Provided by the deployment environment.",
  "secrets.managedInVault":
    "Managed in the workspace Vault. Every app in this workspace uses this value.",
  "secrets.openVault": "Open Vault",
  "secrets.managedByOwner": "Managed in {{owner}}",
  "secrets.removeCredentials": "Remove credentials",
  "secrets.confirmRemove": "Remove",
  "secrets.sharedKeysKept":
    "Some shared keys were not removed. Only workspace admins can remove them.",
  "secrets.newKey": "New",
  "secrets.noKeysFound": "No keys found.",
  "secrets.overridesVault":
    "This personal key overrides the workspace Vault value. Remove it to use the Vault key.",
  "secrets.overridesWorkspace":
    "This personal key overrides the workspace value. Remove it to use the shared key.",
  "secrets.setForWorkspace": "Set for everyone in this workspace.",
  "secrets.sourceEnvironment": "Environment",
  "secrets.sourceVault": "Vault",
  "secrets.sourceWorkspace": "Workspace",
  "secrets.statusUnavailable": "Unavailable",
  "secrets.required": "Required",
  "secrets.searchKeys": "Search keys...",
  "secrets.usePersonalKey": "Use a personal key instead",
  "selection.attached": "{{formattedCount}} characters of selection attached",
  "selection.attached_one":
    "{{formattedCount}} character of selection attached",
  "selection.attached_other":
    "{{formattedCount}} characters of selection attached",
  "selection.clear": "Clear selection context",
  "setup.addOwnKeys": "Add your own keys",
  "setup.builderCredits":
    "Builder.io includes free credits, or use your own API key.",
  "setup.builderOrOwnKeys":
    "Use Builder.io (free credits), or add your own provider keys.",
  "setup.connectAi": "Connect AI",
  "setup.connectBuilder": "Connect Builder.io",
  "setup.connectPlaceholder": "Connect AI to start chatting...",
  "setup.connectToChat": "Connect AI to chat",
  "setup.connectToStart": "Connect AI to start chatting",
  "setup.connected": "Connected",
  "setup.connectedOrganization": "Connected — {{organization}}",
  "setup.connectedTo": "Connected to {{organization}}",
  "setup.freeCredits":
    "Free credits for LLM, hosting, and more — no API key needed",
  "setup.keyProvider": "API key provider",
  "setup.keySaveFailed": "Could not save the key.",
  "setup.storedSecurely": "Stored securely for this app only.",
  "share.add": "Add",
  "share.addPeopleEmail": "Add people by email",
  "share.addPeopleOrganization": "Add people from your organization",
  "share.admin": "Admin",
  "share.adminDescription": "Can edit and manage access",
  "share.commenter": "Commenter",
  "share.commenterDescription": "Can view and add comments",
  "share.advanced": "Advanced",
  "share.advancedAccess": "Advanced access",
  "share.advancedDescription":
    "Control how organization access appears in search.",
  "share.copied": "Copied",
  "share.copy": "Copy",
  "share.shareWithAgents": "Share with agents",
  "share.agentContext": "Agent context link",
  "share.agentContextDescription": "Read-only context for an external agent.",
  "share.preparingAgentLink": "Preparing agent link...",
  "share.agentLinkUnavailable": "Couldn't create the agent link.",
  "share.retryAgentLink": "Retry",
  "share.editor": "Editor",
  "share.editorDescription": "Can edit",
  "share.generalAccess": "General access",
  "share.hideInSearch": "Hide in search",
  "share.linkCanStillOpen": "People with the link can still open this.",
  "share.loading": "Loading...",
  "share.loadMore": "Load more",
  "share.loadFailed": "Couldn't load sharing settings.",
  "share.loadPeopleFailed": "Could not load people.",
  "share.noAccess": "No one has access yet.",
  "share.noMatches": "No matches.",
  "share.noPeopleFound": "No people found.",
  "share.notifyPeople": "Notify people",
  "share.message": "Message",
  "share.addMessage": "Add a message",
  "share.hideMessage": "Hide message",
  "share.messagePlaceholder": "Add a short note (optional)",
  "share.organization": "Organization",
  "share.organizationDescription": "Anyone in your organization can view",
  "share.owner": "Owner",
  "share.peopleWithAccess": "People with access",
  "share.private": "Private",
  "share.privateDescription": "Only people with access can view",
  "share.public": "Public",
  "share.publicDescription": "Anyone with the link can view",
  "share.remove": "Remove",
  "share.role": "Role",
  "share.searching": "Searching...",
  "share.share": "Share",
  "share.shareLink": "Share link",
  "share.shareOptions": "Share options",
  "share.titleWithResource": 'Share "{{title}}"',
  "share.titleWithType": "Share {{type}}",
  "share.triggerWithVisibility": "Share ({{visibility}})",
  "share.unknownPerson": "Unknown person",
  "share.viewer": "Viewer",
  "share.viewerDescription": "Can view",
  "share.userGroup": "User group",
  "status.resuming": "Resuming",
  "status.stillWorking": "Still working",
  "status.thinking": "Thinking",
  "status.working": "Working",
  "shell.chat": "Chat",
  "shell.loadingTerminal": "Loading terminal...",
  "shell.toggleAgent": "Toggle agent",
  "status.contactingModel": "Contacting model",
  "status.starting": "Starting {{activity}}...",
  "status.preparing": "Preparing {{activity}}...",
  "status.writing": "Writing {{activity}}...",
  "status.stillGenerating": "Still generating {{activity}}",
  "status.runningTool": "Running {{activity}}",
  "tabs.allChats": "All chats",
  "tabs.closeTab": "Close tab",
  "tabs.main": "Main",
  "tabs.newChat": "New chat",
  "tabs.subAgent": "Sub-agent...",
  "tool.askedAgent": "Asked {{agent}}",
  "tool.askingAgent": "Asking {{agent}}...",
  "tool.elapsed": "{{duration}} elapsed",
  "tool.askingAgentFailed": "Error asking {{agent}}",
  "tool.input": "Input",
  "tool.inputWithLabel": "Input - {{label}}",
  "tool.interrupted":
    "Interrupted before this finished reporting — it may or may not have completed. Check before retrying.",
  "tool.longRunning": "Still working. Large updates can take a minute or two.",
  "tool.ranTools": "Ran {{count}} tools",
  "tool.ranTools_one": "Ran {{count}} tool",
  "tool.ranTools_other": "Ran {{count}} tools",
  "tool.rawOutput": "Raw {{tool}} tool call output",
  "tool.repeated": "Repeated {{count}} times",
  "tool.result": "Result",
  "tool.subAgentTask": "Sub-agent task",
  "thinking.collapsed": "Collapsed",
  "thinking.display": "Thinking",
  "thinking.expanded": "Expanded",
  "thinking.hidden": "Hidden",
  "tool.thought": "Thought",
  "tool.thoughtFor": "Thought for {{duration}}",
  "tool.viewOutput": "View {{tool}} output",
  "tool.worked": "Worked",
  "tool.workedFor": "Worked for {{duration}}",
  "widget.chart": "Chart",
  "widget.dataChart": "Data chart",
  "widget.dataInsights": "Data insights",
  "widget.dataTable": "Data table",
  "widget.downloadCsv": "Download CSV",
  "widget.connectProvider": "Connect {{provider}}",
  "widget.loadingToolResult": "Loading tool result",
  "widget.noRows": "No rows",
  "widget.points": "{{formattedCount}} points",
  "widget.points_one": "{{formattedCount}} point",
  "widget.points_other": "{{formattedCount}} points",
  "widget.rows": "{{formattedCount}} rows",
  "widget.rows_one": "{{formattedCount}} row",
  "widget.rows_other": "{{formattedCount}} rows",
  "widget.sampled": "sampled",
  "settings.emailTitle": "Email",
  "settings.emailChange": "Change email",
  "settings.emailChanging": "Sending...",
  "settings.emailChangeSent":
    "Check your email for instructions to confirm this change.",
  "settings.emailChangeError": "Could not send confirmation.",
  "settings.emailNewLabel": "New email",
  "settings.emailNewPlaceholder": "Enter new email",
  "usage.builderCredits": "Builder credits",
  "usage.inviteFriends": "Invite friends",
  "usage.inviteCredits":
    "Earn {{amount}} Builder credits when a friend subscribes.",
  "usage.copyInviteLink": "Copy invite link",
  "usage.inviteLinkCopied": "Invite link copied",
  "usage.creditBalance": "Workspace balance",
  "usage.monthlyPlan": "Monthly plan",
  "usage.dailyFreeLimit": "Free daily limit",
  "usage.creditUsedOfLimit": "{{used}} of {{limit}} used",
  "usage.creditRemaining": "{{amount}} remaining",
  "usage.creditUsageUnavailable": "Builder credit usage couldn’t be loaded.",
  "usage.estimatedBuilderCredits": "~{{amount}} estimated credits",
  "usage.otherUsdSpend": "{{amount}} other USD",
  "usage.noBuilderCredits": "0 Builder credits",
  "usage.otherUnclassifiedSpend": "Other or unclassified USD spend",
  "usage.providerSpendDetail":
    "Provider or older calls outside Builder billing",
  "usage.providerSpendToday": "Other or unclassified usage: {{amount}} today",
  "usage.driverCreditsAndUsd": "Builder credits / USD",
  "settings.usage.tabsLabel": "Usage views",
  "settings.usage.tabOverview": "Overview",
  "settings.usage.tabActivity": "Activity",
  "settings.usage.rangeLabel": "Date range",
  "settings.usage.range7": "Last 7 days",
  "settings.usage.range30": "Last 30 days",
  "settings.usage.range90": "Last 90 days",
  "settings.usage.appFilterLabel": "App",
  "settings.usage.allApps": "All apps",
  "settings.usage.unattributedApp": "Unattributed",
  "settings.usage.peopleFilterLabel": "People",
  "settings.usage.everyone": "Everyone",
  "settings.usage.justYou": "Just you",
  "settings.usage.estimatedSpend": "Estimated spend",
  "settings.usage.creditSpend": "Builder.io credit spend",
  "settings.usage.yourEstimatedSpend": "Your estimated spend",
  "settings.usage.yourCreditSpend": "Your Builder.io credit spend",
  "settings.usage.calls": "Calls",
  "settings.usage.tokens": "Tokens",
  "settings.usage.activePeople": "Active people",
  "settings.usage.history": "Usage history",
  "settings.usage.historyDimensionLabel": "Group usage history",
  "settings.usage.byFeature": "By feature",
  "settings.usage.byApp": "By app",
  "settings.usage.byModel": "By model",
  "settings.usage.bySurface": "By surface",
  "settings.usage.historyChartLabel": "Daily usage",
  "settings.usage.noUsage": "No usage in this period.",
  "settings.usage.total": "Total",
  "settings.usage.featureChat": "Chat",
  "settings.usage.featureSubAgents": "Sub-agents",
  "settings.usage.featureAutomations": "Automations",
  "settings.usage.other": "Other",
  "settings.usage.unknownModel": "Unknown model",
  "settings.usage.surfaceApp": "In app",
  "settings.usage.topChats": "Top chats",
  "settings.usage.untitledChat": "Untitled chat",
  "settings.usage.titleUnavailable": "Title couldn't be loaded",
  "settings.usage.showAll": "Show all",
  "settings.usage.showLess": "Show less",
  "settings.usage.topPeople": "Top people",
  "settings.usage.you": "You",
  "settings.usage.toolCalls": "Tool calls",
  "settings.usage.toolCallsChartLabel": "Tool calls per day",
  "settings.usage.noToolCalls": "No tool calls in this period.",
  "settings.usage.toolCallsUnavailable": "Tool calls couldn't be loaded.",
  "settings.usage.modelCalls": "Model calls",
  "settings.usage.modelCallsDimensionLabel": "Group model calls",
  "settings.usage.modelCallsChartLabel": "Model calls per day",
  "settings.usage.noModelCalls": "No model calls in this period.",
  "settings.usage.recentPrompts": "Recent prompts",
  "settings.usage.promptNotCaptured": "Prompt not captured",
  "settings.usage.promptUnavailable": "Prompt couldn't be loaded",
  "settings.usage.loadError": "Usage couldn't be loaded.",
  "settings.usage.yourAlerts": "Your alerts",
  "settings.usage.alertsLoadError": "Alerts couldn't be loaded.",
  "settings.usage.alertDailySpend": "Daily spend",
  "settings.usage.alertMonthlySpend": "Monthly spend",
  "settings.usage.alertDailyTokens": "Daily tokens",
  "settings.usage.alertMonthlyTokens": "Monthly tokens",
  "settings.usage.alertOnTrack": "On track",
  "settings.usage.alertOverLimit": "Over limit",
  "settings.usage.alertDismissed": "Dismissed",
  "settings.usage.alertOff": "Off",
  "settings.usage.alertProgressDay": "{{current}} of {{limit}} today",
  "settings.usage.alertProgressMonth": "{{current}} of {{limit}} this month",
  "settings.usage.alertChannelsBoth": "In app and email",
  "settings.usage.alertChannelInApp": "In app",
  "settings.usage.alertChannelEmail": "Email",
  "settings.usage.alertDefault": "Default",
  "settings.usage.alertEdit": "Edit",
  "settings.usage.alertDialogTitle": "{{name}} alert",
  "settings.usage.alertThreshold": "Alert me at",
  "settings.usage.alertHintDayAll": "Per day, across all apps.",
  "settings.usage.alertHintMonthAll": "Per month, across all apps.",
  "settings.usage.alertHintDayApp": "Per day, in {{app}}.",
  "settings.usage.alertHintMonthApp": "Per month, in {{app}}.",
  "settings.usage.alertNotify": "Notify",
  "settings.usage.alertEnabled": "Alert on",
  "settings.usage.alertReset": "Reset to default",
  "settings.usage.alertInvalidLimit": "Enter an amount greater than zero.",
  "settings.usage.alertNoChannel": "Choose at least one way to be notified.",
  "settings.usage.alertSaveError": "The alert couldn't be saved.",
  "settings.usage.unitUsd": "USD",
  "settings.usage.unitCredits": "credits",
  "settings.usage.unitTokens": "tokens",
  "settings.usage.creditAmount_one": "{{amount}} credit",
  "settings.usage.creditAmount_other": "{{amount}} credits",
  "settings.usage.tokenAmount_one": "{{amount}} token",
  "settings.usage.tokenAmount_other": "{{amount}} tokens",
  "settings.storage.provider": "Provider",
  "settings.storage.providerOther": "Other S3-compatible",
  "settings.storage.endpoint": "Endpoint URL",
  "settings.storage.bucket": "Bucket",
  "settings.storage.accessKeyId": "Access key ID",
  "settings.storage.secretAccessKey": "Secret access key",
  "settings.storage.region": "Region",
  "settings.storage.publicUrl": "Public URL",
  "settings.storage.optional": "Optional",
  "settings.storage.saved": "Saved",
  "settings.storage.hintAws": "Use your bucket's region endpoint.",
  "settings.storage.hintR2": "Find it in your R2 bucket's settings.",
  "settings.storage.hintSupabase":
    "Find it in your project's Storage settings.",
  "settings.storage.hintOther":
    "MinIO, Backblaze B2, Wasabi, and DigitalOcean Spaces work too.",
  "settings.storage.save": "Save",
  "settings.storage.saving": "Saving…",
  "settings.storage.cancel": "Cancel",
  "settings.storage.clear": "Clear credentials",
  "settings.storage.clearing": "Clearing…",
  "settings.storage.clearTitle": "Clear storage credentials?",
  "settings.storage.clearBuilder": "New uploads go to Builder.io storage.",
  "settings.storage.clearNoFallback":
    "Uploads fail until you set up storage again.",
  "settings.storage.clearExisting": "Existing files stay in {{bucket}}.",
  "settings.storage.clearExistingGeneric":
    "Existing files stay in your bucket.",
  "settings.storage.invalidUrl":
    "Use a URL that starts with https:// or http://.",
  "settings.storage.invalidBucket":
    "Bucket names use letters, numbers, dots, dashes, and underscores.",
  "settings.storage.savedNotice":
    "File storage saved. New uploads go to {{bucket}}.",
  "settings.storage.cleared": "Storage credentials cleared.",
  "settings.storage.clearedBuilder":
    "Storage credentials cleared. New uploads go to Builder.io.",
  "settings.storage.saveFailed": "Could not save file storage.",
  "settings.storage.clearFailed": "Could not clear storage credentials.",
  "settings.storage.loadFailed": "Could not load file storage settings.",
  "settings.storage.retry": "Retry",
  "settings.storage.adminOnly":
    "Only organization owners and admins can change file storage.",
  "settings.audit.action": "Action",
  "settings.audit.allApps": "All apps",
  "settings.audit.app": "App",
  "settings.audit.changedBy": "Changed by",
  "settings.audit.close": "Close",
  "settings.audit.empty": "No changes in this period.",
  "settings.audit.emptyDescription":
    "Changes people and the agent make appear here.",
  "settings.audit.failed": "Failed",
  "settings.audit.input": "Input",
  "settings.audit.inputLoadFailed": "Could not load the input.",
  "settings.audit.last30Days": "Last 30 days",
  "settings.audit.last7Days": "Last 7 days",
  "settings.audit.last90Days": "Last 90 days",
  "settings.audit.loadFailed": "Could not load the audit log.",
  "settings.audit.loading": "Loading audit log",
  "settings.audit.onBehalfOf": "On behalf of",
  "settings.audit.range": "Time range",
  "settings.audit.refused": "Refused",
  "settings.audit.result": "Result",
  "settings.audit.showMore": "Show {{count}} more",
  "settings.audit.succeeded": "Succeeded",
  "settings.audit.system": "System",
  "settings.audit.target": "Target",
  "settings.audit.when": "When",
  "accountMenu.label": "Account",
  "accountMenu.loading": "Loading account",
  "accountMenu.triggerLabel": "{{name}}, {{organization}}",
  "accountMenu.triggerLabelDemo": "{{name}}, {{organization}}, Demo mode",
  "accountMenu.personal": "Personal",
  "accountMenu.demoMode": "Demo mode",
  "accountMenu.demoModeOn": "Demo mode is on",
  "accountMenu.demoModeDescription":
    "Displayed emails and supported charts are adjusted for presentations. Your account and permissions are unchanged.",
  "accountMenu.turnOffDemoMode": "Turn off demo mode",
  "accountMenu.invitations": "Invitations",
  "accountMenu.joinYourTeam": "Join your team",
  "accountMenu.join": "Join",
  "accountMenu.yourWorkspace": "Your workspace",
  "accountMenu.createOrganization": "Create organization",
  "accountMenu.organizationName": "Organization name",
  "accountMenu.create": "Create",
  "accountMenu.usage": "Usage",
  "accountMenu.getApps": "Get apps and extensions",
  "accountMenu.back": "Back",
  "settingsOrg.general.organization": "Organization",
  "settingsOrg.general.name": "Name",
  "settingsOrg.general.nameLocked": "Owners and admins can change the name.",
  "settingsOrg.general.membership": "Membership",
  "settingsOrg.general.yourRole": "Your role",
  "settingsOrg.general.deleteDescription":
    "Permanently deletes {{name}}, its members, and its data.",
  "settingsOrg.members.removeTitle": "Remove {{name}}?",
  "settingsOrg.members.removeDescription":
    "They lose access to {{org}}. What they own moves to the person you choose.",
  "settingsOrg.members.roleFor": "Role for {{name}}",
  "settingsOrg.members.moreActions": "More actions for {{name}}",
  "settingsOrg.members.removing": "Removing…",
  "settingsOrg.members.groupsEmpty":
    "Group members to manage app access together.",
  "settingsOrg.auth.signIn": "Sign-in",
  "settingsOrg.auth.joining": "Joining",
  "settingsOrg.auth.betweenApps": "Between apps",
  "settingsOrg.auth.methodsEmailOnly": "Email and password.",
  "settingsOrg.auth.methodsEmailAndOne": "Email and password, and {{method}}.",
  "settingsOrg.auth.methodsEmailAndTwo":
    "Email and password, {{first}}, and {{second}}.",
  "settingsOrg.auth.emailPassword": "Email and password",
  "settingsOrg.auth.emailPasswordNote": "On for every deployment.",
  "settingsOrg.auth.methodConfigured": "Set on your host with these variables.",
  "settingsOrg.auth.methodNotConfigured":
    "Not set up. Add these variables on your host, then redeploy.",
  "settingsOrg.auth.methodOn": "On",
  "settingsOrg.auth.methodOff": "Off",
  "settingsOrg.auth.requireHint":
    "To require one of these for everyone in {{org}}, use Organization sign-in.",
  "settingsOrg.auth.view": "View",
  "settingsOrg.auth.close": "Close",
  "settingsOrg.apps.access": "Access",
  "settingsOrg.apps.browse": "Browse apps",
  "settingsOrg.apps.defaults": "Defaults",
  "settingsOrg.search.domainAutoJoin": "Email domain auto-join",
  "settingsOrg.search.roles": "Member roles",
  "settingsOrg.learnMore": "Learn more",
  "settingsOrg.moreInformation": "More information",
  "settingsOrg.general.workspaceUrl": "Workspace URL",
  "settingsOrg.general.workspaceUrlDescription":
    "Send members to this workspace from another deployment.",
  "settingsOrg.general.workspaceUrlHelp":
    "Members who land on another deployment go to this workspace instead of an empty app.",
  "settingsOrg.general.editWorkspaceUrl": "Edit workspace URL",
  "settingsOrg.general.removeWorkspaceUrl": "Remove workspace URL",
  "settingsOrg.general.setWorkspaceUrl": "Set URL",
  "settingsOrg.auth.domainDescription":
    "Add people with a @{{domain}} email automatically.",
  "settingsOrg.auth.domainDescriptionNoDomain":
    "Add people with your work email domain automatically.",
  "settingsOrg.auth.domainHelp":
    "Anyone who signs up with an email at this domain joins the organization. Only your own email domain can be used, and free email providers aren't allowed.",
  "settingsOrg.auth.editDomain": "Edit domain",
  "settingsOrg.auth.removeDomain": "Remove domain",
  "settingsOrg.auth.sharedSecret": "Shared secret",
  "settingsOrg.auth.sharedSecretSet":
    "Set. Lets the apps in this workspace verify each other.",
  "settingsOrg.auth.sharedSecretNotSet":
    "Not set. Lets the apps in this workspace verify each other.",
  "settingsOrg.auth.secretNotSetValue": "Not set",
  "settingsOrg.auth.manage": "Manage",
  "settingsOrg.auth.reveal": "Reveal",
  "settingsOrg.auth.hide": "Hide",
  "settingsOrg.auth.regenerate": "Regenerate",
  "settingsOrg.auth.syncToApps": "Sync to apps",
  "settingsOrg.auth.pasteSecret": "Paste secret",
  "settingsOrg.auth.pasteSecretLabel": "Paste a shared secret",
  "settingsOrg.auth.syncing": "Syncing to apps…",
  "settingsOrg.auth.syncErrorStatus": "HTTP {{status}}",
  "settingsOrg.invite.emails": "Email addresses",
  "settingsOrg.invite.emailPlaceholder": "name@company.com",
  "settingsOrg.invite.note":
    "Each person signs in with this exact email to accept.",
  "settingsOrg.invite.noteNoEmail":
    "Invites won't be emailed, so ask each person to sign in with this exact email.",
  "settingsOrg.invite.role": "Role",
  "settingsOrg.invite.member": "Member",
  "settingsOrg.invite.admin": "Admin",
  "settingsOrg.invite.ownerOnlyAdmin":
    "Only the organization owner can invite admins.",
  "settingsOrg.invite.removeRow": "Remove",
  "settingsOrg.invite.addAnother": "Add another",
  "settingsOrg.invite.pasteMany": "Paste many",
  "settingsOrg.invite.importCsv": "Import CSV",
  "settingsOrg.invite.pasteLabel":
    "Paste emails separated by commas, spaces, or new lines.",
  "settingsOrg.invite.addAsMembers": "Add as members",
  "settingsOrg.invite.addAsAdmins": "Add as admins",
  "settingsOrg.invite.add": "Add",
  "settingsOrg.invite.send": "Send invites",
  "settingsOrg.invite.sending": "Sending…",
  "settingsOrg.invite.csvNoEmails": "No valid emails found in this CSV.",
  "settingsOrg.auth.synced_one": "Synced to {{count}} app.",
  "settingsOrg.auth.synced_other": "Synced to {{count}} apps.",
  "settingsOrg.auth.syncedPartial_one":
    "Synced to {{succeeded}} of {{count}} app. {{failed}} failed.",
  "settingsOrg.auth.syncedPartial_other":
    "Synced to {{succeeded}} of {{count}} apps. {{failed}} failed.",
  "settingsOrg.invite.sent_one": "Sent {{count}} invite.",
  "settingsOrg.invite.sent_other": "Sent {{count}} invites.",
  "settingsOrg.invite.saved_one":
    "Saved {{count}} invite. They'll see it when they sign in.",
  "settingsOrg.invite.saved_other":
    "Saved {{count}} invites. They'll see them when they sign in.",
  "settingsShell.account.addPassword": "Add password",
  "settingsShell.account.authenticatorCode": "Authenticator code",
  "settingsShell.account.change": "Change",
  "settingsShell.account.changeEmail": "Change email",
  "settingsShell.account.changePassword": "Change password",
  "settingsShell.account.confirmPassword": "Confirm new password",
  "settingsShell.account.currentPassword": "Current password",
  "settingsShell.account.deletionDialogDescription":
    "This sends a deletion request to an administrator. Your data stays until they review it.",
  "settingsShell.account.done": "Done",
  "settingsShell.account.email": "Email",
  "settingsShell.account.emailChangeError": "Could not send confirmation.",
  "settingsShell.account.emailChangeSent":
    "Check your email for instructions to confirm this change.",
  "settingsShell.account.languageAndRegion": "Language and region",
  "settingsShell.account.languageDescription": "Applies on all your devices.",
  "settingsShell.account.manage": "Manage",
  "settingsShell.account.name": "Name",
  "settingsShell.account.nameDescription":
    "Used when referring to you across Agent-Native apps.",
  "settingsShell.account.namePlaceholder": "Your name",
  "settingsShell.account.nameSaveError": "Could not update your name.",
  "settingsShell.account.nameSaved": "Name updated",
  "settingsShell.account.newEmail": "New email",
  "settingsShell.account.newPassword": "New password",
  "settingsShell.account.password": "Password",
  "settingsShell.account.passwordDescription":
    "Add a password for an alternative way to sign in to your account.",
  "settingsShell.account.passwordLoadError":
    "Could not load your sign-in methods.",
  "settingsShell.account.passwordMinLength":
    "Choose a password with at least {{count}} characters.",
  "settingsShell.account.passwordMismatch": "Passwords do not match.",
  "settingsShell.account.passwordSaveError": "Could not update password.",
  "settingsShell.account.passwordSaved": "Password updated",
  "settingsShell.account.photoError": "Could not update photo.",
  "settingsShell.account.photoUpdated": "Photo updated",
  "settingsShell.account.profilePhoto": "Profile photo",
  "settingsShell.account.requestCopyDescription":
    "An administrator verifies your identity and follows up.",
  "settingsShell.account.requestCopyLabel": "Request a copy of your data",
  "settingsShell.account.requestDeletionDescription":
    "Your data stays until an administrator completes the request.",
  "settingsShell.account.requestDeletionLabel": "Request data deletion",
  "settingsShell.account.savePassword": "Save password",
  "settingsShell.account.sendConfirmation": "Send confirmation",
  "settingsShell.account.sending": "Sending...",
  "settingsShell.account.setUpTwoFactor": "Set up two-factor",
  "settingsShell.account.settingUp": "Setting up...",
  "settingsShell.account.signIn": "Sign-in",
  "settingsShell.account.timezone": "Timezone",
  "settingsShell.account.timezoneDescription":
    "Used for timestamps and scheduled automations.",
  "settingsShell.account.turnOffTwoFactor": "Turn off two-factor",
  "settingsShell.account.turningOff": "Turning off...",
  "settingsShell.account.twoFactor": "Two-factor authentication",
  "settingsShell.account.twoFactorBackupCodes":
    "Save these backup codes somewhere safe. Each one can be used once if you lose access to your authenticator.",
  "settingsShell.account.twoFactorCodeError":
    "Enter the six-digit code from your authenticator app.",
  "settingsShell.account.twoFactorDescription":
    "Use an authenticator app to add a second sign-in step to your account.",
  "settingsShell.account.twoFactorDisableError":
    "Could not turn off two-factor authentication.",
  "settingsShell.account.twoFactorEnabled": "Two-factor authentication is on.",
  "settingsShell.account.twoFactorLoadError":
    "Could not load two-factor settings.",
  "settingsShell.account.twoFactorQrLabel": "Two-factor setup QR code",
  "settingsShell.account.twoFactorSaved": "Two-factor authentication enabled",
  "settingsShell.account.twoFactorScan":
    "Scan this QR code with your authenticator app, then enter the code it gives you.",
  "settingsShell.account.twoFactorSetupError":
    "Could not update two-factor settings.",
  "settingsShell.account.twoFactorSetupTitle":
    "Set up two-factor authentication",
  "settingsShell.account.uploading": "Uploading...",
  "settingsShell.account.verifyAndEnable": "Verify and enable",
  "settingsShell.account.verifying": "Verifying...",
  "settingsShell.account.voiceBatch": "Batch",
  "settingsShell.account.voiceDescription":
    "Choose how voice input is transcribed.",
  "settingsShell.account.voiceGoogleRealtime": "Google Realtime",
  "settingsShell.account.voiceInput": "Voice input",
  "settingsShell.account.voiceLoadError":
    "Could not load your voice transcription setting.",
  "settingsShell.account.voiceMacNative": "Mac Native",
  "settingsShell.account.voiceSaveError":
    "Could not save your voice transcription setting.",
  "settingsShell.account.yourData": "Your data",
  "settingsShell.appFallbackName": "App",
  "settingsShell.appGroup.adminOnly": "Only owners and admins can change this",
  "settingsShell.appGroup.automationsCreateTitle":
    "What should happen, and when?",
  "settingsShell.appGroup.defaultModel": "Default model",
  "settingsShell.appGroup.defaultModelDescription":
    "Used for new agent chats in {{app}}. The default is {{model}}.",
  "settingsShell.appGroup.defaultModelDescriptionUnset":
    "Used for new agent chats in {{app}}.",
  "settingsShell.appGroup.defaultModelLoadError":
    "Couldn't load the default model.",
  "settingsShell.appGroup.defaultModelSaveError":
    "Couldn't save the default model. Try again.",
  "settingsShell.appGroup.demoMode": "Demo mode",
  "settingsShell.appGroup.demoModeDescription":
    "Use sample data in this browser for presentations.",
  "settingsShell.appGroup.labsFootnote":
    "These new, unstable features may have bugs.",
  "settingsShell.appGroup.labsLoadError": "Couldn't load your labs.",
  "settingsShell.appGroup.labsSaveError": "Couldn't change {{lab}}. Try again.",
  "settingsShell.appGroup.mcpAbout":
    "Connect {{app}} to Claude, ChatGPT, Cursor, or any AI app that supports MCP. That app can then work in {{app}} for you. It sees only what you can see.",
  "settingsShell.appGroup.mcpFootnote":
    "For tools the agent itself uses, see {{integrations}}.",
  "settingsShell.appGroup.newAutomation": "New automation",
  "settingsShell.appGroup.retry": "Retry",
  "settingsShell.appGroup.thisBrowser": "This browser",
  "settingsShell.appGroup.useDefault": "Use the default",
  "settingsShell.appGroup.whatsNewChip":
    "Updates to {{app}}. Each app has its own changelog.",
  "settingsShell.appGroup.whatsNewEmpty": "No updates yet.",
  "settingsShell.appGroup.whatsNewShowFewer": "Show fewer updates",
  "settingsShell.appGroup.whatsNewViewAll": "View all updates",
  "settingsShell.backToApp": "Back to {{app}}",
  "settingsShell.breadcrumbLabel": "Breadcrumb",
  "settingsShell.builder.connect": "Connect",
  "settingsShell.builder.connected": "Connected",
  "settingsShell.builder.connectedTo": "Connected · {{space}}",
  "settingsShell.builder.connection": "Connection",
  "settingsShell.builder.disconnect": "Disconnect",
  "settingsShell.builder.disconnecting": "Disconnecting…",
  "settingsShell.builder.disconnectBody":
    "This affects everyone in {{org}} who hasn't connected their own account.",
  "settingsShell.builder.disconnectFailed": "Couldn't disconnect Builder.io.",
  "settingsShell.builder.disconnectTitle": "Disconnect Builder.io?",
  "settingsShell.builder.grantsFailed":
    "Couldn't read the Builder.io connections.",
  "settingsShell.builder.loss.defaultStops":
    "Chats stop until you add an organization provider.",
  "settingsShell.builder.loss.defaultSwitches":
    "The default model switches to {{next}}.",
  "settingsShell.builder.loss.modelPicker":
    "Builder.io models leave the model picker.",
  "settingsShell.builder.loss.serviceStops":
    "Stops until another provider is set up.",
  "settingsShell.builder.loss.stops": "Stops working.",
  "settingsShell.builder.loss.uploadsFail":
    "Uploads fail until you set up storage.",
  "settingsShell.builder.manage": "Manage",
  "settingsShell.builder.needsReconnect": "Needs to be reconnected.",
  "settingsShell.builder.orgFallback": "your organization",
  "settingsShell.builder.orgNotConnectedAdmin":
    "Not connected. When you connect it, everyone in {{org}} can use it.",
  "settingsShell.builder.orgNotConnectedMember":
    "Not connected. An owner or admin can connect it.",
  "settingsShell.builder.organization": "Organization",
  "settingsShell.builder.personal": "Personal",
  "settingsShell.builder.personalConnected": "Connected. Only you use it.",
  "settingsShell.builder.personalConnectedOverOrg":
    "Connected. Only you use it, instead of the organization's connection.",
  "settingsShell.builder.personalConnectedTo":
    "Connected · {{space}}. Only you use it.",
  "settingsShell.builder.personalConnectedToOverOrg":
    "Connected · {{space}}. Only you use it, instead of the organization's connection.",
  "settingsShell.builder.personalNotConnected":
    "Connect your own account. Only you use it.",
  "settingsShell.builder.personalRestricted":
    "Owners and admins restricted personal API keys.",
  "settingsShell.builder.personalRestrictedUnused":
    "Not used while personal API keys are restricted.",
  "settingsShell.builder.reconnect": "Reconnect",
  "settingsShell.builder.retry": "Retry",
  "settingsShell.builder.use.aiModel": "AI model",
  "settingsShell.builder.use.aiModelDefaultNote":
    "The default model, {{model}}.",
  "settingsShell.builder.use.aiModelNote":
    "Builder.io models are in the model picker.",
  "settingsShell.builder.use.backgroundAgentsNote":
    "Makes code changes from production.",
  "settingsShell.builder.use.browserAutomationNote":
    "Lets the agent use a browser in production.",
  "settingsShell.builder.use.designSystem": "Design system intelligence",
  "settingsShell.builder.use.designSystemNote":
    "Keeps generated slides and designs on brand.",
  "settingsShell.builder.use.embeddings": "Embeddings",
  "settingsShell.builder.use.embeddingsNote": "Search in Brain.",
  "settingsShell.builder.use.fileStorageNote":
    "New uploads are stored on Builder.io.",
  "settingsShell.builder.use.images": "Image generation",
  "settingsShell.builder.use.imagesNote": "Slides and Design.",
  "settingsShell.builder.use.voice": "Voice input",
  "settingsShell.builder.use.voiceNote": "Dictation in every app.",
  "settingsShell.builder.usedFor": "Used for",
  "settingsShell.builder.usedForFootnote":
    "Choose what runs on Builder.io in {{link}}.",
  "settingsShell.builder.usedForLoadFailed":
    "Couldn't check which services run on Builder.io.",
  "settingsShell.builder.whatHappens": "What happens",
  "settingsShell.channels.about.discord":
    "Run the agent from Discord slash commands.",
  "settingsShell.channels.about.email":
    "Email the agent, and it replies in the same thread.",
  "settingsShell.channels.about.googleDocs":
    "Tag the agent in Google Doc comments to get responses.",
  "settingsShell.channels.about.microsoftTeams":
    "Mention the agent in Microsoft Teams, and it replies in that conversation.",
  "settingsShell.channels.about.page":
    "Where people can message the {{app}} agent. Each app's agent is set up separately.",
  "settingsShell.channels.about.slack":
    "@mention the agent in a thread or DM it, and it replies in that thread.",
  "settingsShell.channels.about.telegram":
    "Chat with your agent via a Telegram bot.",
  "settingsShell.channels.about.whatsapp":
    "Connect your agent to WhatsApp Business.",
  "settingsShell.channels.action.manage": "Manage",
  "settingsShell.channels.action.manageAria": "Manage {{platform}}",
  "settingsShell.channels.action.setUp": "Set up",
  "settingsShell.channels.action.setUpAria": "Set up {{platform}}",
  "settingsShell.channels.action.view": "View",
  "settingsShell.channels.action.viewAria": "View {{platform}}",
  "settingsShell.channels.agentIn": "Agent in {{platform}}",
  "settingsShell.channels.connection": "Connection",
  "settingsShell.channels.copyServiceAccountEmail":
    "Copy service account email",
  "settingsShell.channels.copyWebhookUrl": "Copy webhook URL",
  "settingsShell.channels.credentials": "Credentials",
  "settingsShell.channels.developerSite": "Developer site",
  "settingsShell.channels.documentation": "Documentation",
  "settingsShell.channels.empty": "No channels are available in {{app}}.",
  "settingsShell.channels.information": "Information",
  "settingsShell.channels.loadFailed": "Couldn't load channels.",
  "settingsShell.channels.membersFootnote":
    "Only owners and admins can set up channels.",
  "settingsShell.channels.notFound": "This channel isn't available in {{app}}.",
  "settingsShell.channels.open": "Open",
  "settingsShell.channels.openDocs": "Open docs",
  "settingsShell.channels.registerWebhook": "Register",
  "settingsShell.channels.removeCredentials.action": "Remove",
  "settingsShell.channels.removeCredentials.aria":
    "Remove {{platform}} credentials",
  "settingsShell.channels.removeCredentials.body":
    "The agent stops replying in {{platform}} for everyone, unless the deployment environment also sets these keys.",
  "settingsShell.channels.removeCredentials.confirm": "Remove",
  "settingsShell.channels.removeCredentials.failed":
    "Couldn't remove the credentials.",
  "settingsShell.channels.removeCredentials.removing": "Removing…",
  "settingsShell.channels.removeCredentials.title":
    "Remove {{platform}} credentials?",
  "settingsShell.channels.retry": "Retry",
  "settingsShell.channels.setup.addToEnvironment":
    "Add this to the deployment environment",
  "settingsShell.channels.setup.body":
    "Add these to this deployment, then turn it on.",
  "settingsShell.channels.setup.close": "Close",
  "settingsShell.channels.setup.failed": "Couldn't save the variables.",
  "settingsShell.channels.setup.optional": "Optional",
  "settingsShell.channels.setup.replace": "Replace",
  "settingsShell.channels.setup.replaceAria": "Replace {{key}}",
  "settingsShell.channels.setup.save": "Save",
  "settingsShell.channels.setup.saveAndTurnOn": "Save and turn on",
  "settingsShell.channels.setup.saving": "Saving…",
  "settingsShell.channels.setup.saved": "Saved",
  "settingsShell.channels.setup.savedElsewhere": "Saved outside Channels",
  "settingsShell.channels.setup.setInEnvironment":
    "Set in the deployment environment",
  "settingsShell.channels.setup.stillMissing":
    "Some required variables are still missing.",
  "settingsShell.channels.setup.title": "Set up {{platform}}",
  "settingsShell.channels.shareDocumentsWith": "Share documents with",
  "settingsShell.channels.state.notSetUp": "Not set up",
  "settingsShell.channels.state.off": "Off",
  "settingsShell.channels.state.on": "On",
  "settingsShell.channels.status": "Status",
  "settingsShell.channels.toggleFailed": "Couldn't update {{platform}}.",
  "settingsShell.channels.turnOnAria": "Turn on {{platform}}",
  "settingsShell.channels.unavailable":
    "{{platform}} isn't available in {{app}}.",
  "settingsShell.channels.webhookLocalOnly":
    "{{platform}} can't reach this address. Open this page from the app's public HTTPS address to get a webhook URL.",
  "settingsShell.channels.webhookRegistered": "Registered",
  "settingsShell.channels.webhookRegistration": "Webhook",
  "settingsShell.channels.webhookUrl": "Webhook URL",
  "settingsShell.channels.category": "Category",
  "settingsShell.channels.developer": "Developer",
  "settingsShell.channels.mentionAgent": "Mention the agent",
  "settingsShell.channels.rowDescription": "{{about}} {{state}}.",
  "settingsShell.channels.separately": "Each app's agent is set up separately.",
  "settingsShell.channels.setUpLocked":
    "Only owners and admins can set this up",
  "settingsShell.integrationDetail.access.none":
    "It's a public server, so there's nothing to sign in to.",
  "settingsShell.integrationDetail.access.oauth":
    "The agent acts with your {{name}} permissions, so it only sees what you can see.",
  "settingsShell.integrationDetail.access.token":
    "The agent uses the access token you add, so it sees what that token can see.",
  "settingsShell.integrationDetail.accessToken": "Access token",
  "settingsShell.integrationDetail.addAccessToken": "Add access token",
  "settingsShell.integrationDetail.callout.adminNeeded":
    "An admin needs to set this up",
  "settingsShell.integrationDetail.callout.adminNeededBody":
    "Ask an owner or admin in {{org}} to add {{name}}'s client ID and secret. Then you can connect your own account.",
  "settingsShell.integrationDetail.callout.beforeAnyone":
    "Before anyone can connect",
  "settingsShell.integrationDetail.callout.beforeYouConnect":
    "Before you connect",
  "settingsShell.integrationDetail.callout.token":
    "Connects with an access token",
  "settingsShell.integrationDetail.callout.unavailable": "Not available yet",
  "settingsShell.integrationDetail.category": "Category",
  "settingsShell.integrationDetail.connected": "{{name}} connected",
  "settingsShell.integrationDetail.copyServerUrl": "Copy server URL",
  "settingsShell.integrationDetail.developer": "Developer",
  "settingsShell.integrationDetail.howToCreateToken": "How to create a token",
  "settingsShell.integrationDetail.justMe": "Just me",
  "settingsShell.integrationDetail.notFound":
    "This integration isn't in the catalog.",
  "settingsShell.integrationDetail.notFoundTitle": "Not found",
  "settingsShell.integrationDetail.prompt.amplitude.1":
    "How did weekly active users trend this month?",
  "settingsShell.integrationDetail.prompt.amplitude.2":
    "Build a funnel from signup to first recording",
  "settingsShell.integrationDetail.prompt.amplitude.3":
    "Which cohorts retain best?",
  "settingsShell.integrationDetail.prompt.apollo.1":
    "Find heads of design at Series B startups",
  "settingsShell.integrationDetail.prompt.apollo.2":
    "Enrich this list of emails",
  "settingsShell.integrationDetail.prompt.apollo.3":
    "Add these contacts to the Q4 sequence",
  "settingsShell.integrationDetail.prompt.asana.1":
    "What's due for me this week?",
  "settingsShell.integrationDetail.prompt.asana.2":
    "Create tasks from this recording's action items",
  "settingsShell.integrationDetail.prompt.asana.3":
    "Which projects are behind schedule?",
  "settingsShell.integrationDetail.prompt.atlassian.1":
    "Create a Jira ticket from this recording's action items",
  "settingsShell.integrationDetail.prompt.atlassian.2":
    "What's blocking the Q4 release?",
  "settingsShell.integrationDetail.prompt.atlassian.3":
    "Find the Confluence page about onboarding",
  "settingsShell.integrationDetail.prompt.box.1":
    "Find the signed contract for Acme",
  "settingsShell.integrationDetail.prompt.box.2":
    "Share the Q3 report folder with finance",
  "settingsShell.integrationDetail.prompt.box.3":
    "What changed in the legal folder this week?",
  "settingsShell.integrationDetail.prompt.canva.1":
    "Make a social post from this recording's highlights",
  "settingsShell.integrationDetail.prompt.canva.2": "Find our brand kit colors",
  "settingsShell.integrationDetail.prompt.canva.3":
    "Export the latest deck as a PDF",
  "settingsShell.integrationDetail.prompt.cloudflare.1":
    "Which DNS records point at {{host}}?",
  "settingsShell.integrationDetail.prompt.cloudflare.2":
    "Show Worker errors from the last hour",
  "settingsShell.integrationDetail.prompt.cloudflare.3":
    "Purge the cache for this URL",
  "settingsShell.integrationDetail.prompt.commonRoom.1":
    "Which companies are showing buying signals?",
  "settingsShell.integrationDetail.prompt.commonRoom.2":
    "Who at Acme is active in our community?",
  "settingsShell.integrationDetail.prompt.commonRoom.3":
    "Summarize activity from our top accounts",
  "settingsShell.integrationDetail.prompt.context7.1":
    "Show the current React Router docs for loaders",
  "settingsShell.integrationDetail.prompt.context7.2":
    "How do I configure Drizzle migrations?",
  "settingsShell.integrationDetail.prompt.context7.3":
    "What's new in the latest Tailwind release?",
  "settingsShell.integrationDetail.prompt.exa.1":
    "Find recent articles about agent-native apps",
  "settingsShell.integrationDetail.prompt.exa.2":
    "Research competitors to {{app}}",
  "settingsShell.integrationDetail.prompt.exa.3":
    "Fetch and summarize this page",
  "settingsShell.integrationDetail.prompt.figma.1":
    "Summarize the components in this Figma file",
  "settingsShell.integrationDetail.prompt.figma.2":
    "List the color variables in our design system",
  "settingsShell.integrationDetail.prompt.figma.3":
    "Describe the layout of this frame",
  "settingsShell.integrationDetail.prompt.fullstory.1":
    "Show sessions where people rage-clicked Share",
  "settingsShell.integrationDetail.prompt.fullstory.2":
    "Summarize friction on the pricing page",
  "settingsShell.integrationDetail.prompt.fullstory.3":
    "Where do people drop off in onboarding?",
  "settingsShell.integrationDetail.prompt.github.1":
    "Summarize the pull requests waiting on my review",
  "settingsShell.integrationDetail.prompt.github.2":
    "Find issues about Slack link previews in agent-native",
  "settingsShell.integrationDetail.prompt.github.3":
    "What changed in packages/core this week?",
  "settingsShell.integrationDetail.prompt.gitlab.1":
    "Which merge requests failed CI today?",
  "settingsShell.integrationDetail.prompt.gitlab.2":
    "Summarize open issues labeled bug",
  "settingsShell.integrationDetail.prompt.gitlab.3":
    "Which pipelines were slowest this week?",
  "settingsShell.integrationDetail.prompt.gong.1":
    "Summarize my last call with Acme",
  "settingsShell.integrationDetail.prompt.gong.2":
    "What objections came up this month?",
  "settingsShell.integrationDetail.prompt.gong.3":
    "Which deals mention pricing concerns?",
  "settingsShell.integrationDetail.prompt.googleDocs.1":
    "@agent summarize the comments on this doc",
  "settingsShell.integrationDetail.prompt.googleDocs.2":
    "@agent draft a reply to this comment",
  "settingsShell.integrationDetail.prompt.googleDocs.3":
    "@agent turn these notes into a checklist",
  "settingsShell.integrationDetail.prompt.grafana.1":
    "Chart p95 API latency for the last day",
  "settingsShell.integrationDetail.prompt.grafana.2":
    "Find error logs from around 2pm",
  "settingsShell.integrationDetail.prompt.grafana.3":
    "Which alerts fired this week?",
  "settingsShell.integrationDetail.prompt.granola.1":
    "What did we decide in yesterday's design review?",
  "settingsShell.integrationDetail.prompt.granola.2":
    "List my open action items from meetings",
  "settingsShell.integrationDetail.prompt.granola.3":
    "Summarize my calls with Acme",
  "settingsShell.integrationDetail.prompt.hubspot.1":
    "Move the Acme deal to Closed won",
  "settingsShell.integrationDetail.prompt.hubspot.2":
    "Which deals are stuck in negotiation?",
  "settingsShell.integrationDetail.prompt.hubspot.3":
    "Log this call as a note on the contact",
  "settingsShell.integrationDetail.prompt.intercom.1":
    "Summarize today's open conversations",
  "settingsShell.integrationDetail.prompt.intercom.2":
    "Find help articles about SSO",
  "settingsShell.integrationDetail.prompt.intercom.3":
    "What are customers asking about most this week?",
  "settingsShell.integrationDetail.prompt.linear.1":
    "Create an issue for the broken Slack preview and assign it to me",
  "settingsShell.integrationDetail.prompt.linear.2":
    "What's left in the current cycle?",
  "settingsShell.integrationDetail.prompt.linear.3":
    "Summarize the bugs reported this week",
  "settingsShell.integrationDetail.prompt.monday.1":
    "What's on the design board this sprint?",
  "settingsShell.integrationDetail.prompt.monday.2": "Move this item to Done",
  "settingsShell.integrationDetail.prompt.monday.3": "Which items are overdue?",
  "settingsShell.integrationDetail.prompt.neon.1":
    "Create a branch of production for testing",
  "settingsShell.integrationDetail.prompt.neon.2":
    "Show the slowest queries this week",
  "settingsShell.integrationDetail.prompt.neon.3":
    "How big is the main database?",
  "settingsShell.integrationDetail.prompt.netlify.1":
    "Why did the last deploy fail?",
  "settingsShell.integrationDetail.prompt.netlify.2":
    "Which sites had failed builds this week?",
  "settingsShell.integrationDetail.prompt.netlify.3":
    "Roll back to the previous production deploy",
  "settingsShell.integrationDetail.prompt.notion.1":
    "Find our onboarding checklist",
  "settingsShell.integrationDetail.prompt.notion.2":
    "Summarize this week's meeting notes",
  "settingsShell.integrationDetail.prompt.notion.3":
    "Add these action items to the team wiki",
  "settingsShell.integrationDetail.prompt.paypal.1":
    "List invoices that are past due",
  "settingsShell.integrationDetail.prompt.paypal.2":
    "Summarize this month's transactions",
  "settingsShell.integrationDetail.prompt.paypal.3":
    "Create an invoice for Acme",
  "settingsShell.integrationDetail.prompt.pylon.1":
    "Which accounts have urgent open issues?",
  "settingsShell.integrationDetail.prompt.pylon.2":
    "Summarize the latest Acme ticket",
  "settingsShell.integrationDetail.prompt.pylon.3":
    "Draft a reply to this issue",
  "settingsShell.integrationDetail.prompt.semgrep.1":
    "Scan packages/core for security findings",
  "settingsShell.integrationDetail.prompt.semgrep.2":
    "Explain this finding and how to fix it",
  "settingsShell.integrationDetail.prompt.semgrep.3":
    "Are there hardcoded secrets in this repo?",
  "settingsShell.integrationDetail.prompt.sentry.1":
    "What are the top new errors since yesterday's deploy?",
  "settingsShell.integrationDetail.prompt.sentry.2":
    "Show the stack trace for the most frequent crash",
  "settingsShell.integrationDetail.prompt.sentry.3":
    "Which release introduced this error?",
  "settingsShell.integrationDetail.prompt.sigma.1":
    "Find the revenue dashboard",
  "settingsShell.integrationDetail.prompt.sigma.2":
    "What drove the change in MRR last month?",
  "settingsShell.integrationDetail.prompt.sigma.3":
    "Explain this workbook's main metrics",
  "settingsShell.integrationDetail.prompt.slack.1":
    "Summarize #design from this week",
  "settingsShell.integrationDetail.prompt.slack.2":
    "Find the thread about the pricing change",
  "settingsShell.integrationDetail.prompt.slack.3":
    "What did Camila say about the launch?",
  "settingsShell.integrationDetail.prompt.stripe.1":
    "How much revenue did we make last month?",
  "settingsShell.integrationDetail.prompt.stripe.2":
    "Find the customer on this invoice",
  "settingsShell.integrationDetail.prompt.stripe.3":
    "Which subscriptions failed to renew?",
  "settingsShell.integrationDetail.prompt.supabase.1":
    "How many people signed up this week?",
  "settingsShell.integrationDetail.prompt.supabase.2":
    "Show the schema for the recordings table",
  "settingsShell.integrationDetail.prompt.supabase.3":
    "Which edge functions errored today?",
  "settingsShell.integrationDetail.prompt.telegram.1":
    "Summarize today's recordings",
  "settingsShell.integrationDetail.prompt.telegram.2":
    "Remind me about the 3pm review",
  "settingsShell.integrationDetail.prompt.telegram.3":
    "Share the link to yesterday's demo",
  "settingsShell.integrationDetail.prompt.vercel.1":
    "Why did the last preview deploy fail?",
  "settingsShell.integrationDetail.prompt.vercel.2":
    "Show logs for the production deployment",
  "settingsShell.integrationDetail.prompt.vercel.3":
    "Which domains point at this project?",
  "settingsShell.integrationDetail.prompt.webflow.1":
    "Update the pricing page headline",
  "settingsShell.integrationDetail.prompt.webflow.2":
    "List CMS items published this week",
  "settingsShell.integrationDetail.prompt.webflow.3":
    "Which pages are missing meta descriptions?",
  "settingsShell.integrationDetail.prompt.whatsapp.1":
    "What's on my calendar today?",
  "settingsShell.integrationDetail.prompt.whatsapp.2":
    "Summarize the latest recording",
  "settingsShell.integrationDetail.prompt.whatsapp.3":
    "Send me the notes from the design review",
  "settingsShell.integrationDetail.prompt.zapier.1":
    "Post new recordings to #design in Slack",
  "settingsShell.integrationDetail.prompt.zapier.2":
    "Add new signups to our CRM",
  "settingsShell.integrationDetail.prompt.zapier.3": "Which Zaps can you run?",
  "settingsShell.integrationDetail.serverUrl": "Server URL",
  "settingsShell.integrationDetail.setUp": "Set up",
  "settingsShell.integrationDetail.signIn": "Sign-in",
  "settingsShell.integrationDetail.signInNone": "None",
  "settingsShell.integrationDetail.tokenHint.figma":
    "Create a personal access token in Figma, then paste it here.",
  "settingsShell.integrationDetail.tokenHint.github":
    "Create a personal access token in GitHub, then paste it here.",
  "settingsShell.integrationDetail.tokenHint.sentry":
    "Create a user auth token in Sentry, then paste it here.",
  "settingsShell.integrationDetail.tokenHint.zapier":
    "Create a connection in Zapier, then paste its bearer token here.",
  "settingsShell.integrationDetail.tokenPlaceholder":
    "Paste your {{name}} token",
  "settingsShell.integrationDetail.who": "Who can use it",
  "settingsShell.integrationDetail.whoMember":
    "Only owners and admins can share it with {{org}}.",
  "settingsShell.integrationDetail.whoOrgOnly":
    "Connects once for everyone in {{org}}.",
  "settingsShell.integrationDetail.whoPersonal":
    "Each person connects their own account.",
  "settingsShell.integrationDetail.whoShared":
    "A shared connection lets everyone in {{org}} use your access.",
  "settingsShell.clearSearch": "Clear search",
  "settingsShell.group.account": "Account",
  "settingsShell.group.agent": "Agent",
  "settingsShell.group.connections": "Connections",
  "settingsShell.group.organization": "Organization",
  "settingsShell.interfaceLanguage": "Interface language",
  "settingsShell.integrations.addCustom": "Add custom integration",
  "settingsShell.integrations.builderDescription":
    "Model access, browser automation, file storage, and workspace identity. Free tier available.",
  "settingsShell.integrations.builderStatusFailed":
    "Couldn't check the Builder.io connection.",
  "settingsShell.integrations.category.analytics": "Analytics",
  "settingsShell.integrations.category.design": "Design",
  "settingsShell.integrations.category.engineering": "Engineering",
  "settingsShell.integrations.category.finance": "Finance",
  "settingsShell.integrations.category.other": "Other",
  "settingsShell.integrations.category.productivity": "Productivity",
  "settingsShell.integrations.category.sales": "Sales",
  "settingsShell.integrations.category.support": "Support",
  "settingsShell.integrations.connectName": "Connect {{name}}",
  "settingsShell.integrations.connectedEmptyDescription":
    "Connect a tool below and the agent can use it in chat.",
  "settingsShell.integrations.connectedEmptyTitle": "Nothing connected yet",
  "settingsShell.integrations.footnote":
    "These are tools the agent uses. To use {{app}} from Claude, ChatGPT, or Cursor, see {{link}}.",
  "settingsShell.integrations.moreActions": "More actions for {{name}}",
  "settingsShell.integrations.noResults":
    "No integrations match. Try another name.",
  "settingsShell.integrations.remove": "Remove",
  "settingsShell.integrations.removeFailed": "Couldn't remove {{name}}.",
  "settingsShell.integrations.removePersonal":
    "The agent stops using {{name}} for you.",
  "settingsShell.integrations.removeTitle": "Remove {{name}}?",
  "settingsShell.integrations.removeWorkspace":
    "The agent stops using {{name}} for everyone in the workspace.",
  "settingsShell.integrations.removing": "Removing…",
  "settingsShell.integrations.retry": "Retry",
  "settingsShell.integrations.seeMoreMany":
    "See {{first}}, {{second}}, and more",
  "settingsShell.integrations.seeMoreOne": "See {{first}}",
  "settingsShell.integrations.seeMoreTwo": "See {{first}} and {{second}}",
  "settingsShell.integrations.serversLoadFailed":
    "Couldn't load your connected integrations.",
  "settingsShell.learnings": "Learnings",
  "settingsShell.loading": "Loading settings",
  "settingsShell.navLabel": "Settings",
  "settingsShell.noResults": "No matching settings",
  "settingsShell.openNav": "Open settings menu",
  "settingsShell.page.apiKeys": "API keys",
  "settingsShell.page.appGeneral": "General",
  "settingsShell.page.apps": "Apps",
  "settingsShell.page.audit": "Audit log",
  "settingsShell.page.auth": "Authentication",
  "settingsShell.page.automations": "Automations",
  "settingsShell.page.channels": "Channels",
  "settingsShell.page.creativeContext": "Creative context",
  "settingsShell.page.files": "Files",
  "settingsShell.page.infra": "Infrastructure",
  "settingsShell.page.instructions": "Instructions",
  "settingsShell.page.integrations": "Integrations",
  "settingsShell.page.labs": "Labs",
  "settingsShell.page.mcp": "MCP server",
  "settingsShell.page.members": "Members",
  "settingsShell.page.memory": "Memory",
  "settingsShell.page.model": "Model",
  "settingsShell.page.notifications": "Notifications",
  "settingsShell.page.orgGeneral": "General",
  "settingsShell.page.preferences": "Preferences",
  "settingsShell.page.profile": "Profile",
  "settingsShell.page.security": "Security",
  "settingsShell.page.skills": "Skills",
  "settingsShell.page.subAgents": "Sub-agents",
  "settingsShell.page.usage": "Usage",
  "settingsShell.page.whatsNew": "What's new",
  "settingsShell.pagePending": "Not available yet",
  "settingsShell.resultsLabel": "Settings search results",
  "settingsShell.search.appDefaultModel": "App default model",
  "settingsShell.search.backgroundAgents": "Background agents",
  "settingsShell.search.browserAutomation": "Browser automation",
  "settingsShell.search.connectedAgents": "Connected agents",
  "settingsShell.search.database": "Database",
  "settingsShell.search.defaultModel": "Default model",
  "settingsShell.search.demoMode": "Demo mode",
  "settingsShell.search.email": "Email",
  "settingsShell.search.fileUploads": "File uploads and storage",
  "settingsShell.search.hosting": "Hosting",
  "settingsShell.search.maxIterations": "Max iterations",
  "settingsShell.search.signInMethods": "Sign-in methods",
  "settingsShell.search.voiceTranscription": "Voice transcription",
  "settingsShell.searchPlaceholder": "Search settings",
  "settingsShell.unread": "New",
  "settingsResources.personal": "Personal",
  "settingsResources.organization": "Organization",
  "settingsResources.fromDispatch": "From Dispatch",
  "settingsResources.readOnly": "Read only",
  "settingsResources.readOnlyHint": "Only owners and admins can change this",
  "settingsResources.editInDispatch": "Edit it in Dispatch",
  "settingsResources.openDispatch": "Open Dispatch",
  "settingsResources.allApps": "All apps",
  "settingsResources.allAppsHint": "Dispatch shares this with every app",
  "settingsResources.dispatchEmpty": "Nothing shared from Dispatch",
  "settingsResources.loadFailed": "Couldn't load these resources.",
  "settingsResources.moreActions": "More actions",
  "settingsResources.open": "Open",
  "settingsResources.download": "Download",
  "settingsResources.remove": "Remove",
  "settingsResources.removeTitle": "Remove {{name}}?",
  "settingsResources.removeFailed": "Couldn't remove {{name}}.",
  "settingsResources.saveFailed": "Couldn't save {{name}}.",
  "settingsResources.uploadFailed": "Couldn't upload {{name}}.",
  "settingsResources.cancel": "Cancel",
  "settingsResources.save": "Save",
  "settingsResources.create": "Create",
  "settingsResources.saving": "Saving",
  "settingsResources.creating": "Creating",
  "settingsResources.removing": "Removing",
  "settingsResources.instructions.empty":
    "Tell the agent how to work with you.",
  "settingsResources.instructions.emptyTitle": "No instructions yet",
  "settingsResources.instructions.orgEmpty": "No instructions for {{org}} yet",
  "settingsResources.instructions.add": "Add instructions",
  "settingsResources.instructions.fieldLabel":
    "How should the agent work with you?",
  "settingsResources.instructions.placeholder":
    "Keep answers short. Use metric units.",
  "settingsResources.instructions.savedAs":
    "Saved as AGENTS.md in your personal resources.",
  "settingsResources.memory.empty":
    "The agent saves what it learns about you here.",
  "settingsResources.memory.emptyTitle": "No memories yet",
  "settingsResources.memory.orgEmpty": "No shared memories yet",
  "settingsResources.memory.add": "Add memory",
  "settingsResources.learnings.empty":
    "Corrections you give the agent are saved as learnings.",
  "settingsResources.learnings.emptyTitle": "No learnings yet",
  "settingsResources.learnings.add": "Add learning",
  "settingsResources.skills.empty":
    "Save a workflow once and the agent can reuse it.",
  "settingsResources.skills.emptyTitle": "No skills yet",
  "settingsResources.skills.orgEmpty": "No shared skills yet",
  "settingsResources.skills.add": "Add skill",
  "settingsResources.skills.describe": "Describe it to the agent",
  "settingsResources.skills.upload": "Upload a skill file",
  "settingsResources.skills.describePlaceholder":
    "A skill that reviews pull requests for security issues",
  "settingsResources.files.empty":
    "Add a file to give your agent more context.",
  "settingsResources.files.emptyTitle": "No files yet",
  "settingsResources.files.orgEmpty": "No shared files yet",
  "settingsResources.files.add": "Add file",
  "settingsResources.files.upload": "Upload file",
  "settingsResources.files.create": "Create file",
  "settingsInfra.setup": "Setup",
  "settingsInfra.services": "Services",
  "settingsInfra.environment": "Environment",
  "settingsInfra.builderConnected":
    "Connected. Your account credits power every service marked Builder.io.",
  "settingsInfra.builderNotConnected":
    "Not connected. Set up each service yourself, or connect Builder.io to use your account credits.",
  "settingsInfra.builderUnknown": "Couldn't check the Builder.io connection.",
  "settingsInfra.manage": "Manage",
  "settingsInfra.connect": "Connect",
  "settingsInfra.connecting": "Connecting…",
  "settingsInfra.setUp": "Set up",
  "settingsInfra.view": "View",
  "settingsInfra.retry": "Retry",
  "settingsInfra.close": "Close",
  "settingsInfra.cancel": "Cancel",
  "settingsInfra.save": "Save",
  "settingsInfra.saving": "Saving…",
  "settingsInfra.required": "Required",
  "settingsInfra.recommended": "Recommended",
  "settingsInfra.optional": "Optional",
  "settingsInfra.builderRecommended":
    "Power every service below with your Builder.io account credits. Free tier available.",
  "settingsInfra.builderOnly": "Builder.io only",
  "settingsInfra.rowDescription": "{{source}} · {{use}}",
  "settingsInfra.notSetUp": "Not set up",
  "settingsInfra.availableWithBuilder": "Available with Builder.io",
  "settingsInfra.loadFailed": "Couldn't load this.",
  "settingsInfra.aiModel": "AI model",
  "settingsInfra.useEveryApp": "Every app",
  "settingsInfra.storageBucket": "{{provider}}, bucket {{bucket}}",
  "settingsInfra.useUploads": "Uploads in every app",
  "settingsInfra.storageTitle": "File storage",
  "settingsInfra.storageIntro":
    "New uploads go to your bucket. Existing files stay where they are.",
  "settingsInfra.voice": "Voice input",
  "settingsInfra.images": "Image generation",
  "settingsInfra.embeddings": "Embeddings",
  "settingsInfra.useVoice": "Dictation in every app",
  "settingsInfra.useImages": "Slides and Design",
  "settingsInfra.useEmbeddings": "Search in Brain",
  "settingsInfra.whyVoice":
    "Turns speech into text. Typing always works without it.",
  "settingsInfra.whyImages": "Generates images for slides and designs.",
  "settingsInfra.whyEmbeddings":
    "Improves semantic search. Keyword search still works without it.",
  "settingsInfra.designSystem": "Design system intelligence",
  "settingsInfra.whyDesignSystem":
    "Keeps generated slides and designs on brand.",
  "settingsInfra.whyBackground": "Makes code changes from production.",
  "settingsInfra.whyBrowser": "Lets the agent use a browser in production.",
  "settingsInfra.provider": "Provider",
  "settingsInfra.keyOrg": "Uses the organization {{provider}} key.",
  "settingsInfra.manageKey": "Manage key",
  "settingsInfra.keyPersonal":
    "Your {{provider}} key is personal. Services need an organization key.",
  "settingsInfra.keyNone":
    "Services use organization keys, and there's no {{provider}} key yet.",
  "settingsInfra.keyUnavailable":
    "Couldn't check the organization {{provider}} key.",
  "settingsInfra.useBuilder": "Use Builder.io",
  "settingsInfra.addNamed": "Add {{provider}}",
  "settingsInfra.serviceSaved": "{{service}} now uses {{provider}}.",
  "settingsInfra.serviceSaveFailed": "Couldn't change {{service}}.",
  "settingsInfra.reindex":
    "Re-index Brain so semantic search covers existing items.",
  "settingsInfra.variables": "Required variables",
  "settingsInfra.databaseHosted":
    "{{name}}, set on your host. Every app shares it.",
  "settingsInfra.databaseHostedSingle": "{{name}}, set on your host.",
  "settingsInfra.databaseLocal":
    "{{name}} on this computer. Set DATABASE_URL on your host before you deploy.",
  "settingsInfra.databaseMissing": "Not set. Set DATABASE_URL on your host.",
  "settingsInfra.hostingWorkspace":
    "{{host}}. The workspace deploys every app to its own address.",
  "settingsInfra.hostingSingle": "{{host}}, at {{address}}.",
  "settingsInfra.hostingPlain": "{{host}}.",
  "settingsInfra.hostOwnServer": "Your own server",
  "settingsInfra.hostThisComputer": "This computer",
  "settingsInfra.variablesSet": "{{keys}} are set on your host.",
  "settingsInfra.variablesMissing": "Set {{keys}} on your host.",
  "settingsInfra.dbConnected": "Connected",
  "settingsInfra.dbLocal": "On this computer",
  "settingsInfra.notSet": "Not set",
  "settingsInfra.set": "Set",
  "settingsInfra.dbIntro":
    "Every app reads the database before it starts, so it's set once on your host. To move to another database:",
  "settingsInfra.dbStep1":
    "Create a Postgres database in Neon, Supabase, or any Postgres host.",
  "settingsInfra.dbStep2":
    "Set {{key}} to its connection string in your host's environment.",
  "settingsInfra.dbStep3": "Redeploy. Migrations run during the deploy.",
  "settingsInfra.dbOwn":
    "To give one app its own database, set its own variable, like {{key}}.",
  "settingsInfra.hostIntroWorkspace":
    "The workspace deploys every app, each at its own address. To host on Vercel, Cloudflare, or your own server:",
  "settingsInfra.hostIntro":
    "To host on Vercel, Cloudflare, or your own server:",
  "settingsInfra.hostStep1":
    "Choose the target with {{key}}, like vercel, cloudflare_module, or node.",
  "settingsInfra.hostStep2":
    "Give the new host the same environment, including {{keys}}.",
  "settingsInfra.hostStep3":
    "Deploy. For a workspace, this builds every app and prints the publish command:",
  "settingsInfra.envIntro":
    "Every app reads these before it starts. Set them once on your host, then redeploy.",
  "settingsInfra.varDatabaseUrl": "Your Postgres connection string.",
  "settingsInfra.varA2a":
    "Lets the apps in this workspace call each other. In a workspace, it also signs sign-in sessions when BETTER_AUTH_SECRET isn't set.",
  "settingsInfra.varBetterAuth":
    "Signs sign-in sessions. Use at least 32 random characters.",
  "settingsInfra.varAppUrl":
    "Only needed when the host can't tell the app its public URL.",
  "settingsInfra.varEncryption":
    "Encrypts the keys saved in Settings. Without it, the workspace derives one from A2A_SECRET.",
  "settingsInfra.varEncryptionSingle":
    "Encrypts the keys saved in Settings. Without it, the app derives one from BETTER_AUTH_SECRET.",
  "settingsInfra.varWeak": "Too short. Use at least 32 random characters.",
  "settingsInfra.varWeakLabel": "Too short",
  "settingsInfra.generateSecret": "To generate a secret:",
  "settingsInfra.copy": "Copy",
  "settingsInfra.copied": "Copied",
  "settingsInfra.copyFailed": "Couldn't copy.",
  "settingsApiKeys.addKey": "Add key",
  "settingsApiKeys.adding": "Adding…",
  "settingsApiKeys.availableTo": "Available to",
  "settingsApiKeys.deleteKey": "Delete key",
  "settingsApiKeys.deleting": "Deleting…",
  "settingsApiKeys.deleteTitle": "Delete {{name}}?",
  "settingsApiKeys.everyoneIn": "Everyone in {{org}}",
  "settingsApiKeys.getKey": "Get key",
  "settingsApiKeys.hideKeys": "Hide keys",
  "settingsApiKeys.justMe": "Just me",
  "settingsApiKeys.keyAdded": "Key added",
  "settingsApiKeys.keyDeleted": "Key deleted",
  "settingsApiKeys.loadFailed": "Couldn't load your keys.",
  "settingsApiKeys.manageKey": "Manage {{name}}",
  "settingsApiKeys.managedKeys": "Managed by integrations",
  "settingsApiKeys.managedName": "{{owner}} manages this key.",
  "settingsApiKeys.managedTooltip":
    "Created and rotated by {{owner}}. Disconnect it there.",
  "settingsApiKeys.membersLocked":
    "Only owners and admins can share keys with {{org}}.",
  "settingsApiKeys.modelFootnote": "To use your own model provider, {{link}}.",
  "settingsApiKeys.modelFootnoteLink": "add it in Model",
  "settingsApiKeys.name": "Name",
  "settingsApiKeys.noKeys": "No keys yet",
  "settingsApiKeys.noKeysDescription":
    "Add a key so your apps and the agent can reach a service.",
  "settingsApiKeys.orgKeys": "Organization keys",
  "settingsApiKeys.providerInModel": "Add {{provider}} in {{link}}.",
  "settingsApiKeys.replaceTitle": "Replace {{name}}",
  "settingsApiKeys.replaceValue": "Replace value",
  "settingsApiKeys.saving": "Saving…",
  "settingsApiKeys.showKeys_one": "Show {{count}} key",
  "settingsApiKeys.showKeys_other": "Show {{count}} keys",
  "settingsApiKeys.test": "Test",
  "settingsApiKeys.testPassed": "The saved value works.",
  "settingsApiKeys.usedBy": "Used by {{link}}",
  "settingsApiKeys.value": "Value",
  "settingsApiKeys.valueReplaced": "Value replaced",
  "settingsApiKeys.yourKeys": "Your keys",
  "settingsModel.addEndpoint": "Add an endpoint URL",
  "settingsModel.addNamed": "Add {{provider}}",
  "settingsModel.addProvider": "Add provider",
  "settingsModel.adding": "Adding",
  "settingsModel.affectsOrg": "This affects everyone in {{org}}.",
  "settingsModel.affectsYou": "This affects only you.",
  "settingsModel.allApps": "All apps",
  "settingsModel.apiKey": "API key",
  "settingsModel.builderConnected": "Connected · {{space}}",
  "settingsModel.builderConnectedPlain": "Connected",
  "settingsModel.builderOrgNotConnectedAdmin":
    "Not connected. When you connect it, everyone in {{org}} can use it.",
  "settingsModel.builderOrgNotConnectedMember":
    "Not connected. An owner or admin can connect it.",
  "settingsModel.builderPersonalConnect":
    "Connect your own account to use your Builder.io credits.",
  "settingsModel.builderPersonalInsteadOfOrg":
    "Connect your own account to use it instead of the organization's.",
  "settingsModel.builderPersonalOverOrg":
    "Connected · {{space}}. Used instead of the organization's connection.",
  "settingsModel.builderPersonalOverOrgPlain":
    "Connected. Used instead of the organization's connection.",
  "settingsModel.builderUnknown": "Couldn't check the Builder.io connection.",
  "settingsModel.cancel": "Cancel",
  "settingsModel.change": "Change",
  "settingsModel.chatgptConnected": "Connected",
  "settingsModel.chatgptDescription":
    "Use the Codex engine with your ChatGPT plan.",
  "settingsModel.chatgptPopupBlocked":
    "Allow pop-ups for this site, then try again.",
  "settingsModel.chatgptTitle": "ChatGPT subscription",
  "settingsModel.checkAgain": "Check again",
  "settingsModel.checkedJustNow": "Checked just now.",
  "settingsModel.checkedOn": "Checked {{date}}.",
  "settingsModel.checking": "Checking your key with {{provider}}",
  "settingsModel.checkingEndpoint": "Checking the endpoint",
  "settingsModel.checkingOllama": "Checking installed models…",
  "settingsModel.checkingSaved": "Checking the saved key",
  "settingsModel.chooseModel": "Choose a model",
  "settingsModel.clear": "Clear",
  "settingsModel.connect": "Connect",
  "settingsModel.connecting": "Connecting…",
  "settingsModel.defaultModelDescription":
    "Used in every app unless the app sets its own.",
  "settingsModel.defaultModelNeedsProvider":
    "Add a provider to choose a default model.",
  "settingsModel.disconnect": "Disconnect",
  "settingsModel.effectDefaultStops":
    "Chats stop until another provider is set up.",
  "settingsModel.effectDefaultSwitches":
    "The default model switches to {{next}}.",
  "settingsModel.effectKeepsOrg": "Keeps working with the organization key.",
  "settingsModel.effectKeepsVault": "Keeps working with the Vault key.",
  "settingsModel.effectKeepsWorkspace": "Keeps working with the workspace key.",
  "settingsModel.effectModelsLeave":
    "{{provider}} models leave the model picker.",
  "settingsModel.emptyAskAdmin": "Ask an owner or admin to add one.",
  "settingsModel.emptyDescription": "The agent needs a provider to respond.",
  "settingsModel.emptyDescriptionBuilder":
    "The agent needs a provider to respond. We recommend Builder.io for model access, browser automation, file storage, and workspace identity. Free tier available.",
  "settingsModel.emptyTitle": "Add a model provider",
  "settingsModel.endpointFirst": "Enter the endpoint URL first.",
  "settingsModel.endpointHint":
    "Optional. Use this for LiteLLM or another OpenAI-compatible gateway.",
  "settingsModel.endpointUrl": "Endpoint URL",
  "settingsModel.keyHint":
    "Create one at {{host}}. {{provider}} bills it directly.",
  "settingsModel.keyPlaceholder": "Paste your {{provider}} key",
  "settingsModel.labs": "Labs",
  "settingsModel.loadFailed": "Couldn't load providers.",
  "settingsModel.lockedTip": "Only owners and admins can change this.",
  "settingsModel.manage": "Manage",
  "settingsModel.maxIterationsDescription":
    "How long a response can work before pausing.",
  "settingsModel.maxIterationsInvalid":
    "Enter a whole number from {{min}} to {{max}}.",
  "settingsModel.modelCount_one": "{{count}} model",
  "settingsModel.modelCount_other": "{{count}} models",
  "settingsModel.modelOption": "{{model}} · {{provider}}",
  "settingsModel.models": "Models",
  "settingsModel.modelsHint": "Selected models show in the model picker.",
  "settingsModel.modelsHintService":
    "Chat models are optional. Leave them unchecked to use this key only for {{service}}.",
  "settingsModel.modelsIdle": "Paste a key to see the models it can use.",
  "settingsModel.modelsIdleOllama":
    "Enter the endpoint URL to see its installed models.",
  "settingsModel.modelsSaveFailed":
    "The key was saved, but the model list wasn't. {{message}}",
  "settingsModel.noChatModels": "No chat models",
  "settingsModel.noModelsFound": "No models found.",
  "settingsModel.notSet": "Not set",
  "settingsModel.nothingElse": "Nothing else uses this key.",
  "settingsModel.ollamaHint": "No API key required.",
  "settingsModel.orgProviders": "Organization providers",
  "settingsModel.orgSettings": "Organization settings",
  "settingsModel.organization": "Organization",
  "settingsModel.pasteFirst": "Paste a key first.",
  "settingsModel.personal": "Personal",
  "settingsModel.personalProviders": "Personal providers",
  "settingsModel.previewFailed": "Couldn't check what this affects.",
  "settingsModel.provider": "Provider",
  "settingsModel.providerErrorHeadline": "{{provider}} couldn't check this key",
  "settingsModel.reasonEndpoint": "Check the endpoint URL.",
  "settingsModel.reasonOllamaUnreachable":
    "Check the URL, and that Ollama is running.",
  "settingsModel.reasonPrefix": "{{provider}} keys start with {{prefix}}.",
  "settingsModel.reasonRejected":
    "Check that you copied all of it, or create a new one.",
  "settingsModel.reasonTryAgain": "Try again in a moment.",
  "settingsModel.reasonWrongProvider": "This looks like a {{provider}} key.",
  "settingsModel.reasonWrongProviderVowel":
    "This looks like an {{provider}} key.",
  "settingsModel.reconnect": "Reconnect",
  "settingsModel.rejected":
    "{{provider}} rejected this key on {{date}}. Chats that use it stop until you replace it.",
  "settingsModel.rejectedAskAdmin":
    "{{provider}} rejected this key on {{date}}. Ask an owner or admin to replace it.",
  "settingsModel.rejectedHeadline": "{{provider}} rejected this key",
  "settingsModel.remove": "Remove",
  "settingsModel.removeProvider": "Remove provider",
  "settingsModel.removeTitle": "Remove {{provider}}?",
  "settingsModel.removing": "Removing",
  "settingsModel.replace": "Replace",
  "settingsModel.replaceKey": "Replace key",
  "settingsModel.restrictBody": "Members can only use organization providers.",
  "settingsModel.restrictConfirm": "Restrict keys",
  "settingsModel.restrictDescription":
    "Members can only use organization providers, and keys they added stop working.",
  "settingsModel.restrictLabel": "Restrict personal API keys",
  "settingsModel.restrictMemberBuilder":
    "Their personal Builder.io connection stops working.",
  "settingsModel.restrictMemberChats":
    "Their chats switch to organization providers.",
  "settingsModel.restrictMemberKeys_one":
    "Their {{providers}} key stops working.",
  "settingsModel.restrictMemberKeys_other":
    "Their {{providers}} keys stop working.",
  "settingsModel.restrictNewKeysBody":
    "Members can't add them. Owners and admins still can.",
  "settingsModel.restrictNewKeysTitle": "New personal keys",
  "settingsModel.restrictTitle": "Restrict personal API keys?",
  "settingsModel.restricted": "Owners and admins restricted personal API keys.",
  "settingsModel.restrictedRow":
    "Not used while personal API keys are restricted.",
  "settingsModel.restricting": "Restricting",
  "settingsModel.retry": "Try again",
  "settingsModel.save": "Save",
  "settingsModel.savedRejected":
    "{{provider}} rejected the saved key. Paste a new one.",
  "settingsModel.saving": "Saving",
  "settingsModel.selectAll": "Select all",
  "settingsModel.settingLoadFailed": "Couldn't load this setting.",
  "settingsModel.unreachableHeadline": "Couldn't reach {{provider}}",
  "settingsModel.view": "View",
  "settingsModel.whatHappens": "What happens",
  "settingsModel.who": "Who can use it",
  "settingsModel.whoHintAdmin":
    "Personal providers are only yours. Organization providers work for everyone in {{org}}.",
  "settingsModel.whoHintMember":
    "Only owners and admins can add organization providers.",
  "settingsModel.whoHintService": "Services use organization keys.",
  "settingsSubAgents.connect": "Connect agent",
  "settingsSubAgents.orgApps": "{{org}} apps",
  "settingsSubAgents.workspaceApps": "Workspace apps",
  "settingsSubAgents.external": "External agents",
  "settingsSubAgents.custom": "Custom agents",
  "settingsSubAgents.managedByAdmins": "Managed by admins",
  "settingsSubAgents.appsEmpty": "No apps connected yet",
  "settingsSubAgents.externalEmpty":
    "Connect Foundry, Gemini Enterprise, Anthropic, or any A2A agent.",
  "settingsSubAgents.externalEmptyTitle": "No external agents yet",
  "settingsSubAgents.customEmpty":
    "Define a focused agent the main agent can delegate to.",
  "settingsSubAgents.customEmptyTitle": "No custom agents yet",
  "settingsSubAgents.addAgent": "Add agent",
  "settingsSubAgents.describe": "Describe it to the agent",
  "settingsSubAgents.describePlaceholder":
    "A design agent that critiques layouts and suggests UI direction",
  "settingsSubAgents.write": "Write it yourself",
  "settingsSubAgents.name": "Name",
  "settingsSubAgents.description": "Description",
  "settingsSubAgents.instructions": "Instructions",
  "settingsSubAgents.loadFailed": "Couldn't load connected agents.",
  "settingsSubAgents.statusUnreachable": "Unreachable",
  "settingsSubAgents.edit": "Edit",
  "settingsSubAgents.editTitle": "Edit {{name}}",
  "settingsSubAgents.removeDescription":
    "The agent stops delegating to {{name}} for everyone in {{org}}.",
  "settingsSubAgents.removeDescriptionSolo":
    "The agent stops delegating to {{name}}.",
  "settingsSubAgents.directoryTitle": "Connect an agent",
  "settingsSubAgents.anyAgent": "Any A2A agent",
  "settingsSubAgents.anyAgentHint": "Paste an agent card URL.",
  "settingsSubAgents.registryLink": "Browse the Global A2A Registry",
  "settingsSubAgents.connectTitle": "Connect {{name}}",
  "settingsSubAgents.close": "Close",
} as const;

export default messages;
