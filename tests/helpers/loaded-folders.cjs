const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(process.env.ZSC_FOLDER_SOURCE || path.join(__dirname, '../../zen-safe-close.uc.js'), 'utf8');
const start = source.lastIndexOf('(() => {', source.indexOf('const FLAG = "data-zsc-loaded-folders"'));
const code = source.slice(start, source.indexOf('\n(() => {', start + 1));
const HIDE = 'data-zsc-folder-hidden';
function node(localName) {
  const attrs = new Set(), props = new Map(), priorities = new Map(), listeners = new Map();
  return { localName, attrs, isConnected: true, group: null,
    style: { setProperty: (k,v,p="") => { props.set(k,v); priorities.set(k,p); },
      getPropertyValue: k => props.get(k)||"", getPropertyPriority: k => priorities.get(k)||"",
      removeProperty: k => { props.delete(k);priorities.delete(k); }, props },
    setAttribute: name => attrs.add(name), removeAttribute: name => attrs.delete(name),
    hasAttribute: name => attrs.has(name),
    toggleAttribute(name, value) { if (value) attrs.add(name); else attrs.delete(name); },
    addEventListener(type,fn) { if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn); },
    removeEventListener(type,fn) { listeners.get(type)?.delete(fn); },
    emit(type) { for(const fn of listeners.get(type)||[])fn({type,target:this}); },
    listenerCount(type) { return listeners.get(type)?.size||0; },
    getAnimations: () => [], closest: () => null,
    remove() { this.isConnected = false; } };
}
function setup(on = true, available = true, extras = {}) {
  const folders = [], listeners = new Map(), frames = new Map(), timers = new Map(), originals = {}, calls = [];
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
  const api = { config: { enabled: true, showLoadedInFolders: on, ...extras.config }, uninstall() {} };
  const window = { __zenSafeClose: api,
    gBrowser: { tabContainer: { querySelectorAll: () => folders,
      _invalidateCachedVisibleTabs() { invalidations++; } } },
    gZenFolders: available ? manager : undefined,
    addEventListener(type,fn) { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); },
    removeEventListener(type,fn) { const set=listeners.get(type);set?.delete(fn);if (!set?.size) listeners.delete(type); },
    getComputedStyle: () => ({overflowY: "auto"}),
    requestAnimationFrame(fn) { const n=++id;frames.set(n,fn);return n; },
    cancelAnimationFrame(n) { frames.delete(n); },
    setTimeout(fn) { const n=++id;timers.set(n,fn);return n; },
    clearTimeout(n) { timers.delete(n); } };
  const errors = [];
  class MutationObserver {
    constructor(callback) { this.callback=callback; observer=this; }
    observe(target,options) { this.options=options; } disconnect() { this.disconnected=true; }
  }
  const context={window,document:{documentElement:root,createElementNS:()=>node('style')},
    MutationObserver,ResizeObserver:extras.ResizeObserver,Components:{utils:{reportError:e=>errors.push(e)}}};
  if (!extras.skipModule) vm.runInNewContext(code,context);
  const refresh=()=>window.__zenSafeCloseLoadedFolders.refresh();
  function flush() {const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());}
  function flushJobs() {const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());}
  function fire(type,target=window) { for (const fn of [...(listeners.get(type)||[])]) fn({type,target}); }
  return { folder,tab,folders,api,manager,originals,calls,root,window,errors,frames,listeners,fire,context,
    refresh,flush,flushJobs,timers,get observer(){return observer;},
    change(value) {api.config.showLoadedInFolders=value;fire('ZenSafeCloseConfigChanged');} };
}


module.exports={setup,node,code,HIDE};
