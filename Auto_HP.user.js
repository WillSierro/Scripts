// ==UserScript==
// @name         Auto HP
// @namespace    codex.lamentosa
// @version      1.2.0
// @description  Usa automaticamente o item use-haste/20 quando ele aparecer na tela.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const STORAGE_KEY = "lamentosaAutoHpEnabled";
  const CONTROL_BUTTON_ID = "lamentosa-auto-hp-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-auto-hp-slot";
  const UI_ORDER = 35;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const LINK_SELECTOR = "a[rel='modal'][href*='/premium-market/use-haste/20/']";
  const POLL_INTERVAL_MS = 400;
  const CONFIRM_TIMEOUT_MS = 5000;
  const CLOSE_TIMEOUT_MS = 5000;

  const state = {
    buttonNode: null,
    clickedCurrentAppearance: false,
  };

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  function log(message) {
    console.log(`[Auto HP] ${message}`);
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
      buttonHost: slot.children[0],
    };
  }

  function loadEnabled() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== "false";
  }

  function saveEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  }

  function updateButtonState() {
    if (!state.buttonNode) {
      return;
    }

    state.buttonNode.style.background = loadEnabled() ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Auto HP";
    button.title = "Clique para ligar/desligar o uso automatico do use-haste/20.";
    button.style.minWidth = "108px";
    button.style.padding = "6px 10px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 11px/1 Arial, sans-serif";
    button.style.boxShadow = "0 6px 24px rgba(0, 0, 0, 0.3)";
    button.style.cursor = "pointer";
    button.addEventListener("click", () => {
      saveEnabled(!loadEnabled());
      updateButtonState();
    });
    state.buttonNode = button;
    updateButtonState();
    buttonHost.appendChild(button);
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

    if (typeof element.focus === "function") {
      try {
        element.focus({ preventScroll: true });
      } catch (error) {
        element.focus();
      }
    }

    dispatchSimpleClick(element);
  }

  function getPotionLink() {
    return document.querySelector(LINK_SELECTOR);
  }

  function getConfirmButton() {
    return Array.from(document.querySelectorAll("button, input[type='submit'], a.btn, a"))
      .find((element) => {
        if (!isVisible(element)) {
          return false;
        }

        const text = String(element.textContent || element.value || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();

        return text === "confirmar" || text.includes("confirmar");
      }) || null;
  }

  async function confirmUse() {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      const confirmButton = getConfirmButton();
      if (confirmButton) {
        log("Botao Confirmar detectado. Clicando agora.");
        activateElement(confirmButton);
        return true;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    return false;
  }

  function getCloseButton() {
    return Array.from(document.querySelectorAll("a.close-modal, button.close-modal, .close-modal"))
      .find((element) => isVisible(element)) || null;
  }

  async function closeModal() {
    const deadline = Date.now() + CLOSE_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      const closeButton = getCloseButton();
      if (closeButton) {
        log("Botao fechar detectado. Clicando agora.");
        activateElement(closeButton);
        return true;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }

    return false;
  }

  async function tick() {
    const link = getPotionLink();
    if (!loadEnabled() || !link || !isVisible(link)) {
      state.clickedCurrentAppearance = false;
      return;
    }

    if (state.clickedCurrentAppearance) {
      return;
    }

    state.clickedCurrentAppearance = true;
    log("Link use-haste/20 detectado. Clicando agora.");
    activateElement(link);
    const confirmed = await confirmUse();
    if (confirmed) {
      await closeModal();
    }
  }

  installControls();
  window.setInterval(tick, POLL_INTERVAL_MS);
})();
