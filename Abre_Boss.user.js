// ==UserScript==
// @name         Lamentosa Abre Boss
// @namespace    codex.lamentosa
// @version      1.0.0
// @description  Monitora o chat do boss, abre o boss, clica em Desafiar e depois no OK, sem escolha de sessao.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const WINDOW_DURATION_MINUTES = 32;
  const WINDOW_END_EXTRA_SECONDS = 9;
  const CHALLENGE_TIMEOUT_MS = 10000;
  const CONFIRM_TIMEOUT_MS = 10000;
  const STORAGE_KEY = "lamentosaAbreBossConfig";
  const ENABLED_STORAGE_KEY = "lamentosaAbreBossEnabled";
  const CONTROL_BUTTON_ID = "lamentosa-abre-boss-config-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-abre-boss-slot";
  const UI_ORDER = 15;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const DEFAULT_BUTTON_TITLE =
    "Clique esquerdo configura e liga. Clique direito liga/desliga. Ctrl+Alt+A reconfigura.";
  const CHAT_LIST_SELECTOR = "#gChatList";
  const CHAT_LIST_SELECTORS = [
    "#gChatList",
    "#drawerChat #gChatList",
    ".chat-container #gChatList",
    "ul#gChatList",
  ];
  const CHAT_MESSAGE_SELECTOR = "#gChatList > li, #drawerChat #gChatList > li, li.system";
  const SERVER_TIME_SELECTOR = "#server-time";
  const FIELD_TIMER_SELECTOR = "#fieldTimer";
  const CHAT_POLL_INTERVAL_MS = 250;
  const CHAT_WAIT_LOG_INTERVAL_MS = 10000;
  const BOSS_SCAN_INTERVAL_MS = 250;
  const MODAL_SELECTORS = [
    ".modal.show",
    ".modal.in",
    ".modal",
    ".swal2-popup",
    ".swal2-container",
    "[role='dialog']",
    ".fancybox-content",
    ".remodal",
    ".remodal-is-opened",
    ".micromodal-slide.is-open",
  ].join(", ");

  const CATEGORY_DEFAULTS = [
    { label: "Aprendiz", keyword: "apprentice" },
    { label: "Soldado", keyword: "soldier" },
    { label: "Guerreiro", keyword: "warrior" },
    { label: "Voivoda", keyword: "voivoda" },
    { label: "Anciao", keyword: "elder" },
    { label: "Anciao 2", keyword: "elder2" },
    { label: "Personalizado", keyword: "" },
  ];

  const OK_LABELS = ["ok", "confirm", "confirmar", "sim", "desafiar", "challenge"];
  const CHALLENGE_LABELS = ["desafiar", "challenge"];
  const FAILURE_MESSAGE_PATTERNS = [
    ["alguem", "desafiou", "boss"],
    ["someone", "already", "challenged", "boss"],
    ["boss", "already", "challenged"],
    ["desafio", "ja", "foi", "iniciado", "alguem"],
    ["desafio", "foi", "iniciado", "alguem"],
    ["desafio", "iniciado", "alguem"],
    ["recarregue", "pagina"],
    ["atualize", "pagina"],
    ["reload", "page"],
  ];

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");

  const state = {
    toastNode: null,
    seenKeys: new Set(),
    buttonNode: null,
    hoverIntervalId: null,
  };

  function log(message) {
    console.log(`[Lamentosa Abre Boss] ${message}`);
    showToast(message);
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

  function showToast(message) {
    state.lastMessage = message;
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

  function formatHoverRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateButtonHoverTitle() {
    if (!state.buttonNode) {
      return;
    }

    const config = loadSavedConfig();

    if (!config) {
      state.buttonNode.title = "Sem configuracao salva.";
      return;
    }

    const windowInfo = computeWindow(config);
    const bossLabel = config.categoryLabel || config.keyword || "Boss";
    const untilStart =
      Date.now() >= windowInfo.startMs ? "00:00:00" : formatHoverRemaining(windowInfo.startMs - Date.now());
    const untilEnd =
      Date.now() >= windowInfo.endMs ? "00:00:00" : formatHoverRemaining(windowInfo.endMs - Date.now());

    state.buttonNode.title =
      `Monitorando chat para ${bossLabel} | ` +
      `Inicio ${untilStart} | ` +
      `Fim ${untilEnd} | ` +
      `Setado ${config.time}:06`;
  }

  function startHoverTitleUpdates() {
    updateButtonHoverTitle();
    if (state.hoverIntervalId) {
      window.clearInterval(state.hoverIntervalId);
    }
    state.hoverIntervalId = window.setInterval(updateButtonHoverTitle, 1000);
  }

  function stopHoverTitleUpdates() {
    if (state.hoverIntervalId) {
      window.clearInterval(state.hoverIntervalId);
      state.hoverIntervalId = null;
    }

    if (state.buttonNode) {
      state.buttonNode.title = DEFAULT_BUTTON_TITLE;
    }
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
      style &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    );
  }

  function getEventCoordinates(element) {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, rect.width / 2);
    const clientY = rect.top + Math.max(1, rect.height / 2);
    return {
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY,
    };
  }

  function dispatchPointerLikeEvent(element, eventName, coords) {
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: coords.clientX,
      clientY: coords.clientY,
      screenX: coords.screenX,
      screenY: coords.screenY,
    };

    if (eventName.startsWith("pointer") && typeof PointerEvent === "function") {
      element.dispatchEvent(
        new PointerEvent(eventName, {
          ...eventInit,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        })
      );
      return;
    }

    element.dispatchEvent(new MouseEvent(eventName, eventInit));
  }

  function dispatchClick(element) {
    const coords = getEventCoordinates(element);
    const sequence = [
      "pointerover",
      "mouseover",
      "pointerenter",
      "mouseenter",
      "pointermove",
      "mousemove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ];

    if (typeof element.focus === "function") {
      try {
        element.focus({ preventScroll: true });
      } catch (error) {
        element.focus();
      }
    }

    for (const eventName of sequence) {
      dispatchPointerLikeEvent(element, eventName, coords);
    }

    if (typeof element.click === "function") {
      element.click();
    }
  }

  function dispatchSimpleClick(element) {
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
    const type = normalize(element.getAttribute("type") || "");
    if ((tagName === "button" || tagName === "input") && type === "submit" && element.form) {
      try {
        if (typeof element.form.requestSubmit === "function") {
          element.form.requestSubmit(element);
          return;
        }
      } catch (error) {
        console.warn("[Lamentosa Abre Boss] requestSubmit falhou, tentando click normal", error);
      }
    }

    dispatchClick(element);
  }

  function activateBossAnchor(element) {
    if (!element) {
      return;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", inline: "center" });
    }

    if (typeof element.focus === "function") {
      try {
        element.focus({ preventScroll: true });
      } catch (error) {
        element.focus();
      }
    }

    dispatchSimpleClick(element);
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

  function loadSavedConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return validateConfig(parsed);
    } catch (error) {
      return null;
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function getServerClockSnapshot() {
    const element = document.querySelector(SERVER_TIME_SELECTOR);
    if (!element) {
      return null;
    }

    const isoValue = element.getAttribute("data-time");
    const parsed = isoValue ? new Date(isoValue) : null;
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return {
        serverNowMs: parsed.getTime(),
        localNowMs: Date.now(),
        serverLabel: String(element.textContent || "").trim(),
      };
    }

    const visibleText = String(element.textContent || "").trim();
    const match = visibleText.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const now = new Date();
    const serverNow = new Date(now);
    serverNow.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0);
    return {
      serverNowMs: serverNow.getTime(),
      localNowMs: now.getTime(),
      serverLabel: visibleText,
    };
  }

  function validateConfig(config) {
    if (!config || typeof config !== "object") {
      return null;
    }

    const hour = Number(config.hour);
    const minute = Number(config.minute);
    const keyword = normalize(config.keyword);
    const categoryLabel = String(config.categoryLabel || "").trim();
    const time = String(config.time || "").trim();
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return null;
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return null;
    }
    if (!keyword) {
      return null;
    }
    if (!categoryLabel || !time) {
      return null;
    }
    return {
      time,
      hour,
      minute,
      categoryLabel,
      keyword,
    };
  }

  function parseTimeInput(raw) {
    const value = String(raw || "").trim();
    if (/^\d{1,2}$/.test(value)) {
      const hour = Number(value);
      if (hour >= 0 && hour <= 23) {
        return { hour, minute: 0 };
      }
      return null;
    }

    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return { hour, minute };
  }

  function chooseCategory(rawValue) {
    const raw = String(rawValue || "").trim();
    if (/^\d+$/.test(raw)) {
      const index = Number(raw) - 1;
      if (CATEGORY_DEFAULTS[index]) {
        return CATEGORY_DEFAULTS[index];
      }
    }

    const normalized = normalize(raw);
    return (
      CATEGORY_DEFAULTS.find((item) => normalize(item.label) === normalized) || null
    );
  }

  function promptConfig(forcePrompt = false) {
    const saved = loadSavedConfig();
    if (!forcePrompt && saved) {
      log(
        `Usando configuracao salva: ${saved.categoryLabel} / ${saved.keyword} / ${saved.time}. ` +
          "Use o botao Abre Boss ou Ctrl+Alt+A para reconfigurar."
      );
      return saved;
    }

    const timeDefault = saved?.time || "09:00";
    const timeInput = prompt(
      "Horario base do boss no servidor (HH ou HH:MM). Ex: 9 ou 09:00",
      timeDefault
    );

    if (timeInput === null) {
      return null;
    }

    const timeData = parseTimeInput(timeInput);
    if (!timeData) {
      alert("Horario invalido.");
      return null;
    }

    const categoriesHelp = CATEGORY_DEFAULTS.map(
      (item, index) =>
        `${index + 1}=${item.label}${item.keyword ? ` (${item.keyword})` : ""}`
    ).join("\n");

    const categoryDefault = saved?.categoryLabel || "Soldado";
    const categoryInput = prompt(
      `Escolha a categoria pelo numero ou nome:\n${categoriesHelp}`,
      categoryDefault
    );
    if (categoryInput === null) {
      return null;
    }

    const category = chooseCategory(categoryInput);
    if (!category) {
      alert("Categoria invalida.");
      return null;
    }

    const keywordDefault = saved?.keyword || category.keyword || "";
    const keywordInput = prompt(
      "Tag em ingles que aparece no chat para esse boss:",
      keywordDefault
    );
    if (keywordInput === null) {
      return null;
    }

    const keyword = normalize(keywordInput || keywordDefault);
    if (!keyword) {
      alert("A tag em ingles nao pode ficar vazia.");
      return null;
    }

    const config = {
      time: `${String(timeData.hour).padStart(2, "0")}:${String(timeData.minute).padStart(2, "0")}`,
      hour: timeData.hour,
      minute: timeData.minute,
      categoryLabel: category.label,
      keyword,
    };
    saveConfig(config);
    return config;
  }

  function openReconfigure() {
    const config = promptConfig(true);
    if (!config) {
      log("Reconfiguracao cancelada.");
      return;
    }

    saveEnabled(true);
    updateButtonState();
    log("Configuracao salva. Recarregando a pagina...");
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
    button.textContent = "Abre Boss";
    button.title = DEFAULT_BUTTON_TITLE;
    button.style.minWidth = "108px";
    button.style.padding = "6px 10px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 11px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    state.buttonNode = button;
    updateButtonState();
    button.addEventListener("click", openReconfigure);
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      toggleEnabled();
    });
    button.addEventListener("mouseenter", startHoverTitleUpdates);
    button.addEventListener("mouseleave", stopHoverTitleUpdates);
    buttonHost.appendChild(button);

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        openReconfigure();
      }
    });
  }

  function computeWindow(config) {
    const snapshot = getServerClockSnapshot();
    if (!snapshot) {
      const now = new Date();
      const start = new Date(now);
      start.setHours(config.hour, config.minute, 6, 0);
      const end = new Date(start.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000 + WINDOW_END_EXTRA_SECONDS * 1000);
      if (now > end) {
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
      }
      return {
        startMs: start.getTime(),
        endMs: end.getTime(),
        source: "local",
        serverLabel: null,
      };
    }

    const offsetMs = snapshot.serverNowMs - snapshot.localNowMs;
    const serverNow = new Date(snapshot.serverNowMs);
    const startServer = new Date(snapshot.serverNowMs);
    startServer.setHours(config.hour, config.minute, 6, 0);
    let endServer = new Date(startServer.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000 + WINDOW_END_EXTRA_SECONDS * 1000);

    if (serverNow.getTime() > endServer.getTime()) {
      startServer.setDate(startServer.getDate() + 1);
      endServer = new Date(startServer.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000 + WINDOW_END_EXTRA_SECONDS * 1000);
    }

    return {
      startMs: startServer.getTime() - offsetMs,
      endMs: endServer.getTime() - offsetMs,
      source: "server",
      serverLabel: snapshot.serverLabel,
    };
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  async function waitUntilWindow(windowInfo) {
    if (Date.now() >= windowInfo.startMs) {
      log("Ja estamos dentro da janela. Monitorando agora.");
      return;
    }

    const startLabel = new Date(windowInfo.startMs).toLocaleString();
    const sourceLabel =
      windowInfo.source === "server" && windowInfo.serverLabel
        ? ` com base no relogio do servidor (${windowInfo.serverLabel})`
        : "";
    log(`Aguardando janela do boss para ${startLabel}${sourceLabel}.`);
    let lastMessageAt = 0;

    while (Date.now() < windowInfo.startMs) {
      if (Date.now() - lastMessageAt >= 15000) {
        const remaining = formatRemaining(windowInfo.startMs - Date.now());
        log(`Esperando inicio da janela... faltam ${remaining}`);
        lastMessageAt = Date.now();
      }
      await sleep(1000);
    }

    log("Janela iniciada. Monitorando o chat.");
  }

  function getChatMessageContainer(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest(CHAT_MESSAGE_SELECTOR);
  }

  function getContextText(anchor) {
    const messageContainer = getChatMessageContainer(anchor);
    const contentNode =
      messageContainer?.querySelector(".gc-in-msg") ||
      messageContainer?.querySelector(".gc-msg") ||
      messageContainer;
    return String(contentNode?.innerText || anchor.textContent || "");
  }

  function getBossDisplayText(anchor) {
    const bossName = String(anchor.textContent || "").trim();
    const context = getContextText(anchor)
      .replace(/\s+/g, " ")
      .trim();

    if (!context) {
      return bossName || "boss";
    }

    if (!bossName) {
      return context.slice(0, 120);
    }

    return `${bossName} | ${context.slice(0, 120)}`;
  }

  function getChatMessageTimeText(anchor) {
    const messageContainer = getChatMessageContainer(anchor);
    const timeNode = Array.from(messageContainer?.querySelectorAll("div") || []).find((node) =>
      /^\d{1,2}:\d{2}:\d{2}$/.test(String(node.textContent || "").trim())
    );
    return timeNode ? String(timeNode.textContent || "").trim() : "";
  }

  function getBossMessageLocalTimeMs(anchor) {
    const snapshot = getServerClockSnapshot();
    const timeText = getChatMessageTimeText(anchor);
    if (!snapshot || !timeText) {
      return null;
    }

    const match = timeText.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const messageServer = new Date(snapshot.serverNowMs);
    messageServer.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0);

    const diffMs = messageServer.getTime() - snapshot.serverNowMs;
    if (diffMs > 12 * 60 * 60 * 1000) {
      messageServer.setDate(messageServer.getDate() - 1);
    } else if (diffMs < -12 * 60 * 60 * 1000) {
      messageServer.setDate(messageServer.getDate() + 1);
    }

    const offsetMs = snapshot.serverNowMs - snapshot.localNowMs;
    return messageServer.getTime() - offsetMs;
  }

  function isBossAnchorInsideWindow(anchor, windowInfo) {
    if (!windowInfo) {
      return true;
    }

    const messageLocalMs = getBossMessageLocalTimeMs(anchor);
    if (messageLocalMs === null) {
      return true;
    }

    return (
      messageLocalMs >= windowInfo.startMs - 60 * 1000 &&
      messageLocalMs <= windowInfo.endMs
    );
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

  function getBossAnchorCandidates(root = document) {
    const selector = [
      ".gc-in-msg a[hx-get*='/boss/']",
      ".gc-in-msg a[href*='/boss/']",
      ".gc-msg a[hx-get*='/boss/']",
      ".gc-msg a[href*='/boss/']",
      "a[hx-get*='/boss/']",
      "a[href*='/boss/']",
      "a[data-href*='/boss/']",
    ].join(", ");

    const candidates = [];
    if (root instanceof Element && root.matches?.("a")) {
      candidates.push(root);
    }

    const scopedRoot =
      root instanceof Element || root instanceof Document ? root : document;
    candidates.push(...Array.from(scopedRoot.querySelectorAll(selector)));

    return candidates.filter((anchor, index, all) => anchor && all.indexOf(anchor) === index);
  }

  function findBossChatMessageAnchor(keyword, ignoredKeys, chatList) {
    if (!chatList) {
      return null;
    }

    const keywordNorm = normalize(keyword);
    const messageNodes = Array.from(
      chatList.querySelectorAll("li.system, #gChatList > li, #drawerChat #gChatList > li")
    );

    for (let index = messageNodes.length - 1; index >= 0; index -= 1) {
      const node = messageNodes[index];
      const anchor =
        node.querySelector(".gc-in-msg a[hx-get*='/boss/'], .gc-in-msg a[href*='/boss/'], .gc-in-msg a[data-href*='/boss/']") ||
        node.querySelector(".gc-msg a[hx-get*='/boss/'], .gc-msg a[href*='/boss/'], .gc-msg a[data-href*='/boss/']") ||
        node.querySelector("a[hx-get*='/boss/'], a[href*='/boss/'], a[data-href*='/boss/']");

      if (!anchor || !isVisible(anchor)) {
        continue;
      }

      if (ignoredKeys.has(buildAnchorKey(anchor))) {
        continue;
      }

      const context = normalize(node.innerText || getContextText(anchor));
      const linkValue = getBossLinkValue(anchor);
      if (!linkValue.includes("/boss/")) {
        continue;
      }

      if (
        context.includes(keywordNorm) &&
        context.includes("boss") &&
        (
          context.includes("waitingforyou") ||
          context.includes("apareceu") ||
          context.includes("appeared") ||
          context.includes("spawned")
        )
      ) {
        return anchor;
      }
    }

    return null;
  }

  function getBossAnchors() {
    return Array.from(document.querySelectorAll("#gChatList a, a[href*='/boss/'], a[hx-get*='/boss/']"))
      .filter(isVisible)
      .filter((anchor) => {
        const linkValue = getBossLinkValue(anchor);
        const context = normalize(getContextText(anchor));
        return (
          linkValue.includes("/boss/") &&
          (context.includes("boss") || context.includes("apareceu") || context.includes("appeared"))
        );
      });
  }

  function buildAnchorKey(anchor) {
    return `${getBossLinkValue(anchor) || normalize(anchor.textContent || "")}|${normalize(getContextText(anchor))}`;
  }

  function isBossContextMatch(context, keywordNorm) {
    if (!context || !keywordNorm || !context.includes(keywordNorm)) {
      return false;
    }

    return (
      context.includes("boss") &&
      (
        context.includes("waitingforyou") ||
        context.includes("apareceu") ||
        context.includes("appeared") ||
        context.includes("spawned")
      )
    );
  }

  function isMatchingBossAnchor(anchor, keywordNorm, ignoredKeys) {
    const context = normalize(getContextText(anchor));
    const linkValue = getBossLinkValue(anchor);
    const textValue = normalize(anchor.textContent || "");
    const contextMatch = isBossContextMatch(context, keywordNorm);
    const looksLikeBossLink =
      linkValue.includes("/boss/") ||
      textValue === keywordNorm ||
      textValue.includes(keywordNorm);

    return (
      !ignoredKeys.has(buildAnchorKey(anchor)) &&
      contextMatch &&
      looksLikeBossLink
    );
  }

  function findMatchingBossAnchor(keyword, ignoredKeys, root = document, windowInfo = null) {
    const keywordNorm = normalize(keyword);
    return (
      getBossAnchorCandidates(root)
        .slice()
        .reverse()
        .find(
          (anchor) =>
            isBossAnchorInsideWindow(anchor, windowInfo) &&
            isMatchingBossAnchor(anchor, keywordNorm, ignoredKeys)
        ) || null
    );
  }

  function findMatchingBossAnchorInChatList(keyword, ignoredKeys, chatList, windowInfo = null) {
    if (!chatList) {
      return null;
    }

    const nodes = Array.from(chatList.children).filter((node) => node instanceof HTMLElement);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const bossAnchor = findMatchingBossAnchor(keyword, ignoredKeys, nodes[index], windowInfo);
      if (bossAnchor) {
        return bossAnchor;
      }
    }

    return null;
  }

  function findChatList() {
    for (const selector of CHAT_LIST_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  }

  async function waitForChatList(windowInfo) {
    let lastLogAt = 0;

    while (Date.now() <= windowInfo.endMs) {
      const chatList = findChatList();
      if (chatList) {
        log("Chat global encontrado. Iniciando monitoramento.");
        return chatList;
      }

      if (Date.now() - lastLogAt >= CHAT_WAIT_LOG_INTERVAL_MS) {
        log(`Aguardando o chat global carregar (${CHAT_LIST_SELECTOR})...`);
        lastLogAt = Date.now();
      }

      await sleep(CHAT_POLL_INTERVAL_MS);
    }

    return null;
  }

  function getModalCandidates() {
    return Array.from(document.querySelectorAll(MODAL_SELECTORS)).filter(isVisible);
  }

  function getActionSearchRoots() {
    const modals = getModalCandidates();
    return modals.length ? modals : [document];
  }

  function getReadableText(element) {
    if (!element) {
      return "";
    }
    return String(element.innerText || element.textContent || "").trim();
  }

  function findFailureMessage() {
    const selector =
      [
        ".alert",
        ".alert-danger",
        ".text-danger",
        ".error",
        ".errors",
        ".notification",
        ".message",
        ".msg",
        "[role='alert']",
        ".swal2-popup",
        ".swal2-container",
      ].join(", ");

    const roots = [...getActionSearchRoots(), document.body].filter(Boolean);

    for (const root of roots) {
      const candidates = [root, ...Array.from(root.querySelectorAll?.(selector) || [])];
      for (const candidate of candidates) {
        if (candidate !== root && !isVisible(candidate)) {
          continue;
        }

        const rawText = getReadableText(candidate);
        const text = normalize(rawText);
        if (!text) {
          continue;
        }

        const matched = FAILURE_MESSAGE_PATTERNS.some((parts) =>
          parts.every((part) => text.includes(normalize(part)))
        );
        if (matched) {
          return rawText;
        }
      }
    }

    return null;
  }

  function findLabeledElement(labels) {
    const selectors =
      "button, a, a.btn, input[type='button'], input[type='submit'], [role='button']";
    const normalizedLabels = labels.map((label) => normalize(label));

    let bestCandidate = null;
    let bestScore = -1;

    for (const root of getActionSearchRoots()) {
      const candidates = Array.from(root.querySelectorAll(selectors));
      for (const element of candidates) {
        if (!isVisible(element)) {
          continue;
        }

        const text = normalize(element.textContent || element.value || "");
        const href = normalize(
          element.getAttribute("href") || element.getAttribute("hx-get") || ""
        );
        const matchesText = normalizedLabels.some(
          (label) => text === label || text.includes(label)
        );
        const matchesHref = normalizedLabels.some((label) => href.includes(label));

        if (!matchesText && !matchesHref) {
          continue;
        }

        let score = 0;
        if (matchesText) {
          score += 3;
        }
        if (matchesHref) {
          score += 2;
        }
        if (element.matches("button, input[type='submit']")) {
          score += 2;
        }
        if (element.closest(MODAL_SELECTORS)) {
          score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = element;
        }
      }
    }

    return bestCandidate;
  }

  function findChallengeButton() {
    const byId = document.querySelector("#bossChallengeBtn");
    if (isVisible(byId)) {
      return byId;
    }

    const labeled = findLabeledElement(CHALLENGE_LABELS);
    if (labeled) {
      return labeled;
    }

    return (
      Array.from(document.querySelectorAll("a[href*='/challenge/'], a[hx-get*='/challenge/']"))
        .filter(isVisible)
        .find(() => true) || null
    );
  }

  function findOkButton() {
    return findLabeledElement(OK_LABELS);
  }

  async function waitForElement(getter, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const element = getter();
      if (element) {
        log(`${label} encontrado.`);
        return element;
      }
      await sleep(250);
    }

    log(`${label} nao apareceu a tempo.`);
    return null;
  }

  async function waitForChallengeOutcome() {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

    while (Date.now() <= deadline) {
      const failureMessage = findFailureMessage();
      if (failureMessage) {
        return {
          kind: "failure",
          message: failureMessage,
        };
      }

      const okButton = findOkButton();
      if (okButton) {
        log("Botao final de confirmacao encontrado.");
        return {
          kind: "ok",
          element: okButton,
        };
      }

      await sleep(250);
    }

    return {
      kind: "timeout",
      message: "Nao apareceu o botao final de confirmacao nem mensagem de erro apos clicar em Desafiar.",
    };
  }

  async function run() {
    installControls();
    if (!loadEnabled()) {
      log("Abre Boss pausado.");
      return;
    }
    const config = promptConfig(false);
    if (!config) {
      log("Configuracao cancelada.");
      return;
    }

    const windowInfo = computeWindow(config);
    await waitUntilWindow(windowInfo);

    const chatList = await waitForChatList(windowInfo);
    if (!chatList) {
      log("Nao achei o chat global (#gChatList) antes do fim da janela.");
      return;
    }

    let completed = false;
    let processing = false;
    let attempted = false;
    let finalMessage = "";

    const tryBossSequence = async (bossAnchor) => {
      if (!bossAnchor) {
        return false;
      }

      const bossText = getBossDisplayText(bossAnchor);
      const bossKey = buildAnchorKey(bossAnchor);
      if (state.seenKeys.has(bossKey)) {
        return false;
      }

      attempted = true;
      state.seenKeys.add(bossKey);

      log(`Boss detectado: ${bossText}`);
      activateBossAnchor(bossAnchor);

      const challengeButton = await waitForElement(
        findChallengeButton,
        CHALLENGE_TIMEOUT_MS,
        "Botao Desafiar"
      );
      if (!challengeButton) {
        state.seenKeys.delete(bossKey);
        finalMessage = "Nao apareceu o botao Desafiar apos abrir o boss.";
        return false;
      }
      activateElement(challengeButton);

      const outcome = await waitForChallengeOutcome();
      if (outcome.kind === "failure") {
        finalMessage = `Tentativa encerrada: ${outcome.message}`;
        log(finalMessage);
        return false;
      }
      if (outcome.kind === "timeout") {
        state.seenKeys.delete(bossKey);
        finalMessage = outcome.message;
        log(finalMessage);
        return false;
      }

      activateElement(outcome.element);

      log("Sequencia concluida com sucesso.");
      completed = true;
      finalMessage = "Sequencia concluida com sucesso.";
      return true;
    };

    const existingVisibleBoss =
      findBossChatMessageAnchor(config.keyword, state.seenKeys, chatList) ||
      findMatchingBossAnchorInChatList(config.keyword, state.seenKeys, chatList, windowInfo) ||
      findMatchingBossAnchor(config.keyword, state.seenKeys, document, windowInfo);
    if (await tryBossSequence(existingVisibleBoss)) {
      return;
    }
    if (attempted && finalMessage) {
      log(`Tentativa imediata falhou: ${finalMessage}. Continuando monitoramento.`);
      attempted = false;
      finalMessage = "";
    }
    log("Monitorando novas mensagens do chat para esse boss.");

    let finished = false;

    const observer = new MutationObserver(async (mutations) => {
      if (processing || completed || finished) {
        return;
      }
      if (Date.now() > windowInfo.endMs) {
        observer.disconnect();
        finished = true;
        finalMessage = "A janela terminou sem detectar um boss compativel.";
        log(finalMessage);
        return;
      }

      const liveBoss =
        findBossChatMessageAnchor(config.keyword, state.seenKeys, chatList) ||
        findMatchingBossAnchorInChatList(config.keyword, state.seenKeys, chatList, windowInfo);
      if (liveBoss) {
        processing = true;
        observer.disconnect();
        const success = await tryBossSequence(liveBoss);
        processing = false;
        finished = true;
        if (!success && finalMessage) {
          log(`Abre Boss finalizado: ${finalMessage}`);
        }
        return;
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          const candidateRoots = [];
          const directMessage = getChatMessageContainer(node);
          if (directMessage) {
            candidateRoots.push(directMessage);
          }

          if (node.matches(CHAT_MESSAGE_SELECTOR)) {
            candidateRoots.push(node);
          }

          candidateRoots.push(
            ...Array.from(node.querySelectorAll?.(CHAT_MESSAGE_SELECTOR) || [])
          );

          const uniqueRoots = candidateRoots.filter(
            (root, index, all) => root && all.indexOf(root) === index
          );

          for (const root of uniqueRoots) {
            const bossAnchor =
              findBossChatMessageAnchor(config.keyword, state.seenKeys, chatList) ||
              findMatchingBossAnchor(config.keyword, state.seenKeys, root, windowInfo);
            if (!bossAnchor) {
              continue;
            }

            processing = true;
            observer.disconnect();
            const success = await tryBossSequence(bossAnchor);
            processing = false;
            finished = true;
            if (!success && finalMessage) {
              log(`Abre Boss finalizado: ${finalMessage}`);
            }
            return;
          }
        }
      }
    });

    observer.observe(chatList, { childList: true, subtree: true, characterData: true });

    let lastLogAt = 0;
    while (Date.now() <= windowInfo.endMs && !completed && !finished) {
      const liveBoss =
        findBossChatMessageAnchor(config.keyword, state.seenKeys, chatList) ||
        findMatchingBossAnchorInChatList(config.keyword, state.seenKeys, chatList, windowInfo);
      if (liveBoss) {
        observer.disconnect();
        const success = await tryBossSequence(liveBoss);
        finished = true;
        if (!success && finalMessage) {
          log(`Abre Boss finalizado: ${finalMessage}`);
        }
        return;
      }

      if (Date.now() - lastLogAt >= 15000) {
        const remaining = formatRemaining(windowInfo.endMs - Date.now());
        log(`Monitorando chat... janela restante ${remaining}`);
        lastLogAt = Date.now();
      }

      await sleep(BOSS_SCAN_INTERVAL_MS);
    }

    observer.disconnect();
    if (completed || finished) {
      return;
    }
    log("A janela terminou sem detectar um boss compativel.");
  }

  run().catch((error) => {
    console.error("[Lamentosa Abre Boss] erro inesperado", error);
    showToast(`Erro: ${error?.message || error}`);
  });
})();

