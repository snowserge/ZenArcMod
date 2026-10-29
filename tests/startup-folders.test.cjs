const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test');
const {setup}=require('./helpers/loaded-folders.cjs'),{shared}=require('./helpers/session-memory.cjs');
const source=fs.readFileSync(path.join(__dirname,'../zen-safe-close.uc.js'),'utf8');
const start=source.lastIndexOf('(() => {',source.indexOf('const STARTUP = "__zenSafeCloseStartupFolders"'));
const code=source.slice(start,source.indexOf('\n(() => {',start+1));
function fixture({on=true,memory=true,installed=true,layout=true}={}){
 const h=setup(layout,true,{config:{collapseSleepingFoldersAtStartup:on,rememberLoadedTabs:memory}}),env=shared();
 const remembered=new Set();let resolve;
 const ready=new Promise(r=>{resolve=r;});
 h.api.status={installed};h.window.SessionStore={promiseAllWindowsRestored:ready};
 h.window.__zenSafeCloseSessionMemory={isRememberedLoaded:t=>h.api.config.rememberLoadedTabs&&remembered.has(t)};
 h.window.setTimeout=env.setTimeout;h.window.clearTimeout=env.clearTimeout;
 function install(){vm.runInNewContext(code,h.context);}
 install();
 return {...h,env,remembered,install,async initialized(){resolve();for(let i=0;i<3;i++)await Promise.resolve();env.tick();}};
}
test('startup collapses empty/sleeping folders and preserves loaded folder state',async()=>{
 const h=fixture(),empty=h.folder(),sleep=h.folder(),loaded=h.folder(),kept=h.folder();
 for(const f of [empty,sleep,loaded])f.collapsed=false;
 h.tab(sleep,true);h.tab(loaded);h.tab(kept);
 await h.initialized();assert(empty.collapsed);assert(sleep.collapsed);assert(!loaded.collapsed);assert(kept.collapsed);
});
test('remembered pending tabs count as loaded even before background restore begins',async()=>{
 const h=fixture(),f=h.folder(),t=h.tab(f,true);f.collapsed=false;h.remembered.add(t);
 await h.initialized();assert(!f.collapsed);assert(t.hasAttribute('pending'));
});
test('without session memory actual pending tabs cause a startup collapse',async()=>{
 const h=fixture({memory:false}),f=h.folder(),t=h.tab(f,true);f.collapsed=false;h.remembered.add(t);
 await h.initialized();assert(f.collapsed);
});
test('nested folders use descendant state, including pending remembered descendants',async()=>{
 const h=fixture(),parent=h.folder(),live=h.folder(parent),sleep=h.folder(parent),empty=h.folder(sleep);
 for(const f of [parent,live,sleep,empty])f.collapsed=false;
 h.remembered.add(h.tab(live,true));h.tab(sleep,true);
 await h.initialized();assert(!parent.collapsed);assert(!live.collapsed);assert(sleep.collapsed);assert(empty.collapsed);
});
test('placeholders and closing tabs do not keep a folder expanded',async()=>{
 const h=fixture(),f=h.folder();f.collapsed=false;h.tab(f,false,true);h.tab(f).closing=true;
 await h.initialized();assert(f.collapsed);
});
test('wait for native session boundary, busy window and main browser installation',async()=>{
 const h=fixture({installed:false}),f=h.folder();f.collapsed=false;h.tab(f,true);h.env.tick();assert(!f.collapsed);
 h.fire('SSWindowStateBusy');await h.initialized();assert(!f.collapsed);
 h.fire('SSWindowStateReady');h.env.tick();assert(!f.collapsed);
 h.api.status.installed=true;h.fire('ZenSafeCloseConfigChanged');h.env.tick();assert(f.collapsed);
});
test('startup preference off leaves folders unchanged and enabling later waits for next startup',async()=>{
 const h=fixture({on:false}),f=h.folder();f.collapsed=false;h.tab(f,true);await h.initialized();assert(!f.collapsed);
 h.api.config.collapseSleepingFoldersAtStartup=true;h.fire('ZenSafeCloseConfigChanged');h.env.tick();assert(!f.collapsed);
});
test('manual folder interaction during startup protects that branch and its ancestors',async()=>{
 const h=fixture(),parent=h.folder(),child=h.folder(parent);parent.collapsed=child.collapsed=false;h.tab(child,true);
 for(const fn of h.listeners.get('pointerdown'))fn({isTrusted:true,target:{closest:()=>child}});
 await h.initialized();assert(!parent.collapsed);assert(!child.collapsed);
});
test('after startup, manually reopening folders and late restore events do not re-collapse them',async()=>{
 const h=fixture(),f=h.folder();f.collapsed=false;await h.initialized();assert(f.collapsed);
 f.collapsed=false;h.fire('SSWindowStateReady');h.fire('ZenSafeCloseConfigChanged');h.env.tick();assert(!f.collapsed);
});
test('hot reload uses the existing one-shot token and does not close reopened folders',async()=>{
 const h=fixture(),f=h.folder();f.collapsed=false;await h.initialized();f.collapsed=false;
 h.install();for(let i=0;i<3;i++)await Promise.resolve();h.env.tick();assert(!f.collapsed);
});
test('native behavior also works when loaded-folder visibility is disabled',async()=>{
 const h=fixture({layout:false}),f=h.folder();f.collapsed=false;h.tab(f,true);await h.initialized();assert(f.collapsed);
});
test('batch collapse does not anchor each programmatic toggle or repeatedly render',async()=>{
 const h=fixture(),folders=[h.folder(),h.folder(),h.folder()];let invalidations=0;
 h.window.gBrowser.tabContainer._invalidateCachedVisibleTabs=()=>invalidations++;
 for(const f of folders){let collapsed=false;Object.defineProperty(f,'collapsed',{get:()=>collapsed,set(value){collapsed=value;h.manager.animateCollapse(f);}});h.tab(f,true);}
 await h.initialized();assert.equal(invalidations,1);assert(!h.window.__zenSafeCloseLoadedFolders.status.holdingHeader);
 assert(!h.window.__zenSafeCloseApplyingStartupFolders);
});
test('uninstall cancels startup work and removes its listeners',async()=>{
 const h=fixture(),f=h.folder();f.collapsed=false;h.api.uninstall();await h.initialized();
 assert(!f.collapsed);assert.equal(h.listeners.size,0);assert(!h.window.__zenSafeCloseStartupFolderRule);
});
