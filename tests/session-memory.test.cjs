const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../zen-safe-close.uc.js'),'utf8');
const start=source.lastIndexOf('(() => {',source.indexOf('const KEY = "zen-safe-close.loaded.v1"'));
const code=source.slice(start,source.indexOf('\n(() => {',start+1));
const KEY='zen-safe-close.loaded.v1',BACKUP='zen-safe-close-internal.sessionRestorePolicy';
const POLICY=['browser.sessionstore.restore_on_demand','browser.sessionstore.restore_pinned_tabs_on_demand'];
function shared() {
 const user=new Map(),tasks=new Map(),observers=new Map();let id=0,time=0;
 const setTimeout=(fn,delay)=>{const n=++id;tasks.set(n,{fn,at:time+delay});return n;};
 const clearTimeout=id=>tasks.delete(id);
 const prefs={prefHasUserValue:k=>user.has(k),getBoolPref:(k,f=false)=>user.get(k)??f,
  getIntPref:(k,f=1)=>user.get(k)??f,setIntPref:(k,v)=>user.set(k,v),
  getStringPref:(k,f='')=>user.get(k)??f,setBoolPref:(k,v)=>user.set(k,v),setStringPref:(k,v)=>user.set(k,v),clearUserPref:k=>user.delete(k)};
 const host={setTimeout,clearTimeout};
 const services={prefs,appShell:{hiddenDOMWindow:host},obs:{
  addObserver(o,n){if(!observers.has(n))observers.set(n,new Set());observers.get(n).add(o);},
  removeObserver(o,n){observers.get(n)?.delete(o);}
 }};
 function tick(ms=0) {time+=ms;let count=0;while(true){const found=[...tasks].find(([,t])=>t.at<=time);if(!found)break;if(++count>100)throw Error('timer loop');tasks.delete(found[0]);found[1].fn();}}
 return {user,tasks,services,host,tick,setTimeout,clearTimeout,notify(n){for(const o of observers.get(n)||[])o.observe();}};
}
function setup({on=true,privateWindow=false,env=shared(),values=new Map(),tabs:specs=[],ready=true}={}) {
 const listeners=new Map(),errors=[],reloads=[];let resolve;
 const promise=new Promise(r=>{resolve=r;});
 const tabs=specs.map((spec,i)=>{
  const t={id:spec.id||'tab'+i,isConnected:true,closing:false,attrs:new Set(spec.pending?['pending']:[]),
   hasAttribute(k){return this.attrs.has(k);}};
  if(spec.empty)t.attrs.add('zen-empty-tab');if(spec.glance)t.attrs.add('glance-id');
  if(spec.saved!==undefined)values.set(t.id,spec.saved);
  t.linkedBrowser={reload(){reloads.push(t.id);if(spec.fail)throw Error('reload failed');}};return t;
 });
 const ss={promiseAllWindowsRestored:promise,getCustomTabValue:t=>values.get(t.id)||'',
  setCustomTabValue:(t,k,v)=>{assert.equal(k,KEY);values.set(t.id,v);},deleteCustomTabValue:t=>values.delete(t.id)};
 const api={config:{enabled:true,rememberLoadedTabs:on},uninstall(){}};
 const win={__zenSafeClose:api,SessionStore:ss,closed:false,gBrowser:{tabs,tabContainer:{},getBrowserForTab:t=>t.linkedBrowser},
  setTimeout:env.setTimeout,clearTimeout:env.clearTimeout,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){const set=listeners.get(type);set?.delete(fn);if(!set?.size)listeners.delete(type);}};
 let observer;
 class MutationObserver {constructor(fn){observer=this;this.fn=fn;}observe(){}disconnect(){this.disconnected=true;}}
 vm.runInNewContext(code,{window:win,Services:env.services,MutationObserver,
  ChromeUtils:{importESModule:()=>({PrivateBrowsingUtils:{isWindowPrivate:()=>privateWindow}})},
  Components:{utils:{reportError:e=>errors.push(String(e))}}});
 function fire(type,target=win){for(const fn of [...(listeners.get(type)||[])])fn({type,target});}
 async function initialized(){resolve();for(let i=0;i<3;i++)await Promise.resolve();env.tick();}
 if(ready)resolve();
 return {win,api,tabs,ss,values,env,errors,reloads,listeners,initialized,
  fire,tick:env.tick,get observer(){return observer;},
  change(on){api.config.rememberLoadedTabs=on;fire('ZenSafeCloseConfigChanged');env.tick();},
  complete(t){t.attrs.delete('pending');fire('SSTabRestored',t);env.tick();},
  mutate(t,pending){if(pending)t.attrs.add('pending');else t.attrs.delete('pending');observer.fn([{type:'attributes',target:t}]);env.tick();}};
}
test('off by default never records metadata, changes policy or reloads tabs',async()=>{
 const h=setup({on:false,tabs:[{pending:true,saved:'1'}]});await h.initialized();
 assert.deepEqual(h.reloads,[]);assert.equal(h.env.user.size,0);assert.equal(h.values.get('tab0'),'1');
});
test('private windows never register session memory or write metadata/policy',async()=>{
 const h=setup({privateWindow:true,tabs:[{pending:true,saved:'1'}]});await h.initialized();
 assert(!h.win.__zenSafeCloseSessionMemory);assert.equal(h.env.user.size,0);assert.equal(h.listeners.size,0);assert(!h.observer);
});
test('startup waits for native restore before reading or overwriting saved flags',async()=>{
 const h=setup({ready:false,tabs:[{pending:true,saved:'1'}]});h.tick();
 assert.equal(h.values.get('tab0'),'1');assert.deepEqual(h.reloads,[]);
 await h.initialized();assert.deepEqual(h.reloads,['tab0']);assert.equal(h.values.get('tab0'),'1');
});
test('only previously loaded existing tabs resume; saved sleeping and new tabs stay pending',async()=>{
 const h=setup({tabs:[{id:'a',pending:true,saved:'1'},{id:'b',pending:true,saved:'0'},{id:'c',pending:true}]});
 await h.initialized();assert.deepEqual(h.reloads,['a']);assert.equal(h.values.get('b'),'0');assert.equal(h.win.gBrowser.tabs.length,3);
 h.complete(h.tabs[0]);assert.equal(h.values.get('a'),'1');
});
test('state follows per-tab identity, not URL/index, including duplicate pages',async()=>{
 const h=setup({tabs:[{id:'second-copy',pending:true,saved:'0'},{id:'first-copy',pending:true,saved:'1'}]});
 await h.initialized();assert.deepEqual(h.reloads,['first-copy']);
});
test('at most two restores run concurrently and completion advances the queue',async()=>{
 const h=setup({tabs:Array.from({length:5},(_,i)=>({id:String(i),pending:true,saved:'1'}))});
 await h.initialized();assert.deepEqual(h.reloads,['0','1']);
 h.complete(h.tabs[0]);assert.deepEqual(h.reloads,['0','1','2']);
 h.complete(h.tabs[1]);assert.deepEqual(h.reloads,['0','1','2','3']);
});
test('ordinary loaded/pending changes are recorded live without reloading sleeping tabs',async()=>{
 const h=setup({tabs:[{pending:false}]});await h.initialized();assert.equal(h.values.get('tab0'),'1');
 h.mutate(h.tabs[0],true);assert.equal(h.values.get('tab0'),'0');assert.deepEqual(h.reloads,[]);
 h.mutate(h.tabs[0],false);assert.equal(h.values.get('tab0'),'1');
});
test('explicit discard cancels queued startup load and wins over the old saved intention',async()=>{
 const h=setup({tabs:Array.from({length:3},(_,i)=>({id:String(i),pending:true,saved:'1'}))});await h.initialized();
 h.fire('TabBrowserDiscarded',h.tabs[2]);h.tick();h.complete(h.tabs[0]);
 assert.deepEqual(h.reloads,['0','1']);assert.equal(h.values.get('2'),'0');
});
test('enabling during an existing session records current state instead of replaying old markers',async()=>{
 const h=setup({on:false,tabs:[{pending:true,saved:'1'}]});await h.initialized();h.change(true);
 assert.deepEqual(h.reloads,[]);assert.equal(h.values.get('tab0'),'0');
});
test('native window busy/ready blocks temporary pending state from overwriting flags',async()=>{
 const h=setup({tabs:[{pending:false}]});await h.initialized();h.fire('SSWindowStateBusy');
 h.mutate(h.tabs[0],true);assert.equal(h.values.get('tab0'),'1');
 h.fire('SSWindowStateReady');h.tick();assert.equal(h.values.get('tab0'),'0');
});
test('reload errors and timeouts retain intention without repeated retries',async()=>{
 const h=setup({tabs:[{pending:true,saved:'1',fail:true},{pending:true,saved:'1'}]});await h.initialized();
 assert(h.errors.length);h.tick(20000);h.tick();assert.equal(h.reloads.length,2);
 assert.equal(h.values.get('tab0'),'1');assert.equal(h.values.get('tab1'),'1');
});
test('closing queued tabs does not create replacements or consume restore slots',async()=>{
 const h=setup({tabs:Array.from({length:4},(_,i)=>({id:String(i),pending:true,saved:'1'}))});await h.initialized();
 h.tabs[2].closing=true;h.fire('TabClose',h.tabs[2]);h.tick();h.complete(h.tabs[0]);
 assert.deepEqual(h.reloads,['0','1','3']);
});
test('placeholders and glance tabs are excluded from persistent session metadata',async()=>{
 const h=setup({tabs:[{empty:true},{glance:true}]});await h.initialized();assert.equal(h.values.size,0);
});
test('policy originals survive a shutdown and next startup, and disabling restores user/default values',async()=>{
 const env=shared();env.user.set(POLICY[0],false);
 const h=setup({env,tabs:[{}]});await h.initialized();const backup=env.user.get(BACKUP);
 assert(backup);assert.equal(env.user.get('browser.startup.page'),3);for(const name of POLICY)assert.equal(env.user.get(name),true);
 env.notify('quit-application-granted');h.fire('unload');assert.equal(env.user.get(BACKUP),backup);
 const nextEnv=shared();for(const [k,v] of env.user)nextEnv.user.set(k,v);
 const next=setup({env:nextEnv});await next.initialized();assert.equal(next.env.user.get(BACKUP),backup);
 next.change(false);assert.equal(next.env.user.get(POLICY[0]),false);assert(!next.env.user.has(POLICY[1]));assert(!next.env.user.has(BACKUP));
});
test('multiple windows share policy; uninstall of one does not undo another window',async()=>{
 const env=shared(),a=setup({env}),b=setup({env});await a.initialized();await b.initialized();
 a.api.uninstall();env.tick();assert.equal(env.user.get(POLICY[0]),true);
 b.api.uninstall();env.tick();assert.equal(env.user.size,0);
});
test('a same-turn hot reload reacquires policy before restoration',async()=>{
 const env=shared(),a=setup({env});await a.initialized();const backup=env.user.get(BACKUP);
 a.api.uninstall();const b=setup({env});await b.initialized();env.tick();
 assert.equal(env.user.get(BACKUP),backup);assert.equal(env.user.get(POLICY[0]),true);
});
test('disable stops queued work, clears own metadata and preserves newer external prefs',async()=>{
 const h=setup({tabs:[{pending:true,saved:'1'},{pending:true,saved:'1'},{pending:true,saved:'1'}]});await h.initialized();
 h.env.user.set(POLICY[0],false);h.change(false);assert.equal(h.env.user.get(POLICY[0]),false);
 assert.equal(h.values.size,0);h.tick(30000);assert.equal(h.reloads.length,2);
});
test('uninstall removes observers/timers/listeners and ignores late initialization',async()=>{
 const h=setup({ready:false});h.api.uninstall();await h.initialized();
 assert.equal(h.listeners.size,0);assert(h.observer.disconnected);assert(!h.win.__zenSafeCloseSessionMemory);
 assert.equal(h.env.tasks.size,0);assert.equal(h.env.user.size,0);
});

test('a complete saved session restores loaded flags after restart even when tab order changes',async()=>{
 const a=setup({tabs:[{id:'loaded',pending:false},{id:'sleeping',pending:true}]});await a.initialized();
 assert.equal(a.values.get('loaded'),'1');assert.equal(a.values.get('sleeping'),'0');
 a.env.notify('quit-application-granted');a.fire('unload');
 const env=shared();for(const [k,v]of a.env.user)env.user.set(k,v);
 const b=setup({env,values:new Map(a.values),tabs:[{id:'sleeping',pending:true},{id:'loaded',pending:true}]});
 await b.initialized();assert.deepEqual(b.reloads,['loaded']);b.complete(b.tabs[1]);
 assert.equal(b.values.get('loaded'),'1');assert.equal(b.values.get('sleeping'),'0');
});
test('startup-page choice is restored when disabled and metadata contains no URLs',async()=>{
 const env=shared();env.user.set('browser.startup.page',1);
 const h=setup({env,tabs:[{}]});await h.initialized();assert.equal(env.user.get('browser.startup.page'),3);
 assert.deepEqual([...h.values.values()],['1']);
 const backup=JSON.parse(env.user.get(BACKUP));assert.deepEqual(Object.keys(backup).sort(),['browser.startup.page',...POLICY].sort());
 h.change(false);assert.equal(env.user.get('browser.startup.page'),1);
});
test('invalid policy backup fails without restoring any tabs or overwriting the backup',async()=>{
 const env=shared();env.user.set(BACKUP,'not-json');const h=setup({env,tabs:[{pending:true,saved:'1'}]});
 await h.initialized();assert(h.errors.length);assert.deepEqual(h.reloads,[]);assert.equal(env.user.get(BACKUP),'not-json');
});
