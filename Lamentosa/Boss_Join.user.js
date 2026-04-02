// ==UserScript==
// @name         Lamentosa Boss Join
// @namespace    codex.lamentosa
// @version      3.3.2
// @description  Le o chat do boss por categoria e entra automaticamente no lobby seguindo a regra 1/2/3/4.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const CONFIG_STORAGE_KEY = "lamentosaBossJoinConfig";
  const ENABLED_STORAGE_KEY = "lamentosaBossJoinEnabled";
  const RUNTIME_STORAGE_KEY = "lamentosaBossJoinRuntime";
  const BOSS_AUTO_STORAGE_KEY = "lamentosaBossAutoConfig";
  const CONTROL_BUTTON_ID = "lamentosa-boss-join-config-btn";
  const TOAST_ID = "lamentosa-boss-join-toast";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-boss-join-slot";
  const UI_ORDER = 20;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const CHAT_LIST_SELECTOR = "#gChatList";
  const LIFE_CURRENT_SELECTOR = ".g-life .value";
  const LIFE_FULL_SELECTOR = ".g-life .full-life-value";
  const PAGE_STATE_SELECTOR = "#pageState";
  const JOIN_SELECTORS = [
    "a[data-action='boss_join']",
    "button[data-action='boss_join']",
    ".ui-ws-action[data-action='boss_join']",
    "a.btn.ui-ws-action[data-action='boss_join']",
  ].join(", ");
  const TIMER_SELECTOR = "#fieldTimer";
  const TEMPLE_PATH = "/temple/main-room/";
  const POLL_INTERVAL_MS = 200;
  const DEFAULT_MAX_ENTRIES = 4;
  const FIRST_TURN_WINDOW_START_TIME = "00:02:00";
  const FIRST_TURN_WINDOW_END_TIME = "00:01:59";
  const FOLLOWUP_WINDOW_START_TIME = "00:01:48";
  const FOLLOWUP_WINDOW_END_TIME = "00:01:47";
  const JOIN_FAILURE_SELECTORS = [
    ".alert",
    ".alert-danger",
    ".text-danger",
    ".notification",
    ".message",
    ".msg",
    "[role='alert']",
    "body",
  ].join(", ");
  const JOIN_FAILURE_PATTERNS = [
    ["vagas", "seu", "cla", "preenchidas"],
    ["vagas", "clã", "preenchidas"],
    ["vagas", "nao", "membros", "cla", "ja", "foram", "preenchidas"],
    ["vagas", "nao", "membros", "do", "cla", "ja", "foram", "preenchidas"],
    ["slots", "your", "clan", "filled"],
    ["your", "clan", "already", "filled"],
  ];
  const CATEGORY_DEFAULTS = [
    { label: "Aprendiz", keyword: "apprentice" },
    { label: "Soldado", keyword: "soldier" },
    { label: "Guerreiro", keyword: "warrior" },
    { label: "Voivoda", keyword: "voivoda" },
    { label: "Anciao", keyword: "elder" },
    { label: "Anciao 2", keyword: "elder2" },
    { label: "Personalizado", keyword: "" },
  ];

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  const state = {
    intervalId: null,
    clicked: false,
    lastStatusMessage: "",
    chatObserver: null,
    chatListReady: false,
    seenChatKeys: new Set(),
    chatClickTriggered: false,
    chatSeeded: false,
    buttonNode: null,
  };

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function parseInteger(rawValue) {
    const digits = String(rawValue || "").replace(/[^\d]/g, "");
    if (!digits) {
      return null;
    }

    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getLifeStatus() {
    const currentElement = document.querySelector(LIFE_CURRENT_SELECTOR);
    const fullElement = document.querySelector(LIFE_FULL_SELECTOR);
    const current = parseInteger(currentElement?.textContent);
    const full = parseInteger(fullElement?.textContent);

    if (!current || !full || full <= 0) {
      return null;
    }

    return {
      current,
      full,
      isFull: current >= full,
    };
  }

  function isTemplePage() {
    return location.pathname.includes("/temple/main-room");
  }

  function isBossOrDungeonPage() {
    return location.pathname.includes("/boss") || location.pathname.includes("/dungeon");
  }

  function isActivityFinished() {
    const text = normalizeText(document.querySelector(PAGE_STATE_SELECTOR)?.textContent || "");
    return text.includes("terminado") || text.includes("finished") || text.includes("finish");
  }

  function getTempleUrl() {
    return new URL(TEMPLE_PATH, location.origin).href;
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
      slot.style.maxWidth = "260px";
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
      slot,
      buttonHost: slot.children[0],
      toastHost: slot.children[1],
    };
  }

  function showToast(message, force = false) {
    if (!force && state.lastStatusMessage === message) {
      return;
    }

    state.lastStatusMessage = message;
    console.log(`[Lamentosa Boss Join] ${message}`);
  }

  function findJoinFailureMessage() {
    const candidates = Array.from(document.querySelectorAll(JOIN_FAILURE_SELECTORS));
    for (const candidate of candidates) {
      if (candidate !== document.body && !isVisible(candidate)) {
        continue;
      }

      const text = normalizeText(candidate.innerText || candidate.textContent || "");
      if (!text) {
        continue;
      }

      const matched = JOIN_FAILURE_PATTERNS.some((parts) =>
        parts.every((part) => text.includes(normalizeText(part)))
      );
      if (matched) {
        return String(candidate.innerText || candidate.textContent || "").trim();
      }
    }

    return "";
  }

  function loadEnabled() {
    const raw = localStorage.getItem(ENABLED_STORAGE_KEY);
    return raw !== "false";
  }

  function saveEnabled(enabled) {
    localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  }

  function updateButtonState() {
    if (!state.buttonNode) {
      return;
    }

    state.buttonNode.style.background = loadEnabled() ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
  }

  function toggleEnabled() {
    saveEnabled(!loadEnabled());
    updateButtonState();
    location.reload();
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

  function dispatchClick(element) {
    const eventNames = ["mousedown", "mouseup", "click"];
    for (const eventName of eventNames) {
      element.dispatchEvent(
        new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    }
    if (typeof element.click === "function") {
      element.click();
    }
  }

  function activateElement(element) {
    if (!element) {
      return;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", inline: "center" });
    }

    const tagName = String(element.tagName || "").toLowerCase();
    const type = normalizeToken(element.getAttribute("type") || "");
    if ((tagName === "button" || tagName === "input") && type === "submit" && element.form) {
      try {
        if (typeof element.form.requestSubmit === "function") {
          element.form.requestSubmit(element);
          return;
        }
      } catch (error) {
        console.warn("[Lamentosa Boss Join] requestSubmit falhou, tentando click normal", error);
      }
    }

    dispatchClick(element);
  }

  function parseTimerText(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      return null;
    }

    const parts = value.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
      return null;
    }

    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      if (seconds > 59) {
        return null;
      }
      return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      if (minutes > 59 || seconds > 59) {
        return null;
      }
      return hours * 3600 + minutes * 60 + seconds;
    }

    return null;
  }

  function chooseCategory(rawValue) {
    const raw = String(rawValue || "").trim();
    if (/^\d+$/.test(raw)) {
      const index = Number(raw) - 1;
      if (CATEGORY_DEFAULTS[index]) {
        return CATEGORY_DEFAULTS[index];
      }
    }

    const normalized = normalizeToken(raw);
    return (
      CATEGORY_DEFAULTS.find((item) => normalizeToken(item.label) === normalized) || null
    );
  }

  function loadBossAutoFallback() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BOSS_AUTO_STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      const keyword = normalizeToken(parsed.keyword || "");
      const categoryLabel = String(parsed.categoryLabel || "").trim();
      if (!keyword || !categoryLabel) {
        return null;
      }

      return { keyword, categoryLabel };
    } catch (error) {
      return null;
    }
  }

  function sanitizeConfig(config, requireManual = false) {
    const maxEntries = Number(config?.maxEntries ?? DEFAULT_MAX_ENTRIES);
    const firstTurnWindowStartTime = String(
      config?.firstTurnWindowStartTime || FIRST_TURN_WINDOW_START_TIME
    ).trim();
    const firstTurnWindowEndTime = String(
      config?.firstTurnWindowEndTime || FIRST_TURN_WINDOW_END_TIME
    ).trim();
    const windowStartTime = String(
      config?.windowStartTime || FOLLOWUP_WINDOW_START_TIME
    ).trim();
    const windowEndTime = String(
      config?.windowEndTime || FOLLOWUP_WINDOW_END_TIME
    ).trim();
    const firstTurnWindowStartSeconds = parseTimerText(firstTurnWindowStartTime);
    const firstTurnWindowEndSeconds = parseTimerText(firstTurnWindowEndTime);
    const windowStartSeconds = parseTimerText(windowStartTime);
    const windowEndSeconds = parseTimerText(windowEndTime);
    const categoryLabel = String(config?.categoryLabel || "").trim();
    const keyword = normalizeToken(config?.keyword || "");
    const configuredManually = config?.configuredManually === true;

    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10) {
      return null;
    }
    if (
      firstTurnWindowStartSeconds == null ||
      firstTurnWindowEndSeconds == null ||
      windowStartSeconds == null ||
      windowEndSeconds == null
    ) {
      return null;
    }
    if (!categoryLabel || !keyword) {
      return null;
    }
    if (requireManual && !configuredManually) {
      return null;
    }

    return {
      maxEntries,
      firstTurnWindowStartTime,
      firstTurnWindowEndTime,
      firstTurnWindowStartSeconds,
      firstTurnWindowEndSeconds,
      windowStartTime,
      windowEndTime,
      windowStartSeconds,
      windowEndSeconds,
      categoryLabel,
      keyword,
      configuredManually,
    };
  }

  function buildDefaultConfig() {
    const fallback = loadBossAutoFallback();
    return sanitizeConfig({
      maxEntries: DEFAULT_MAX_ENTRIES,
      firstTurnWindowStartTime: FIRST_TURN_WINDOW_START_TIME,
      firstTurnWindowEndTime: FIRST_TURN_WINDOW_END_TIME,
      windowStartTime: FOLLOWUP_WINDOW_START_TIME,
      windowEndTime: FOLLOWUP_WINDOW_END_TIME,
      categoryLabel: fallback?.categoryLabel || "Soldado",
      keyword: fallback?.keyword || "soldier",
      configuredManually: false,
    });
  }

  function getStoredConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "null");
      const valid = sanitizeConfig(parsed, true);
      if (valid) {
        return valid;
      }
    } catch (error) {
      // ignore and fall back to defaults
    }

    return null;
  }

  function loadConfig() {
    return getStoredConfig() || buildDefaultConfig();
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }

  function promptConfig(forcePrompt = false) {
    const stored = getStoredConfig();
    const saved = stored || buildDefaultConfig();
    if (!forcePrompt && stored) {
      return saved;
    }

    const categoriesHelp = CATEGORY_DEFAULTS.map(
      (item, index) =>
        `${index + 1}=${item.label}${item.keyword ? ` (${item.keyword})` : ""}`
    ).join("\n");

    const categoryInput = prompt(
      `Qual categoria do boss esse join deve ler no chat?\n${categoriesHelp}`,
      saved?.categoryLabel || "Soldado"
    );
    if (categoryInput === null) {
      return null;
    }

    const category = chooseCategory(categoryInput);
    if (!category) {
      alert("Categoria invalida.");
      return null;
    }

    const keywordInput = prompt(
      "Tag em ingles que aparece na mensagem do boss no chat:",
      saved?.keyword || category.keyword || ""
    );
    if (keywordInput === null) {
      return null;
    }

    const keyword = normalizeToken(keywordInput || category.keyword);
    if (!keyword) {
      alert("A tag em ingles nao pode ficar vazia.");
      return null;
    }

    const nextConfig = sanitizeConfig({
      maxEntries: DEFAULT_MAX_ENTRIES,
      firstTurnWindowStartTime: FIRST_TURN_WINDOW_START_TIME,
      firstTurnWindowEndTime: FIRST_TURN_WINDOW_END_TIME,
      windowStartTime: FOLLOWUP_WINDOW_START_TIME,
      windowEndTime: FOLLOWUP_WINDOW_END_TIME,
      categoryLabel: category.label,
      keyword,
      configuredManually: true,
    });

    if (!nextConfig) {
      alert("Configuracao invalida.");
      return null;
    }

    saveConfig(nextConfig);
    return nextConfig;
  }

  function validateRuntime(runtime) {
    if (!runtime || typeof runtime !== "object") {
      return null;
    }

    return {
      lobbyKey: String(runtime.lobbyKey || ""),
      successfulEntries: Math.max(
        0,
        Number(runtime.successfulEntries ?? runtime.clickCount ?? 0)
      ),
      lastSuccessfulAt: Number(runtime.lastSuccessfulAt || 0),
      attemptedLobbyKey: String(runtime.attemptedLobbyKey || ""),
      pendingJoinLobbyKey: String(runtime.pendingJoinLobbyKey || ""),
      pendingJoinAt: Number(runtime.pendingJoinAt || 0),
      healReturnUrl: String(runtime.healReturnUrl || ""),
    };
  }

  function loadRuntime() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RUNTIME_STORAGE_KEY) || "null");
      const valid = validateRuntime(parsed);
      if (valid) {
        return valid;
      }
    } catch (error) {
      // ignore
    }

    return {
      lobbyKey: "",
      successfulEntries: 0,
      lastSuccessfulAt: 0,
      attemptedLobbyKey: "",
      pendingJoinLobbyKey: "",
      pendingJoinAt: 0,
      healReturnUrl: "",
    };
  }

  function saveRuntime(runtime) {
    localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(runtime));
  }

  function getJoinButton() {
    return (
      Array.from(document.querySelectorAll(JOIN_SELECTORS)).find((element) => {
        if (!isVisible(element)) {
          return false;
        }

        const text = normalizeToken(element.textContent || element.value || "");
        const action = normalizeToken(element.getAttribute("data-action") || "");
        return text.includes("entrar") || action.includes("bossjoin");
      }) || null
    );
  }

  function getLobbyKey(joinButton) {
    if (!joinButton) {
      return "";
    }

    return (
      joinButton.getAttribute("data-content") ||
      joinButton.getAttribute("href") ||
      joinButton.getAttribute("hx-get") ||
      "boss-join-default"
    );
  }

  function getTimerElement() {
    return document.querySelector(TIMER_SELECTOR);
  }

  function getRuntimeForLobby(lobbyKey) {
    const runtime = loadRuntime();
    if (runtime.lobbyKey !== lobbyKey) {
      const nextRuntime = {
        lobbyKey,
        successfulEntries: runtime.successfulEntries || 0,
        lastSuccessfulAt: runtime.lastSuccessfulAt || 0,
        attemptedLobbyKey: "",
        pendingJoinLobbyKey: "",
        pendingJoinAt: 0,
        healReturnUrl: runtime.healReturnUrl || "",
      };
      saveRuntime(nextRuntime);
      return nextRuntime;
    }

    return runtime;
  }

  function resetRuntime(currentLobbyKey = "") {
    const runtime = {
      lobbyKey: currentLobbyKey,
      successfulEntries: 0,
      lastSuccessfulAt: 0,
      attemptedLobbyKey: "",
      pendingJoinLobbyKey: "",
      pendingJoinAt: 0,
      healReturnUrl: "",
    };
    saveRuntime(runtime);
    state.clicked = false;
    state.chatClickTriggered = false;
    state.chatSeeded = false;
    state.seenChatKeys.clear();
    showToast("Contagem do Boss Join resetada.", true);
  }

  function getCurrentTurn(runtime) {
    return runtime.successfulEntries + 1;
  }

  function getRemainingEntries(config, runtime) {
    return Math.max(0, config.maxEntries - runtime.successfulEntries);
  }

  function isWithinTimerWindow(timerSeconds, startSeconds, endSeconds) {
    if (timerSeconds == null) {
      return false;
    }

    const min = Math.min(startSeconds, endSeconds);
    const max = Math.max(startSeconds, endSeconds);
    return timerSeconds >= min && timerSeconds <= max;
  }

  function stopWatcher(message) {
    if (state.intervalId) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
    if (state.chatObserver) {
      state.chatObserver.disconnect();
      state.chatObserver = null;
    }
    if (message) {
      showToast(message, true);
    }
  }

  function getContextText(anchor) {
    const container =
      anchor.closest(`${CHAT_LIST_SELECTOR} li, [data-chat-message], li, .gc-in-msg, .chat-message, .message, .msg, div`) ||
      anchor.parentElement;
    return String(container?.innerText || anchor.textContent || "");
  }

  function getBossLinkValue(anchor) {
    return (
      anchor.getAttribute("href") ||
      anchor.getAttribute("hx-get") ||
      anchor.href ||
      ""
    );
  }

  function buildChatKey(anchor) {
    return `${getBossLinkValue(anchor)}|${normalizeToken(getContextText(anchor))}`;
  }

  function findMatchingBossAnchor(root, config) {
    const anchors = Array.from(
      root.querySelectorAll?.("a[href*='/boss/'], a[hx-get*='/boss/']") || []
    );

    return (
      anchors.find((anchor) => {
        const linkValue = getBossLinkValue(anchor);
        const contextToken = normalizeToken(getContextText(anchor));
        if (!linkValue.includes("/boss/")) {
          return false;
        }

        return (
          contextToken.includes(config.keyword) &&
          (
            linkValue.includes("/boss/open/") ||
            contextToken.includes("boss") ||
            contextToken.includes("apareceu") ||
            contextToken.includes("appeared") ||
            contextToken.includes("spawned")
          )
        );
      }) || null
    );
  }

  function handleChatNode(node, config, seedOnly) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const bossAnchor = findMatchingBossAnchor(node, config);
    if (!bossAnchor) {
      return false;
    }

    const chatKey = buildChatKey(bossAnchor);
    if (!chatKey || state.seenChatKeys.has(chatKey)) {
      return false;
    }

    state.seenChatKeys.add(chatKey);
    if (seedOnly || state.chatClickTriggered) {
      return false;
    }

    state.chatClickTriggered = true;
    showToast(
      `Boss ${config.categoryLabel} detectado no chat. Abrindo o link do boss.`,
      true
    );
    activateElement(bossAnchor);
    return true;
  }

  function seedExistingChat(chatList, config) {
    if (state.chatSeeded) {
      return;
    }

    Array.from(chatList.children).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      const bossAnchor = findMatchingBossAnchor(node, config);
      if (!bossAnchor) {
        return;
      }

      const chatKey = buildChatKey(bossAnchor);
      if (chatKey) {
        state.seenChatKeys.add(chatKey);
      }
    });

    state.chatSeeded = true;
  }

  function tryOpenCurrentBossFromChat(chatList, config) {
    if (state.chatClickTriggered) {
      return false;
    }

    const matchingNodes = Array.from(chatList.children).filter((node) => node instanceof HTMLElement);
    for (let index = matchingNodes.length - 1; index >= 0; index -= 1) {
      const node = matchingNodes[index];
      const bossAnchor = findMatchingBossAnchor(node, config);
      if (!bossAnchor) {
        continue;
      }

      const chatKey = buildChatKey(bossAnchor);
      if (chatKey) {
        state.seenChatKeys.add(chatKey);
      }

      state.chatClickTriggered = true;
      showToast(
        `Boss ${config.categoryLabel} ja estava no chat. Abrindo o link do boss agora.`,
        true
      );
      activateElement(bossAnchor);
      return true;
    }

    return false;
  }

  function ensureChatObserver(config) {
    if (state.chatObserver) {
      return;
    }

    const chatList = document.querySelector(CHAT_LIST_SELECTOR);
    if (!chatList) {
      showToast(
        `Aguardando o chat global para ler a categoria ${config.categoryLabel}/${config.keyword}.`
      );
      return;
    }

    if (!state.chatListReady) {
      state.chatListReady = true;
      if (tryOpenCurrentBossFromChat(chatList, config)) {
        return;
      }
      seedExistingChat(chatList, config);
      showToast(
        `Chat pronto. Esperando nova mensagem do boss ${config.categoryLabel}/${config.keyword}.`,
        true
      );
    }

    state.chatObserver = new MutationObserver((mutations) => {
      if (state.chatClickTriggered || state.clicked) {
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (handleChatNode(node, config, false)) {
            return;
          }
        }
      }
    });

    state.chatObserver.observe(chatList, { childList: true, subtree: false });
  }

  function openConfig() {
    const config = promptConfig(true);
    if (!config) {
      showToast("Reconfiguracao cancelada.");
      return;
    }

    showToast("Configuracao salva. Recarregando a pagina...", true);
    window.setTimeout(() => {
      location.reload();
    }, 300);
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Boss Join";
    button.title =
      "Clique esquerdo liga/desliga. Clique direito configura. Ctrl+Alt+J configura. Ctrl+Alt+K reseta a contagem.";
    button.style.minWidth = "150px";
    button.style.padding = "8px 12px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 12px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    state.buttonNode = button;
    updateButtonState();
    button.addEventListener("click", toggleEnabled);
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openConfig();
    });
    buttonHost.appendChild(button);

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        openConfig();
      }

      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const joinButton = getJoinButton();
        resetRuntime(getLobbyKey(joinButton));
      }
    });
  }

  function describeWaitingState(config, runtime, timerText) {
    const currentTurn = getCurrentTurn(runtime);
    const remaining = getRemainingEntries(config, runtime);

    if (runtime.successfulEntries >= config.maxEntries) {
      return `Limite atingido: ${runtime.successfulEntries}/${config.maxEntries}. Nada mais a fazer nesse lobby.`;
    }

    if (currentTurn === 1) {
      return (
        `Vez 1/${config.maxEntries} para ${config.categoryLabel}. Faltam ${remaining}. ` +
        `Esperando a janela rapida ${config.firstTurnWindowStartTime} -> ${config.firstTurnWindowEndTime}.`
      );
    }

    const timerLabel = timerText || "timer aguardando";
    return (
      `Vez ${currentTurn}/${config.maxEntries} para ${config.categoryLabel}. Faltam ${remaining}. ` +
      `Esperando janela ${config.windowStartTime} -> ${config.windowEndTime}. Timer atual: ${timerLabel}.`
    );
  }

  function markClick(runtime, lobbyKey) {
    const nextRuntime = {
      lobbyKey,
      successfulEntries: runtime.successfulEntries,
      lastSuccessfulAt: runtime.lastSuccessfulAt || 0,
      attemptedLobbyKey: lobbyKey,
      pendingJoinLobbyKey: lobbyKey,
      pendingJoinAt: Date.now(),
      healReturnUrl: runtime.healReturnUrl || "",
    };
    saveRuntime(nextRuntime);
    return nextRuntime;
  }

  function clearPendingAttempt(runtime) {
    const nextRuntime = {
      lobbyKey: runtime.lobbyKey || "",
      successfulEntries: runtime.successfulEntries || 0,
      lastSuccessfulAt: runtime.lastSuccessfulAt || 0,
      attemptedLobbyKey: runtime.attemptedLobbyKey || runtime.lobbyKey || "",
      pendingJoinLobbyKey: "",
      pendingJoinAt: 0,
      healReturnUrl: runtime.healReturnUrl || "",
    };
    saveRuntime(nextRuntime);
    return nextRuntime;
  }

  function markSuccessfulEntry(runtime) {
    const nextRuntime = {
      lobbyKey: runtime.lobbyKey || runtime.pendingJoinLobbyKey || "",
      successfulEntries: Math.min(
        DEFAULT_MAX_ENTRIES,
        (runtime.successfulEntries || 0) + 1
      ),
      lastSuccessfulAt: Date.now(),
      attemptedLobbyKey: runtime.pendingJoinLobbyKey || runtime.attemptedLobbyKey || "",
      pendingJoinLobbyKey: "",
      pendingJoinAt: 0,
      healReturnUrl: runtime.healReturnUrl || "",
    };
    saveRuntime(nextRuntime);
    return nextRuntime;
  }

  function saveHealReturnUrl(runtime, url) {
    const nextRuntime = {
      lobbyKey: runtime.lobbyKey || "",
      successfulEntries: runtime.successfulEntries || 0,
      lastSuccessfulAt: runtime.lastSuccessfulAt || 0,
      attemptedLobbyKey: runtime.attemptedLobbyKey || "",
      pendingJoinLobbyKey: runtime.pendingJoinLobbyKey || "",
      pendingJoinAt: runtime.pendingJoinAt || 0,
      healReturnUrl: String(url || ""),
    };
    saveRuntime(nextRuntime);
    return nextRuntime;
  }

  function reconcileJoinOutcome(config) {
    const runtime = loadRuntime();
    if (!runtime.pendingJoinLobbyKey) {
      return runtime;
    }

    const failureMessage = findJoinFailureMessage();
    if (failureMessage) {
      const nextRuntime = clearPendingAttempt(runtime);
      state.chatClickTriggered = false;
      state.clicked = false;
      showToast(
        `Nao consegui entrar na vez ${getCurrentTurn(nextRuntime)}/${config.maxEntries}. Vou esperar o proximo boss. ${failureMessage}`,
        true
      );
      return nextRuntime;
    }

    if (isBossOrDungeonPage() && isActivityFinished()) {
      const nextRuntime = markSuccessfulEntry(runtime);
      state.chatClickTriggered = false;
      state.clicked = false;
      showToast(
        `Entrada confirmada. Agora estamos em ${nextRuntime.successfulEntries}/${config.maxEntries}.`,
        true
      );
      return nextRuntime;
    }

    return runtime;
  }

  function handleHealBeforeJoin(joinButton) {
    const life = getLifeStatus();
    if (!life) {
      return false;
    }

    const runtime = loadRuntime();
    if (runtime.healReturnUrl) {
      if (isTemplePage()) {
        if (!life.isFull) {
          showToast("Vida nao esta cheia. Aguardando cura no templo antes de voltar ao boss.");
          return true;
        }

        showToast("Vida cheia detectada. Voltando ao boss para continuar o join.", true);
        saveHealReturnUrl(runtime, "");
        location.assign(runtime.healReturnUrl);
        return true;
      }

      if (life.isFull && location.href === runtime.healReturnUrl) {
        saveHealReturnUrl(runtime, "");
      }
      return false;
    }

    if (life.isFull) {
      return false;
    }

    if (!joinButton) {
      return false;
    }

    const returnUrl = location.href;
    showToast("Vida nao esta cheia. Indo ao templo curar antes de tentar entrar no boss.", true);
    saveHealReturnUrl(runtime, returnUrl);
    location.assign(getTempleUrl());
    return true;
  }

  function processJoin(config, joinButton) {
    const lobbyKey = getLobbyKey(joinButton);
    const runtime = getRuntimeForLobby(lobbyKey);
    const currentTurn = getCurrentTurn(runtime);
    const timerElement = getTimerElement();
    const timerText = String(timerElement?.textContent || "").trim();
    const timerSeconds = parseTimerText(timerText);

    if (runtime.successfulEntries >= config.maxEntries) {
      stopWatcher(
        `Limite atingido nesse lobby: ${runtime.successfulEntries}/${config.maxEntries}. Resete com Ctrl+Alt+K.`
      );
      return;
    }

    showToast(describeWaitingState(config, runtime, timerText));

    if (runtime.pendingJoinLobbyKey === lobbyKey) {
      return;
    }

    if (runtime.attemptedLobbyKey === lobbyKey) {
      return;
    }

    if (currentTurn === 1) {
      if (
        !isWithinTimerWindow(
          timerSeconds,
          config.firstTurnWindowStartSeconds,
          config.firstTurnWindowEndSeconds
        )
      ) {
        return;
      }

      markClick(runtime, lobbyKey);
      activateElement(joinButton);
      showToast(
        `Tentando entrar na vez 1/${config.maxEntries} para ${config.categoryLabel}.`,
        true
      );
      return;
    }

    if (!isWithinTimerWindow(timerSeconds, config.windowStartSeconds, config.windowEndSeconds)) {
      return;
    }

    markClick(runtime, lobbyKey);
    activateElement(joinButton);
    showToast(
      `Tentando entrar na vez ${currentTurn}/${config.maxEntries} para ${config.categoryLabel} dentro da janela ${config.windowStartTime} -> ${config.windowEndTime}.`,
      true
    );
  }

  function tick(config) {
    const joinButton = getJoinButton();
    const runtimeAfterOutcome = reconcileJoinOutcome(config);

    if (runtimeAfterOutcome.successfulEntries >= config.maxEntries) {
      stopWatcher(
        `Limite concluido: ${runtimeAfterOutcome.successfulEntries}/${config.maxEntries}. Resete com Ctrl+Alt+K quando quiser comecar de novo.`
      );
      return;
    }

    if (joinButton) {
      if (handleHealBeforeJoin(joinButton)) {
        return;
      }
      processJoin(config, joinButton);
      return;
    }

    if (handleHealBeforeJoin(null)) {
      return;
    }

    ensureChatObserver(config);
    if (state.chatClickTriggered) {
      showToast(`Boss aberto para ${config.categoryLabel}. Esperando o botao Entrar aparecer.`);
      return;
    }
    showToast(
      `Aguardando no chat o boss ${config.categoryLabel}/${config.keyword}, ou o botao Entrar aparecer.`
    );
  }

  function run() {
    installControls();
    if (!loadEnabled()) {
      showToast("Boss Join pausado.", true);
      return;
    }
    const config = loadConfig();
    if (!config) {
      showToast("Configuracao cancelada.", true);
      return;
    }

    state.intervalId = window.setInterval(() => tick(config), POLL_INTERVAL_MS);
    tick(config);
  }

  run();
})();
