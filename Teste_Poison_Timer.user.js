// ==UserScript==
// @name         Teste Poison Timer
// @namespace    codex.lamentosa
// @version      1.0.7
// @description  Testa quanto tempo leva para abrir o veneno, usar, preencher Nuvem e procurar sem atacar.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_HOSTS = [/lamentosa/i];
  const UI_STACK_ID = "lamentosa-ui-stack";
  const UI_SLOT_ID = "lamentosa-poison-test-slot";
  const UI_ORDER = 55;
  const BUTTON_ID = "lamentosa-poison-test-btn";
  const TOAST_ID = "lamentosa-poison-test-toast";
  const BUTTON_BG = "#1f6fb2";
  const TARGET_NAME = "Nuvem";
  const ACTION_TIMEOUT_MS = 8000;
  const ACTION_POLL_INTERVAL_MS = 120;
  const TYPE_START_DELAY_MS = 180;
  const TYPE_CHAR_DELAY_MS = 220;
  const TYPE_FINISH_DELAY_MS = 450;
  const TEST_ITEMS = [
    { itemPk: "945167", itemName: "Strength Poison" },
    { itemPk: "945168", itemName: "Defense Poison" },
  ];

  if (!ENABLED_HOSTS.some((pattern) => pattern.test(location.hostname))) {
    return;
  }

  let buttonNode = null;
  let running = false;

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
      slot.style.maxWidth = "280px";
      slot.style.pointerEvents = "none";

      const buttonHost = document.createElement("div");
      buttonHost.style.pointerEvents = "auto";

      const toastHost = document.createElement("div");
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
    node.style.whiteSpace = "pre-line";
    toastHost.appendChild(node);
    return node;
  }

  function showToast(message) {
    const node = getToastNode();
    node.textContent = message;
    console.log(`[Lamentosa Teste Poison Timer] ${message}`);
  }

  function updateButtonState() {
    if (!buttonNode) {
      return;
    }

    buttonNode.style.background = running ? "#8b5a12" : BUTTON_BG;
    buttonNode.textContent = running ? "Teste Veneno..." : "Teste Veneno";
  }

  function installControls() {
    if (!document.body || document.getElementById(BUTTON_ID)) {
      return;
    }

    const { buttonHost } = ensureUiSlot();
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Teste Veneno";
    button.title = "Executa o teste do veneno em Nuvem sem clicar em Atacar.";
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
      if (running) {
        return;
      }
      runPoisonTest().catch((error) => {
        console.error("[Lamentosa Teste Poison Timer] erro inesperado", error);
        showToast(`Erro no teste: ${error?.message || error}`);
        running = false;
        updateButtonState();
      });
    });
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

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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

  function normalizeToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
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

  function getModalRoot(element = null) {
    const direct =
      element?.closest(".modal, .modal-ct, [role='dialog'], .fancybox-content, .swal2-popup") || null;
    if (direct && isVisible(direct)) {
      return direct;
    }

    return findVisibleBySelectors(
      [".modal", ".modal-ct", "[role='dialog']", ".fancybox-content", ".swal2-popup"],
      document
    );
  }

  function getModalContent(root) {
    if (!root) {
      return null;
    }

    return root.querySelector(".modal-content, .fancybox-content, .swal2-html-container") || root;
  }

  function getTextSnapshot(root) {
    const text = String(getModalContent(root)?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 320);
  }

  function summarizeText(text, maxLength = 120) {
    const normalized = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) {
      return "";
    }
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
  }

  function findLoadingIndicator(root = document) {
    return (
      Array.from(root.querySelectorAll("*"))
        .filter(isVisible)
        .find((element) => normalizeToken(element.textContent || "").includes("loading")) || null
    );
  }

  function getActionLabel(element) {
    return String(
      element?.textContent || element?.value || element?.getAttribute?.("aria-label") || "acao"
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function isCloseModalControl(element) {
    return !!element?.matches?.(".close-modal, a.close-modal, button.close-modal");
  }

  function findConfirmationAction(root = document, excludedElements = []) {
    const excluded = new Set(excludedElements.filter(Boolean));
    return (
      Array.from(root.querySelectorAll("button, a.btn, a, input[type='submit'], input[type='button']"))
        .filter(isVisible)
        .filter((element) => !excluded.has(element))
        .filter((element) => !isCloseModalControl(element))
        .find((element) => {
          const text = normalizeToken(element.textContent || element.value || "");
          const href = String(element.getAttribute("href") || "").toLowerCase();
          if (!text && !href) {
            return false;
          }
          if (text.includes("procurar") || text.includes("search")) {
            return false;
          }

          return (
            [
              "atacar",
              "attack",
              "confirmar",
              "confirm",
              "usar",
              "use",
              "aplicar",
              "apply",
              "envenenar",
              "poison",
            ].some((token) => text.includes(token)) ||
            href.includes("/attack/") ||
            href.includes("sub-use") ||
            href.includes("subuse") ||
            href.includes("poison")
          );
        }) || null
    );
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
          // fall through to the generic submit path
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

  function getActionRoot(element) {
    return (
      element?.closest("form, .modal, .modal-ct, [role='dialog'], .fancybox-content, .swal2-popup") ||
      document
    );
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
    if (document.activeElement !== input && typeof input.focus === "function") {
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        input.focus();
      }
    }

    setSelectionRangeSafe(input, 0, String(input.value || "").length);
    dispatchKeyboardEvent(input, "keydown", "Backspace");
    dispatchBeforeInputEvent(input, null, "deleteContentBackward");
    setNativeInputValue(input, "");
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

  function findPoisonItem() {
    for (const item of TEST_ITEMS) {
      const openButton =
        document.querySelector(`a[rel='modal'][data-content-selector='.inv-md${item.itemPk}']`) || null;
      const useButton =
        document.querySelector(`a[href='/items/sub-search-target/${item.itemPk}/']`) ||
        document.querySelector(`a[href*='/items/sub-search-target/${item.itemPk}/']`);

      if (openButton || useButton) {
        return {
          ...item,
          openButton,
          useButton,
        };
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

  function formatMs(ms) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  async function runPoisonTest() {
    running = true;
    updateButtonState();
    showToast("Iniciando teste do veneno em Nuvem...");

    const item = findPoisonItem();
    if (!item) {
      running = false;
      updateButtonState();
      showToast("Nao achei Strength Poison nem Defense Poison no inventario.");
      return;
    }

    const startedAt = performance.now();
    const marks = [{ label: "inicio", at: startedAt }];

    if (item.openButton && isVisible(item.openButton)) {
      activateElement(item.openButton);
      marks.push({ label: "abriu inventario/item", at: performance.now() });
      await sleep(120);
    }

    const useButton = await waitForElement(() => {
      const direct =
        document.querySelector(`a[href='/items/sub-search-target/${item.itemPk}/']`) ||
        document.querySelector(`a[href*='/items/sub-search-target/${item.itemPk}/']`);
      return direct && isVisible(direct) ? direct : direct;
    });
    if (!useButton) {
      running = false;
      updateButtonState();
      showToast(`Nao achei o botao Usar do ${item.itemName}.`);
      return;
    }
    activateElement(useButton);
    marks.push({ label: "clicou usar", at: performance.now() });

    const searchForm = await waitForElement(() => findPoisonSearchForm(item.itemPk));
    if (!searchForm) {
      running = false;
      updateButtonState();
      showToast("Nao achei o formulario do veneno.");
      return;
    }

    const targetInput = await waitForElement(() => findPoisonTargetInput(item.itemPk));
    if (!targetInput || !isVisible(targetInput)) {
      running = false;
      updateButtonState();
      showToast("Nao achei o campo de alvo.");
      return;
    }
    await typeIntoInput(targetInput, TARGET_NAME);
    if (String(targetInput.value || "").trim() !== TARGET_NAME) {
      running = false;
      updateButtonState();
      showToast(`O campo do alvo nao ficou com ${TARGET_NAME}. Parei antes de Procurar.`);
      return;
    }
    marks.push({ label: "escreveu nome", at: performance.now() });

    const actionRoot = getActionRoot(targetInput);
    const modalRoot = getModalRoot(targetInput) || actionRoot;
    const snapshotBeforeSearch = getTextSnapshot(modalRoot);
    const searchButton = await waitForElement(() => findPoisonSearchButton(item.itemPk));
    if (!searchButton) {
      running = false;
      updateButtonState();
      showToast("Nao achei o botao Procurar.");
      return;
    }
    submitSearchForm(searchForm, searchButton);
    marks.push({ label: "clicou procurar", at: performance.now() });

    const resultState = await waitForElement(() => {
      const currentModal =
        getModalRoot(searchButton) || getModalRoot(targetInput) || getModalRoot() || modalRoot || document;
      const confirmationAction = findConfirmationAction(currentModal, [searchButton]);
      if (confirmationAction) {
        return {
          type: "confirmation",
          element: confirmationAction,
          snapshot: getTextSnapshot(currentModal),
        };
      }

      const currentSnapshot = getTextSnapshot(currentModal);
      const targetStillVisible = !!findPoisonTargetInput(item.itemPk);
      if (!targetStillVisible && currentSnapshot && currentSnapshot !== snapshotBeforeSearch) {
        return {
          type: findLoadingIndicator(currentModal) ? "loading" : "result",
          snapshot: currentSnapshot,
        };
      }

      return null;
    }, ACTION_TIMEOUT_MS * 2);

    if (!resultState) {
      running = false;
      updateButtonState();
      const currentModal = getModalRoot(searchButton) || getModalRoot(targetInput) || modalRoot || document;
      const currentSnapshot = getTextSnapshot(currentModal);
      if (findLoadingIndicator(currentModal)) {
        showToast("O modal ficou parado em Loading... depois de Procurar.");
        return;
      }
      showToast(`Nao reconheci a tela seguinte apos Procurar. Modal: ${summarizeText(currentSnapshot)}`);
      return;
    }

    if (resultState.type === "confirmation") {
      marks.push({ label: `confirmacao apareceu (${getActionLabel(resultState.element)})`, at: performance.now() });
    } else if (resultState.type === "loading") {
      marks.push({ label: "resultado entrou em loading", at: performance.now() });
    } else {
      marks.push({ label: "resultado carregou", at: performance.now() });
    }

    const totalMs = marks[marks.length - 1].at - startedAt;
    const lines = [
      `Tempo total: ${formatMs(totalMs)}`,
      `Teste concluido com ${item.itemName} em ${TARGET_NAME}.`,
    ];

    for (let index = 1; index < marks.length; index += 1) {
      const current = marks[index];
      const previous = marks[index - 1];
      lines.push(`${current.label}: +${formatMs(current.at - previous.at)}`);
    }

    console.log(`[Lamentosa Teste Poison Timer] Tempo total: ${formatMs(totalMs)}`);
    showToast(lines.join("\n"));
    running = false;
    updateButtonState();
  }

  installControls();
})();
