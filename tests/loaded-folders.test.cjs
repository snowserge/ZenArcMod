const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../zen-safe-close.uc.js'), 'utf8');
const start = source.lastIndexOf('(() => {', source.indexOf('const FLAG = "data-zsc-loaded-folders"'));
const code = source.slice(start, source.indexOf('\n(() => {', start + 1));
const HIDE = 'data-zsc-folder-hidden';
function node(localName) {
  const attrs = new Set(), props = new Map();
  return { localName, attrs, isConnected: true, group: null,
    style: { setProperty: (k,v) => props.set(k,v), removeProperty: k => props.delete(k), props },
    setAttribute: name => attrs.add(name), removeAttribute: name => attrs.delete(name),
    hasAttribute: name => attrs.has(name),
    toggleAttribute(name, value) { if (value) attrs.add(name); else attrs.delete(name); },
    getAnimations: () => [], closest: () => null,
    remove() { this.isConnected = false; } };
}
function setup(on = true, available = true) {
  const folders = [], listeners = new Map(), frames = new Map(), originals = {}, calls = [];
  let id = 0, observer, invalidations = 0;
  function folder(parent = null) {
    const f = node('zen-folder'); f.group = parent; f.collapsed = true; f.direct = [];
    f.groupContainer = node('div'); f.groupStartElement = node('div');
    f.labelElement = { parentElement: node('hbox') }; f._activeTabs = [];
    Object.defineProperty(f, 'tabs', { get() {
      return [...f.direct, ...folders.filter(x => x.group === f).flatMap(x => x.tabs)];
    } });
    Object.defineProperty(f, 'activeTabs', { get: () => f._activeTabs, set(value) {
      f._activeTabs = value;
      for (const t of value) t.setAttribute('folder-active','true');
    } });
    folders.push(f); return f;
  }
  function tab(f, pending = false, empty = false) {
    const t = node('tab'); t.group = f;
    t.toggleAttribute('pending',pending); t.toggleAttribute('zen-empty-tab',empty);
    f.direct.push(t);
    Object.defineProperty(t,'visible',{get() {
      for (let g=t.group;g;g=g.group) if (g.collapsed && !g.activeTabs.includes(t)) return false;
      return true;
    }});
    return t;
  }
  const manager = { updateFolderIcon(f) { f.iconActive = f.collapsed && f.hasAttribute('has-active'); } };
  for (const name of ['animateCollapse','animateExpand','animateSelect','animateUnload','animateUnloadAll']) {
    originals[name] = manager[name] = function(f, ...args) {
      calls.push({name,f,args});
      if (f.localName === 'zen-folder' && ['animateCollapse','animateExpand'].includes(name)) {
        f.activeTabs = f.collapsed ? f.tabs.filter(t => t.selected) : [];
        f.toggleAttribute('has-active', f.activeTabs.length > 0);
      }
      return Promise.resolve('native');
    };
  }
  const root = node('window'); root.appendChild = () => {};
  const api = { config: { enabled: true, showLoadedInFolders: on }, uninstall() {} };
  const window = { __zenSafeClose: api,
    gBrowser: { tabContainer: { querySelectorAll: () => folders,
      _invalidateCachedVisibleTabs() { invalidations++; } } },
    gZenFolders: available ? manager : undefined,
    addEventListener(type,fn) { listeners.set(type,fn); },
    removeEventListener(type) { listeners.delete(type); },
    requestAnimationFrame(fn) { const n=++id;frames.set(n,fn);return n; },
    cancelAnimationFrame(n) { frames.delete(n); } };
  const errors = [];
  class MutationObserver {
    constructor(callback) { this.callback=callback; observer=this; }
    observe() {} disconnect() { this.disconnected=true; }
  }
  vm.runInNewContext(code,{window,document:{documentElement:root,createElementNS:()=>node('style')},
    MutationObserver,Components:{utils:{reportError:e=>errors.push(e)}}});
  const refresh=()=>window.__zenSafeCloseLoadedFolders.refresh();
  function flush() {const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());}
  return { folder,tab,folders,api,manager,originals,calls,root,window,errors,frames,listeners,
    refresh,flush,get observer(){return observer;},
    change(value) {api.config.showLoadedInFolders=value;listeners.get('ZenSafeCloseConfigChanged')();} };
}

test('off by default delegates to native methods and leaves rows untouched',async()=>{
  const h=setup(false),f=h.folder(),t=h.tab(f);h.refresh();
  assert.equal(h.root.hasAttribute('data-zsc-loaded-folders'),false);
  assert.equal(await h.manager.animateCollapse(f,123),'native');
  assert.deepEqual(h.calls[0].args,[123]); assert(!t.hasAttribute(HIDE));
});
test('loaded tabs stay visible in all three collapsed folders irrespective of selection',()=>{
  const h=setup(),rows=[];
  for(let i=0;i<3;i++) {const f=h.folder(); const live=h.tab(f),sleep=h.tab(f,true); rows.push({f,live,sleep});}
  rows[0].live.selected=true;h.refresh();
  for(const {f,live,sleep} of rows) {
    assert(live.visible);assert(!live.hasAttribute(HIDE));assert(sleep.hasAttribute(HIDE));
    assert(f.iconActive);assert(f.collapsed);assert.equal(f.activeTabs.length,1);
  }
  rows[0].live.selected=false; rows[2].live.selected=true;
  h.refresh(); assert(rows.every(x=>x.live.visible));
});
test('nested loaded descendants stay visible through every collapsed ancestor',()=>{
  const h=setup(),parent=h.folder(),child=h.folder(parent),leaf=h.folder(child);
  const live=h.tab(leaf),sleep=h.tab(leaf,true),sibling=h.folder(parent);h.tab(sibling,true);
  h.refresh();assert(live.visible);assert(!live.hasAttribute(HIDE));assert(sleep.hasAttribute(HIDE));
  for(const f of [parent,child,leaf]) assert(f.activeTabs.includes(live));
  assert(sibling.hasAttribute(HIDE));
  child.collapsed=false;h.refresh();assert(live.visible);assert(sleep.hasAttribute(HIDE));
  parent.collapsed=false;h.refresh();assert(live.visible);assert(sleep.hasAttribute(HIDE));
  leaf.collapsed=false;h.refresh();assert(!sleep.hasAttribute(HIDE));
});
test('expanded folders show unloaded tabs; collapsing hides them without unloading live ones',async()=>{
  const h=setup(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);
  f.collapsed=false;h.refresh();assert(!sleep.hasAttribute(HIDE));
  f.collapsed=true;await h.manager.animateCollapse(f);assert(sleep.hasAttribute(HIDE));
  assert(!live.hasAttribute('pending'));assert(f.activeTabs.includes(live));
});
test('pending mutations hide discarded tabs and reveal restored tabs without reopening folders',()=>{
  const h=setup(),f=h.folder(),a=h.tab(f),b=h.tab(f);h.refresh();
  a.setAttribute('pending','true');h.observer.callback([{type:'attributes'}]);h.flush();
  assert(a.hasAttribute(HIDE));assert(!b.hasAttribute(HIDE));assert.equal(f.activeTabs.length,1);
  b.setAttribute('pending','true');h.refresh();assert(f.groupContainer.hasAttribute(HIDE));assert(!f.iconActive);
  a.removeAttribute('pending');h.refresh();assert(!f.groupContainer.hasAttribute(HIDE));assert(a.visible);
});
test('empty placeholders and closing tabs are never treated as loaded',()=>{
  const h=setup(),f=h.folder(),empty=h.tab(f,false,true),closing=h.tab(f);closing.closing=true;
  h.refresh();assert(empty.hasAttribute(HIDE));assert(closing.hasAttribute(HIDE));assert(!f.activeTabs.length);
});
test('selecting a loaded tab does not auto-expand a fully loaded folder',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();
  assert.equal(await h.manager.animateSelect(f),false);assert(f.collapsed);
  assert.equal(h.calls.length,0);
});
test('moving a hidden tab out of folders clears mode-owned visibility',()=>{
  const h=setup(),f=h.folder(),t=h.tab(f,true);h.refresh();assert(t.hasAttribute(HIDE));
  f.direct=[];t.group=null;h.refresh();assert(!t.hasAttribute(HIDE));assert(!t.hasAttribute('folder-active'));
});
test('turning off recomputes standard visibility and preserves collapsed/loading state',()=>{
  const h=setup(),f=h.folder(),a=h.tab(f),b=h.tab(f);a.selected=true;h.refresh();
  assert(b.visible);h.change(false);
  assert(a.visible);assert(!b.visible);assert(f.collapsed);assert(!b.hasAttribute('pending'));
  assert(!h.root.hasAttribute('data-zsc-loaded-folders'));assert(!a.hasAttribute(HIDE));
  h.change(true);assert(b.visible);
});
test('missing native folder API leaves the module inactive and can recover after startup',()=>{
  const h=setup(true,false),f=h.folder(),t=h.tab(f);h.refresh();assert(!t.visible);
  h.window.gZenFolders=h.manager;h.refresh();assert(t.visible);
});
test('internal pinned containers delegate normally; cleanup restores wrappers and cancels work',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();
  assert.equal(await h.manager.animateSelect(node('zen-workspace-collapsible-pins')),'native');
  await h.manager.animateCollapse(f);assert(h.frames.size);
  h.api.uninstall();assert.equal(h.frames.size,0);assert(h.observer.disconnected);
  for(const name of Object.keys(h.originals)) assert.equal(h.manager[name],h.originals[name]);
  assert.equal(h.listeners.size,0);assert.equal(h.window.__zenSafeCloseLoadedFolders,undefined);
  assert.equal(h.errors.length,0);
});

test('split-view wrapper is kept when a loaded member exists, hidden when all are pending',()=>{
  const h=setup(),f=h.folder(),a=h.tab(f),b=h.tab(f,true),split=node('tab-group');
  split.setAttribute('split-view-group','true');split.group=f;split.tabs=[a,b];a.group=b.group=split;
  h.refresh();assert(a.visible);assert(!split.hasAttribute(HIDE));assert(b.hasAttribute(HIDE));
  a.setAttribute('pending','true');h.refresh();assert(split.hasAttribute(HIDE));
});

test('disabling the entire mod also restores standard visibility',()=>{
  const h=setup(),f=h.folder(),a=h.tab(f),b=h.tab(f);a.selected=true;h.refresh();assert(b.visible);
  h.api.config.enabled=false;h.refresh();assert(!b.visible);assert(a.visible);
  assert(!h.root.hasAttribute('data-zsc-loaded-folders'));
});
