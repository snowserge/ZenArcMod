const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Run the shipped visuals code, with only browser plumbing replaced.
const source = fs.readFileSync(process.env.ZSC_SOURCE ||
  path.join(__dirname, "../zen-safe-close.uc.js"), "utf8");
const visuals = source.slice(source.indexOf('(() => {', source.indexOf('})();') + 5),
  source.indexOf('\n(() => {', source.indexOf('const ATTR =')));

function setup(overrides = {}) {
  const config = {
    enabled: true, visuals: true, density: "roomy", hideClose: true,
    hideUnload: false, effect: "sepia", strength: 1, saturation: 0.6,
    opacity: 0.7, visualScope: "pinned", inactive: "unloaded",
    includeFolders: true, ...overrides
  };
  const listeners = new Map();
  const styles = [];
  const tabs = [];
  function tab({ pinned = true, pending = true, folder = false, empty = false } = {}) {
    const attrs = new Set([...(pending ? ["pending"] : []),
      ...(empty ? ["zen-empty-tab"] : [])]);
    const result = {
      pinned, attrs, group: null,
      closest: () => folder ? {} : null,
      hasAttribute: name => attrs.has(name),
      toggleAttribute: (name, value) => value ? attrs.add(name) : attrs.delete(name),
      removeAttribute: name => attrs.delete(name)
    };
    tabs.push(result);
    return result;
  }
  const selected = tab({ pending: false, folder: true });
  const unloaded = tab({ folder: true });
  const ordinary = tab({ pinned: false });
  const empty = tab({ empty: true });
  let removed = false, disconnected = false, uninstalled = false;
  const window = {
    __zenSafeClose: { config, uninstall() { uninstalled = true; } },
    gBrowser: { tabs, selectedTab: selected },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}
  };
  const document = {
    createElementNS: () => ({ textContent: "", remove() { removed = true; } }),
    documentElement: { appendChild: style => styles.push(style) }
  };
  class MutationObserver {
    observe() {}
    disconnect() { disconnected = true; }
  }
  vm.runInNewContext(visuals, { window, document, MutationObserver });
  return {
    config, selected, unloaded, ordinary, empty, window,
    css: () => styles[0].textContent,
    change(values) { Object.assign(config, values); listeners.get("ZenSafeCloseConfigChanged")(); },
    cleanup: () => ({ removed, disconnected, uninstalled, listeners: listeners.size })
  };
}

// Inspect the generated declarations, not a second copy of the stylesheet.
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

for (const density of ["roomy", "cosy", "compact"]) {
  for (const inactive of ["unloaded", "unselected"]) {
    test(`native folder animation retains row opacity/height: ${density}, ${inactive}`, () => {
      const h = setup({ density, inactive });
      assert(h.unloaded.attrs.has("data-zsc-unloaded"));
      assert(!h.selected.attrs.has("data-zsc-unloaded"));
      const generated = rules(h.css());
      const appearance = generated.filter(r => /(?:^|;)\s*(?:opacity|filter)\s*:/.test(r.body));
      assert.equal(appearance.length, 1);
      assert.match(appearance[0].selector, />\s*\.tab-stack$/);
      // Zen animates the outer row and persists normal inline styles there.
      // Neither visual opacity nor a positive min-height may override those.
      for (const rule of generated.filter(r => !r.selector.includes(" > "))) {
        assert.doesNotMatch(rule.body, /(?:^|;)\s*(?:opacity|filter|height|min-height)\s*:/);
      }
      if (density === "roomy") assert.doesNotMatch(h.css(), /--tab-min-height/);
      else assert.match(h.css(), new RegExp("--tab-min-height: " + (density === "cosy" ? 32 : 28) + "px"));
    });
  }
}

test("compact and cosy do not clamp collapsed rows even with visuals disabled", () => {
  for (const density of ["compact", "cosy"]) {
    const h = setup({ density, visuals: false });
    const outer = rules(h.css()).filter(r => !r.selector.includes(" > "));
    assert(outer.length > 0);
    for (const rule of outer) {
      assert.doesNotMatch(rule.body, /(?:^|;)\s*min-height\s*:/);
    }
  }
});

test("folder and scope settings still control appearance", () => {
  const h = setup();
  assert(!h.ordinary.attrs.has("data-zsc-unloaded"));
  assert(!h.empty.attrs.has("data-zsc-unloaded"));
  h.change({ includeFolders: false, visualScope: "all" });
  assert(!h.unloaded.attrs.has("data-zsc-unloaded"));
  assert(h.ordinary.attrs.has("data-zsc-unloaded"));
  h.change({ includeFolders: true, effect: "grayscale", opacity: 0.4 });
  assert(h.unloaded.attrs.has("data-zsc-unloaded"));
  assert.match(h.css(), /grayscale\(1\)/);
  assert.match(h.css(), /opacity: 0.4/);
});

test("disabling visuals or the mod clears appearance, uninstall removes resources", () => {
  const h = setup({ density: "compact" });
  h.change({ visuals: false });
  assert(!h.unloaded.attrs.has("data-zsc-unloaded"));
  assert.doesNotMatch(h.css(), /filter:/);
  h.change({ enabled: false });
  assert.equal(h.css(), "");
  h.window.__zenSafeClose.uninstall();
  assert.deepEqual(h.cleanup(), {
    removed: true, disconnected: true, uninstalled: true, listeners: 0
  });
});
