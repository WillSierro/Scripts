// ==UserScript==
// @name         Lamentosa Dg Poison
// @namespace    codex.lamentosa
// @version      1.6.0
// @description  Entra na DUNGEON de TheVamp/Nuvem, arma o veneno aos 4s do running e ataca aos 1s, com aviso Telegram.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      api.telegram.org
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const CHAT_LIST_SELECTOR = "#gChatList";
  const TOAST_ID = "lamentosa-dungeon-test-toast";
  const CONTROL_BUTTON_ID = "lamentosa-dungeon-alert-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-dungeon-alert-slot";
  const UI_ORDER = 50;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const STORAGE_KEY = "lamentosaDungeonAlertConfig";
  const PENDING_POISON_KEY = "lamentosaDungeonAlertPendingPoisons";
  const TARGET_PLAYERS = ["TheVamp", "Nuvem"];
  const VOICE_ALERT_TEXT = "jogar veneno";
  const ACTION_TIMEOUT_MS = 8000;
  const ACTION_POLL_INTERVAL_MS = 120;
  const TIMER_POLL_INTERVAL_MS = 150;
  const POISON_PREPARE_SECONDS = 4;
  const POISON_ATTACK_SECONDS = 1;
  const PENDING_POISON_MAX_AGE_MS = 5 * 60 * 1000;
  const TYPE_START_DELAY_MS = 70;
  const TYPE_CHAR_DELAY_MS = 45;
  const TYPE_FINISH_DELAY_MS = 80;
  const BRAZIL_TIMEZONE = "America/Sao_Paulo";
  const POISON_ATTEMPT_PATTERNS = ["try to poison", "tries to poison", "tried to poison"];
  const POISON_CONFIG = {
    thevamp: {
      itemPk: "945168",
      itemName: "Defense Poison",
      targetName: "TheVamp",
    },
    nuvem: {
      itemPk: "945167",
      itemName: "Strength Poison",
      targetName: "Nuvem",
    },
  };
  const DEFAULT_TELEGRAM_CONFIG = {
    enabled: true,
    telegramEnabled: true,
    telegramBotToken: "8532640999:AAEriel3Nd2-8152JSvQTsSfkASEP5tV5O8",
    telegramChatId: "-1001840156311",
  };
  const seenKeys = new Set();
  const pendingPoisonIds = new Set();
  let buttonNode = null;
  let poisonRunnerTimerId = 0;
  let poisonRunnerActive = false;

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

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
    node.style.maxWidth = "340px";
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

  function showToast(message) {
    const node = getToastNode();
    node.textContent = message;
    console.log(`[Lamentosa Dg Poison] ${message}`);
  }

  function updateButtonState() {
    if (!buttonNode) {
      return;
    }

    const config = loadConfig();
    buttonNode.style.background = config.enabled ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
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
      };
    } catch (error) {
      return { ...DEFAULT_TELEGRAM_CONFIG };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Dg Poison";
    button.title = "Clique para ligar/desligar o Dg Poison. Ctrl+Alt+D tambem alterna.";
    button.style.minWidth = "108px";
    button.style.padding = "6px 10px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 11px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    buttonNode = button;
    updateButtonState();
    button.addEventListener("click", () => {
      const config = loadConfig();
      const nextConfig = {
        ...config,
        enabled: !config.enabled,
      };
      saveConfig(nextConfig);
      updateButtonState();
      if (nextConfig.enabled) {
        schedulePendingPoisonRunner();
      } else if (poisonRunnerTimerId) {
        window.clearTimeout(poisonRunnerTimerId);
        poisonRunnerTimerId = 0;
      }
    });
    buttonHost.appendChild(button);

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const config = loadConfig();
        const nextConfig = {
          ...config,
          enabled: !config.enabled,
        };
        saveConfig(nextConfig);
        updateButtonState();
        if (nextConfig.enabled) {
          schedulePendingPoisonRunner();
        } else if (poisonRunnerTimerId) {
          window.clearTimeout(poisonRunnerTimerId);
          poisonRunnerTimerId = 0;
        }
      }
    });
  }

  function ensureDefaultConfigSaved() {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
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

  function dispatchClick(element) {
    if (typeof element.click === "function") {
      element.click();
      return;
    }

    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  }

  function activateElement(element) {
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

    dispatchClick(element);
  }

  function normalizeToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function loadPendingPoisons() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_POISON_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function savePendingPoisons(jobs) {
    localStorage.setItem(PENDING_POISON_KEY, JSON.stringify(jobs));
  }

  function prunePendingPoisons() {
    const originalJobs = loadPendingPoisons();
    const now = Date.now();
    const jobs = originalJobs.filter((job) => {
      const createdAt = Number(job.createdAt || 0);
      return createdAt > 0 && now - createdAt <= PENDING_POISON_MAX_AGE_MS;
    });
    if (jobs.length !== originalJobs.length) {
      savePendingPoisons(jobs);
    }
    return jobs;
  }

  function parseTimerSeconds(value) {
    const match = String(value || "").trim().match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function getFieldTimerState() {
    const timer = document.querySelector("#fieldTimer");
    if (!timer || !isVisible(timer)) {
      return null;
    }

    const rawText = String(timer.textContent || "").trim();
    return {
      element: timer,
      text: rawText,
      seconds: parseTimerSeconds(rawText),
      isJoin: timer.classList.contains("status-join"),
      isRunning: timer.classList.contains("status-running"),
    };
  }

  async function waitForRunningTimerAtOrBelow(targetSeconds, timeoutMs = ACTION_TIMEOUT_MS * 2) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const timerState = getFieldTimerState();
      if (
        timerState &&
        timerState.isRunning &&
        timerState.seconds !== null &&
        timerState.seconds <= targetSeconds
      ) {
        return timerState;
      }
      await sleep(40);
    }
    return null;
  }

  function queuePoison(playerName) {
    const poison = POISON_CONFIG[normalizeToken(playerName)];
    if (!poison) {
      return;
    }

    const now = Date.now();
    const jobs = prunePendingPoisons();
    const duplicate = jobs.find(
      (job) => normalizeToken(job.playerName) === normalizeToken(playerName)
    );
    if (duplicate) {
      schedulePendingPoisonRunner();
      return;
    }

    jobs.push({
      id: `${normalizeToken(playerName)}-${now}`,
      playerName: poison.targetName,
      itemPk: poison.itemPk,
      itemName: poison.itemName,
      createdAt: now,
    });
    savePendingPoisons(jobs);
    showToast(
      `Veneno de ${poison.itemName} agendado para ${poison.targetName}. Prepara aos ${POISON_PREPARE_SECONDS}s e ataca aos ${POISON_ATTACK_SECONDS}s.`
    );
    schedulePendingPoisonRunner();
  }

  function removePendingPoison(jobId) {
    const jobs = loadPendingPoisons().filter((job) => job.id !== jobId);
    savePendingPoisons(jobs);
    pendingPoisonIds.delete(jobId);
  }

  function schedulePendingPoisonRunner() {
    if (poisonRunnerTimerId) {
      window.clearTimeout(poisonRunnerTimerId);
      poisonRunnerTimerId = 0;
    }

    if (!isEnabled()) {
      return;
    }

    const jobs = prunePendingPoisons().sort(
      (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)
    );
    if (!jobs.length) {
      return;
    }

    poisonRunnerTimerId = window.setTimeout(() => {
      poisonRunnerTimerId = 0;
      processPendingPoisons().catch((error) => {
        console.error("[Lamentosa Dg Poison] Erro ao processar veneno pendente", error);
      });
    }, TIMER_POLL_INTERVAL_MS);
  }

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function dispatchInputEvent(input, data = null, inputType = "insertText") {
    try {
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          data,
          inputType,
        })
      );
    } catch (error) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function dispatchBeforeInputEvent(input, data = null, inputType = "insertText") {
    try {
      return input.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data,
          inputType,
        })
      );
    } catch (error) {
      return input.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
    }
  }

  function setInputValue(input, value) {
    setNativeInputValue(input, value);
    dispatchInputEvent(input, value, "insertReplacementText");
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchKeyboardEvent(input, type, key) {
    const isSingleChar = typeof key === "string" && key.length === 1;
    const upperKey = isSingleChar ? key.toUpperCase() : "";
    const charCode = isSingleChar ? key.charCodeAt(0) : 0;
    input.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key,
        code: /^[A-Z]$/.test(upperKey)
          ? `Key${upperKey}`
          : /^[0-9]$/.test(key)
            ? `Digit${key}`
            : "",
        keyCode: charCode,
        which: charCode,
      })
    );
  }

  function dispatchMouseEvent(element, type) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  }

  function setSelectionRangeSafe(input, start, end = start) {
    if (typeof input.setSelectionRange !== "function") {
      return;
    }

    try {
      input.setSelectionRange(start, end);
    } catch (error) {
      // ignore selection failures on custom inputs
    }
  }

  async function focusInputForTyping(input) {
    if (typeof input.scrollIntoView === "function") {
      input.scrollIntoView({ block: "center", inline: "center" });
    }

    dispatchMouseEvent(input, "mouseover");
    dispatchMouseEvent(input, "mouseenter");
    dispatchMouseEvent(input, "mousemove");
    dispatchMouseEvent(input, "mousedown");
    if (typeof input.focus === "function") {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
    }
    dispatchMouseEvent(input, "mouseup");
    dispatchMouseEvent(input, "click");
    await sleep(TYPE_START_DELAY_MS);
  }

  async function typeIntoInput(input, value) {
    await focusInputForTyping(input);
    setNativeInputValue(input, "");
    setSelectionRangeSafe(input, 0, String(input.value || "").length);
    dispatchKeyboardEvent(input, "keydown", "Backspace");
    dispatchBeforeInputEvent(input, null, "deleteContentBackward");
    dispatchInputEvent(input, null, "deleteContentBackward");
    dispatchKeyboardEvent(input, "keyup", "Backspace");
    await sleep(TYPE_CHAR_DELAY_MS);

    for (const char of String(value)) {
      if (document.activeElement !== input) {
        input.focus();
        setSelectionRangeSafe(input, String(input.value || "").length);
      }

      dispatchKeyboardEvent(input, "keydown", char);
      dispatchKeyboardEvent(input, "keypress", char);
      dispatchBeforeInputEvent(input, char, "insertText");
      const nextValue = `${String(input.value || "")}${char}`;
      setNativeInputValue(input, nextValue);
      setSelectionRangeSafe(input, nextValue.length, nextValue.length);
      dispatchInputEvent(input, char, "insertText");
      dispatchKeyboardEvent(input, "keyup", char);
      await sleep(TYPE_CHAR_DELAY_MS);
    }

    if (String(input.value || "") !== String(value)) {
      throw new Error(`Nao consegui digitar ${value} no campo de alvo.`);
    }

    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(TYPE_FINISH_DELAY_MS);
  }

  function isTargetTextInput(element) {
    if (
      !element ||
      !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
      element.disabled ||
      element.readOnly
    ) {
      return false;
    }

    const type = String(element.getAttribute("type") || "text").toLowerCase();
    if (
      [
        "hidden",
        "submit",
        "button",
        "checkbox",
        "radio",
        "file",
        "range",
        "color",
      ].includes(type)
    ) {
      return false;
    }

    return isVisible(element);
  }

  function collectActionRoots() {
    const seen = new Set();
    const roots = [];
    const pushRoot = (root) => {
      if (!root || seen.has(root)) {
        return;
      }
      if (root !== document && !isVisible(root)) {
        return;
      }
      seen.add(root);
      roots.push(root);
    };

    Array.from(
      document.querySelectorAll("form, .modal, .modal-ct, [role='dialog'], .fancybox-content, .swal2-popup")
    ).forEach(pushRoot);

    const searchButton = findLabeledButton(["Procurar", "Search"]);
    const attackButton = findLabeledButton(["Atacar!", "Atacar", "Attack!"]);
    pushRoot(getActionRoot(searchButton));
    pushRoot(getActionRoot(attackButton));
    pushRoot(document);
    return roots;
  }

  function scoreTargetInput(input) {
    let score = 0;
    const context = [
      input.id,
      input.name,
      input.placeholder,
      input.getAttribute("aria-label"),
      input.closest("label")?.textContent,
      getActionRoot(input)?.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    const text = normalizeToken(context);

    if (input.id === "id_target_name" || input.name === "target_name") {
      score += 20;
    }
    if (text.includes("target")) {
      score += 10;
    }
    if (text.includes("nick")) {
      score += 8;
    }
    if (text.includes("nome")) {
      score += 6;
    }
    if (text.includes("player") || text.includes("character")) {
      score += 4;
    }
    if (text.includes("procurar") || text.includes("search")) {
      score += 3;
    }
    if (text.includes("atacar") || text.includes("attack")) {
      score += 2;
    }

    return score;
  }

  function findTargetInput() {
    const exactSelectors = [
      "#id_target_name",
      "input[name='target_name']",
      "input[name*='target']",
      "input[id*='target']",
      "input[placeholder*='nick']",
      "input[placeholder*='Nick']",
      "input[placeholder*='nome']",
      "input[placeholder*='Nome']",
      "input[placeholder*='name']",
      "input[placeholder*='Name']",
    ];

    for (const root of collectActionRoots()) {
      for (const selector of exactSelectors) {
        const match = Array.from(root.querySelectorAll(selector)).find(isTargetTextInput);
        if (match) {
          return match;
        }
      }
    }

    const candidates = [];
    const seen = new Set();
    for (const root of collectActionRoots()) {
      Array.from(root.querySelectorAll("input, textarea"))
        .filter(isTargetTextInput)
        .forEach((input) => {
          if (seen.has(input)) {
            return;
          }
          seen.add(input);
          candidates.push(input);
        });
    }

    candidates.sort((left, right) => scoreTargetInput(right) - scoreTargetInput(left));
    return candidates[0] || null;
  }

  function isEnabled() {
    return loadConfig().enabled;
  }

  async function waitForElement(getter, timeoutMs = ACTION_TIMEOUT_MS, intervalMs = ACTION_POLL_INTERVAL_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const element = getter();
      if (element) {
        return element;
      }
      await sleep(intervalMs);
    }
    return null;
  }

  function findLabeledButton(labels, root = document) {
    const tokens = labels.map(normalizeToken);
    return (
      Array.from(root.querySelectorAll("button, a.btn, a, input[type='submit'], input[type='button']"))
        .filter(isVisible)
        .find((element) => {
          const text = normalizeToken(element.textContent || element.value || "");
          return tokens.some((token) => text === token || text.includes(token));
        }) || null
    );
  }

  function findVisibleBySelectors(selectors, root = document) {
    for (const selector of selectors) {
      const match = Array.from(root.querySelectorAll(selector)).find(isVisible);
      if (match) {
        return match;
      }
    }
    return null;
  }

  function findSearchButton(root = document) {
    return (
      findLabeledButton(["Procurar", "Search"], root) ||
      findVisibleBySelectors(
        [
          "button[type='submit']",
          "input[type='submit']",
          "button[name*='search']",
          "button[id*='search']",
          "button[class*='search']",
          "button[data-action*='search']",
          "a[data-action*='search']",
        ],
        root
      )
    );
  }

  function findAttackButton(root = document) {
    return (
      findLabeledButton(["Atacar!", "Atacar", "Attack!", "Attack", "Confirmar", "Confirm"], root) ||
      findVisibleBySelectors(
        [
          "a[href*='/attack/']",
          "a[href*='attack']",
          "button[data-action*='attack']",
          "a[data-action*='attack']",
          ".ui-ws-action[data-action*='attack']",
          "input[type='submit'][value*='Atacar']",
          "input[type='submit'][value*='Attack']",
          "input[type='button'][value*='Atacar']",
          "input[type='button'][value*='Attack']",
        ],
        root
      )
    );
  }

  function findAnyAttackButton() {
    for (const root of collectActionRoots()) {
      const match = findAttackButton(root);
      if (match) {
        return match;
      }
    }
    return findAttackButton(document);
  }

  function getActionRoot(element) {
    return (
      element?.closest("form, .modal, .modal-ct, [role='dialog'], .fancybox-content, .swal2-popup") ||
      document
    );
  }

  function getPoisonItemConfig(playerName) {
    return POISON_CONFIG[normalizeToken(playerName)] || null;
  }

  function findPoisonOpenButton(itemPk) {
    return (
      document.querySelector(`a[rel='modal'][data-content-selector='.inv-md${itemPk}']`) || null
    );
  }

  function findUsePoisonButton(itemPk) {
    const selectors = [
      `a[href='/items/sub-search-target/${itemPk}/']`,
      `a[href*='/items/sub-search-target/${itemPk}/']`,
      `a[data-item-pk='${itemPk}'][href*='/items/sub-search-target/']`,
    ];

    for (const selector of selectors) {
      const visible = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (visible) {
        return visible;
      }
      const fallback = document.querySelector(selector);
      if (fallback) {
        return fallback;
      }
    }

    return null;
  }

  function findPoisonSearchForm(itemPk) {
    const selector = `form[action='/items/sub-search-target/${itemPk}/'], form[action*='/items/sub-search-target/${itemPk}/']`;
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  }

  function findPoisonTargetInput(itemPk) {
    const form = findPoisonSearchForm(itemPk);
    if (!form) {
      return null;
    }

    return (
      Array.from(
        form.querySelectorAll(
          "#id_target_name, input[name='target_name'], input[placeholder='Nome do alvo'], input[placeholder*='Nome do alvo']"
        )
      ).find(isTargetTextInput) || null
    );
  }

  function findPoisonSearchButton(itemPk) {
    const form = findPoisonSearchForm(itemPk);
    if (!form) {
      return null;
    }

    return findSearchButton(form);
  }

  function submitSearchForm(form, submitter) {
    if (form && typeof form.requestSubmit === "function") {
      if (
        submitter &&
        (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement)
      ) {
        try {
          form.requestSubmit(submitter);
          return true;
        } catch (error) {
          // fall through to generic submit
        }
      }

      try {
        form.requestSubmit();
        return true;
      } catch (error) {
        // fall through to click/submit fallback
      }
    }

    if (submitter) {
      activateElement(submitter);
      return true;
    }

    return !!form?.dispatchEvent?.(new Event("submit", { bubbles: true, cancelable: true }));
  }

  async function runPoisonSequence(job) {
    const poison = getPoisonItemConfig(job.playerName);
    if (!poison) {
      return true;
    }

    if (!isEnabled()) {
      return false;
    }

    const openButton = findPoisonOpenButton(poison.itemPk);
    if (openButton) {
      activateElement(openButton);
      await sleep(120);
    }

    const useButton = await waitForElement(() => findUsePoisonButton(poison.itemPk));
    if (!useButton) {
      showToast(`Nao achei o botao Usar do ${poison.itemName}.`);
      return false;
    }
    activateElement(useButton);

    const searchForm = await waitForElement(() => findPoisonSearchForm(poison.itemPk));
    if (!searchForm) {
      showToast(`Nao achei o formulario do ${poison.itemName}.`);
      return false;
    }

    const targetInput = await waitForElement(() => findPoisonTargetInput(poison.itemPk));
    if (!targetInput || !isVisible(targetInput)) {
      showToast(`Nao achei o campo de alvo para ${poison.targetName}.`);
      return false;
    }
    await typeIntoInput(targetInput, poison.targetName);
    if (String(targetInput.value || "").trim() !== poison.targetName) {
      showToast(`O campo do alvo nao ficou com ${poison.targetName}. Parei antes de Procurar.`);
      return false;
    }

    const actionRoot = getActionRoot(targetInput);
    const searchButton = await waitForElement(() => findPoisonSearchButton(poison.itemPk));
    if (!searchButton) {
      showToast(`Nao achei o botao Procurar para ${poison.targetName}.`);
      return false;
    }
    submitSearchForm(searchForm, searchButton);

    const attackButton = await waitForElement(
      () => findAttackButton(actionRoot) || findAnyAttackButton(),
      ACTION_TIMEOUT_MS * 2
    );
    if (!attackButton) {
      showToast(`Nao achei o botao Atacar para ${poison.targetName}.`);
      return false;
    }

    showToast(`Veneno armado em ${poison.targetName}. Esperando ${POISON_ATTACK_SECONDS}s para atacar.`);
    const readyTimer = await waitForRunningTimerAtOrBelow(POISON_ATTACK_SECONDS);
    if (!readyTimer) {
      showToast(`Armei o veneno em ${poison.targetName}, mas nao chegou no timing de ${POISON_ATTACK_SECONDS}s.`);
      return false;
    }

    const finalAttackButton = findAttackButton(actionRoot) || findAnyAttackButton() || attackButton;
    activateElement(finalAttackButton);
    showToast(`Veneno ${poison.itemName} usado em ${poison.targetName} com timer ${readyTimer.text}.`);
    return true;
  }

  async function processPendingPoisons() {
    if (poisonRunnerActive) {
      return;
    }

    poisonRunnerActive = true;
    try {
      if (!isEnabled()) {
        return;
      }

      const jobs = prunePendingPoisons().sort(
        (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)
      );
      const currentJob = jobs[0];
      if (!currentJob || pendingPoisonIds.has(currentJob.id)) {
        return;
      }

      const timerState = getFieldTimerState();
      if (!timerState || timerState.seconds === null) {
        return;
      }

      if (timerState.isJoin) {
        return;
      }

      if (!timerState.isRunning) {
        return;
      }

      if (timerState.seconds > POISON_PREPARE_SECONDS) {
        return;
      }

      pendingPoisonIds.add(currentJob.id);
      const success = await runPoisonSequence(currentJob);
      const latestTimerState = getFieldTimerState();
      if (
        success ||
        (latestTimerState &&
          latestTimerState.isRunning &&
          latestTimerState.seconds !== null &&
          latestTimerState.seconds <= 0)
      ) {
        removePendingPoison(currentJob.id);
      } else {
        pendingPoisonIds.delete(currentJob.id);
      }
    } finally {
      poisonRunnerActive = false;
      schedulePendingPoisonRunner();
    }
  }

  function playAlertSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
      console.warn("[Lamentosa Dg Poison] Falha ao tocar beep", error);
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
      console.warn("[Lamentosa Dg Poison] Falha ao falar alerta", error);
      playAlertSound();
    }
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

  function sendTelegramMessage(message, successMessage = "") {
    const config = loadConfig();
    if (!config.telegramEnabled || !config.telegramBotToken || !config.telegramChatId) {
      return;
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/sendMessage`;
    const payload = JSON.stringify({
      chat_id: config.telegramChatId,
      text: message,
    });

    if (typeof GM_xmlhttpRequest === "function") {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          "Content-Type": "application/json",
        },
        data: payload,
        onload: () => {
          if (successMessage) {
            showToast(successMessage);
          }
        },
        onerror: () => {
          showToast("Falha ao enviar alerta para o Telegram.");
        },
      });
      return;
    }

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    })
      .then(() => {
        if (successMessage) {
          showToast(successMessage);
        }
      })
      .catch(() => showToast("Falha ao enviar alerta para o Telegram."));
  }

  function sendDungeonAlert(playerName) {
    sendTelegramMessage(
      `O ${playerName} iniciou uma DUNGEON, jogue um Veneno nele`,
      `Telegram enviado para ${playerName}.`
    );
  }

  function sendPoisonAttemptAlert(attackerName, targetName) {
    const timestamp = formatBrazilTimestamp();
    sendTelegramMessage(`[${timestamp}] ${attackerName} tentou envenenar ${targetName}.`);
  }

  function getMessageKey(messageNode) {
    return normalize(messageNode.innerText || messageNode.textContent || "");
  }

  function findDungeonLink(messageNode) {
    return (
      Array.from(messageNode.querySelectorAll("a")).find((anchor) => {
        const text = normalize(anchor.textContent || "");
        const href = anchor.getAttribute("href") || anchor.getAttribute("hx-get") || "";
        return text.includes("dungeon") || href.includes("/dungeons/");
      }) || null
    );
  }

  function isDungeonAnnouncement(messageNode) {
    const text = normalize(messageNode.innerText || messageNode.textContent || "");
    return text.includes("started a new dungeon");
  }

  function isPoisonAttemptMessage(messageNode) {
    const text = normalize(messageNode.innerText || messageNode.textContent || "");
    return POISON_ATTEMPT_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function getPublicPlayerAnchors(messageNode) {
    return Array.from(messageNode.querySelectorAll("a")).filter((anchor) => {
      const href = anchor.getAttribute("href") || anchor.getAttribute("hx-get") || "";
      return href.includes("/public/");
    });
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

  function findPublicAnchorInTextPart(anchors, textPart) {
    const textToken = normalizeToken(textPart);
    return (
      anchors.find((anchor) => {
        const token = normalizeToken(anchor.textContent || "");
        return token && textToken.includes(token);
      }) || null
    );
  }

  function cleanupPlayerLabel(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:;,\-.\]]+|[\s:;,\-.!]+$/g, "")
      .trim();
  }

  function findPlayerName(messageNode) {
    const anchors = Array.from(messageNode.querySelectorAll("a"));
    const targetTokens = TARGET_PLAYERS.map(normalizeToken);

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || anchor.getAttribute("hx-get") || "";
      const text = String(anchor.textContent || "").trim();
      const token = normalizeToken(text);
      if (!href.includes("/public/")) {
        continue;
      }
      if (targetTokens.includes(token)) {
        return text;
      }
    }

    const messageTextToken = normalizeToken(messageNode.innerText || messageNode.textContent || "");
    for (const player of TARGET_PLAYERS) {
      if (messageTextToken.includes(normalizeToken(player))) {
        return player;
      }
    }

    return null;
  }

  function findPoisonAttemptDetails(messageNode) {
    if (!isPoisonAttemptMessage(messageNode)) {
      return null;
    }

    const rawText = String(messageNode.innerText || messageNode.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const match = rawText.match(/(.+?)\s+(?:try|tries|tried)\s+to\s+poison\s+(.+?)(?:[.!]|$)/i);
    if (!match) {
      return null;
    }

    const attackerPart = cleanupPlayerLabel(match[1]);
    const receiverPart = cleanupPlayerLabel(match[2]);
    const targetName = findTrackedPlayerNameInText(receiverPart);
    if (!targetName) {
      return null;
    }

    const publicAnchors = getPublicPlayerAnchors(messageNode);
    const attackerAnchor = findPublicAnchorInTextPart(publicAnchors, attackerPart);
    const targetAnchor = findPublicAnchorInTextPart(publicAnchors, receiverPart);
    return {
      attackerName: String(attackerAnchor?.textContent || attackerPart || "Alguem").trim(),
      targetName: String(targetAnchor?.textContent || targetName).trim(),
    };
  }

  function handleMessage(messageNode, isInitial) {
    const config = loadConfig();
    if (!config.enabled) {
      return;
    }

    if (!(messageNode instanceof HTMLElement)) {
      return;
    }

    const key = getMessageKey(messageNode);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    if (isInitial) {
      return;
    }

    const poisonAttempt = findPoisonAttemptDetails(messageNode);
    if (poisonAttempt) {
      showToast(`${poisonAttempt.attackerName} tentou envenenar ${poisonAttempt.targetName}.`);
      sendPoisonAttemptAlert(poisonAttempt.attackerName, poisonAttempt.targetName);
      return;
    }

    if (!isDungeonAnnouncement(messageNode)) {
      return;
    }

    const playerName = findPlayerName(messageNode);
    if (!playerName) {
      return;
    }

    const dungeonLink = findDungeonLink(messageNode);
    if (!dungeonLink || !isVisible(dungeonLink)) {
      showToast(`DUNGEON de ${playerName} detectada, mas nao achei o link clicavel.`);
      return;
    }

    showToast(`DUNGEON de ${playerName} detectada. Jogar veneno.`);
    speakAlert();
    sendDungeonAlert(playerName);
    activateElement(dungeonLink);
    queuePoison(playerName);
    showToast(`Cliquei no link DUNGEON de ${playerName}.`);
  }

  function bootstrapChatObserver(chatList) {
    Array.from(chatList.children).forEach((node) => handleMessage(node, true));
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }

          if (node.matches("li")) {
            handleMessage(node, false);
            continue;
          }

          node.querySelectorAll?.("li").forEach((child) => handleMessage(child, false));
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
  schedulePendingPoisonRunner();
  waitForChatList();
})();
