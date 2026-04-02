// ==UserScript==
// @name         Lamentosa Dungeon Alert
// @namespace    codex.lamentosa
// @version      1.3.0
// @description  Clica em DUNGEON apenas para TheVamp e Nuvem, com alerta sonoro e alerta fixo no Telegram.
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
  const TARGET_PLAYERS = ["TheVamp", "Nuvem"];
  const VOICE_ALERT_TEXT = "jogar veneno";
  const DEFAULT_TELEGRAM_CONFIG = {
    enabled: true,
    telegramEnabled: true,
    telegramBotToken: "8532640999:AAEriel3Nd2-8152JSvQTsSfkASEP5tV5O8",
    telegramChatId: "-1001840156311",
  };
  const seenKeys = new Set();
  let buttonNode = null;

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
    console.log(`[Lamentosa Dungeon Alert] ${message}`);
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
    button.textContent = "Dungeon Alert";
    button.title = "Clique para ligar/desligar o Dungeon Alert. Ctrl+Alt+D tambem alterna.";
    button.style.minWidth = "150px";
    button.style.padding = "8px 12px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 12px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    buttonNode = button;
    updateButtonState();
    button.addEventListener("click", () => {
      const config = loadConfig();
      saveConfig({
        ...config,
        enabled: !config.enabled,
      });
      updateButtonState();
    });
    buttonHost.appendChild(button);

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const config = loadConfig();
        saveConfig({
          ...config,
          enabled: !config.enabled,
        });
        updateButtonState();
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
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
    if (typeof element.click === "function") {
      element.click();
    }
  }

  function normalizeToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
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
      console.warn("[Lamentosa Dungeon Alert] Falha ao tocar beep", error);
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
      console.warn("[Lamentosa Dungeon Alert] Falha ao falar alerta", error);
      playAlertSound();
    }
  }

  function sendTelegramAlert(playerName) {
    const config = loadConfig();
    if (!config.telegramEnabled || !config.telegramBotToken || !config.telegramChatId) {
      return;
    }

    const message = `O ${playerName} iniciou uma DUNGEON, jogue um Veneno nele`;
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
          showToast(`Telegram enviado para ${playerName}.`);
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
      .then(() => showToast(`Telegram enviado para ${playerName}.`))
      .catch(() => showToast("Falha ao enviar alerta para o Telegram."));
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
    sendTelegramAlert(playerName);
    dispatchClick(dungeonLink);
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
  waitForChatList();
})();
