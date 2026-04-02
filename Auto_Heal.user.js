// ==UserScript==
// @name         Lamentosa Auto Heal
// @namespace    codex.lamentosa
// @version      1.4.2
// @description  Vigia a vida em tempo real e vai ao templo curar automaticamente ate 100%.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const STORAGE_KEY = "lamentosaAutoHealState";
  const SHARED_HEAL_LOCK_KEY = "lamentosaSharedHealLock";
  const TOAST_ID = "lamentosa-auto-heal-toast";
  const CONTROL_BUTTON_ID = "lamentosa-auto-heal-btn";
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-auto-heal-slot";
  const UI_ORDER = 40;
  const BUTTON_ACTIVE_BG = "#2f8f46";
  const BUTTON_INACTIVE_BG = "#9a2f2f";
  const LIFE_CURRENT_SELECTOR = ".g-life .value";
  const LIFE_FULL_SELECTOR = ".g-life .full-life-value";
  const PAGE_STATE_SELECTOR = "#pageState";
  const RECOVERY_BUTTON_SELECTOR = ".recovery-btn[data-percent]";
  const TEMPLE_PATH = "/temple/main-room/";
  const POLL_INTERVAL_MS = 120;
  const HEAL_TIMEOUT_MS = 5000;
  const REDIRECT_COOLDOWN_MS = 1800;
  const MAX_50_HEALS_PER_CYCLE = 2;
  const HEAL_LOCK_TTL_MS = 8000;

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  window.__lamentosaAutoHealActive = true;

  const state = {
    intervalId: null,
    waitingForHeal: false,
    lastLifeValue: null,
    lastClickedPercent: null,
    lastClickAt: 0,
    lastStatusMessage: "",
    redirectCooldownUntil: 0,
    heal50ClicksThisCycle: 0,
    buttonNode: null,
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
    console.log(`[Lamentosa Auto Heal] ${message}`);
  }

  function updateButtonState() {
    if (!state.buttonNode) {
      return;
    }

    const storage = loadStorage();
    state.buttonNode.style.background = storage.enabled ? BUTTON_ACTIVE_BG : BUTTON_INACTIVE_BG;
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
    const eventNames = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
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
        console.warn("[Lamentosa Auto Heal] requestSubmit falhou, tentando click normal", error);
      }
    }

    dispatchClick(element);
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
      missing: Math.max(0, full - current),
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
    const text = normalize(document.querySelector(PAGE_STATE_SELECTOR)?.textContent || "");
    return text.includes("terminado") || text.includes("finished");
  }

  function shouldWaitForActivityToFinish() {
    return isBossOrDungeonPage() && !isTemplePage() && !isActivityFinished();
  }

  function getTempleUrl() {
    return new URL(TEMPLE_PATH, location.origin).href;
  }

  function loadSharedHealLock() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SHARED_HEAL_LOCK_KEY) || "null");
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return {
        owner: String(parsed.owner || ""),
        expiresAt: Number(parsed.expiresAt || 0),
      };
    } catch (error) {
      return null;
    }
  }

  function saveSharedHealLock(lock) {
    localStorage.setItem(SHARED_HEAL_LOCK_KEY, JSON.stringify(lock));
  }

  function clearSharedHealLock(owner) {
    const current = loadSharedHealLock();
    if (current && current.owner && current.owner !== owner && current.expiresAt > Date.now()) {
      return;
    }
    localStorage.removeItem(SHARED_HEAL_LOCK_KEY);
  }

  function acquireSharedHealLock(owner) {
    const now = Date.now();
    const current = loadSharedHealLock();
    if (current && current.owner && current.owner !== owner && current.expiresAt > now) {
      return false;
    }

    saveSharedHealLock({
      owner,
      expiresAt: now + HEAL_LOCK_TTL_MS,
    });
    return true;
  }

  function loadStorage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && typeof parsed === "object") {
        return {
          enabled: parsed.enabled !== false,
        };
      }
    } catch (error) {
      // ignore
    }

    return { enabled: true };
  }

  function saveStorage(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function setEnabled(enabled) {
    saveStorage({ enabled });
    if (!enabled) {
      resetHealCycle();
    }
    updateButtonState();
    showToast(enabled ? "Auto Heal ativado." : "Auto Heal pausado.", true);
  }

  function installControls() {
    if (!document.body || document.getElementById(CONTROL_BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = CONTROL_BUTTON_ID;
    button.type = "button";
    button.textContent = "Auto Heal";
    button.title = "Clique para ativar ou pausar a autocura. Ctrl+Alt+L tambem alterna.";
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
    button.addEventListener("click", () => {
      const storage = loadStorage();
      setEnabled(!storage.enabled);
    });
    buttonHost.appendChild(button);

    window.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        const storage = loadStorage();
        setEnabled(!storage.enabled);
      }
    });
  }

  function getRecoveryOptions() {
    return Array.from(document.querySelectorAll(RECOVERY_BUTTON_SELECTOR))
      .map((button) => {
        const percent = parseInteger(button.getAttribute("data-percent"));
        const row = button.closest("tr");
        const cost = parseInteger(row?.querySelector(".gold")?.textContent);
        return { button, percent, cost };
      })
      .filter((item) => item.percent && item.cost != null && isVisible(item.button))
      .sort((a, b) => a.percent - b.percent || a.cost - b.cost);
  }

  function resetHealCycle() {
    state.waitingForHeal = false;
    state.lastLifeValue = null;
    state.lastClickedPercent = null;
    state.lastClickAt = 0;
    state.heal50ClicksThisCycle = 0;
    clearSharedHealLock("auto-heal");
  }

  function getRecovery50Button(options) {
    return options.find((option) => option.percent === 50)?.button || null;
  }

  function processTempleHealing(life) {
    if (!life) {
      showToast("Aguardando os dados de vida carregarem no templo.");
      return;
    }

    if (life.isFull) {
      resetHealCycle();
      showToast("Vida ja esta em 100%. Auto Heal parado.", true);
      return;
    }

    if (state.waitingForHeal) {
      acquireSharedHealLock("auto-heal");
      if (life.current > (state.lastLifeValue || 0)) {
        state.waitingForHeal = false;
        state.lastLifeValue = null;
        state.lastClickedPercent = null;
        state.lastClickAt = 0;
        showToast("Vida aumentou. Verificando se precisa do segundo 50%.", true);
        return;
      }

      if (Date.now() - state.lastClickAt >= HEAL_TIMEOUT_MS) {
        state.waitingForHeal = false;
        state.lastLifeValue = null;
        state.lastClickedPercent = null;
        state.lastClickAt = 0;
        showToast("O clique de 50% nao refletiu a tempo. Parando esse ciclo para evitar loop.", true);
      }
      return;
    }

    const options = getRecoveryOptions();
    if (!options.length) {
      showToast("Aguardando os botoes de recuperacao aparecerem no templo.");
      return;
    }

    if (state.heal50ClicksThisCycle >= MAX_50_HEALS_PER_CYCLE) {
      showToast("Ja usei 2x a cura de 50% neste ciclo. Parando para evitar loop.", true);
      clearSharedHealLock("auto-heal");
      return;
    }

    if (!acquireSharedHealLock("auto-heal")) {
      showToast("Outro script de cura esta atuando agora. Auto Heal aguardando.");
      return;
    }

    const nextButton = getRecovery50Button(options);
    if (!nextButton) {
      showToast("Nao achei o botao de cura de 50% no templo.", true);
      clearSharedHealLock("auto-heal");
      return;
    }

    const nextPercent = parseInteger(nextButton.getAttribute("data-percent"));
    showToast(
      `Vida ${life.current}/${life.full}. Usando cura de ${nextPercent}% (${state.heal50ClicksThisCycle + 1}/${MAX_50_HEALS_PER_CYCLE}).`,
      true
    );
    state.waitingForHeal = true;
    state.lastLifeValue = life.current;
    state.lastClickedPercent = nextPercent;
    state.lastClickAt = Date.now();
    state.heal50ClicksThisCycle += 1;
    activateElement(nextButton);
  }

  function tick() {
    const storage = loadStorage();
    if (!storage.enabled) {
      return;
    }

    const life = getLifeStatus();
    if (!life) {
      return;
    }

    if (shouldWaitForActivityToFinish()) {
      showToast("Em boss/dungeon ativo. Auto Heal vai esperar terminar para curar.");
      return;
    }

    if (life.isFull) {
      if (
        state.waitingForHeal ||
        state.heal50ClicksThisCycle > 0 ||
        state.lastLifeValue != null ||
        state.lastClickedPercent != null
      ) {
        resetHealCycle();
        showToast("Vida cheia detectada. Auto Heal finalizado.", true);
      }
      return;
    }

    if (!isTemplePage()) {
      const templeUrl = getTempleUrl();
      if (Date.now() < state.redirectCooldownUntil) {
        return;
      }
      state.redirectCooldownUntil = Date.now() + REDIRECT_COOLDOWN_MS;
      showToast("Vida abaixo de 100%. Indo para o templo curar.", true);
      location.assign(templeUrl);
      return;
    }

    state.redirectCooldownUntil = 0;
    processTempleHealing(life);
  }

  function run() {
    installControls();
    const storage = loadStorage();
    showToast(
      storage.enabled
        ? "Auto Heal ativo. Vou curar sempre que a vida cair."
        : "Auto Heal carregado, mas esta pausado.",
      true
    );
    state.intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    tick();
  }

  run();
})();
