// ==UserScript==
// @name           ZenArcMod
// @version        2.5.2
// @description    Keep pinned tabs; unload to Zen's native empty screen.
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==
// MIT License. See LICENSE.txt. Loaded per browser window by Sine.
(() => {
  "use strict";
  const win = window;
  const S = Services;
  const VERSION = "2.5.2";
  const TAG = "[ZenArcMod]";
  if (win.location?.href !== "chrome://browser/content/browser.xhtml") return;
  if (win.__zenSafeClose) {
    Components.utils.reportError(TAG + " Another copy is active. Remove the old AutoConfig mod and restart.");
    return;
  }
  let disposed = false, quitting = false, installed = false;
  let lastError = "", cancelLanding = null;
  const PREFIX = "zen-safe-close.";
  const DEFAULTS = {"enabled":true,"protectPinned":true,"emptyScreen":true,"neutralFocus":true,"preserveScroll":true,"hideClose":true,"hideUnload":false,"visuals":true,"includeFolders":true,"inactive":"unloaded","effect":"sepia","opacity":"1","strength":"1","saturation":"0.6","gestures":true,"newGesture":"D","closeGesture":"DR","gestureDistance":"24","settleTime":"200","menuDelay":"500","visualScope":"pinned","density":"roomy","showLoadedInFolders":false,"rememberLoadedTabs":false,"collapseSleepingFoldersAtStartup":true,"trail":true,"trailColor":"#168f85","trailWidth":"12"};
  let config = {}, configRevision = 0, configErrors = [];
  let onConfigChanged = () => {};
  function readConfig() {
    const next = {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
      try {
        next[key] = typeof value === "boolean"
          ? S.prefs.getBoolPref(PREFIX + key, value)
          : S.prefs.getStringPref(PREFIX + key, value);
      } catch (_) { next[key] = value; }
    }
    function number(key, min, max) {
      const raw = String(next[key]).trim().replace(",", ".");
      const n = raw === "" ? NaN : Number(raw);
      next[key] = Math.min(max, Math.max(min,
        Number.isFinite(n) ? n : Number(DEFAULTS[key])));
    }
    number("opacity", 0.1, 1);
    number("strength", 0, 1);
    number("saturation", 0, 2);
    number("gestureDistance", 8, 200);
    number("trailWidth", 2, 24);
    if (!/^#[0-9a-f]{6}$/i.test(next.trailColor)) next.trailColor = DEFAULTS.trailColor;
    number("settleTime", 0, 1000);
    number("menuDelay", 0, 1500);
    if (!["roomy", "cosy", "compact"].includes(next.density)) next.density = "roomy";
    if (!["unloaded", "unselected"].includes(next.inactive)) next.inactive = "unloaded";
    if (!["pinned", "all"].includes(next.visualScope)) next.visualScope = "pinned";
    if (!["sepia", "grayscale", "none"].includes(next.effect)) next.effect = "sepia";
    const directions = { "↑": "U", "↓": "D", "←": "L", "→": "R" };
    const normalize = value => String(value).toUpperCase()
      .replace(/[↑↓←→]/g, ch => directions[ch])
      .replace(/[\s,>\-]/g, "").replace(/(.)\1+/g, "$1");
    next.newGesture = normalize(next.newGesture);
    next.closeGesture = normalize(next.closeGesture);
    configErrors = [];
    if (![next.newGesture, next.closeGesture].every(value => /^[UDLR]{0,12}$/.test(value))) {
      configErrors.push("Gesture: use only U, D, L, R or arrow symbols (up to 12 directions).");
    }
    if (next.newGesture && next.newGesture === next.closeGesture) {
      configErrors.push("New tab and close tab gestures must be different.");
    }
    next.gesturesValid = configErrors.length === 0;
    config = Object.freeze(next);
    configRevision++;
  }
  try {
    const branch = S.prefs.getDefaultBranch("");
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (typeof value === "boolean") branch.setBoolPref(PREFIX + key, value);
      else branch.setStringPref(PREFIX + key, value);
    }
  } catch (_) {}
  readConfig();
  const prefObserver = { observe() { if (!disposed) { readConfig(); onConfigChanged(); } } };
  S.prefs.addObserver(PREFIX, prefObserver);
  const pending = new Set(), originals = [];
  const enabled = () => !disposed && !quitting &&
    config.enabled;
  function warn(error) {
    lastError = String(error);
    try { Components.utils.reportError(TAG + " " + lastError); } catch (_) {}
    try {
      const box = win.gBrowser.getNotificationBox(win.gBrowser.selectedBrowser);
      const notification = box.appendNotification("zen-safe-close-warning", {
        label: "ZenArcMod: pinned tab kept. " + lastError,
        priority: box.PRIORITY_WARNING_MEDIUM
      }, []);
      notification?.catch?.(() => {});
    } catch (_) {}
  }
  const belongs = tab => tab?.isConnected && tab.ownerDocument?.defaultView === win;
  const protect = tab => enabled() && config.protectPinned && belongs(tab) && tab.pinned;
  const complex = tab => tab.splitView || tab.splitview ||
    tab.group?.hasAttribute("split-view-group") || tab.hasAttribute("glance-id") ||
    tab.hasAttribute("zen-glance-tab");
  function wrap(object, name, factory) {
    if (typeof object?.[name] !== "function") throw new Error(name + " unavailable");
    const original = object[name], replacement = factory(original);
    object[name] = replacement;
    if (object[name] !== replacement) throw new Error("Cannot wrap " + name);
    originals.push([object, name, original, replacement]);
  }
  function captureScroll() {
    const ws = win.gZenWorkspaces, arrow = win.gBrowser.tabContainer?.arrowScrollbox;
    const nodes = new Set();
    for (const box of [ws?.activeScrollbox, arrow]) {
      if (!box) continue;
      for (const node of [box, box.scrollbox, box._scrollbox,
        box.shadowRoot?.querySelector?.("scrollbox")]) {
        if (node && Number.isFinite(node.scrollTop) && Number.isFinite(node.scrollLeft)) nodes.add(node);
      }
    }
    return [...nodes].map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  }
  function chooseEmptyScreen() {
    const gb = win.gBrowser, ws = win.gZenWorkspaces, empty = ws?._emptyTab;
    // Deliberately never call selectEmptyTab(): its fallback creates an ordinary tab.
    if (!S.prefs.getBoolPref("zen.urlbar.replace-newtab", true) ||
        win.gZenVerticalTabsManager?._canReplaceNewTab === false) {
      throw new Error("Enable zen.urlbar.replace-newtab and restart Zen");
    }
    if (!belongs(empty) || empty.pinned || empty.closing || empty.group ||
        !empty.hasAttribute("zen-empty-tab") ||
        empty.linkedBrowser?.currentURI?.spec !== "about:blank") {
      throw new Error("Native Zen empty screen unavailable; no extra tab was created");
    }
    if (config.neutralFocus && typeof S.focus?.clearFocus !== "function") throw new Error("clearFocus unavailable");
    cancelLanding?.();
    const workspace = ws.activeWorkspace, snapshot = config.preserveScroll ? captureScroll() : [];
    let cancelled = false, frame = null, timer = null;
    const intentEvents = ["keydown", "pointerdown", "mousedown", "wheel", "touchstart"];
    const valid = () => !cancelled && enabled() && !win.closed &&
      gb.selectedTab === empty && ws.activeWorkspace === workspace;
    function restoreScroll() {
      for (const {node, top, left} of snapshot) {
        if (node.isConnected === false) continue;
        if (typeof node.scrollTo === "function") node.scrollTo({ top, left, behavior: "instant" });
        else { node.scrollTop = top; node.scrollLeft = left; }
      }
    }
    function settle() {
      if (!valid()) { cancel(); return; }
      try { if (config.neutralFocus) S.focus.clearFocus(win); restoreScroll(); } catch (error) { warn(error); }
    }
    function focusIn(event) {
      if (!valid()) return;
      // Suppress only native URL-bar focus restoration, not arbitrary controls.
      if (config.neutralFocus && (event.target === win.gURLBar?.inputField ||
          win.gURLBar?.contains?.(event.target))) settle();
    }
    function switched() {
      if (valid()) settle(); else cancel();
    }
    function cancel() {
      if (cancelled) return;
      cancelled = true;
      if (frame !== null) win.cancelAnimationFrame(frame);
      if (timer !== null) win.clearTimeout(timer);
      for (const type of intentEvents) win.removeEventListener(type, cancel, true);
      win.removeEventListener("focusin", focusIn, true);
      win.removeEventListener("TabSwitchDone", switched, true);
      if (cancelLanding === cancel) cancelLanding = null;
    }
    cancelLanding = cancel;
    for (const type of intentEvents) win.addEventListener(type, cancel, true);
    win.addEventListener("focusin", focusIn, true);
    win.addEventListener("TabSwitchDone", switched, true);
    try {
      gb.selectedTab = empty;
      if (gb.selectedTab !== empty) throw new Error("Zen refused to select its native empty screen");
      settle();
      if (config.settleTime === 0) { cancel(); return empty; }
      frame = win.requestAnimationFrame(() => {
        settle();
        if (!cancelled) frame = win.requestAnimationFrame(settle);
      });
      // Short, cancellable settling window for asynchronous native focus/scroll.
      // Real user input cancels it before Ctrl+L, clicks or wheel actions run.
      timer = win.setTimeout(cancel, config.settleTime);
      return empty;
    } catch (error) {
      cancel(); throw error;
    }
  }
  function chooseLanding(tabs) {
    const gb = win.gBrowser;
    if (!config.emptyScreen) {
      if (!tabs.includes(gb.selectedTab)) return;
      const other = Array.from(gb.visibleTabs || gb.tabs).find(tab =>
        belongs(tab) && !tabs.includes(tab) &&
        tab !== win.gZenWorkspaces?._emptyTab &&
        !tab.hidden && !tab.closing && !tab.hasAttribute("pending"));
      if (other) { gb.selectedTab = other; return; }
    }
    chooseEmptyScreen();
  }
  function handle(tabs) {
    const gb = win.gBrowser;
    const targets = [...new Set(tabs)].filter(tab => protect(tab) && !pending.has(tab));
    if (!targets.length) return Promise.resolve();
    const supported = targets.filter(tab => !complex(tab));
    if (supported.length !== targets.length) warn("Split View / Glance: automatic unload unsupported");
    if (!supported.length) return Promise.resolve();
    for (const tab of supported) pending.add(tab);
    const epoch = configRevision;
    try { chooseLanding(supported); }
    catch (error) {
      supported.forEach(tab => pending.delete(tab));
      warn(error); return Promise.resolve();
    }
    return (async () => {
      try {
        const unload = supported.filter(tab => protect(tab) && !tab.hasAttribute("pending"));
        if (!unload.length) return;
        for (const name of ["runBeforeUnloadForTabs", "prepareDiscardBrowser", "discardBrowser"]) {
          if (typeof gb[name] !== "function") throw new Error(name + " unavailable");
        }
        if (await gb.runBeforeUnloadForTabs(unload)) throw new Error("Unload cancelled by the page or user");
        if (epoch !== configRevision || !enabled()) return;
        await Promise.all(unload.filter(tab => protect(tab) && tab !== gb.selectedTab)
          .map(tab => gb.prepareDiscardBrowser(tab)));
        if (epoch !== configRevision || !enabled()) return;
        const objectSignature = /^[^(]*\(\s*[^,]+,\s*\{/.test(
          Function.prototype.toString.call(gb.discardBrowser));
        for (const tab of unload) {
          // Recheck after async work; never steal a user's newer selection.
          if (!protect(tab) || tab.closing || tab === gb.selectedTab || tab.hasAttribute("pending")) continue;
          const ok = gb.discardBrowser(tab, objectSignature
            ? { forceDiscard: true, renderDiscarded: true } : true);
          if (!ok || !tab.hasAttribute("pending")) throw new Error("Zen refused to discard; pinned tab kept");
        }
      } catch (error) { if (!disposed) warn(error); }
      finally { supported.forEach(tab => pending.delete(tab)); }
    })();
  }
  function command(event) {
    const gb = win.gBrowser, tab = gb?.selectedTab;
    if (event.target?.id !== "cmd_close" || !enabled()) return;
    if (tab === win.gZenWorkspaces?._emptyTab) {
      // Closing an empty view should not jump to another tab or close the window.
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (!protect(tab)) return;
    const tabs = tab.multiselected ? Array.from(gb.selectedTabs) : [tab];
    const pins = tabs.filter(protect), ordinary = tabs.filter(item => !protect(item));
    event.preventDefault(); event.stopImmediatePropagation();
    handle(pins);
    if (ordinary.length) gb.removeTabs(ordinary);
  }
  const startObserver = { observe(subject) { if (subject === win) install(); } };
  const quitObserver = { observe() { quitting = true; cancelLanding?.(); } };
  let watchingStartup = false, watchingQuit = false;
  function destroy() {
    if (disposed) return;
    disposed = true;
    S.prefs.removeObserver(PREFIX, prefObserver);
    cancelLanding?.();
    if (watchingStartup) S.obs.removeObserver(startObserver, "browser-delayed-startup-finished");
    if (watchingQuit) S.obs.removeObserver(quitObserver, "quit-application-granted");
    win.removeEventListener("command", command, true);
    win.removeEventListener("unload", destroy);
    for (const [object, name, original, replacement] of originals.reverse()) {
      if (object[name] === replacement) object[name] = original;
    }
    if (win.__zenSafeClose === api) delete win.__zenSafeClose;
  }
  // Share ownership through live browser windows on every OS. Keep the bag on
  // the window across Sine hot reloads; surviving windows retain the same bag
  // when the first window closes. Never depend on macOS's hidden DOM window.
  let sharedHost = win.__zenSafeCloseSharedHost;
  if (!sharedHost) {
    for (const other of S.wm?.getEnumerator("navigator:browser") || []) {
      if (other.__zenSafeCloseSharedHost) { sharedHost = other.__zenSafeCloseSharedHost; break; }
    }
    win.__zenSafeCloseSharedHost = sharedHost ||= {};
  }
  const api = {
    sharedHost,
    version: VERSION, closePinned: handle, uninstall: destroy,
    get config() { return config; },
    setConfig(values) {
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(DEFAULTS, key)) throw new Error("Unknown setting: " + key);
        if (typeof DEFAULTS[key] === "boolean" && typeof value !== "boolean") {
          throw new Error("Boolean required: " + key);
        }
        if (typeof DEFAULTS[key] !== "boolean" &&
            typeof value !== "string" && typeof value !== "number") {
          throw new Error("Text or number required: " + key);
        }
      }
      for (const [key, value] of Object.entries(values)) {
        if (typeof DEFAULTS[key] === "boolean") S.prefs.setBoolPref(PREFIX + key, value);
        else S.prefs.setStringPref(PREFIX + key, String(value));
      }
    },
    get status() {
      return { version: VERSION, installed, enabled: enabled(), pending: pending.size,
        nativeEmptyAvailable: belongs(win.gZenWorkspaces?._emptyTab),
        configErrors: [...configErrors], configRevision,
        lastError, hooks: originals.map(item => item[1]),
        folderLayout: win.__zenSafeCloseLoadedFolders?.status, sessionMemory: win.__zenSafeCloseSessionMemory?.status,
        startupFolders: win.__zenSafeCloseStartupFolderRule?.status,
        nativeSync: win.__zenSafeCloseNativeSync?.status };
    }
  };
  function install() {
    if (disposed || installed || win.closed) return;
    if (watchingStartup) {
      S.obs.removeObserver(startObserver, "browser-delayed-startup-finished");
      watchingStartup = false;
    }
    try {
      const gb = win.gBrowser, manager = win.gZenPinnedTabManager;
      if (!gb || !manager) throw new Error("Zen browser API unavailable");
      wrap(gb, "removeTab", original => function(tab, ...args) {
        if (win.__zenSafeCloseNativeSync?.allows(tab)) return original.call(this, tab, ...args);
        if (enabled() && tab === win.gZenWorkspaces?._emptyTab) return undefined;
        if (protect(tab) && !args[0]?.adoptedBy) { handle([tab]); return undefined; }
        return original.call(this, tab, ...args);
      });
      wrap(gb, "removeTabs", original => function(tabs, ...args) {
        const all = Array.from(tabs);
        if (!enabled()) return original.call(this, tabs, ...args);
        const protectedHere = tab => protect(tab) && !win.__zenSafeCloseNativeSync?.allows(tab);
        const pins = all.filter(protectedHere);
        const ordinary = all.filter(tab => !protectedHere(tab) && tab !== win.gZenWorkspaces?._emptyTab);
        if (!pins.length && ordinary.length === all.length) return original.call(this, tabs, ...args);
        if (pins.length) handle(pins);
        if (ordinary.length) return original.call(this, ordinary, ...args);
        return undefined;
      });
      wrap(manager, "onCloseTabShortcut", original => function(...args) {
        const [event, tab = gb.selectedTab] = args;
        const all = Array.isArray(tab) ? tab : [tab], pins = all.filter(protect);
        if (!pins.length) return original.apply(this, args);
        event?.preventDefault?.(); event?.stopImmediatePropagation?.();
        return handle(pins);
      });
      win.addEventListener("command", command, true);
      S.obs.addObserver(quitObserver, "quit-application-granted");
      watchingQuit = true;
      installed = true;
      win.dispatchEvent(new win.CustomEvent("ZenSafeCloseConfigChanged"));
    } catch (error) { warn(error); destroy(); }
  }
  onConfigChanged = () => {
    cancelLanding?.();
    win.dispatchEvent(new win.CustomEvent("ZenSafeCloseConfigChanged"));
  };
  win.__zenSafeClose = api;
  win.addEventListener("unload", destroy, { once: true });
  // Sine invokes this callback on disable, remove and hot reload.
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(destroy);
  if (win.gBrowserInit?.delayedStartupFinished) install();
  else {
    S.obs.addObserver(startObserver, "browser-delayed-startup-finished");
    watchingStartup = true;
  }
})();

(() => {
  "use strict";
  const win = window;
  const api = win.__zenSafeClose;
  if (!api) return;
  win.__zenSafeCloseVisuals?.destroy();
  const ATTR = "data-zsc-unloaded";
  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "zen-safe-close-visuals";
  function render() {
    const c = api.config;
    const rules = [];
    if (c.enabled) {
      // Roomy uses Zen's native dimensions; remove our overrides completely.
      const density = {
        cosy: { height: 32, margin: 1 },
        compact: { height: 28, margin: 0 }
      }[c.density];
      if (density) {
        const tab = '#tabbrowser-tabs .tabbrowser-tab' +
          ':not([zen-essential="true"]):not([zen-empty-tab])' +
          ':not([zen-glance-tab]):not(.tabbrowser-tab .tabbrowser-tab)';
        rules.push(`
          @media -moz-pref("zen.tabs.vertical") {
            ${tab} {
              --tab-min-height: ${density.height}px !important;
              --tab-margin-block: ${density.margin}px !important;
              --tab-padding-block-start: 0px !important;
              --tab-padding-block-end: 0px !important;
              padding-block: 0 !important;
              margin-block: 0 !important;
            }
            ${tab} > .tab-stack > .tab-background {
              min-height: ${density.height}px !important;
              margin-block: ${density.margin}px !important;
            }
          }
        `);
      }
      if (c.hideClose) rules.push(".tabbrowser-tab[pinned] .tab-close-button { display: none !important; }");
      if (c.hideUnload) rules.push(".tabbrowser-tab[pinned] .tab-reset-button { display: none !important; }");
      if (c.visuals) {
        const filter = c.effect === "sepia"
          ? "sepia(" + c.strength + ") saturate(" + c.saturation + ")"
          : c.effect === "grayscale" ? "grayscale(" + c.strength + ")" : "none";
        const selector = c.visualScope === "pinned"
          ? ".tabbrowser-tab[pinned][data-zsc-unloaded]" : ".tabbrowser-tab[data-zsc-unloaded]";
        // Zen animates the outer tab's opacity/height when folding active folders.
        // Keep appearance on its contents so native collapse can hide the row.
        rules.push(selector + " > .tab-stack { filter: " + filter +
          " !important; opacity: " + c.opacity + " !important; }");
      }
    }
    style.textContent = rules.join("\n");
  }
  render();
  document.documentElement.appendChild(style);
  let stopped = false;
  let frame = null;
  function refresh() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    if (stopped) return;
    for (const tab of win.gBrowser?.tabs || []) {
      const c = api.config;
      let folder = !!tab.closest?.("zen-folder");
      for (let group = tab.group; group && !folder; group = group.group) {
        folder = !!group.isZenFolder && group.localName !== "zen-workspace-collapsible-pins";
      }
      const inactive = c.inactive === "unselected"
        ? tab !== win.gBrowser.selectedTab : tab.hasAttribute("pending") &&
          !win.__zenSafeCloseSessionMemory?.isRememberedLoaded?.(tab);
      const target = c.visualScope === "all" || tab.pinned;
      const dim = c.enabled && c.visuals && target && inactive &&
        !tab.hasAttribute("zen-empty-tab") && (c.includeFolders || !folder);
      tab.toggleAttribute(ATTR, dim);
    }
  }
  function schedule() {
    if (!stopped && frame === null) frame = win.requestAnimationFrame(refresh);
  }
  const events = ["TabSelect", "TabOpen", "TabPinned", "TabUnpinned", "TabBrowserDiscarded",
    "SSTabRestored", "TabGrouped", "TabUngrouped", "FolderGrouped", "FolderUngrouped", "ZenSafeCloseSessionStateChanged"];
  for (const name of events) win.addEventListener(name, schedule, true);
  function changed() { render(); refresh(); }
  win.addEventListener("ZenSafeCloseConfigChanged", changed);
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === "attributes" ||
        [...record.addedNodes, ...record.removedNodes].some(node =>
          node.nodeType === 1 &&
          (node.matches(".tabbrowser-tab, zen-folder, tab-group") ||
           node.querySelector(".tabbrowser-tab"))))) schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["pending", "pinned"]
  });
  const originalUninstall = api.uninstall;
  function destroy() {
    if (stopped) return;
    stopped = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    observer.disconnect();
    win.removeEventListener("ZenSafeCloseConfigChanged", changed);
    for (const name of events) win.removeEventListener(name, schedule, true);
    win.removeEventListener("unload", destroy);
    style.remove();
    for (const tab of win.gBrowser?.tabs || []) tab.removeAttribute(ATTR);
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseVisuals?.destroy === destroy) delete win.__zenSafeCloseVisuals;
  }
  function combinedUninstall() {
    destroy();
    return originalUninstall.call(api);
  }
  api.uninstall = combinedUninstall;
  if (typeof win.addUnloadListener === "function") {
    win.addUnloadListener(combinedUninstall);
  }
  win.addEventListener("unload", destroy, { once: true });
  win.__zenSafeCloseVisuals = { refresh, destroy };
  refresh();
})();

(() => {
  "use strict";
  const win = window, api = win.__zenSafeClose;
  if (!api || !win.gBrowser) return;
  win.__zenSafeCloseNativeSync?.destroy();
  const SYNC = "__zenSafeCloseNativeSyncOwners";
  const host = api.sharedHost;
  const shared = host[SYNC] ||= { owners: new Set(), ids: new Map(), hooks: [], errors: [] };
  let stopped = false;
  // These IDs exist only while Zen applies a native removal. Never persist a
  // personal tab list, and never authorize unrelated tabs during async sync.
  function authorize(ids, run) {
    const targets = [...new Set(ids.filter(id => typeof id === "string" && id))];
    for (const id of targets) shared.ids.set(id, (shared.ids.get(id) || 0) + 1);
    const release = () => {
      for (const id of targets) {
        const count = shared.ids.get(id) - 1;
        if (count) shared.ids.set(id, count); else shared.ids.delete(id);
      }
      if (!shared.owners.size && !shared.ids.size && host[SYNC] === shared) delete host[SYNC];
    };
    let result;
    try { result = run(); }
    catch (error) { release(); throw error; }
    if (result && typeof result.then === "function") return Promise.resolve(result).finally(release);
    release();
    return result;
  }
  function hook(module, name, factory) {
    if (shared.hooks.some(item => item[0] === module && item[1] === name)) return;
    const original = module?.[name];
    if (typeof original !== "function") throw new Error(name + " unavailable");
    const replacement = factory(original);
    module[name] = replacement;
    if (module[name] !== replacement) throw new Error("Cannot wrap " + name);
    shared.hooks.push([module, name, original, replacement]);
  }
  shared.owners.add(api);
  shared.errors = [];
  for (const [uri, exported, name, ids] of [
    ["resource:///modules/zen/ZenWindowSync.sys.mjs", "ZenWindowSync", "on_TabClose",
      event => [event?.target?.id]],
    ["resource:///modules/zen/ZenSpacesSyncApplier.sys.mjs", "ZenSpacesSyncApplier", "applyBatch",
      records => Array.from(records || []).filter(record => record?.deleted).map(record => record.id)]
  ]) {
    try {
      const module = ChromeUtils.importESModule(uri)[exported];
      hook(module, name, original => function(...args) {
        return authorize(ids(args[0]), () => original.apply(this, args));
      });
    } catch (error) {
      // Older Zen releases may not have the cloud-sync module yet.
      shared.errors.push(exported + ": " + String(error));
      Components.utils.reportError("[ZenArcMod sync] " + error);
    }
  }
  const originalUninstall = api.uninstall;
  function destroy() {
    if (stopped) return;
    stopped = true;
    shared.owners.delete(api);
    if (!shared.owners.size) {
      for (const [module, name, original, replacement] of shared.hooks.splice(0).reverse()) {
        if (module[name] === replacement) module[name] = original;
      }
      // Preserve in-flight tombstones across Sine hot reload, until finally().
      if (!shared.ids.size && host[SYNC] === shared) delete host[SYNC];
    }
    win.removeEventListener("unload", destroy);
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseNativeSync?.destroy === destroy) delete win.__zenSafeCloseNativeSync;
  }
  function combinedUninstall() { destroy(); return originalUninstall.call(api); }
  api.uninstall = combinedUninstall;
  win.addEventListener("unload", destroy, { once: true });
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(combinedUninstall);
  win.__zenSafeCloseNativeSync = {
    allows: tab => !stopped && !!tab?.id && shared.ids.has(tab.id), destroy,
    get status() { return { hooks: shared.hooks.map(item => item[1]),
      activeRemovals: shared.ids.size, errors: [...shared.errors] }; }
  };
})();

(() => {
  "use strict";
  const win = window, api = win.__zenSafeClose;
  if (!api || !win.gBrowser) return;
  win.__zenSafeCloseSessionMemory?.destroy();
  const KEY = "zen-safe-close.loaded.v1";
  const BACKUP = "zen-safe-close-internal.sessionRestorePolicy";
  const POLICY = { "browser.startup.page": 3, "browser.sessionstore.restore_on_demand": true,
    "browser.sessionstore.restore_pinned_tabs_on_demand": true };
  const readPolicy = name => typeof POLICY[name] === "boolean"
    ? Services.prefs.getBoolPref(name, false) : Services.prefs.getIntPref(name, 1);
  const setPolicy = (name, value) => typeof POLICY[name] === "boolean"
    ? Services.prefs.setBoolPref(name, value) : Services.prefs.setIntPref(name, value);
  let stopped = false, quitting = false, ready = false, busy = false, active = false;
  let timer = null, epoch = 0, owner = false, lastError = "";
  const seen = new Set(), queue = [], intended = new Set(), requests = new Map();
  let published = new Set();
  const initialResume = !!api.config.rememberLoadedTabs;
  let resumeExisting = initialResume;
  let ss, privateWindow;
  try {
    ss = win.SessionStore || ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore;
    privateWindow = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs")
      .PrivateBrowsingUtils.isWindowPrivate(win);
  } catch (error) { Components.utils.reportError("[ZenArcMod session] " + error); return; }
  // Never write private browsing metadata or change policy from a private window.
  if (privateWindow) return;
  const host = api.sharedHost;
  // Module timers survive the browser window that released the last owner.
  const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const shared = host.__zenSafeCloseSessionOwners ||= { owners: new Set(), restoreTimer: null };
  const enabled = () => !stopped && api.config.enabled && api.config.rememberLoadedTabs;
  function report(error) { lastError = String(error); Components.utils.reportError("[ZenArcMod session] " + lastError); }
  const eligible = tab => tab?.isConnected && !tab.closing && !tab.hasAttribute("zen-empty-tab") &&
    !tab.hasAttribute("glance-id") && !tab.hasAttribute("zen-glance-tab");
  function isRememberedLoaded(tab) {
    return active && enabled() && eligible(tab) && (intended.has(tab) ||
      (resumeExisting && ss.getCustomTabValue(tab, KEY) === "1"));
  }
  function publishState() {
    const next = new Set(Array.from(win.gBrowser.tabs || []).filter(tab =>
      tab.hasAttribute("pending") && isRememberedLoaded(tab)));
    if (next.size === published.size && [...next].every(tab => published.has(tab))) return;
    published = next;
    win.dispatchEvent(new win.CustomEvent("ZenSafeCloseSessionStateChanged"));
  }
  function write(tab, value) {
    if (eligible(tab) && ss.getCustomTabValue(tab, KEY) !== value) ss.setCustomTabValue(tab, KEY, value);
  }
  function restorePolicy() {
    if (shared.owners.size) return;
    const raw = Services.prefs.getStringPref(BACKUP, "");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      for (const name of Object.keys(POLICY)) {
        const entry = saved[name];
        if (!entry || typeof entry.value !== typeof POLICY[name] || typeof entry.hadUser !== "boolean") throw new Error("Invalid restore-policy backup");
      }
      for (const name of Object.keys(POLICY)) {
        // Don't overwrite a newer external preference change.
        if (readPolicy(name) !== POLICY[name]) continue;
        if (saved[name].hadUser) setPolicy(name, saved[name].value);
        else Services.prefs.clearUserPref(name);
      }
      Services.prefs.clearUserPref(BACKUP);
    } catch (error) { report(error); }
  }
  function acquirePolicy() {
    if (owner) return true;
    if (shared.restoreTimer !== null) { timers.clearTimeout(shared.restoreTimer); shared.restoreTimer = null; }
    try {
      let raw = Services.prefs.getStringPref(BACKUP, "");
      if (!raw) {
        const saved = {};
        for (const name of Object.keys(POLICY)) saved[name] = { hadUser: Services.prefs.prefHasUserValue(name),
          value: readPolicy(name) };
        Services.prefs.setStringPref(BACKUP, JSON.stringify(saved));
      } else {
        const saved = JSON.parse(raw);
        if (Object.keys(POLICY).some(name => typeof saved[name]?.value !== typeof POLICY[name] || typeof saved[name]?.hadUser !== "boolean")) throw new Error("Invalid restore-policy backup");
      }
      // Persist while the option is on, including across shutdown: SessionStore
      // reads these before a Sine window script can run on the next launch.
      for (const name of Object.keys(POLICY)) setPolicy(name, POLICY[name]);
      shared.owners.add(win); owner = true; return true;
    } catch (error) { report(error); restorePolicy(); return false; }
  }
  function releasePolicy(preserve) {
    if (!owner) return;
    shared.owners.delete(win); owner = false;
    if (!preserve && !shared.owners.size && shared.restoreTimer === null) {
      // A same-turn Sine hot reload can reacquire ownership before restoring
      // policy; avoid briefly letting native queues load all sleeping tabs.
      shared.restoreTimer = timers.setTimeout(() => { shared.restoreTimer = null; restorePolicy(); }, 0);
    }
  }
  function cancelRequests() {
    epoch++;
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
    queue.length = 0;
    for (const request of requests.values()) win.clearTimeout(request.timer);
    requests.clear(); intended.clear();
  }
  function schedule() {
    if (!stopped && timer === null) timer = win.setTimeout(() => { timer = null; scan(); publishState(); pump(); }, 0);
  }
  function finish(tab) {
    const request = requests.get(tab);
    if (request) { win.clearTimeout(request.timer); requests.delete(tab); }
    if (!tab.hasAttribute("pending")) intended.delete(tab);
    schedule();
  }
  function pump() {
    if (!active || !enabled() || !ready || api.status?.installed === false || busy || quitting || win.closed) return;
    while (requests.size < 2 && queue.length) {
      const tab = queue.shift();
      if (!eligible(tab) || !intended.has(tab) || !tab.hasAttribute("pending")) continue;
      const generation = epoch;
      const request = { timer: win.setTimeout(() => {
        if (generation !== epoch) return;
        requests.delete(tab);
        // Keep the saved intention on a failed/slow load, rather than replacing
        // it with startup's temporary pending state. No automatic retry loop.
        schedule();
      }, 20000) };
      requests.set(tab, request);
      try {
        // Firefox's lazy-browser reload waits for SSTabRestoring before reloading
        // the saved session-history entry. It does not select/create a tab.
        win.gBrowser.getBrowserForTab(tab).reload();
      } catch (error) {
        win.clearTimeout(request.timer); requests.delete(tab); report(error);
      }
    }
  }
  function scan() {
    if (!active || !enabled() || !ready || api.status?.installed === false || busy || quitting || win.closed) return;
    const tabs = Array.from(win.gBrowser.tabs || []).filter(eligible);
    for (const tab of tabs) {
      if (!seen.has(tab)) {
        seen.add(tab);
        if (resumeExisting && ss.getCustomTabValue(tab, KEY) === "1" && tab.hasAttribute("pending")) {
          intended.add(tab); queue.push(tab);
        }
      }
      const value = tab.hasAttribute("pending") ? "0" : "1";
      // Restoring tabs are pending temporarily. Preserve their previous intent
      // until completion or an explicit discard by the user/browser.
      write(tab, intended.has(tab) && value === "0" ? "1" : value);
      if (value === "1") intended.delete(tab);
    }
    for (const tab of seen) if (!tabs.includes(tab)) { seen.delete(tab); intended.delete(tab); finishRemoved(tab); }
  }
  function finishRemoved(tab) {
    const request = requests.get(tab);
    if (request) { win.clearTimeout(request.timer); requests.delete(tab); }
  }
  function refresh() {
    if (enabled()) {
      if (!acquirePolicy()) return;
      if (!active) { active = true; seen.clear(); }
      publishState();
      if (ready) schedule();
    } else {
      const wasActive = active;
      active = false; resumeExisting = false;
      cancelRequests(); seen.clear(); releasePolicy(false);
      if (!owner && !shared.owners.size && shared.restoreTimer === null) restorePolicy();
      publishState();
      if (wasActive && ready) for (const tab of win.gBrowser.tabs || []) {
        try { ss.deleteCustomTabValue(tab, KEY); } catch (error) { report(error); }
      }
    }
  }
  function restored(event) {
    const tab = event.target;
    if (!eligible(tab)) return;
    if (active && ready && api.status?.installed !== false && !busy && !quitting && !win.closed && !tab.hasAttribute("pending")) {
      intended.delete(tab); write(tab, "1"); finish(tab);
    }
    schedule();
  }
  function restoring(event) {
    // SessionStore may replace custom values after TabOpen. Re-read the restored
    // value once history is ready; a request already in flight must not queue twice.
    const tab = event.target;
    if (!requests.has(tab) && !intended.has(tab)) seen.delete(tab);
    schedule();
  }
  function discarded(event) {
    const tab = event.target;
    if (!active || !ready || !eligible(tab)) return;
    intended.delete(tab); seen.add(tab); finishRemoved(tab);
    write(tab, "0"); publishState(); schedule();
  }
  const handlers = [
    ["ZenSafeCloseConfigChanged", refresh], ["TabOpen", schedule], ["TabClose", schedule],
    ["SSTabRestoring", restoring], ["SSTabRestored", restored], ["TabSelect", schedule],
    ["TabBrowserDiscarded", discarded],
    ["SSWindowStateBusy", () => { busy = true; }],
    ["SSWindowStateReady", () => { busy = false; schedule(); }]
  ];
  for (const [type, fn] of handlers) win.addEventListener(type, fn, true);
  const observer = new MutationObserver(records => { if (records.some(r => r.type === "attributes")) schedule(); });
  observer.observe(win.gBrowser.tabContainer, { subtree: true, attributes: true, attributeFilter: ["pending"] });
  const quitObserver = { observe() {
    // Metadata is normally updated live. Snapshot before shutdown tears browsers
    // down, while retaining intentions for any unfinished startup loads.
    scan(); quitting = true; cancelRequests();
  } };
  Services.obs.addObserver(quitObserver, "quit-application-granted");
  const originalUninstall = api.uninstall;
  function destroy(closingWindow = false) {
    if (stopped) return;
    const preserve = closingWindow || quitting || win.closed;
    if (preserve) scan();
    stopped = true; active = false; cancelRequests();
    publishState();
    observer.disconnect();
    for (const [type, fn] of handlers) win.removeEventListener(type, fn, true);
    Services.obs.removeObserver(quitObserver, "quit-application-granted");
    win.removeEventListener("unload", unload);
    releasePolicy(preserve);
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseSessionMemory?.destroy === destroy) delete win.__zenSafeCloseSessionMemory;
  }
  function unload() { destroy(true); }
  function combinedUninstall() { destroy(); return originalUninstall.call(api); }
  api.uninstall = combinedUninstall;
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(combinedUninstall);
  win.addEventListener("unload", unload, { once: true });
  win.__zenSafeCloseSessionMemory = { destroy, isRememberedLoaded,
    get status() { return { active, ready, queued: queue.length, restoring: requests.size, lastError }; } };
  refresh();
  Promise.resolve(ss.promiseAllWindowsRestored || ss.promiseInitialized).then(() => {
    if (stopped) return;
    ready = true; refresh();
  }).catch(report);
})();


(() => {
  "use strict";
  const win = window, api = win.__zenSafeClose;
  if (!api || !win.gBrowser) return;
  win.__zenSafeCloseLoadedFolders?.destroy();
  const FLAG = "data-zsc-loaded-folders";
  const HIDE = "data-zsc-folder-hidden", BOX = "data-zsc-folder-container";
  const START = "data-zsc-folder-start";
  const methods = ["animateCollapse", "animateExpand", "animateSelect", "animateUnload", "animateUnloadAll"];
  let stopped = false, active = false, frame = null, manager = null;
  const hooks = [], ownedFolders = new Set();
  let touched = new Set(), cancelPosition = null;
  let managedTabs = new Set();
  let cleaned = new WeakSet();
  const isFolder = node => node?.localName === "zen-folder";
  const enabled = () => !stopped && api.config.enabled && api.config.showLoadedInFolders;
  const loaded = tab => !tab.closing && !tab.hasAttribute("zen-empty-tab") &&
    (!tab.hasAttribute("pending") || win.__zenSafeCloseSessionMemory?.isRememberedLoaded?.(tab));
  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "zen-safe-close-loaded-folders";
  style.textContent = `
    [${FLAG}] [${HIDE}] { display: none !important; }
    [${FLAG}] [${BOX}]:not([${HIDE}]) { display: flex !important; flex-direction: column; }
    [${FLAG}] [${START}] { margin-top: 0 !important; }
    [${FLAG}] #tabbrowser-tabs, [${FLAG}] #tabbrowser-tabs * { overflow-anchor: none !important; }
  `;
  document.documentElement.appendChild(style);
  function mark(node, attr, value) {
    if (!node) return;
    touched.add(node);
    if (node.hasAttribute(attr) !== !!value) node.toggleAttribute(attr, !!value);
  }
  function clearLayout(node) {
    if (!node || cleaned.has(node)) return;
    cleaned.add(node);
    // Only native folder-animation properties; keep appearance on .tab-stack.
    for (const animation of node.getAnimations?.() || []) {
      const keys = animation.effect?.getKeyframes?.() || [];
      if (keys.some(key => ["opacity", "height", "minHeight", "marginTop"].some(p => p in key))) animation.cancel();
    }
    for (const prop of ["opacity", "height", "min-height"]) node.style.removeProperty(prop);
  }
  function folders() {
    return Array.from(win.gBrowser.tabContainer?.querySelectorAll("zen-folder") || [])
      .filter(folder => folder.isConnected && !folder.closest?.("[drag-image]"));
  }
  function collapsedParent(node) {
    for (let group = node.group; group; group = group.group) {
      if (isFolder(group) && group.collapsed) return true;
    }
    return false;
  }
  function render() {
    if (!active || !enabled()) return;
    for (const [node, previous] of scrollerStyles) {
      if (node.isConnected === false) { releaseScroller(node, previous); scrollerStyles.delete(node); }
    }
    const position = preservePosition ? null : viewportPosition();
    const all = folders();
    const previousTouched = touched;
    touched = new Set();
    for (const folder of ownedFolders) if (!all.includes(folder)) ownedFolders.delete(folder);
    for (const box of observedSizes) if (box.isConnected === false) { sizes?.unobserve(box); observedSizes.delete(box); }
    const folderTabs = new Set();
    for (const folder of all) {
      ownedFolders.add(folder);
      const tabs = Array.from(folder.tabs || []), live = tabs.filter(loaded);
      tabs.forEach(tab => folderTabs.add(tab));
      const visible = folder.collapsed ? live : [];
      const previous = folder.activeTabs || [];
      folder.toggleAttribute("has-active", !!visible.length);
      if (previous.length !== visible.length || previous.some((tab, i) => tab !== visible[i])) folder.activeTabs = visible;
      const hideFolder = collapsedParent(folder) && !live.length;
      clearLayout(folder);
      clearLayout(folder.labelElement?.parentElement);
      mark(folder, HIDE, hideFolder);
      const box = folder.groupContainer;
      if (box) {
        if (sizes && !observedSizes.has(box)) { sizes.observe(box); observedSizes.add(box); }
        clearLayout(box);
        box.removeAttribute("hidden");
        box.style.removeProperty("overflow-y");
        mark(box, BOX, true);
        mark(box, HIDE, (folder.collapsed || collapsedParent(folder)) && !live.length);
      }
      const start = folder.groupStartElement;
      mark(start, START, true);
      manager.updateFolderIcon?.(folder);
    }
    // Final pass after native activeTabs setters: every collapsed ancestor must
    // contain the loaded descendant in its list for tab.visible to stay true.
    for (const tab of managedTabs) {
      if (!folderTabs.has(tab)) { tab.removeAttribute("folder-active"); clearLayout(tab); }
    }
    managedTabs = folderTabs;
    for (const tab of folderTabs) {
      clearLayout(tab);
      const inCollapsed = collapsedParent(tab);
      tab.toggleAttribute("folder-active", loaded(tab) && inCollapsed);
      mark(tab, HIDE, inCollapsed && !loaded(tab));
      const split = tab.group?.hasAttribute("split-view-group") ? tab.group : null;
      if (split) {
        clearLayout(split);
        mark(split, HIDE, collapsedParent(split) && !Array.from(split.tabs || []).some(loaded));
      }
    }
    // Reconcile only nodes that left the managed tree. Never briefly unhide
    // pending rows or remove container layout during an ordinary refresh.
    for (const node of previousTouched) {
      if (!touched.has(node)) {
        for (const attr of [HIDE, BOX, START]) node.removeAttribute(attr);
        cleaned.delete(node);
      }
    }
    win.gBrowser.tabContainer?._invalidateCachedVisibleTabs?.();
    if (preservePosition) preservePosition(); else position?.restore();
  }
  function schedule() {
    if (!stopped && frame === null) frame = win.requestAnimationFrame(() => { frame = null; refresh(); });
  }
  const scrollerStyles = new Map();
  let preservePosition = null;
  function onAnchoredScroll() { if (preservePosition) schedule(); }
  function ownScroller(node) {
    if (!node?.style || scrollerStyles.has(node)) return;
    scrollerStyles.set(node, { value: node.style.getPropertyValue("overflow-anchor"),
      priority: node.style.getPropertyPriority("overflow-anchor") });
    // Document selectors do not cross the arrowscrollbox shadow boundary.
    node.style.setProperty("overflow-anchor", "none", "important");
    node.addEventListener?.("scroll", onAnchoredScroll, { passive: true });
  }
  function scrollNodes(header) {
    const nodes = new Set();
    for (let node = header.parentElement; node;
         node = node.assignedSlot || node.parentElement || node.getRootNode?.().host) {
      if (node.clientHeight > 0 && ["auto", "scroll"].includes(win.getComputedStyle(node).overflowY)) nodes.add(node);
    }
    for (const box of [win.gZenWorkspaces?.activeScrollbox, win.gBrowser.tabContainer?.arrowScrollbox]) {
      for (const node of [box?.scrollbox, box?._scrollbox, box?.shadowRoot?.querySelector?.("scrollbox"), box]) {
        if (node && Number.isFinite(node.scrollTop) && (node.clientHeight > 0 || node.scrollTop !== 0)) nodes.add(node);
      }
    }
    const result = [...nodes].filter(node => node.isConnected !== false && Number.isFinite(node.scrollTop));
    result.forEach(ownScroller);
    return result;
  }
  function snapshotPosition(group) {
    const header = group.labelElement?.parentElement;
    const before = header?.getBoundingClientRect?.();
    if (!before || !Number.isFinite(before.top)) return null;
    const nodes = scrollNodes(header);
    if (!nodes.length) return null;
    const viewport = nodes[0].getBoundingClientRect?.();
    if (viewport && (before.bottom <= viewport.top || before.top >= viewport.bottom)) return null;
    const workspace = win.gZenWorkspaces?.activeWorkspace;
    const snapshot = nodes.map(node => ({ node, left: node.scrollLeft }));
    function valid() {
      return active && enabled() && !win.closed && header.isConnected !== false &&
        win.gZenWorkspaces?.activeWorkspace === workspace;
    }
    function move(node, top, left) {
      // scrollTop assignment can obey smooth-scroll CSS and finish much later.
      if (typeof node.scrollTo === "function") node.scrollTo({ top, left, behavior: "instant" });
      else { node.scrollTop = top; if (Number.isFinite(left)) node.scrollLeft = left; }
    }
    return {
      valid,
      restore() {
        if (!valid()) return;
        for (const { node, left } of snapshot) {
          if (node.isConnected === false) continue;
          const delta = header.getBoundingClientRect().top - before.top;
          const horizontal = Number.isFinite(left) && Math.abs(node.scrollLeft - left) > 0.5;
          if (Math.abs(delta) > 0.5 || horizontal) move(node, node.scrollTop + delta, left);
        }
      }
    };
  }
  function holdPosition(group) {
    cancelPosition?.();
    const snapshot = snapshotPosition(group);
    if (!snapshot) return;
    const inputs = ["wheel", "touchstart", "pointerdown", "mousedown", "keydown", "TabSelect", "blur", "resize", "sizemodechange"];
    let id = null, cancelled = false, remaining = 2;
    function cancel() {
      if (cancelled) return;
      cancelled = true;
      if (id !== null) win.cancelAnimationFrame(id);
      for (const type of inputs) win.removeEventListener(type, cancel, true);
      if (cancelPosition === cancel) { cancelPosition = null; preservePosition = null; }
    }
    function restorePosition() {
      if (cancelled || !snapshot.valid()) { cancel(); return; }
      snapshot.restore();
    }
    cancelPosition = cancel;
    preservePosition = restorePosition;
    for (const type of inputs) win.addEventListener(type, cancel, true);
    restorePosition();
    function settled() {
      id = null;
      restorePosition();
      if (!cancelled && --remaining > 0) id = win.requestAnimationFrame(settled);
      // Keep the anchor until newer input, but never poll on an endless frame
      // loop. Later pending/resize events restore it during their own render.
    }
    if (!cancelled) id = win.requestAnimationFrame(settled);
  }
  function viewportPosition() {
    const workspace = win.gZenWorkspaces?.activeWorkspaceElement;
    for (const group of folders()) {
      if (workspace?.contains && !workspace.contains(group)) continue;
      const snapshot = snapshotPosition(group);
      if (snapshot) return snapshot;
    }
    return null;
  }
  function releaseScroller(node, previous) {
    node.removeEventListener?.("scroll", onAnchoredScroll);
    if (node.style.getPropertyValue("overflow-anchor") !== "none" ||
        node.style.getPropertyPriority("overflow-anchor") !== "important") return;
    if (previous.value) node.style.setProperty("overflow-anchor", previous.value, previous.priority);
    else node.style.removeProperty("overflow-anchor");
  }
  function releaseScrollers() {
    for (const [node, previous] of scrollerStyles) releaseScroller(node, previous);
    scrollerStyles.clear();
  }
  function installHooks() {
    const next = win.gZenFolders;
    if (manager === next && hooks.length) return true;
    if (!next || methods.some(name => typeof next[name] !== "function")) return false;
    manager = next;
    for (const name of methods) {
      const original = manager[name];
      const replacement = function(group, ...args) {
        if (!active || !enabled() || !isFolder(group)) return original.call(this, group, ...args);
        if (win.__zenSafeCloseApplyingStartupFolders) { schedule(); return Promise.resolve(false); }
        if (["animateExpand", "animateCollapse"].includes(name)) holdPosition(group);
        render();
        schedule(); // Native callers may clear activeTabs after awaiting us.
        // animateSelect's false means keep the folder collapsed, even if all
        // its tabs are loaded. No mutation of tab selection is needed.
        return Promise.resolve(false);
      };
      manager[name] = replacement;
      hooks.push([manager, name, original, replacement]);
    }
    return true;
  }
  function restore() {
    cancelPosition?.();
    active = false;
    document.documentElement.removeAttribute(FLAG);
    releaseScrollers();
    for (const node of touched) {
      for (const attr of [HIDE, BOX, START]) node.removeAttribute(attr);
    }
    touched.clear();
    const all = [...ownedFolders].filter(folder => folder.isConnected);
    const tabs = new Set(all.flatMap(folder => Array.from(folder.tabs || [])));
    for (const folder of all) { folder.removeAttribute("has-active"); folder.activeTabs = []; }
    for (const tab of tabs) { tab.removeAttribute("folder-active"); cleaned.delete(tab); clearLayout(tab); }
    // Recompute native visibility from the current selection. Keep all folder
    // collapsed flags and tab loading state unchanged when toggling the option.
    for (const folder of all.reverse()) {
      const name = folder.collapsed ? "animateCollapse" : "animateExpand";
      try { Promise.resolve(manager[name](folder)).catch(error => Components.utils.reportError(error)); }
      catch (error) { Components.utils.reportError(error); }
    }
    ownedFolders.clear();
    managedTabs.clear();
    cleaned = new WeakSet();
    for (const folder of all) {
      cleaned.delete(folder); cleaned.delete(folder.groupContainer);
      if (folder.labelElement?.parentElement) cleaned.delete(folder.labelElement.parentElement);
    }
  }
  function refresh() {
    if (enabled() && installHooks()) {
      active = true;
      document.documentElement.setAttribute(FLAG, "true");
      render();
    } else if (active) restore();
  }
  const events = ["TabSelect", "TabOpen", "TabClose", "TabBrowserDiscarded", "SSTabRestored",
    "TabGrouped", "TabUngrouped", "FolderGrouped", "FolderUngrouped", "TabGroupCreate",
    "TabGroupCollapse", "TabGroupExpand", "TabGroupAnimationComplete", "ZenSafeCloseSessionStateChanged"];
  for (const name of events) win.addEventListener(name, schedule, true);
  win.addEventListener("ZenSafeCloseConfigChanged", refresh);
  const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  const observedSizes = new Set();
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      if (record.type === "attributes") {
        if (record.attributeName !== "style") return true;
        const node = record.target;
        if (!cleaned.has(node) || !["opacity", "height", "min-height"].some(prop => node.style.getPropertyValue(prop))) return false;
        // An old native animation or another layout callback wrote after the
        // initial cleanup. Clean only that node on the next pass.
        cleaned.delete(node); return true;
      }
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
        (node.matches(".tabbrowser-tab, zen-folder, tab-group") || node.querySelector(".tabbrowser-tab, zen-folder")));
    })) schedule();
  });
  observer.observe(win.gBrowser.tabContainer, { subtree: true, childList: true,
    attributes: true, attributeFilter: ["pending", "collapsed", "style"] });
  const originalUninstall = api.uninstall;
  function destroy() {
    if (stopped) return;
    stopped = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    observer.disconnect();
    sizes?.disconnect(); observedSizes.clear();
    for (const name of events) win.removeEventListener(name, schedule, true);
    win.removeEventListener("ZenSafeCloseConfigChanged", refresh);
    win.removeEventListener("unload", destroy);
    cancelPosition?.();
    if (active) restore();
    for (const [object, name, original, replacement] of hooks.reverse()) {
      if (object[name] === replacement) object[name] = original;
    }
    style.remove();
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseLoadedFolders?.destroy === destroy) delete win.__zenSafeCloseLoadedFolders;
  }
  function combinedUninstall() { destroy(); return originalUninstall.call(api); }
  api.uninstall = combinedUninstall;
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(combinedUninstall);
  win.addEventListener("unload", destroy, { once: true });
  win.__zenSafeCloseLoadedFolders = { refresh, destroy,
    get status() { return { active, folders: ownedFolders.size, holdingHeader: !!preservePosition, scrollers: scrollerStyles.size }; } };
  refresh();
})();


(() => {
  "use strict";
  const win = window, api = win.__zenSafeClose;
  if (!api || !win.gBrowser) return;
  win.__zenSafeCloseStartupFolderRule?.destroy();
  const STARTUP = "__zenSafeCloseStartupFolders";
  // Retain the one-shot token across Sine hot reloads, not across windows/restarts.
  const state = win[STARTUP] ||= { handled: false, collapsed: 0, touched: new WeakSet() };
  let stopped = false, ready = false, busy = false, timer = null;
  const enabled = () => api.config.enabled && api.config.collapseSleepingFoldersAtStartup;
  if (!enabled()) state.handled = true;
  function schedule() {
    if (!stopped && !state.handled && timer === null) timer = win.setTimeout(() => {
      timer = null;
      if (!ready || busy || api.status?.installed === false || win.closed) return;
      if (!enabled()) { state.handled = true; return; }
      state.handled = true;
      const folders = Array.from(win.gBrowser.tabContainer?.querySelectorAll("zen-folder") || [])
        .filter(folder => folder.isConnected && !folder.closest?.("[drag-image]"));
      win.__zenSafeCloseApplyingStartupFolders = true;
      try {
        for (const folder of folders.reverse()) {
          if (folder.collapsed || state.touched.has(folder)) continue;
          const hasLoaded = Array.from(folder.tabs || []).some(tab =>
            !tab.closing && !tab.hasAttribute("zen-empty-tab") &&
            (!tab.hasAttribute("pending") || win.__zenSafeCloseSessionMemory?.isRememberedLoaded?.(tab)));
          if (!hasLoaded) {
            try { folder.collapsed = true; state.collapsed++; }
            catch (error) { Components.utils.reportError("[ZenArcMod startup folders] " + error); }
          }
        }
      } finally { delete win.__zenSafeCloseApplyingStartupFolders; }
      win.__zenSafeCloseLoadedFolders?.refresh();
    }, 0);
  }
  function input(event) {
    if (!event.isTrusted || state.handled) return;
    let folder = event.target?.closest?.("zen-folder");
    if (!folder) folder = event.composedPath?.().find(node => node.localName === "zen-folder");
    // Don't close a branch the user has already opened during slow startup.
    for (; folder; folder = folder.group) state.touched.add(folder);
  }
  function changed() {
    if (!enabled()) state.handled = true;
    schedule();
  }
  const handlers = [
    ["pointerdown", input], ["keydown", input],
    ["ZenSafeCloseConfigChanged", changed],
    ["SSWindowStateBusy", () => { busy = true; }],
    ["SSWindowStateReady", () => { busy = false; schedule(); }]
  ];
  for (const [type, fn] of handlers) win.addEventListener(type, fn, true);
  const originalUninstall = api.uninstall;
  function destroy() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) win.clearTimeout(timer);
    for (const [type, fn] of handlers) win.removeEventListener(type, fn, true);
    win.removeEventListener("unload", destroy);
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseStartupFolderRule?.destroy === destroy) delete win.__zenSafeCloseStartupFolderRule;
  }
  function combinedUninstall() { destroy(); return originalUninstall.call(api); }
  api.uninstall = combinedUninstall;
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(combinedUninstall);
  win.addEventListener("unload", destroy, { once: true });
  win.__zenSafeCloseStartupFolderRule = { destroy,
    get status() { return { ready, handled: state.handled, collapsed: state.collapsed }; } };
  try {
    const ss = win.SessionStore || ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore;
    Promise.resolve(ss.promiseAllWindowsRestored || ss.promiseInitialized).then(() => {
      if (stopped) return;
      ready = true; schedule();
    }).catch(error => Components.utils.reportError("[ZenArcMod startup folders] " + error));
  } catch (error) { Components.utils.reportError("[ZenArcMod startup folders] " + error); }
})();

(() => {
  "use strict";
  const win = window, api = win.__zenSafeClose;
  if (!api || !win.gBrowser) return;
  win.__zenSafeCloseGestures?.destroy();
  win.__zenSafeCloseSystemGestures?.destroy();

  const settings = () => api.config;
  const browser = () => win.gBrowser.selectedBrowser;
  const now = () => win.performance.now();
  let state = null, stopped = false, suppressUntil = 0, lastError = "";
  const jobs = new Set();
  const enabled = () => !stopped && win.__zenSafeClose === api &&
    api.status?.enabled !== false && api.status?.installed !== false &&
    settings().enabled && settings().gestures && settings().gesturesValid &&
    !!(settings().newGesture || settings().closeGesture);
  function report(error) {
    lastError = String(error);
    Components.utils.reportError("[ZenArcMod gestures] " + lastError);
  }

  // Shared across browser windows. On macOS/Linux a context menu on mouse-down
  // captures the mouse before a gesture can start. Defer it until mouse-up,
  // preserving the user's pref and restoring it after the last owner unloads.
  const menuPref = "ui.context_menus.after_mouseup";
  const sharedHost = api.sharedHost;
  const sharedKey = "__zenSafeCloseGestureMenu";
  let menuOwner = null;
  function syncMenuPref() {
    if (enabled() && !menuOwner) {
      try {
        if (!sharedHost[sharedKey]) {
          const prefs = Services.prefs;
          const saved = { hadUser: prefs.prefHasUserValue(menuPref),
            value: prefs.getBoolPref(menuPref, false), owners: new Set() };
          if (!saved.value) prefs.setBoolPref(menuPref, true);
          sharedHost[sharedKey] = saved;
        }
        menuOwner = sharedHost[sharedKey];
        menuOwner.owners.add(win);
      } catch (error) { report(error); }
    } else if (!enabled() && menuOwner) {
      menuOwner.owners.delete(win);
      if (!menuOwner.owners.size) {
        try {
          // Preserve any newer user/external change instead of overwriting it.
          if (Services.prefs.getBoolPref(menuPref, false) && !menuOwner.value) {
            if (menuOwner.hadUser) Services.prefs.setBoolPref(menuPref, menuOwner.value);
            else Services.prefs.clearUserPref(menuPref);
          }
        } catch (error) { report(error); }
        delete sharedHost[sharedKey];
      }
      menuOwner = null;
    }
  }

  // The overlay belongs to browser chrome: page CSS, zoom, iframes and CSP
  // cannot restyle it. Screen coordinates are converted to window CSS pixels;
  // backing pixels are scaled separately for Retina/mixed-DPI displays.
  let canvas = null, ctx = null, frame = null, previous = null, distance = 0;
  let bounds = null, queued = [];
  function clearTrail() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    canvas?.remove();
    canvas = ctx = previous = bounds = null;
    queued = [];
    distance = 0;
  }
  function point(event) { return { x: event.screenX, y: event.screenY }; }
  function drawTrail() {
    frame = null;
    if (!ctx) return;
    for (const p of queued) {
      const next = { x: p.x - win.mozInnerScreenX - bounds.left,
        y: p.y - win.mozInnerScreenY - bounds.top };
      if (previous) {
        const dx = next.x - previous.x, dy = next.y - previous.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.5) continue;
        const max = settings().trailWidth;
        const radius = d => Math.min(max, 0.8 + d / 45) / 2;
        const r0 = radius(distance), r1 = radius(distance + length);
        const nx = -dy / length, ny = dx / length;
        distance += length;
        // A filled ribbon with round joins; width depends on travelled length,
        // not event frequency or mouse speed. No Gesturefy source is embedded.
        ctx.beginPath();
        ctx.moveTo(previous.x + nx * r0, previous.y + ny * r0);
        ctx.lineTo(next.x + nx * r1, next.y + ny * r1);
        ctx.lineTo(next.x - nx * r1, next.y - ny * r1);
        ctx.lineTo(previous.x - nx * r0, previous.y - ny * r0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(next.x, next.y, r1, 0, Math.PI * 2);
        ctx.fill();
      }
      previous = next;
    }
    queued = [];
  }
  function trail(event) {
    if (!settings().trail) return;
    try {
      if (!canvas) {
        bounds = win.gBrowser.tabpanels.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return;
        canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.id = "zen-safe-close-gesture-trail";
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.cssText = `position:fixed !important; pointer-events:none !important;
          left:${bounds.left}px !important; top:${bounds.top}px !important;
          width:${bounds.width}px !important; height:${bounds.height}px !important;
          margin:0 !important; padding:0 !important; border:0 !important;
          z-index:2147483647 !important; opacity:0.92 !important;`;
        const ratio = win.devicePixelRatio || 1;
        canvas.width = Math.ceil(bounds.width * ratio);
        canvas.height = Math.ceil(bounds.height * ratio);
        ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable");
        ctx.scale(ratio, ratio);
        ctx.fillStyle = settings().trailColor;
        document.documentElement.appendChild(canvas);
        queued.push(state.start);
      }
      // Bound work per frame without accumulating a whole gesture history.
      if (queued.length >= 128) queued[queued.length - 1] = point(event);
      else queued.push(point(event));
      if (frame === null) frame = win.requestAnimationFrame(drawTrail);
    } catch (error) { clearTrail(); report(error); }
  }

  function insideContent(event) {
    const gb = win.gBrowser, path = event.composedPath?.() || [];
    return path.includes(browser()) || (gb.tabpanels && path.includes(gb.tabpanels)) ||
      !!gb.tabpanels?.contains?.(event.target);
  }
  function sameSource(s) {
    return enabled() && !win.closed && s.tab.isConnected && !s.tab.closing &&
      win.gBrowser.selectedTab === s.tab && s.tab.linkedBrowser === s.browser &&
      s.browser.currentURI?.spec === s.url;
  }
  function hideContextMenu() {
    const popup = document.getElementById("contentAreaContextMenu");
    if (popup?.state === "open" || popup?.state === "showing") popup.hidePopup();
  }
  function cancel() {
    if (state?.gesturing) suppressUntil = now() + settings().menuDelay;
    state = null;
    clearTrail();
    for (const id of jobs) win.clearTimeout(id);
    jobs.clear();
  }
  function down(event) {
    if (!event.isTrusted) return;
    cancel();
    syncMenuPref();
    if (event.button !== 2) return;
    suppressUntil = 0;
    if (!event.isTrusted || !enabled() || event.buttons !== 2 ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !insideContent(event)) return;
    const tab = win.gBrowser.selectedTab;
    state = { tab, browser: browser(), url: browser().currentURI.spec,
      start: point(event), x: event.screenX, y: event.screenY, chain: "", gesturing: false };
  }
  function move(event) {
    const s = state;
    if (!s || !event.isTrusted) return;
    if (!sameSource(s) || event.buttons !== 2 || event.ctrlKey ||
        event.altKey || event.metaKey || event.shiftKey) { cancel(); return; }
    const dx = event.screenX - s.x, dy = event.screenY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= settings().gestureDistance) {
      const direction = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
      s.x = event.screenX;
      s.y = event.screenY;
      if (!s.chain.endsWith(direction)) s.chain += direction;
      if (s.chain.length > 12) s.chain = "INVALID";
      // All drags beyond the threshold are gestures. Invalid strokes never
      // fall back to a shorter valid prefix or open a stray context menu.
      s.gesturing = true;
    }
    if (s.gesturing) { hideContextMenu(); trail(event); }
  }
  function execute(action, s) {
    if (!sameSource(s)) return;
    try {
      if (action === "new") {
        const command = document.getElementById("cmd_newNavigatorTab");
        if (typeof command?.doCommand === "function") command.doCommand();
        else if (typeof win.BrowserCommands?.openTab === "function") win.BrowserCommands.openTab();
        else throw new Error("Native new-tab command unavailable");
      } else {
        if (s.tab === win.gZenWorkspaces?._emptyTab) return;
        if (s.tab.pinned && settings().protectPinned) api.closePinned([s.tab]);
        else win.gBrowser.removeTab(s.tab, { animate: true });
      }
    } catch (error) { report(error); }
  }
  function up(event) {
    if (event.button !== 2 || !event.isTrusted || !state) return;
    move({ isTrusted: true, buttons: 2, screenX: event.screenX, screenY: event.screenY,
      ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
    const s = state;
    state = null;
    clearTrail();
    if (!s || !sameSource(s)) return;
    if (s.gesturing) {
      suppressUntil = now() + settings().menuDelay;
      event.preventDefault(); event.stopImmediatePropagation(); hideContextMenu();
    }
    const action = settings().newGesture && s.chain === settings().newGesture ? "new" :
      settings().closeGesture && s.chain === settings().closeGesture ? "close" : null;
    if (!action) return;
    const id = win.setTimeout(() => { jobs.delete(id); execute(action, s); }, 0);
    jobs.add(id);
  }
  function context(event) {
    if (!event.isTrusted || event.button !== 2 || !enabled() || !insideContent(event)) return;
    if (state?.gesturing || now() < suppressUntil) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
  function key(event) { if (event.key === "Escape") cancel(); }
  function blur(event) { if (event.target === win) cancel(); }
  function changed() { cancel(); syncMenuPref(); }
  const handlers = [
    ["ZenSafeCloseConfigChanged", changed],
    ["mousedown", down], ["mousemove", move], ["mouseup", up],
    ["contextmenu", context], ["keydown", key], ["blur", blur],
    ["TabSelect", cancel], ["resize", cancel], ["sizemodechange", cancel]
  ];
  for (const [name, handler] of handlers) win.addEventListener(name, handler, true);
  // Leaving the window cancels even if mouse-up subsequently happens in another app.
  function leave(event) { if (!event.relatedTarget) cancel(); }
  document.documentElement.addEventListener("mouseleave", leave, true);

  const originalUninstall = api.uninstall;
  function destroy() {
    if (stopped) return;
    stopped = true;
    cancel();
    syncMenuPref();
    for (const [name, handler] of handlers) win.removeEventListener(name, handler, true);
    document.documentElement.removeEventListener("mouseleave", leave, true);
    win.removeEventListener("unload", destroy);
    if (api.uninstall === combinedUninstall) api.uninstall = originalUninstall;
    if (win.__zenSafeCloseGestures?.destroy === destroy) delete win.__zenSafeCloseGestures;
    if (win.__zenSafeCloseSystemGestures?.destroy === destroy) delete win.__zenSafeCloseSystemGestures;
  }
  function combinedUninstall() { destroy(); return originalUninstall.call(api); }
  api.uninstall = combinedUninstall;
  if (typeof win.addUnloadListener === "function") win.addUnloadListener(combinedUninstall);
  win.addEventListener("unload", destroy, { once: true });
  const gestureAPI = { destroy,
    get status() { return { enabled: enabled(), scope: "all-tab-content",
      gesture: state?.chain || "", threshold: settings().gestureDistance, lastError }; }
  };
  win.__zenSafeCloseGestures = gestureAPI;
  // Keep the old diagnostic entry point working for existing installations.
  win.__zenSafeCloseSystemGestures = gestureAPI;
  syncMenuPref();
})();
