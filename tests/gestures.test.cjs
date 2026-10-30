const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../zen-safe-close.uc.js'), 'utf8');
const gestures = source.slice(source.lastIndexOf('\n(() => {'));

function shared(userValue) {
  const values = new Map(userValue === undefined ? [] : [['ui.context_menus.after_mouseup', userValue]]);
  return { sharedHost: {}, appShell: { get hiddenDOMWindow() { throw Error('NS_ERROR_FAILURE'); } }, prefs: {
    values, prefHasUserValue: name => values.has(name),
    getBoolPref: (name, fallback) => values.get(name) ?? fallback,
    setBoolPref: (name, value) => values.set(name, value),
    clearUserPref: name => values.delete(name)
  } };
}
function setup({ url = 'https://example.org/', pinned = false, empty = false,
  services = shared(), config = {}, canvasFactory } = {}) {
  const listeners = new Map(), timers = new Map(), frames = new Map(), nodes = [];
  const commands = [], errors = [], radii = [];
  let id = 0, clock = 100;
  const c = { enabled: true, gestures: true, gesturesValid: true, newGesture: 'D',
    closeGesture: 'DR', gestureDistance: 24, menuDelay: 500, protectPinned: true,
    trail: true, trailColor: '#168f85', trailWidth: 12, ...config };
  const browser = { currentURI: { spec: url } };
  const tab = { pinned, isConnected: true, linkedBrowser: browser };
  const rootListeners = new Map();
  const root = {
    appendChild(node) { nodes.push(node); node.isConnected = true; },
    addEventListener: (type, fn) => rootListeners.set(type, fn),
    removeEventListener: type => rootListeners.delete(type)
  };
  const panel = { contains: target => target === browser,
    getBoundingClientRect: () => ({ left: 30, top: 80, width: 900, height: 600 }) };
  const popup = { state: 'closed', hidePopup() { popup.state = 'closed'; } };
  const api = { sharedHost: services.sharedHost, config: c, status: { enabled: true, installed: true },
    closePinned: tabs => commands.push(['unload', ...tabs]), uninstall() {} };
  const win = {
    __zenSafeClose: api, closed: false, devicePixelRatio: 2,
    mozInnerScreenX: 200, mozInnerScreenY: 100,
    performance: { now: () => clock },
    gBrowser: { selectedTab: tab, selectedBrowser: browser, tabpanels: panel,
      removeTab: t => commands.push(['close', t]) },
    gZenWorkspaces: { _emptyTab: empty ? tab : {} },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(fn) { const i = ++id; timers.set(i, fn); return i; },
    clearTimeout(i) { timers.delete(i); },
    requestAnimationFrame(fn) { const i = ++id; frames.set(i, fn); return i; },
    cancelAnimationFrame(i) { frames.delete(i); }
  };
  const document = { documentElement: root,
    getElementById: name => name === 'cmd_newNavigatorTab'
      ? { doCommand: () => commands.push(['new']) } : popup,
    createElementNS() {
      const ctx = { scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
        arc(x, y, r) { radii.push(r); } };
      const node = canvasFactory ? canvasFactory() : { getContext: () => ctx };
      node.style = {}; node.setAttribute = () => {};
      node.remove = () => { node.isConnected = false; };
      return node;
    }
  };
  vm.runInNewContext(gestures, { window: win, document, Services: services,
    Components: { utils: { reportError: e => errors.push(String(e)) } } });
  function fire(type, props = {}) {
    const e = { isTrusted: true, button: 2, buttons: 2, screenX: 330, screenY: 300,
      target: browser, composedPath: () => [browser, panel],
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...props };
    listeners.get(type)?.(e);
    return e;
  }
  function flushFrames() { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); }
  function flushJobs() { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); }
  function stroke(chain = 'DR') {
    let x = 330, y = 300;
    fire('mousedown', { screenX: x, screenY: y });
    for (const direction of chain) {
      x += direction === 'R' ? 100 : direction === 'L' ? -100 : 0;
      y += direction === 'D' ? 100 : direction === 'U' ? -100 : 0;
      fire('mousemove', { screenX: x, screenY: y }); flushFrames();
    }
    const e = fire('mouseup', { buttons: 0, screenX: x, screenY: y });
    flushJobs(); return e;
  }
  return { c, win, tab, api, browser, services, commands, errors, nodes, radii, popup,
    fire, stroke, flushJobs, flushFrames, listeners, rootListeners, timers, frames,
    liveNodes: () => nodes.filter(n => n.isConnected),
    tick: ms => { clock += ms; } };
}
module.exports = { setup, shared };

for (const url of ['https://example.org/', 'about:preferences', 'about:config',
  'about:addons', 'about:blank', 'file:///tmp/test.html', 'moz-extension://test/options.html',
  'https://addons.mozilla.org/', 'https://example.org/document.pdf']) {
  test(`new and close gestures on ${url}`, () => {
    const h = setup({ url });
    h.stroke('D'); h.stroke('DR');
    assert.deepEqual(h.commands.map(x => x[0]), ['new', 'close']);
    assert.equal(h.errors.length, 0);
  });
}
test('pinned close unloads, ordinary close removes, empty screen stays', () => {
  const pin = setup({ pinned: true }); pin.stroke(); assert.equal(pin.commands[0][0], 'unload');
  const empty = setup({ empty: true }); empty.stroke(); assert.deepEqual(empty.commands, []);
  const unprotected = setup({ pinned: true, config: { protectPinned: false } });
  unprotected.stroke(); assert.equal(unprotected.commands[0][0], 'close');
});
test('plain right click and jitter preserve the native menu; invalid stroke does nothing', () => {
  const h = setup();
  h.fire('mousedown'); h.fire('mousemove', { screenY: 308 });
  assert(!h.fire('mouseup', { buttons: 0, screenY: 308 }).prevented);
  assert(!h.fire('contextmenu').prevented);
  h.stroke('DL'); assert.deepEqual(h.commands, []);
  assert(h.fire('contextmenu').prevented);
  h.tick(501); assert(!h.fire('contextmenu').prevented);
  // A newer right click immediately re-enables its own native context menu.
  h.stroke(); h.fire('mousedown'); assert(!h.fire('contextmenu').prevented);
});
test('trail grows with distance, has a width cap, Retina backing, and no hit testing', () => {
  const h = setup(); h.fire('mousedown');
  for (let i = 1; i <= 20; i++) {
    h.fire('mousemove', { screenY: 300 + i * 40 }); h.flushFrames();
  }
  assert(h.radii[0] < h.radii[5]);
  assert(h.radii.every(r => r <= 6));
  assert.equal(h.nodes[0].width, 1800);
  assert.match(h.nodes[0].style.cssText, /pointer-events:none/);
  h.fire('mouseup', { screenY: 1100 }); assert.equal(h.liveNodes().length, 0);
});
test('trail failure and disabled trail never prevent the command', () => {
  const off = setup({ config: { trail: false } }); off.stroke();
  assert.equal(off.commands[0][0], 'close'); assert.equal(off.nodes.length, 0);
  const fail = setup({ canvasFactory: () => ({ getContext: () => null }) }); fail.stroke();
  assert.equal(fail.commands[0][0], 'close'); assert(fail.errors.length > 0);
});
test('Escape, tab switch, blur, resize, leaving the window and lost buttons cancel', () => {
  for (const action of [
    h => h.fire('keydown', { key: 'Escape' }),
    h => h.fire('TabSelect'), h => h.fire('blur', { target: h.win }),
    h => h.fire('resize'), h => h.rootListeners.get('mouseleave')({ relatedTarget: null }),
    h => h.fire('mousemove', { buttons: 0 })
  ]) {
    const h = setup(); h.fire('mousedown'); h.fire('mousemove', { screenY: 400 });
    h.flushFrames(); assert.equal(h.liveNodes().length, 1); action(h);
    h.fire('mouseup', { screenY: 400 }); h.flushJobs();
    assert.deepEqual(h.commands, []); assert.equal(h.liveNodes().length, 0);
  }
});
test('navigation and newer selection invalidate queued commands', () => {
  const h = setup(); h.fire('mousedown'); h.fire('mousemove', { screenY: 400 });
  h.fire('mouseup', { screenY: 400 });
  h.browser.currentURI.spec = 'https://different.org/'; h.flushJobs();
  assert.deepEqual(h.commands, []);
});
test('untrusted, modified, multi-button and toolbar input cannot execute commands', () => {
  for (const props of [{ isTrusted: false }, { ctrlKey: true }, { metaKey: true },
    { altKey: true }, { shiftKey: true }, { buttons: 3 }, { composedPath: () => [], target: {} }]) {
    const h = setup(); h.fire('mousedown', props);
    h.fire('mousemove', { screenY: 400 }); h.fire('mouseup', { screenY: 400 }); h.flushJobs();
    assert.deepEqual(h.commands, []);
  }
});
test('disabling or invalid settings remove trail and do not consume gestures', () => {
  for (const values of [{ gestures: false }, { gesturesValid: false }, { enabled: false }]) {
    const h = setup(); h.fire('mousedown'); h.fire('mousemove', { screenY: 400 });
    Object.assign(h.c, values); h.fire('ZenSafeCloseConfigChanged'); h.stroke();
    assert.deepEqual(h.commands, []); assert.equal(h.liveNodes().length, 0);
    assert(!h.fire('contextmenu').prevented);
  }
});
test('menu preference is shared and restored after the final window releases it', () => {
  for (const original of [undefined, false, true]) {
    const services = shared(original), a = setup({ services }), b = setup({ services });
    assert.equal(services.prefs.getBoolPref('ui.context_menus.after_mouseup'), true);
    a.api.uninstall(); assert.equal(services.prefs.getBoolPref('ui.context_menus.after_mouseup'), true);
    b.api.uninstall(); assert.equal(services.prefs.values.get('ui.context_menus.after_mouseup'), original);
  }
});
test('uninstall cancels pending work, removes canvas/listeners and preserves newer pref changes', () => {
  const h = setup(); h.fire('mousedown'); h.fire('mousemove', { screenY: 400 });
  h.services.prefs.setBoolPref('ui.context_menus.after_mouseup', false);
  h.api.uninstall();
  assert.equal(h.services.prefs.getBoolPref('ui.context_menus.after_mouseup'), false);
  assert.equal(h.listeners.size, 0); assert.equal(h.rootListeners.size, 0);
  assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.liveNodes().length, 0);
  assert.equal(h.win.__zenSafeCloseGestures, undefined);
});

test('Windows hiddenDOMWindow is never needed to start or execute gestures', () => {
  const services = shared();
  assert.throws(() => services.appShell.hiddenDOMWindow, /NS_ERROR_FAILURE/);
  const h = setup({ services }); h.stroke('D'); h.stroke('DR');
  assert.deepEqual(h.commands.map(x => x[0]), ['new', 'close']);
  assert.equal(h.errors.length, 0);
});
