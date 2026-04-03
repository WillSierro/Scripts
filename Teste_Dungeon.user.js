// ==UserScript==
// @name         Teste Dungeon
// @namespace    codex.lamentosa
// @version      1.0.0
// @description  Testa o clique automatico em qualquer DUNGEON nova que aparecer no chat.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const STORAGE_KEY = "lamentosaTesteDungeonEnabled";
  const CHAT_LIST_SELECTOR = "#gChatList";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-teste-dungeon-slot";
  const CONTROL_BUTTON_ID = "lamentosa-teste-dungeon-btn";
  const UI_ORDER = 55;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";

  const state = {
    observer: null,
    seenKeys: new Set(),
    buttonNode: null,
  };

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  function log(message) {
    console.log(`[Teste Dungeon] ${message}`);
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
    button.textContent = "Teste Dungeon";
    button.title = "Clique para ligar/desligar o teste de clique da DUNGEON.";
    button.style.minWidth = "150px";
    button.style.padding = "8px 12px";
    button.style.border = "0";
    button.style.borderRadius = "999px";
    button.style.color = "#fff";
    button.style.font = "600 12px/1 Arial, sans-serif";
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

  function getContextText(anchor) {
    const container =
      anchor.closest("#gChatList li, li.system, li") ||
      anchor.closest(".gc-in-msg, .gc-msg") ||
      anchor.parentElement;
    return String(container?.innerText || anchor.textContent || "");
  }

  function getDungeonLinkValue(anchor) {
    return (
      anchor.getAttribute("href") ||
      anchor.getAttribute("hx-get") ||
      anchor.getAttribute("data-href") ||
      anchor.href ||
      ""
    );
  }

  function normalizeToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function buildKey(anchor) {
    return `${getDungeonLinkValue(anchor)}|${normalizeToken(getContextText(anchor))}`;
  }

  function isDungeonMessage(anchor) {
    const linkValue = getDungeonLinkValue(anchor);
    const context = normalizeToken(getContextText(anchor));
    return (
      (linkValue.includes("/dungeons/") || linkValue.includes("/dungeon/")) &&
      context.includes("dungeon") &&
      (context.includes("startedanew") || context.includes("startednew"))
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

  function activateDungeonAnchor(element) {
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

  function seedExistingChat(chatList) {
    Array.from(chatList.querySelectorAll("a[href*='/dungeons/'], a[hx-get*='/dungeons/'], a[href*='/dungeon/'], a[hx-get*='/dungeon/']"))
      .filter(isVisible)
      .forEach((anchor) => {
        if (isDungeonMessage(anchor)) {
          state.seenKeys.add(buildKey(anchor));
        }
      });
  }

  function tryHandleNode(node) {
    if (!loadEnabled() || !(node instanceof HTMLElement)) {
      return false;
    }

    const anchors = [
      ...(node.matches("a") ? [node] : []),
      ...Array.from(
        node.querySelectorAll?.("a[href*='/dungeons/'], a[hx-get*='/dungeons/'], a[href*='/dungeon/'], a[hx-get*='/dungeon/']") || []
      ),
    ];

    for (const anchor of anchors) {
      if (!isVisible(anchor) || !isDungeonMessage(anchor)) {
        continue;
      }

      const key = buildKey(anchor);
      if (!key || state.seenKeys.has(key)) {
        continue;
      }

      state.seenKeys.add(key);
      log(`DUNGEON detectada: ${getContextText(anchor).replace(/\s+/g, " ").trim()}`);
      activateDungeonAnchor(anchor);
      return true;
    }

    return false;
  }

  function startObserver(chatList) {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (tryHandleNode(node)) {
            return;
          }
        }
      }
    });

    state.observer.observe(chatList, { childList: true, subtree: true });
  }

  function waitForChat() {
    const intervalId = window.setInterval(() => {
      const chatList = document.querySelector(CHAT_LIST_SELECTOR);
      if (!chatList) {
        return;
      }

      window.clearInterval(intervalId);
      seedExistingChat(chatList);
      startObserver(chatList);
      log("Teste Dungeon pronto. Aguardando nova DUNGEON no chat.");
    }, 300);
  }

  installControls();
  waitForChat();
})();
