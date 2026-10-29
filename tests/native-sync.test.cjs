const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Execute the shipped close protection and sync adapter together. Native sync
// is simulated; these tests do not run Gecko or a real Firefox Sync account.
const source = fs.readFileSync(process.env.ZSC_SOURCE ||
  path.join(__dirname, "../zen-safe-close.uc.js"), "utf8");
const core = source.slice(0, source.indexOf("\n})();") + 6);
const start = source.lastIndexOf("(() => {", source.indexOf('const SYNC ='));
const adapter = source.slice(start, source.indexOf("\n(() => {", start + 1));

function environment() {
  const host = {}, windows = [], errors = [];
  const cloud = { applyBatch(records) { return this.run(records); }, run() {} };
  const local = { on_TabClose(event) {
    assert.equal(this, local);
    for (const win of windows) {
      if (win === event.target.ownerDocument.defaultView) continue;
      const target = win.gBrowser.tabs.find(tab => tab.id === event.target.id);
      if (target) win.gBrowser.removeTab(target, { animate: true });
    }
    return "native-result";
  } };
  const modules = { ZenWindowSync: local, ZenSpacesSyncApplier: cloud };
  function open({ sync = true, missing = "" } = {}) {
    const listeners = new Map(), defaults = {}, removed = [];
    const prefs = { "zen-safe-close.emptyScreen": false };
    const window = {
      location: { href: "chrome://browser/content/browser.xhtml" },
      gBrowserInit: { delayedStartupFinished: true },
      gZenPinnedTabManager: { onCloseTabShortcut() { throw Error("Unexpected native close shortcut"); } },
      gZenWorkspaces: {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
      CustomEvent: class { constructor(type) { this.type = type; } }
    };
    const browser = window.gBrowser = {
      tabs: [],
      removeTab(tab, ...args) {
        assert.equal(this, browser);
        removed.push({ tab, args });
        tab.isConnected = false;
        return "removed";
      },
      removeTabs(tabs, ...args) {
        for (const tab of tabs) this.removeTab(tab, ...args);
        return "bulk-removed";
      }
    };
    function tab(id, pinned = true) {
      const result = { id, pinned, isConnected: true,
        ownerDocument: { defaultView: window }, hasAttribute: name => name === "pending" };
      browser.tabs.push(result);
      return result;
    }
    browser.selectedTab = tab("selected-ordinary", false);
    const context = vm.createContext({ window,
      Services: { appShell: { hiddenDOMWindow: host },
        obs: { addObserver() {}, removeObserver() {} },
        prefs: { getDefaultBranch: () => ({
          setBoolPref: (key, value) => defaults[key] = value,
          setStringPref: (key, value) => defaults[key] = value }),
          getBoolPref: (key, fallback) => prefs[key] ?? defaults[key] ?? fallback,
          getStringPref: (key, fallback) => prefs[key] ?? defaults[key] ?? fallback,
          addObserver() {}, removeObserver() {} } },
      ChromeUtils: { importESModule(uri) {
        const key = uri.match(/\/([^/]+)\.sys\.mjs$/)[1];
        if (key === missing) throw Error("Module absent");
        assert(key in modules);
        return { [key]: modules[key] };
      } },
      Components: { utils: { reportError: error => errors.push(error) } }
    });
    vm.runInContext(core, context);
    assert.equal(window.__zenSafeClose.status.installed, true);
    if (sync) vm.runInContext(adapter, context);
    windows.push(window);
    return { window, tab, removed, api: window.__zenSafeClose,
      adapter: () => window.__zenSafeCloseNativeSync,
      installSync: () => vm.runInContext(adapter, context) };
  }
  return { open, cloud, local, host, errors };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test("regression: old broad protection blocks native tombstones, adapter permits them", async () => {
  const e = environment(), h = e.open({ sync: false }), target = h.tab("native-tab-id");
  e.cloud.run = () => h.window.gBrowser.removeTab(target, { animate: true });
  e.cloud.applyBatch([{ id: target.id, deleted: true }]);
  assert.equal(h.removed.length, 0);
  h.installSync();
  assert.equal(e.cloud.applyBatch([{ id: target.id, deleted: true }]), "removed");
  assert.equal(h.removed[0].tab, target);
  assert.equal(h.removed[0].args[0].animate, true);
  assert.equal(h.adapter().status.activeRemovals, 0);
});

test("Unpin cleanup can remove the matching still-pinned copy in another window", () => {
  const e = environment(), a = e.open(), b = e.open();
  const original = a.tab("shared-tab-id", false), copy = b.tab(original.id);
  assert.equal(e.local.on_TabClose({ target: original }), "native-result");
  assert.equal(a.removed.length, 0);
  assert.equal(b.removed[0].tab, copy);
  assert.equal(a.adapter().status.activeRemovals, 0);
});

test("pending cloud delete authorizes only tombstones, not other pins or live records", async () => {
  const e = environment(), h = e.open(), wait = deferred();
  const gone = h.tab("gone"), keep = h.tab("keep"), live = h.tab("live");
  e.cloud.run = () => wait.promise;
  const result = e.cloud.applyBatch([{ id: gone.id, deleted: true },
    { id: live.id, cleartext: { data: { pinned: false } } }]);
  h.window.gBrowser.removeTab(keep);
  h.window.gBrowser.removeTab(live);
  assert.equal(h.removed.length, 0);
  h.window.gBrowser.removeTab(gone);
  assert.equal(h.removed[0].tab, gone);
  wait.resolve("complete");
  assert.equal(await result, "complete");
  assert.equal(h.adapter().status.activeRemovals, 0);
  assert(!h.adapter().allows(gone));
});

test("mixed bulk removal leaves unrelated pinned tabs protected", () => {
  const e = environment(), h = e.open();
  const gone = h.tab("gone"), keep = h.tab("keep"), normal = h.tab("normal", false);
  e.cloud.run = () => h.window.gBrowser.removeTabs([gone, keep, normal], { animate: true });
  e.cloud.applyBatch([{ id: gone.id, deleted: true }]);
  assert.deepEqual(h.removed.map(item => item.tab.id), ["gone", "normal"]);
  assert(keep.isConnected);
});

test("ordinary closing remains protected outside sync", () => {
  const e = environment(), h = e.open(), pin = h.tab("pin");
  h.window.gBrowser.removeTab(pin);
  h.window.gBrowser.removeTabs([pin]);
  assert.equal(h.removed.length, 0);
  assert(pin.pinned);
});

test("explicit close shortcut and command remain protected during same-ID cloud deletion", async () => {
  const e = environment(), h = e.open(), wait = deferred(), pin = h.tab("pin");
  e.cloud.run = () => wait.promise;
  const result = e.cloud.applyBatch([{ id: pin.id, deleted: true }]);
  const event = { target: { id: "cmd_close" }, preventDefault() {}, stopImmediatePropagation() {} };
  h.window.gZenPinnedTabManager.onCloseTabShortcut(event, pin);
  h.window.gBrowser.selectedTab = pin;
  // Provide a loaded ordinary landing tab, avoiding the native empty-screen mock.
  const landing = h.tab("landing", false);
  landing.hasAttribute = () => false;
  h.window.dispatchEvent({ ...event, type: "command" });
  assert.equal(h.removed.length, 0);
  wait.resolve(); await result;
});

test("sync throws and rejected promises release authorization and preserve the error", async () => {
  const e = environment(), h = e.open(), pin = h.tab("pin"), error = Error("native failure");
  e.cloud.run = () => { throw error; };
  assert.throws(() => e.cloud.applyBatch([{ id: pin.id, deleted: true }]), value => value === error);
  assert.equal(h.adapter().status.activeRemovals, 0);
  e.cloud.run = () => Promise.reject(error);
  await assert.rejects(e.cloud.applyBatch([{ id: pin.id, deleted: true }]), value => value === error);
  assert.equal(h.adapter().status.activeRemovals, 0);
  h.window.gBrowser.removeTab(pin);
  assert.equal(h.removed.length, 0);
});

test("overlapping batches use reference counts, including duplicate records", async () => {
  const e = environment(), h = e.open(), a = deferred(), b = deferred(), pin = h.tab("pin");
  e.cloud.run = () => a.promise;
  const first = e.cloud.applyBatch([{ id: pin.id, deleted: true }, { id: pin.id, deleted: true }]);
  e.cloud.run = () => b.promise;
  const second = e.cloud.applyBatch([{ id: pin.id, deleted: true }]);
  a.resolve(); await first;
  assert(h.adapter().allows(pin));
  b.resolve(); await second;
  assert(!h.adapter().allows(pin));
});

test("hooks are shared, survive one window closing, and restore after the final unload", () => {
  const e = environment(), native = e.local.on_TabClose;
  const a = e.open(), wrapped = e.local.on_TabClose, b = e.open();
  assert.equal(e.local.on_TabClose, wrapped);
  a.api.uninstall();
  assert.equal(e.local.on_TabClose, wrapped);
  assert.equal(b.adapter().status.hooks.length, 2);
  b.api.uninstall();
  assert.equal(e.local.on_TabClose, native);
  assert(!e.host.__zenSafeCloseNativeSyncOwners);
});

test("missing cloud module keeps local sync and close protection usable", () => {
  const e = environment(), h = e.open({ missing: "ZenSpacesSyncApplier" });
  assert.deepEqual(Array.from(h.adapter().status.hooks), ["on_TabClose"]);
  assert.equal(h.adapter().status.errors.length, 1);
  h.window.gBrowser.removeTab(h.tab("pin"));
  assert.equal(h.removed.length, 0);
});

test("hot reload preserves an in-flight tombstone without authorizing unrelated pins", async () => {
  const e = environment(), h = e.open(), pin = h.tab("pin"), wait = deferred();
  e.cloud.run = () => wait.promise;
  const result = e.cloud.applyBatch([{ id: pin.id, deleted: true }]);
  h.adapter().destroy(); h.installSync();
  assert(h.adapter().allows(pin));
  assert(!h.adapter().allows(h.tab("unrelated")));
  h.window.gBrowser.removeTab(pin);
  assert.equal(h.removed[0].tab, pin);
  wait.resolve(); await result;
  assert.equal(h.adapter().status.activeRemovals, 0);
});
