// ==UserScript==
// @name         Aviso_Alerta
// @namespace    codex.lamentosa
// @version      2.2.5
// @description  Monitora dungeon, tentativas de veneno e abertura de boss, enviando alertas no Telegram sem executar acoes no jogo.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.telegram.org
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const CHAT_LIST_SELECTOR = "#gChatList";
  const CHAT_MESSAGE_SELECTOR = "#gChatList > li, #drawerChat #gChatList > li, li.system";
  const TOAST_ID = "lamentosa-dungeon-test-toast";
  const CONTROL_BUTTON_ID = "lamentosa-dungeon-alert-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-dungeon-alert-slot";
  const UI_ORDER = 50;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const STORAGE_KEY = "lamentosaDungeonAlertConfig";
  const TELEGRAM_CHAT_ID_CACHE_STORAGE_KEY = "lamentosaAvisoAlertaTelegramChatIdCache";
  const TELEGRAM_CHAT_ID_CACHE_FALLBACK_KEYS = [
    "lamentosaAutoAttackTelegramChatIdCache",
  ];
  const BOSS_ALERT_HISTORY_STORAGE_KEY = "lamentosaAvisoAlertaBossAlertHistory";
  const WAR_ALERT_HISTORY_STORAGE_KEY = "lamentosaAvisoAlertaWarAlertHistory";
  const UNIQUE_REPORT_LAST_SENT_DATE_STORAGE_KEY = "lamentosaAvisoAlertaUniqueReportLastSentDate";
  const TARGET_PLAYERS = ["TheVamp", "Nuvem"];
  const POISON_ATTEMPT_PATTERNS = ["try to poison", "tries to poison", "tried to poison"];
  const BOSS_SPAWN_PATTERNS = [
    "waiting for you",
    "waitingforyou",
    "apareceu",
    "appeared",
    "spawned",
  ];
  const ELDER_BOSS_NAMES = [
    "First Adept",
    "Pain Invoker",
    "First Mother",
    "Lost Spirit",
    "Abyzou",
    "Shyeth",
    "The Phantom",
    "Soul Binder",
    "Shadow Weaver",
  ];
  const UNIQUE_ITEM_NAMES = [
    "Beast Hunter",
    "Blood Pendant",
    "Bone Ripper",
    "Carapace of the Beast",
    "Chaos Wand",
    "Crown of Tempest",
    "Death Whispers",
    "Destroyer",
    "Dragon Blade",
    "Eye of the Abyss",
    "Fallen Armor",
    "Fallen Heart",
    "Fury Blade",
    "Goddess Mask",
    "Golden Sword",
    "Ice Sword",
    "Iron Bastion",
    "Mantle of Oblivion",
    "Mystic Circlet",
    "Phantom Locket",
    "Shroud of Night",
    "Soul Chain",
    "Supreme Sword",
    "Veil of Shadows",
    "Volcano Axe",
    "Wraith Collar",
  ];
  const INFERNNUM_CLAN_ALIASES = [
    "Infernnum",
    "Infernium",
  ];
  const BRAZIL_TIMEZONE = "America/Sao_Paulo";
  const PRIVATE_BOSS_ALERT_USERNAME = "Wskratos";
  const GROUP_PRIVATE_MENTION = "@Wskratos";
  const BOSS_INFO_WAIT_TIMEOUT_MS = 30000;
  const BOSS_INFO_POLL_INTERVAL_MS = 1000;
  const UNIQUE_LIST_URL = "/items/uniques/";
  const TORMENTUS_BATTLE_URL = "/massive-battles/tormentus/";
  const UNIQUE_REPORT_CHECK_INTERVAL_MS = 60 * 1000;
  const UNIQUE_REPORT_SEND_HOUR = 22;
  const UNIQUE_OWNERSHIP_DAYS = 30;
  const TORMENTUS_BATTLE_CACHE_TTL_MS = 5 * 60 * 1000;
  const TORMENTUS_BATTLE_MATCH_WINDOW_MS = 45 * 60 * 1000;
  const GROUP_MENTION_OWNER_NAMES = [
    "Kratos",
    "Decimus Abigoris",
    "Ðe͠c͠i͠m͠u͠s͠ Âßïgørîs",
  ];
  const VOICE_ALERT_TEXT = "alerta";
  const DEFAULT_TELEGRAM_CONFIG = {
    enabled: true,
    telegramEnabled: true,
    telegramBotToken: "",
    telegramChatId: "",
    privateBossTelegramUsername: PRIVATE_BOSS_ALERT_USERNAME,
  };

  const bossKeysInFlight = new Set();
  let buttonNode = null;
  const state = {
    chatIdLookupPromises: Object.create(null),
    processedMessageNodes: new WeakSet(),
    tormentusBattleInfo: null,
    tormentusBattleLoadedAt: 0,
    tormentusBattlePromise: null,
    uniqueReportIntervalId: 0,
    uniqueReportInFlight: false,
  };

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeToken(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, "");
  }

  function normalizeTelegramUsername(value) {
    return String(value || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
  }

  function cleanupLabel(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:;,\-.]+|[\s:;,\-.!]+$/g, "")
      .trim();
  }

  function sanitizeBossOwnerName(text) {
    return cleanupLabel(text).replace(
      /\s*\((?:lobisomem|vampiro|werewolf|vampire)\)\s*$/i,
      ""
    );
  }

  function isLikelyBossOwnerName(text) {
    const value = cleanupLabel(text);
    const token = normalizeToken(value);
    if (!token) {
      return false;
    }

    const blockedTokens = [
      "boss",
      "modo",
      "bonus",
      "valor",
      "sobrevivente",
      "sessoesvazias",
      "unique",
      "unico",
      "recaptcha",
      "tabela",
      "proximabatalha",
      "battlestarted",
    ];
    if (blockedTokens.some((blockedToken) => token.includes(blockedToken))) {
      return false;
    }

    return value.length <= 80;
  }

  function isInfernnnumClanName(text) {
    const valueToken = normalizeToken(text);
    if (!valueToken) {
      return false;
    }

    return INFERNNUM_CLAN_ALIASES.some((alias) => {
      const aliasToken = normalizeToken(alias);
      return (
        valueToken === aliasToken ||
        valueToken.includes(aliasToken) ||
        aliasToken.includes(valueToken)
      );
    });
  }

  function loadConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") {
        return { ...DEFAULT_TELEGRAM_CONFIG };
      }

      return {
        enabled:
          typeof parsed.enabled === "boolean"
            ? parsed.enabled
            : DEFAULT_TELEGRAM_CONFIG.enabled,
        telegramEnabled:
          typeof parsed.telegramEnabled === "boolean"
            ? parsed.telegramEnabled
            : DEFAULT_TELEGRAM_CONFIG.telegramEnabled,
        telegramBotToken:
          String(parsed.telegramBotToken || "").trim() ||
          DEFAULT_TELEGRAM_CONFIG.telegramBotToken,
        telegramChatId:
          String(parsed.telegramChatId || "").trim() ||
          DEFAULT_TELEGRAM_CONFIG.telegramChatId,
        privateBossTelegramUsername:
          normalizeTelegramUsername(parsed.privateBossTelegramUsername) ||
          DEFAULT_TELEGRAM_CONFIG.privateBossTelegramUsername,
      };
    } catch {
      return { ...DEFAULT_TELEGRAM_CONFIG };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function loadUniqueReportLastSentDateKey() {
    return String(localStorage.getItem(UNIQUE_REPORT_LAST_SENT_DATE_STORAGE_KEY) || "").trim();
  }

  function saveUniqueReportLastSentDateKey(dateKey) {
    const nextValue = String(dateKey || "").trim();
    if (!nextValue) {
      localStorage.removeItem(UNIQUE_REPORT_LAST_SENT_DATE_STORAGE_KEY);
      return;
    }

    localStorage.setItem(UNIQUE_REPORT_LAST_SENT_DATE_STORAGE_KEY, nextValue);
  }

  function loadWarAlertHistory() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(WAR_ALERT_HISTORY_STORAGE_KEY) || "{}"
      );
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveWarAlertHistory(history) {
    localStorage.setItem(
      WAR_ALERT_HISTORY_STORAGE_KEY,
      JSON.stringify(history || {})
    );
  }

  function pruneWarAlertHistory(dateKey = getBrazilNowParts().dateKey) {
    const originalHistory = loadWarAlertHistory();
    const nextHistory = Object.fromEntries(
      Object.entries(originalHistory).filter(([, value]) => String(value || "") === dateKey)
    );

    if (Object.keys(nextHistory).length !== Object.keys(originalHistory).length) {
      saveWarAlertHistory(nextHistory);
    }

    return nextHistory;
  }

  function hasWarAlertBeenSent(alertKey) {
    if (!alertKey) {
      return false;
    }

    const history = pruneWarAlertHistory();
    return Boolean(history[alertKey]);
  }

  function markWarAlertAsSent(alertKey) {
    if (!alertKey) {
      return;
    }

    const dateKey = getBrazilNowParts().dateKey;
    const history = pruneWarAlertHistory(dateKey);
    history[alertKey] = dateKey;
    saveWarAlertHistory(history);
  }

  function isEnabled() {
    return loadConfig().enabled;
  }

  function ensureDefaultConfigSaved() {
    if (localStorage.getItem(STORAGE_KEY)) {
      return;
    }

    saveConfig({ ...DEFAULT_TELEGRAM_CONFIG });
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    );
  }

  function getUiStack() {
    let root = document.getElementById(UI_STACK_ID);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = UI_STACK_ID;
    root.style.position = "fixed";
    root.style.right = "16px";
    root.style.top = "72px";
    root.style.zIndex = "2147483647";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.alignItems = "flex-end";
    root.style.gap = "10px";
    root.style.pointerEvents = "none";
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function reflowUiStack() {
    const root = getUiStack();
    Array.from(root.children)
      .sort((a, b) => Number(a.dataset.order || 0) - Number(b.dataset.order || 0))
      .forEach((child) => root.appendChild(child));
  }

  function ensureUiSlot() {
    const root = getUiStack();
    let slot = document.getElementById(UI_SLOT_ID);
    if (!slot) {
      slot = document.createElement("div");
      slot.id = UI_SLOT_ID;
      slot.dataset.order = String(UI_ORDER);
      slot.style.display = "flex";
      slot.style.flexDirection = "column";
      slot.style.alignItems = "flex-end";
      slot.style.gap = "6px";
      slot.style.maxWidth = "360px";
      slot.style.pointerEvents = "none";

      const buttonHost = document.createElement("div");
      buttonHost.style.pointerEvents = "auto";

      const toastHost = document.createElement("div");
      toastHost.style.display = "none";
      toastHost.style.pointerEvents = "none";

      slot.appendChild(buttonHost);
      slot.appendChild(toastHost);
      root.appendChild(slot);
      reflowUiStack();
    }

    return {
      buttonHost: slot.children[0],
      toastHost: slot.children[1],
    };
  }

  function getToastNode() {
    const { toastHost } = ensureUiSlot();
    let node = document.getElementById(TOAST_ID);
    if (node) {
      return node;
    }

    node = document.createElement("div");
    node.id = TOAST_ID;
    node.style.padding = "10px 12px";
    node.style.background = "rgba(0, 0, 0, 0.82)";
    node.style.color = "#fff";
    node.style.font = "13px/1.4 Arial, sans-serif";
    node.style.borderRadius = "10px";
    node.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    node.style.maxWidth = "360px";
    node.style.pointerEvents = "none";
    toastHost.style.display = "block";
    toastHost.appendChild(node);
    return node;
  }

  function showToast(message) {
    const node = getToastNode();
    node.textContent = message;
    console.log(`[Lamentosa Aviso_Alerta] ${message}`);
  }

  function updateButtonState() {
    if (!buttonNode) {
      return;
    }

    const config = loadConfig();
    buttonNode.style.background = config.enabled ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Aviso_Alerta";
    button.title =
      "Clique para ligar/desligar o Aviso_Alerta. Clique direito ou Ctrl+Alt+U força o relatorio de uniques. Ctrl+Alt+D tambem alterna.";
    button.style.minWidth = "108px";
    button.style.padding = "6px 10px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 11px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    button.addEventListener("click", () => {
      const config = loadConfig();
      saveConfig({
        ...config,
        enabled: !config.enabled,
      });
      updateButtonState();
      showToast(!config.enabled ? "Aviso_Alerta ativado." : "Aviso_Alerta pausado.");
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void maybeRunUniqueReport({ force: true });
    });
    buttonHost.appendChild(button);
    buttonNode = button;
    updateButtonState();

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const config = loadConfig();
        saveConfig({
          ...config,
          enabled: !config.enabled,
        });
        updateButtonState();
        showToast(!config.enabled ? "Aviso_Alerta ativado." : "Aviso_Alerta pausado.");
        return;
      }

      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        void maybeRunUniqueReport({ force: true });
      }
    });
  }

  function playAlertSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return;
      }

      const audioContext = new AudioCtx();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.18);
    } catch (error) {
      console.warn("[Lamentosa Aviso_Alerta] Falha ao tocar beep", error);
    }
  }

  function speakAlert() {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance !== "function") {
      playAlertSound();
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(VOICE_ALERT_TEXT);
      utterance.lang = "pt-BR";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("[Lamentosa Aviso_Alerta] Falha ao falar alerta", error);
      playAlertSound();
    }
  }

  function loadTelegramChatIdCache() {
    const mergedCache = {};

    for (const storageKey of [TELEGRAM_CHAT_ID_CACHE_STORAGE_KEY, ...TELEGRAM_CHAT_ID_CACHE_FALLBACK_KEYS]) {
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
        if (!parsed || typeof parsed !== "object") {
          continue;
        }

        Object.assign(mergedCache, parsed);
      } catch {
        // ignore malformed cache entries
      }
    }

    if (Object.keys(mergedCache).length) {
      return mergedCache;
    }

    try {
      const parsed = JSON.parse(
        localStorage.getItem(TELEGRAM_CHAT_ID_CACHE_STORAGE_KEY) || "{}"
      );
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveTelegramChatIdCache(nextCache) {
    localStorage.setItem(
      TELEGRAM_CHAT_ID_CACHE_STORAGE_KEY,
      JSON.stringify(nextCache || {})
    );
  }

  function loadBossAlertHistory() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(BOSS_ALERT_HISTORY_STORAGE_KEY) || "{}"
      );
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveBossAlertHistory(history) {
    localStorage.setItem(
      BOSS_ALERT_HISTORY_STORAGE_KEY,
      JSON.stringify(history || {})
    );
  }

  function pruneBossAlertHistory(dateKey = getBrazilNowParts().dateKey) {
    const originalHistory = loadBossAlertHistory();
    const nextHistory = Object.fromEntries(
      Object.entries(originalHistory).filter(([, value]) => String(value || "") === dateKey)
    );

    if (Object.keys(nextHistory).length !== Object.keys(originalHistory).length) {
      saveBossAlertHistory(nextHistory);
    }

    return nextHistory;
  }

  function hasBossAlertBeenSent(alertKey) {
    if (!alertKey) {
      return false;
    }

    const history = pruneBossAlertHistory();
    return Boolean(history[alertKey]);
  }

  function markBossAlertAsSent(alertKey) {
    if (!alertKey) {
      return;
    }

    const dateKey = getBrazilNowParts().dateKey;
    const history = pruneBossAlertHistory(dateKey);
    history[alertKey] = dateKey;
    saveBossAlertHistory(history);
  }

  function requestJson(method, url, payload = null) {
    return new Promise((resolve, reject) => {
      const headers = {
        "Content-Type": "application/json",
      };

      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: payload,
          onload: (response) => {
            try {
              resolve(JSON.parse(response.responseText || "{}"));
            } catch (error) {
              reject(error);
            }
          },
          onerror: reject,
        });
        return;
      }

      fetch(url, {
        method,
        headers,
        body: payload,
      })
        .then((response) => response.json())
        .then(resolve)
        .catch(reject);
    });
  }

  function requestText(method, url) {
    return new Promise((resolve, reject) => {
      const absoluteUrl = new URL(url, location.origin).href;
      const isSameOrigin = absoluteUrl.startsWith(location.origin);

      if (isSameOrigin) {
        fetch(absoluteUrl, {
          method,
          credentials: "include",
        })
          .then((response) => response.text())
          .then(resolve)
          .catch(reject);
        return;
      }

      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method,
          url: absoluteUrl,
          onload: (response) => resolve(String(response.responseText || "")),
          onerror: reject,
        });
        return;
      }

      fetch(absoluteUrl, { method, credentials: "include" })
        .then((response) => response.text())
        .then(resolve)
        .catch(reject);
    });
  }

  async function resolvePrivateChatId(telegramUsername) {
    const usernameToken = normalizeTelegramUsername(telegramUsername);
    const config = loadConfig();
    if (!config.telegramBotToken || !usernameToken) {
      return "";
    }

    const cached = loadTelegramChatIdCache();
    if (cached[usernameToken]) {
      return String(cached[usernameToken]);
    }

    if (state.chatIdLookupPromises[usernameToken]) {
      return state.chatIdLookupPromises[usernameToken];
    }

    state.chatIdLookupPromises[usernameToken] = requestJson(
      "GET",
      `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/getUpdates`
    )
      .then((data) => {
        if (data?.ok === false) {
          console.warn(
            "[Lamentosa Aviso_Alerta] Telegram getUpdates falhou:",
            data?.description || data
          );
          return "";
        }

        const updates = Array.isArray(data?.result) ? data.result.slice().reverse() : [];
        for (const update of updates) {
          const message = update?.message || update?.edited_message || null;
          if (!message || message?.chat?.type !== "private") {
            continue;
          }

          const fromUsername = normalizeTelegramUsername(message?.from?.username);
          const chatUsername = normalizeTelegramUsername(message?.chat?.username);
          if (fromUsername !== usernameToken && chatUsername !== usernameToken) {
            continue;
          }

          const chatId = String(message?.chat?.id || message?.from?.id || "").trim();
          if (!chatId) {
            continue;
          }

          const nextCache = loadTelegramChatIdCache();
          nextCache[usernameToken] = chatId;
          saveTelegramChatIdCache(nextCache);
          return chatId;
        }

        return "";
      })
      .catch(() => "")
      .finally(() => {
        delete state.chatIdLookupPromises[usernameToken];
      });

    return state.chatIdLookupPromises[usernameToken];
  }

  async function sendTelegramMessageDetailed(chatId, message, options = {}) {
    const config = loadConfig();
    if (!config.telegramEnabled || !config.telegramBotToken || !chatId || !message) {
      return {
        ok: false,
        messageIds: [],
        firstMessageId: 0,
        lastMessageId: 0,
      };
    }

    try {
      const messageParts = splitTelegramMessage(message);
      const messageIds = [];
      for (const messagePart of messageParts) {
        const response = await requestJson(
          "POST",
          `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/sendMessage`,
          JSON.stringify({
            chat_id: chatId,
            text: messagePart,
            disable_notification: Boolean(options.disableNotification),
          })
        );

        if (response?.ok === false) {
          console.warn(
            "[Lamentosa Aviso_Alerta] Telegram sendMessage falhou:",
            response?.description || response
          );
          return {
            ok: false,
            messageIds,
            firstMessageId: messageIds[0] || 0,
            lastMessageId: messageIds[messageIds.length - 1] || 0,
          };
        }

        const messageId = Number(response?.result?.message_id || 0);
        if (Number.isFinite(messageId) && messageId > 0) {
          messageIds.push(messageId);
        }
      }
      return {
        ok: true,
        messageIds,
        firstMessageId: messageIds[0] || 0,
        lastMessageId: messageIds[messageIds.length - 1] || 0,
      };
    } catch (error) {
      console.warn("[Lamentosa Aviso_Alerta] Erro ao enviar Telegram:", error);
      return {
        ok: false,
        messageIds: [],
        firstMessageId: 0,
        lastMessageId: 0,
      };
    }
  }

  async function sendTelegramMessage(chatId, message, options = {}) {
    const result = await sendTelegramMessageDetailed(chatId, message, options);
    return result.ok;
  }

  async function pinTelegramMessage(chatId, messageId, options = {}) {
    const config = loadConfig();
    if (!config.telegramEnabled || !config.telegramBotToken || !chatId || !messageId) {
      return false;
    }

    try {
      const response = await requestJson(
        "POST",
        `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/pinChatMessage`,
        JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          disable_notification: Boolean(options.disableNotification),
        })
      );

      if (response?.ok === false) {
        console.warn(
          "[Lamentosa Aviso_Alerta] Telegram pinChatMessage falhou:",
          response?.description || response
        );
        return false;
      }

      return true;
    } catch (error) {
      console.warn("[Lamentosa Aviso_Alerta] Erro ao fixar mensagem no Telegram:", error);
      return false;
    }
  }

  function splitTelegramMessage(message, maxLength = 3500) {
    const text = String(message || "").trim();
    if (!text) {
      return [];
    }

    if (text.length <= maxLength) {
      return [text];
    }

    const parts = [];
    let current = "";
    for (const line of text.split("\n")) {
      const nextCandidate = current ? `${current}\n${line}` : line;
      if (nextCandidate.length <= maxLength) {
        current = nextCandidate;
        continue;
      }

      if (current) {
        parts.push(current);
      }

      if (line.length <= maxLength) {
        current = line;
        continue;
      }

      let remainingLine = line;
      while (remainingLine.length > maxLength) {
        parts.push(remainingLine.slice(0, maxLength));
        remainingLine = remainingLine.slice(maxLength);
      }
      current = remainingLine;
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  async function sendGroupTelegramMessage(message) {
    const config = loadConfig();
    if (!config.telegramChatId) {
      return false;
    }

    return sendTelegramMessage(config.telegramChatId, message);
  }

  async function sendPinnedGroupTelegramMessage(message) {
    const config = loadConfig();
    if (!config.telegramChatId) {
      return {
        sent: false,
        pinned: false,
      };
    }

    const sendResult = await sendTelegramMessageDetailed(config.telegramChatId, message, {
      disableNotification: false,
    });
    if (!sendResult.ok) {
      return {
        sent: false,
        pinned: false,
      };
    }

    const pinned = sendResult.firstMessageId
      ? await pinTelegramMessage(config.telegramChatId, sendResult.firstMessageId, {
          disableNotification: false,
        })
      : false;

    return {
      sent: true,
      pinned,
    };
  }

  async function sendPrivateBossTelegramMessage(message) {
    const config = loadConfig();
    const chatId = await resolvePrivateChatId(config.privateBossTelegramUsername);
    if (!chatId) {
      console.warn(
        `[Lamentosa Aviso_Alerta] Nao consegui resolver o chat_id privado de @${config.privateBossTelegramUsername}.`
      );
      return false;
    }

    return sendTelegramMessage(chatId, message);
  }

  function formatBrazilTimestamp(date = new Date()) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function parseChatClock(timeText) {
    const match = String(timeText || "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    return {
      hour: Number(match[1]),
      minute: Number(match[2]),
      second: Number(match[3]),
      text: `${String(Number(match[1])).padStart(2, "0")}:${match[2]}:${match[3]}`,
    };
  }

  function formatChatTimestamp(eventDate, timeText) {
    const dateValue =
      eventDate instanceof Date && !Number.isNaN(eventDate.getTime()) ? eventDate : new Date();
    const dateLabel = new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateValue);
    const clock = parseChatClock(timeText);
    return `${dateLabel}, ${clock?.text || formatBrazilTimestamp(dateValue).split(", ")[1]}`;
  }

  function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function parseBrazilianDateTime(rawText) {
    const text = normalize(rawText).replace(/\s+/g, " ").trim();
    const match = text.match(
      /^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\s+as\s+(\d{1,2}):(\d{2})$/i
    );
    if (!match) {
      return null;
    }

    const monthMap = {
      janeiro: 0,
      fevereiro: 1,
      marco: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };
    const monthName = match[2];
    const monthIndex = monthMap[monthName];
    if (!Number.isInteger(monthIndex)) {
      return null;
    }

    const result = new Date(
      Number(match[3]),
      monthIndex,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      0,
      0
    );

    return Number.isNaN(result.getTime()) ? null : result;
  }

  function formatTelegramDateTime(date) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function getBrazilNowParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: BRAZIL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    const partMap = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== "literal") {
        partMap[part.type] = part.value;
      }
    }

    return {
      dateKey: `${partMap.year}-${partMap.month}-${partMap.day}`,
      hour: Number(partMap.hour || 0),
      minute: Number(partMap.minute || 0),
    };
  }

  function getChatMessageContainer(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest(CHAT_MESSAGE_SELECTOR);
  }

  function getMessageContentNode(messageNode) {
    if (!(messageNode instanceof Element)) {
      return null;
    }

    return (
      messageNode.querySelector(".gc-in-msg") ||
      messageNode.querySelector(".gc-msg") ||
      messageNode
    );
  }

  function getContextText(messageNode) {
    return String(getMessageContentNode(messageNode)?.innerText || messageNode.textContent || "");
  }

  function getChatMessageTimeText(messageNode) {
    const container = getChatMessageContainer(messageNode) || messageNode;
    const directText = String(container?.innerText || "");
    const directMatch = directText.match(/\b(\d{1,2}:\d{2}:\d{2})\b/);
    if (directMatch) {
      return directMatch[1];
    }

    const timeNode = Array.from(container?.querySelectorAll("*") || []).find((node) =>
      /^\d{1,2}:\d{2}:\d{2}$/.test(String(node.textContent || "").trim())
    );
    return timeNode ? String(timeNode.textContent || "").trim() : "";
  }

  function getEventDate(messageNode) {
    const timeText = getChatMessageTimeText(messageNode);
    if (!timeText) {
      return new Date();
    }

    const match = timeText.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return new Date();
    }

    const now = new Date();
    const eventDate = new Date(now);
    eventDate.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0);

    if (eventDate.getTime() - now.getTime() > 12 * 60 * 60 * 1000) {
      eventDate.setDate(eventDate.getDate() - 1);
    } else if (now.getTime() - eventDate.getTime() > 12 * 60 * 60 * 1000) {
      eventDate.setDate(eventDate.getDate() + 1);
    }

    return eventDate;
  }

  function getWarCategoryByHour(hour) {
    if (hour === 13 || hour === 14) {
      return "soldier";
    }

    if (hour === 16 || hour === 17) {
      return "warrior";
    }

    if (hour === 19 || hour === 20) {
      return "voivodas";
    }

    if (hour === 22 || hour === 23) {
      return "elders";
    }

    return "";
  }

  function findTrackedPlayerNameInText(text) {
    const textToken = normalizeToken(text);
    for (const player of TARGET_PLAYERS) {
      if (textToken.includes(normalizeToken(player))) {
        return player;
      }
    }
    return null;
  }

  function findPlayerName(messageNode) {
    const publicAnchors = Array.from(messageNode.querySelectorAll("a")).filter((anchor) => {
      const href = anchor.getAttribute("href") || anchor.getAttribute("hx-get") || "";
      return href.includes("/public/");
    });

    for (const anchor of publicAnchors) {
      const text = cleanupLabel(anchor.textContent);
      if (TARGET_PLAYERS.some((player) => normalizeToken(player) === normalizeToken(text))) {
        return text;
      }
    }

    return findTrackedPlayerNameInText(getContextText(messageNode));
  }

  function isDungeonAnnouncement(messageNode) {
    const text = normalize(getContextText(messageNode));
    return text.includes("started a new dungeon");
  }

  function isPoisonAttemptMessage(messageNode) {
    const text = normalize(getContextText(messageNode));
    return POISON_ATTEMPT_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function getPublicPlayerAnchors(messageNode) {
    return Array.from(messageNode.querySelectorAll("a")).filter((anchor) => {
      const href = anchor.getAttribute("href") || anchor.getAttribute("hx-get") || "";
      return href.includes("/public/");
    });
  }

  function findPublicAnchorInTextPart(anchors, textPart) {
    const textToken = normalizeToken(textPart);
    return (
      anchors.find((anchor) => {
        const token = normalizeToken(anchor.textContent || "");
        return token && textToken.includes(token);
      }) || null
    );
  }

  function findPoisonAttemptDetails(messageNode) {
    if (!isPoisonAttemptMessage(messageNode)) {
      return null;
    }

    const rawText = String(getContextText(messageNode))
      .replace(/\s+/g, " ")
      .trim();
    const match = rawText.match(/(.+?)\s+(?:try|tries|tried)\s+to\s+poison\s+(.+?)(?:[.!]|$)/i);
    if (!match) {
      return null;
    }

    const attackerPart = cleanupLabel(match[1]);
    const receiverPart = cleanupLabel(match[2]);
    const targetName = findTrackedPlayerNameInText(receiverPart);
    if (!targetName) {
      return null;
    }

    const publicAnchors = getPublicPlayerAnchors(messageNode);
    const attackerAnchor = findPublicAnchorInTextPart(publicAnchors, attackerPart);
    const targetAnchor = findPublicAnchorInTextPart(publicAnchors, receiverPart);

    return {
      attackerName: cleanupLabel(attackerAnchor?.textContent || attackerPart || "Alguem"),
      targetName: cleanupLabel(targetAnchor?.textContent || targetName),
    };
  }

  function getBossLinkValue(anchor) {
    return (
      anchor.getAttribute("href") ||
      anchor.getAttribute("hx-get") ||
      anchor.getAttribute("data-href") ||
      anchor.href ||
      ""
    );
  }

  function findBossAnchor(messageNode) {
    return (
      Array.from(messageNode.querySelectorAll("a")).find((anchor) =>
        getBossLinkValue(anchor).includes("/boss/")
      ) || null
    );
  }

  function isBossAnnouncement(messageNode, bossAnchor) {
    if (!bossAnchor) {
      return false;
    }

    const context = normalize(getContextText(messageNode));
    const contextToken = normalizeToken(getContextText(messageNode));
    return (
      getBossLinkValue(bossAnchor).includes("/boss/") &&
      (context.includes("boss") || contextToken.includes("boss")) &&
      BOSS_SPAWN_PATTERNS.some((pattern) => {
        const patternText = normalize(pattern);
        const patternToken = normalizeToken(pattern);
        return context.includes(patternText) || contextToken.includes(patternToken);
      })
    );
  }

  function parseClanBattleLine(rawText) {
    const compactText = String(rawText || "")
      .replace(/\s+/g, " ")
      .trim();

    const match = compactText.match(/^(.+?)\s+[x×]\s+(.+?)\s*:\s*(.+)$/i);
    if (!match) {
      return null;
    }

    return {
      leftClan: cleanupLabel(match[1]),
      rightClan: cleanupLabel(match[2]),
      detailText: cleanupLabel(match[3]),
      compactText,
    };
  }

  function findGvgAlertDetails(messageNode) {
    const parsed = parseClanBattleLine(getContextText(messageNode));
    if (!parsed) {
      return null;
    }

    const detailToken = normalizeToken(parsed.detailText);
    const compactToken = normalizeToken(parsed.compactText);
    const hasGvg = detailToken.includes("gvg") || compactToken.includes("gvg");
    const battleStarted = detailToken.includes("battlestarted");
    const infernnumInvolved =
      isInfernnnumClanName(parsed.leftClan) || isInfernnnumClanName(parsed.rightClan);

    if (!hasGvg || !battleStarted || !infernnumInvolved) {
      return null;
    }

    const eventDate = getEventDate(messageNode);
    const timeText = getChatMessageTimeText(messageNode);
    const chatClock = parseChatClock(timeText);
    const category = getWarCategoryByHour(chatClock?.hour ?? eventDate.getHours());
    if (!category) {
      return null;
    }

    const timestamp = formatChatTimestamp(eventDate, timeText);
    const alertKey =
      `gvg|${timestamp}|${normalize(parsed.leftClan)}|${normalize(parsed.rightClan)}|${category}`;

    return {
      leftClan: parsed.leftClan,
      rightClan: parsed.rightClan,
      category,
      timestamp,
      alertKey,
    };
  }

  function findTormentusWarDetails(messageNode) {
    const rawText = String(getContextText(messageNode) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!rawText) {
      return null;
    }

    const rawToken = normalizeToken(rawText);
    const isTormentusWar =
      rawToken.includes("tormentuswar") ||
      /\btw\b/i.test(rawText);
    if (!isTormentusWar || !isInfernnnumClanName(rawText)) {
      return null;
    }

    const parsed = parseClanBattleLine(rawText);
    const eventDate = getEventDate(messageNode);
    const timestamp = formatChatTimestamp(eventDate, getChatMessageTimeText(messageNode));
    const participantsText = parsed
      ? `${parsed.leftClan} x ${parsed.rightClan}`
      : cleanupLabel(rawText);
    const alertKey = `tw|${timestamp}|${normalize(participantsText)}`;

    return {
      participantsText,
      timestamp,
      alertKey,
    };
  }

  function getBossNameFromAnchor(bossAnchor) {
    return cleanupLabel(bossAnchor?.textContent || "");
  }

  function parseLabeledTable(doc) {
    const rows = Array.from(doc.querySelectorAll(".smart-table-modal li"));
    const map = {};
    for (const row of rows) {
      const spans = Array.from(row.querySelectorAll("span"));
      if (spans.length < 2) {
        continue;
      }

      const key = normalize(spans[0].textContent || "");
      const value = cleanupLabel(
        spans
          .slice(1)
          .map((span) => cleanupLabel(span.textContent || ""))
          .filter(Boolean)
          .join(" ")
      );
      if (key && value) {
        map[key] = value;
      }
    }
    return map;
  }

  async function fetchUniqueList() {
    const html = await requestText("GET", new URL(UNIQUE_LIST_URL, location.origin).href);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll(".market-items > li"))
      .map((itemNode) => {
        const anchor = itemNode.querySelector("a[href*='/items/uniques/']");
        const spans = Array.from(itemNode.querySelectorAll("div span"));
        const name = cleanupLabel(spans[0]?.textContent || anchor?.getAttribute("title") || "");
        const slotLabel = cleanupLabel(
          String(spans[1]?.textContent || "")
            .replace(/\s*\((?:unico|único)\)\s*/gi, "")
            .trim()
        );
        const href =
          anchor?.getAttribute("href") ||
          anchor?.getAttribute("hx-get") ||
          "";

        if (!name || !href) {
          return null;
        }

        return {
          name,
          slotLabel,
          href: new URL(href, location.origin).href,
        };
      })
      .filter(Boolean);
  }

  async function fetchUniqueOwnerInfo(uniqueItem) {
    const html = await requestText("GET", uniqueItem.href);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = parseLabeledTable(doc);
    const ownerAnchor = doc.querySelector(".smart-table-modal a[href*='/public/']");
    const ownerName = cleanupLabel(ownerAnchor?.textContent || table["dono"] || "");
    const isBossOwner = normalize(ownerName).startsWith("boss:");
    const ownedSinceText = cleanupLabel(table["dono desde"] || "");
    const ownedSinceDate = parseBrazilianDateTime(ownedSinceText);
    const expiresAt =
      !isBossOwner && ownedSinceDate ? addDays(ownedSinceDate, UNIQUE_OWNERSHIP_DAYS) : null;

    return {
      name: uniqueItem.name,
      slotLabel: uniqueItem.slotLabel || cleanupLabel(table["slot"] || "Item"),
      ownerName: ownerName || "Sem dono",
      isBossOwner,
      ownedSinceDate,
      expiresAt,
    };
  }

  async function buildUniqueOwnershipReport() {
    const uniqueItems = await fetchUniqueList();
    const results = [];

    for (const uniqueItem of uniqueItems) {
      try {
        results.push(await fetchUniqueOwnerInfo(uniqueItem));
      } catch (error) {
        console.warn("[Lamentosa Aviso_Alerta] Falha ao ler unique", uniqueItem?.name, error);
      }
    }

    results.sort((left, right) => {
      const leftTime = left.expiresAt ? left.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.expiresAt ? right.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    });

    return results;
  }

  function formatUniqueReportMessage(uniqueItems) {
    const getSlotEmoji = (slotLabel) => {
      const token = normalizeToken(slotLabel);
      if (token.includes("mao")) {
        return "⚔️";
      }
      if (token.includes("cabeca")) {
        return "👑";
      }
      if (token.includes("torso")) {
        return "🛡️";
      }
      if (token.includes("pescoco")) {
        return "📿";
      }
      return "✨";
    };

    const lines = [
      `Relatorio de uniques ${formatTelegramDateTime(new Date())} (pt-BR)`,
    ];

    for (const uniqueItem of uniqueItems) {
      const slotLabel = cleanupLabel(uniqueItem.slotLabel || "Item");
      const slotEmoji = getSlotEmoji(slotLabel);
      const blockLines = [
        "",
        `${slotEmoji} ${slotLabel}: ${uniqueItem.name}`,
        `Dono: ${uniqueItem.ownerName}`,
      ];

      if (!uniqueItem.isBossOwner) {
        const expiresLabel = uniqueItem.expiresAt
          ? formatTelegramDateTime(uniqueItem.expiresAt)
          : "nao consegui calcular";
        blockLines.push(`Vai cair em: ${expiresLabel}`);
      }

      lines.push(...blockLines);
    }

    return lines.join("\n");
  }

  async function maybeRunUniqueReport(options = {}) {
    const force = Boolean(options?.force);
    if ((!isEnabled() && !force) || state.uniqueReportInFlight) {
      return;
    }

    const nowParts = getBrazilNowParts();
    if (!force) {
      if (nowParts.hour !== UNIQUE_REPORT_SEND_HOUR) {
        return;
      }

      if (loadUniqueReportLastSentDateKey() === nowParts.dateKey) {
        return;
      }
    }

    state.uniqueReportInFlight = true;
    try {
      const uniqueItems = await buildUniqueOwnershipReport();
      if (!uniqueItems.length) {
        showToast("Nao consegui montar o relatorio de uniques.");
        return;
      }

      const message = formatUniqueReportMessage(uniqueItems);
      const sent = await sendPrivateBossTelegramMessage(message);
      if (sent) {
        saveUniqueReportLastSentDateKey(nowParts.dateKey);
        showToast(force ? "Relatorio de uniques de teste enviado no privado." : "Relatorio de uniques enviado no privado.");
      } else {
        showToast("Falha ao enviar o relatorio de uniques no privado. Verifique se o bot ja falou com @Wskratos.");
      }
    } catch (error) {
      console.error("[Lamentosa Aviso_Alerta] Falha no relatorio de uniques", error);
      showToast("Falha ao consultar uniques.");
    } finally {
      state.uniqueReportInFlight = false;
    }
  }

  function startUniqueReportLoop() {
    if (state.uniqueReportIntervalId) {
      window.clearInterval(state.uniqueReportIntervalId);
      state.uniqueReportIntervalId = 0;
    }

    state.uniqueReportIntervalId = window.setInterval(() => {
      void maybeRunUniqueReport();
    }, UNIQUE_REPORT_CHECK_INTERVAL_MS);

    void maybeRunUniqueReport();
  }

  const ELDER_BOSS_NAME_SET = new Set(ELDER_BOSS_NAMES.map(normalize).filter(Boolean));
  const UNIQUE_ITEM_NAME_SET = new Set(UNIQUE_ITEM_NAMES.map(normalize).filter(Boolean));

  function isElderBossName(bossName) {
    const bossNameNorm = normalize(bossName);
    if (!bossNameNorm) {
      return false;
    }

    for (const elderBossName of ELDER_BOSS_NAME_SET) {
      if (
        bossNameNorm === elderBossName ||
        bossNameNorm.includes(elderBossName) ||
        elderBossName.includes(bossNameNorm)
      ) {
        return true;
      }
    }

    return false;
  }

  function getBossAlertCategory(messageNode, bossName) {
    const contextToken = normalizeToken(getContextText(messageNode));
    if (contextToken.includes("elder2")) {
      return "elder2";
    }

    if (isElderBossName(bossName) || contextToken.includes("elder")) {
      return "elder";
    }

    if (contextToken.includes("soldier")) {
      return "soldier";
    }

    return "";
  }

  function shouldMentionPrivateUserForOwner(ownerName) {
    const ownerToken = normalizeToken(ownerName);
    if (!ownerToken) {
      return false;
    }

    return GROUP_MENTION_OWNER_NAMES.some((name) => {
      const nameToken = normalizeToken(name);
      return (
        ownerToken === nameToken ||
        ownerToken.includes(nameToken) ||
        nameToken.includes(ownerToken) ||
        (ownerToken.includes("kratos") && nameToken.includes("kratos")) ||
        (ownerToken.includes("abigoris") && nameToken.includes("abigoris"))
      );
    });
  }

  async function fetchBossInfo(bossAnchor) {
    const href = getBossLinkValue(bossAnchor);
    if (!href) {
      return {
        bossName: getBossNameFromAnchor(bossAnchor),
        ownerName: "",
        hasUnique: null,
      };
    }

    const url = new URL(href, location.origin).href;
    const html = await requestText("GET", url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const fallbackBossName = getBossNameFromAnchor(bossAnchor);
    const pageTitleBossName = cleanupLabel(
      doc.querySelector(".page-title h1, h1")?.textContent || ""
    );
    const bossName = pageTitleBossName || fallbackBossName || "Boss";

    return {
      bossName,
      ownerName: extractBossOwnerName(doc),
      hasUnique: detectBossUnique(doc),
    };
  }

  async function waitForBossInfo(bossAnchor) {
    const deadline = Date.now() + BOSS_INFO_WAIT_TIMEOUT_MS;
    let latestInfo = null;

    while (Date.now() <= deadline) {
      latestInfo = await fetchBossInfo(bossAnchor);
      if (cleanupLabel(latestInfo?.ownerName || "")) {
        return latestInfo;
      }

      await sleep(BOSS_INFO_POLL_INTERVAL_MS);
    }

    return latestInfo;
  }

  function extractBossOwnerName(doc) {
    const candidateRoots = [
      ...Array.from(doc.querySelectorAll(".lobby-info, .l-lobby-info, .modal-content, .inside-info")),
      doc.body,
    ].filter(Boolean);

    for (const root of candidateRoots) {
      const line = Array.from(root.querySelectorAll?.("li, p, div, span") || []).find((node) =>
        normalize(node.textContent || "").startsWith("dono da sessao")
      );
      if (!line) {
        continue;
      }

      const ownerAnchor = line.querySelector("a[href*='/public/']");
      if (ownerAnchor) {
        const ownerFromAnchor = sanitizeBossOwnerName(ownerAnchor.textContent || "");
        if (isLikelyBossOwnerName(ownerFromAnchor)) {
          return ownerFromAnchor;
        }
        continue;
      }

      const rawText = cleanupLabel(line.textContent || "");
      const ownerText = sanitizeBossOwnerName(rawText.replace(/^dono da sessao\s*:?\s*/i, ""));
      if (isLikelyBossOwnerName(ownerText)) {
        return ownerText;
      }
    }

    return "";
  }

  function detectBossUnique(doc) {
    const focusedHaystacks = Array.from(
      doc.querySelectorAll(".drops, .drops li, img[src*='/items/unique/']")
    ).map((node) =>
      normalize(
        [
          node.getAttribute?.("src"),
          node.getAttribute?.("class"),
          node.getAttribute?.("title"),
          node.getAttribute?.("alt"),
          node.textContent,
        ]
          .filter(Boolean)
          .join(" ")
      )
    );

    const haystacks = focusedHaystacks.length
      ? focusedHaystacks
      : [normalize(doc.body?.innerText || doc.documentElement?.textContent || "")];

    return haystacks.some((haystack) => {
      if (/\b(unique|unico)\b/.test(haystack)) {
        return true;
      }

      for (const uniqueItemName of UNIQUE_ITEM_NAME_SET) {
        if (haystack.includes(uniqueItemName)) {
          return true;
        }
      }

      return false;
    });
  }

  async function sendDungeonAlert(playerName, eventDate) {
    const timestamp = formatBrazilTimestamp(eventDate);
    await sendGroupTelegramMessage(`[${timestamp}] ${playerName} abriu Dungeon.`);
  }

  async function sendPoisonAttemptAlert(attackerName, targetName, eventDate) {
    const timestamp = formatBrazilTimestamp(eventDate);
    const reapplyAt = formatBrazilTimestamp(addHours(eventDate, 2));
    await sendGroupTelegramMessage(
      `[${timestamp}] ${attackerName} tentou envenenar ${targetName}. Jogar veneno novamente as ${reapplyAt} (pt-BR).`
    );
  }

  async function sendGvgAlert(gvgDetails) {
    if (!gvgDetails || hasWarAlertBeenSent(gvgDetails.alertKey)) {
      return;
    }

    const groupMessage =
      `[${gvgDetails.timestamp}] GVG ${gvgDetails.category}: ` +
      `${gvgDetails.leftClan} x ${gvgDetails.rightClan}.`;
    const groupResult = await sendPinnedGroupTelegramMessage(groupMessage);
    if (groupResult.sent) {
      markWarAlertAsSent(gvgDetails.alertKey);
    }
  }

  async function sendTormentusWarAlert(twDetails) {
    if (!twDetails || hasWarAlertBeenSent(twDetails.alertKey)) {
      return;
    }

    const groupMessage =
      `[${twDetails.timestamp}] Tormentus War detectada para ${twDetails.participantsText}.`;
    const groupResult = await sendPinnedGroupTelegramMessage(groupMessage);
    if (groupResult.sent) {
      markWarAlertAsSent(twDetails.alertKey);
    }
  }

  async function sendBossAlert(messageNode, bossAnchor) {
    const eventDate = getEventDate(messageNode);
    const fallbackBossName = getBossNameFromAnchor(bossAnchor) || "Boss";
    const category = getBossAlertCategory(messageNode, fallbackBossName);
    if (!category) {
      return;
    }

    const sessionBaseKey = `${normalize(fallbackBossName) || "boss"}|${category}`;
    if (bossKeysInFlight.has(sessionBaseKey)) {
      return;
    }

    bossKeysInFlight.add(sessionBaseKey);
    try {
      let bossInfo;
      try {
        bossInfo = await waitForBossInfo(bossAnchor);
      } catch (error) {
        console.warn("[Lamentosa Aviso_Alerta] Falha ao ler detalhes do boss", error);
        bossInfo = {
          bossName: fallbackBossName,
          ownerName: "",
          hasUnique: null,
        };
      }

      const bossName = cleanupLabel(bossInfo.bossName || fallbackBossName || "Boss");
      const ownerName = sanitizeBossOwnerName(bossInfo.ownerName || "Alguem");
      const alertKey =
        `${normalize(bossName) || "boss"}|` +
        `${normalize(ownerName) || "semdono"}|${category}`;

      if (!cleanupLabel(bossInfo.ownerName || "")) {
        showToast(`Boss ${bossName} detectado, mas a sessao ainda nao abriu para ler o dono.`);
        return;
      }

      if (hasBossAlertBeenSent(alertKey)) {
        return;
      }

      if (category === "soldier") {
        const sent = await sendPrivateBossTelegramMessage(
          `O boss ${bossName} foi aberto por ${ownerName}.`
        );
        if (sent) {
          markBossAlertAsSent(alertKey);
        }
        showToast(`Boss soldado ${bossName} aberto por ${ownerName}. Aviso privado enviado.`);
        return;
      }

      const uniqueSuffix =
        bossInfo.hasUnique === true
          ? "e tem unique."
          : bossInfo.hasUnique === false
            ? "e nao tem unique."
            : "e nao consegui confirmar unique.";

      const shouldMentionInGroup = bossInfo.hasUnique === true;
      const mentionPrefix = shouldMentionInGroup ? `${GROUP_PRIVATE_MENTION} ` : "";
      const groupMessage = `${mentionPrefix}O boss ${bossName} foi aberto por ${ownerName} ${uniqueSuffix}`;
      const groupResult = await sendPinnedGroupTelegramMessage(groupMessage);
      const groupSent = groupResult.sent;

      let privateSent = false;
      if (bossInfo.hasUnique === true) {
        privateSent = await sendPrivateBossTelegramMessage(
          `O boss ${bossName} foi aberto por ${ownerName} e tem unique.`
        );
      }

      if (groupSent || privateSent) {
        markBossAlertAsSent(alertKey);
      }

      showToast(
        groupSent && groupResult.pinned
          ? `Boss elder ${bossName} aberto por ${ownerName}. Aviso enviado e fixado no grupo.`
          : `Boss elder ${bossName} aberto por ${ownerName}.`
      );
    } finally {
      bossKeysInFlight.delete(sessionBaseKey);
    }
  }

  async function handleMessage(messageNode, isInitial) {
    const config = loadConfig();
    if (!config.enabled) {
      return;
    }

    if (!(messageNode instanceof HTMLElement)) {
      return;
    }

    if (state.processedMessageNodes.has(messageNode)) {
      return;
    }
    state.processedMessageNodes.add(messageNode);

    if (isInitial) {
      return;
    }

    const poisonAttempt = findPoisonAttemptDetails(messageNode);
    if (poisonAttempt) {
      const eventDate = getEventDate(messageNode);
      showToast(
        `${poisonAttempt.attackerName} tentou envenenar ${poisonAttempt.targetName}.`
      );
      speakAlert();
      await sendPoisonAttemptAlert(
        poisonAttempt.attackerName,
        poisonAttempt.targetName,
        eventDate
      );
      return;
    }

    if (isDungeonAnnouncement(messageNode)) {
      const playerName = findPlayerName(messageNode);
      if (playerName) {
        const eventDate = getEventDate(messageNode);
        showToast(`Dungeon de ${playerName} detectada.`);
        speakAlert();
        await sendDungeonAlert(playerName, eventDate);
        return;
      }
    }

    const gvgDetails = findGvgAlertDetails(messageNode);
    if (gvgDetails) {
      showToast(
        `GVG ${gvgDetails.category} detectada: ${gvgDetails.leftClan} x ${gvgDetails.rightClan}.`
      );
      speakAlert();
      await sendGvgAlert(gvgDetails);
      return;
    }

    const twDetails = findTormentusWarDetails(messageNode);
    if (twDetails) {
      showToast(`Tormentus War detectada: ${twDetails.participantsText}.`);
      speakAlert();
      await sendTormentusWarAlert(twDetails);
      return;
    }

    const bossAnchor = findBossAnchor(messageNode);
    if (isBossAnnouncement(messageNode, bossAnchor)) {
      speakAlert();
      await sendBossAlert(messageNode, bossAnchor);
    }
  }

  function bootstrapChatObserver(chatList) {
    Array.from(chatList.children).forEach((node) => {
      void handleMessage(node, true);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          if (node.matches("li")) {
            void handleMessage(node, false);
            continue;
          }

          node.querySelectorAll?.("li").forEach((child) => {
            void handleMessage(child, false);
          });
        }
      }
    });

    observer.observe(chatList, { childList: true, subtree: false });
  }

  function waitForChatList() {
    const chatList = document.querySelector(CHAT_LIST_SELECTOR);
    if (chatList) {
      bootstrapChatObserver(chatList);
      return;
    }

    const observer = new MutationObserver(() => {
      const loadedChatList = document.querySelector(CHAT_LIST_SELECTOR);
      if (!loadedChatList) {
        return;
      }

      observer.disconnect();
      bootstrapChatObserver(loadedChatList);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  ensureDefaultConfigSaved();
  installControls();
  waitForChatList();
  startUniqueReportLoop();
})();
