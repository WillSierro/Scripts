// ==UserScript==
// @name         Lamentosa Connection Guard
// @namespace    codex.lamentosa
// @version      1.0.0
// @description  Detecta Connection lost e recarrega a pagina automaticamente.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const ENABLED_STORAGE_KEY = "lamentosaConnectionGuardEnabled";
  const CONTROL_BUTTON_ID = "lamentosa-connection-guard-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-connection-guard-slot";
  const UI_ORDER = 60;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const RELOAD_COOLDOWN_MS = 15000;
  const CHECK_INTERVAL_MS = 1000;
  const STORAGE_KEY = "lamentosaConnectionGuardLastReloadAt";
  const MESSAGE_PATTERN_GROUPS = [
    [
      ["connection", "lost"],
      ["please", "refresh", "the", "page"],
    ],
    [
      ["bad", "gateway"],
      ["error", "code", "502"],
    ],
    [
      ["bad", "gateway"],
      ["host", "error"],
    ],
  ];
  const CANDIDATE_SELECTORS = [
    ".alert",
    ".alert-danger",
    ".text-danger",
    ".notification",
    ".message",
    ".msg",
    ".toast",
    ".banner",
    "[role='alert']",
    "body",
  ].join(", ");

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  let buttonNode = null;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(element) {
    if (!element || element === document.body) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    );
  }

  function matchesConnectionLost(text) {
    const normalized = normalize(text);
    if (!normalized) {
      return false;
    }

    return MESSAGE_PATTERN_GROUPS.some((patternGroup) =>
      patternGroup.every((parts) =>
        parts.every((part) => normalized.includes(part))
      )
    );
  }

  function shouldReloadNow() {
    const lastReloadAt = Number(sessionStorage.getItem(STORAGE_KEY) || "0");
    return Date.now() - lastReloadAt >= RELOAD_COOLDOWN_MS;
  }

  function loadEnabled() {
    const raw = localStorage.getItem(ENABLED_STORAGE_KEY);
    return raw !== "false";
  }

  function saveEnabled(enabled) {
    localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
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
      slot.style.pointerEvents = "none";

      const buttonHost = document.createElement("div");
      buttonHost.style.pointerEvents = "auto";

      slot.appendChild(buttonHost);
      root.appendChild(slot);
      reflowUiStack();
    }

    return {
      slot,
      buttonHost: slot.children[0],
    };
  }

  function updateButtonState() {
    if (!buttonNode) {
      return;
    }

    buttonNode.style.background = loadEnabled() ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Connection";
    button.title = "Clique para ligar/desligar o refresh automatico de Connection lost.";
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
      saveEnabled(!loadEnabled());
      updateButtonState();
    });
    buttonHost.appendChild(button);
  }

  function markReload() {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  }

  function findConnectionLostNode() {
    const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTORS));
    for (const candidate of candidates) {
      if (!isVisible(candidate)) {
        continue;
      }

      if (matchesConnectionLost(candidate.innerText || candidate.textContent || "")) {
        return candidate;
      }
    }

    return null;
  }

  function tryReload() {
    if (!loadEnabled()) {
      return;
    }

    const lostNode = findConnectionLostNode();
    if (!lostNode) {
      return;
    }

    if (!shouldReloadNow()) {
      return;
    }

    markReload();
    window.location.reload();
  }

  const observer = new MutationObserver(() => {
    tryReload();
  });

  installControls();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.setInterval(tryReload, CHECK_INTERVAL_MS);
  tryReload();
})();
