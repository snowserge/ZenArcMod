const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../zen-safe-close.uc.js'),'utf8');
const start=source.lastIndexOf('(() => {',source.indexOf('const BACKUP = "zen-safe-close-internal.browserSettings.v1"'));
const code=source.slice(start,source.indexOf('\n(() => {',start+1));
const core=source.slice(0,source.indexOf('\n})();')+6);
const BACKUP='zen-safe-close-internal.browserSettings.v1';
const P=['activeInterval','idleInterval','immediateInterval'].map(k=>'services.sync.scheduler.'+k);
const POPUP='zen.folders.search.enabled';
const keys=['manageSyncIntervals','syncActiveInterval','syncIdleInterval','syncImmediateInterval','folderPopup'];
const flags=keys.map(k=>'services.sync.prefs.sync.zen-safe-close.'+k);
function environment({ready=true,values=new Map()}={}) {
 const defaults=new Map([[P[0],600],[P[1],3600],[P[2],90],[POPUP,true]]);
 const host={},observers=new Map(),tasks=new Map(),errors=[];let next=0,imports=0;
 const prefs={
  prefHasUserValue:k=>values.has(k),
  getBoolPref:(k,f)=>values.get(k)??defaults.get(k)??f,
  getIntPref:(k,f)=>values.get(k)??defaults.get(k)??f,
  getStringPref:(k,f)=>values.get(k)??defaults.get(k)??f,
  setBoolPref:(k,v)=>{assert.equal(typeof v,'boolean');values.set(k,v);},
  setIntPref:(k,v)=>{assert(Number.isInteger(v));values.set(k,v);},
  setStringPref:(k,v)=>values.set(k,v),clearUserPref:k=>values.delete(k),
  getDefaultBranch:()=>({setBoolPref:(k,v)=>defaults.set(k,v),setStringPref:(k,v)=>defaults.set(k,v)}),
  addObserver(){},removeObserver(){}
 };
 const scheduler={idle:false,hasIncomingItems:false,numClients:2,adjustments:0,checks:0,
  adjustSyncInterval(){this.adjustments++;
   this.syncInterval=this.idle?this.idleInterval:this.hasIncomingItems?this.immediateInterval:this.activeInterval;
   if(!this.idle)this.hasIncomingItems=false;},
  checkSyncStatus(){this.checks++;}
 };
 const service={ready},sync={scheduler,locked:false};
 const timers={setTimeout(fn){const id=++next;tasks.set(id,fn);return id;},clearTimeout:id=>tasks.delete(id)};
 const Services={prefs,wm:{getEnumerator:()=>[]},obs:{
  addObserver(o,n){if(!observers.has(n))observers.set(n,new Set());observers.get(n).add(o);},
  removeObserver(o,n){observers.get(n)?.delete(o);}
 }};
 function tick(){let count=0;while(tasks.size){if(++count>100)throw Error('timer loop');const [id,fn]=tasks.entries().next().value;tasks.delete(id);fn();}}
 function notify(n){for(const o of [...(observers.get(n)||[])])o.observe();}
 function open(config={}) {
  const listeners=new Map();let popupCancels=0;
  const api={sharedHost:host,config:{enabled:true,manageSyncIntervals:true,
   syncActiveInterval:120,syncIdleInterval:600,syncImmediateInterval:90,folderPopup:false,...config},uninstall(){}};
  const win={__zenSafeClose:api,gZenFolders:{cancelPopupTimer(){popupCancels++;}},
   addEventListener(n,f){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},
   removeEventListener(n,f){listeners.get(n)?.delete(f);}
  };
  const context={window:win,Services,ChromeUtils:{importESModule(uri){
   if(uri.includes('Timer.sys.mjs'))return timers;
   assert(uri.includes('services-sync/main.sys.mjs'));imports++;return {Weave:{Service:sync}};
  }},Components:{classes:{'@mozilla.org/weave/service;1':{getService:()=>({wrappedJSObject:service})}},
   interfaces:{nsISupports:{}},utils:{reportError:e=>errors.push(String(e))}}};
  vm.runInNewContext(code,context);
  function change(values){Object.assign(api.config,values);for(const f of listeners.get('ZenSafeCloseConfigChanged')||[])f();tick();}
  return {api,win,context,listeners,change,get popupCancels(){return popupCancels;}};
 }
 return {open,prefs,values,defaults,scheduler,service,sync,host,tasks,tick,notify,errors,
  get imports(){return imports;},observerCount:()=>[...observers.values()].reduce((n,s)=>n+s.size,0),Services};
}

test('defaults apply 120/600/90 seconds, disable the hover popup and enroll only the five mod controls in Sync',()=>{
 const e=environment(),h=e.open();
 assert.deepEqual(P.map(k=>e.prefs.getIntPref(k)),[120,600,90]);
 assert.equal(e.prefs.getBoolPref(POPUP),false);assert.equal(h.popupCancels,1);
 assert(flags.every(k=>e.prefs.getBoolPref(k)));
 assert.equal(e.scheduler.activeInterval,120000);assert.equal(e.scheduler.idleInterval,600000);
 assert.equal(e.scheduler.immediateInterval,90000);assert(e.values.has(BACKUP));
});

test('custom fields update all three running scheduler intervals without resetting idle state',()=>{
 const e=environment(),h=e.open();e.scheduler.idle=true;
 h.change({syncActiveInterval:180,syncIdleInterval:900,syncImmediateInterval:75});
 assert.deepEqual(P.map(k=>e.prefs.getIntPref(k)),[180,900,75]);
 assert.equal(e.scheduler.syncInterval,900000);assert.equal(e.scheduler.idle,true);
 assert.equal(e.scheduler.immediateInterval,75000);
});

test('turning off interval management restores preexisting user/default values but keeps the popup setting',()=>{
 const e=environment();e.values.set(P[0],480);const h=e.open();
 h.change({manageSyncIntervals:false});
 assert.equal(e.prefs.getIntPref(P[0]),480);assert(!e.values.has(P[1]));assert(!e.values.has(P[2]));
 assert.equal(e.scheduler.activeInterval,480000);assert.equal(e.scheduler.idleInterval,3600000);
 assert.equal(e.prefs.getBoolPref(POPUP),false);assert(flags.every(k=>e.prefs.getBoolPref(k)));
});

test('folder popup can be switched independently while custom intervals are off',()=>{
 const e=environment(),h=e.open({manageSyncIntervals:false});
 assert.equal(e.prefs.getIntPref(P[0]),600);h.change({folderPopup:true});
 assert.equal(e.prefs.getBoolPref(POPUP),true);const count=h.popupCancels;
 h.change({folderPopup:false});assert.equal(h.popupCancels,count+1);
 assert.equal(e.prefs.getIntPref(P[0]),600);
});

test('master disable restores popup, interval and Sync-allowlist originals',()=>{
 const e=environment();e.values.set(POPUP,false);e.values.set(flags[0],false);
 const h=e.open();h.change({enabled:false});
 assert.equal(e.prefs.getBoolPref(POPUP),false);assert.equal(e.prefs.getBoolPref(flags[0]),false);
 assert(!e.values.has(P[0]));assert(!e.values.has(BACKUP));
 assert.deepEqual([...e.values.keys()].sort(),[POPUP,flags[0]].sort());
});

test('last uninstall restores originals and removes module observers/listeners',()=>{
 const e=environment(),h=e.open();h.api.uninstall();e.tick();
 assert.equal(e.values.size,0);assert.equal(e.observerCount(),0);
 assert.equal([...h.listeners.values()].reduce((n,s)=>n+s.size,0),0);
 assert.equal(h.win.__zenSafeCloseBrowserSettings,undefined);assert.equal(e.tasks.size,0);
});

test('multiple windows share one backup; closing one cannot restore another owners settings',()=>{
 const e=environment();e.values.set(P[0],420);
 const a=e.open(),original=e.values.get(BACKUP),b=e.open();
 assert.equal(e.values.get(BACKUP),original);a.api.uninstall();e.tick();
 assert.equal(e.prefs.getIntPref(P[0]),120);
 b.api.uninstall();e.tick();assert.equal(e.prefs.getIntPref(P[0]),420);assert(!e.values.has(BACKUP));
});

test('same-turn hot reload preserves the original backup instead of saving mod values as originals',()=>{
 const e=environment();e.values.set(P[0],420);const a=e.open(),original=e.values.get(BACKUP);
 a.api.uninstall();const b=e.open();e.tick();
 assert.equal(e.values.get(BACKUP),original);b.api.uninstall();e.tick();
 assert.equal(e.prefs.getIntPref(P[0]),420);
});

test('newer external native preferences survive release',()=>{
 const e=environment(),h=e.open();e.values.set(P[0],333);e.values.set(POPUP,true);
 h.api.uninstall();e.tick();
 assert.equal(e.prefs.getIntPref(P[0]),333);assert.equal(e.prefs.getBoolPref(POPUP),true);
 assert(!e.values.has(BACKUP));
});

test('shutdown preserves policy for next startup; disabling after restart restores the initial originals',()=>{
 const e=environment();e.values.set(P[0],420);const h=e.open();
 e.notify('quit-application-granted');h.api.uninstall();e.tick();
 assert.equal(e.prefs.getIntPref(P[0]),120);assert(e.values.has(BACKUP));
 const next=environment({values:new Map(e.values)}),b=next.open();
 b.change({enabled:false});assert.equal(next.prefs.getIntPref(P[0]),420);
 assert.equal(next.prefs.getBoolPref(POPUP),true);assert(!next.values.has(BACKUP));
});

test('unconfigured Sync is not initialized; a later service-ready event updates its scheduler',()=>{
 const e=environment({ready:false}),h=e.open();
 assert.equal(e.imports,0);assert.equal(e.scheduler.checks,0);
 assert.equal(e.prefs.getIntPref(P[0]),120);
 e.service.ready=true;e.notify('weave:service:ready');
 assert.equal(e.scheduler.activeInterval,120000);assert.equal(e.scheduler.checks,1);
 assert.equal(h.win.__zenSafeCloseBrowserSettings.status.liveScheduler,true);
});

test('disabled interval management does not touch an otherwise idle Sync service',()=>{
 const e=environment();e.open({manageSyncIntervals:false});
 assert.equal(e.imports,0);assert.equal(e.scheduler.checks,0);
});

test('unrelated configuration events do not keep rescheduling Sync',()=>{
 const e=environment(),h=e.open(),checks=e.scheduler.checks;
 h.change({folderPopup:true});h.change({folderPopup:false});
 assert.equal(e.scheduler.checks,checks);
});

test('a running sync is not reset; new cached values are available to its native completion policy',()=>{
 const e=environment(),h=e.open();e.sync.locked=true;e.scheduler.hasIncomingItems=true;
 h.change({syncActiveInterval:240});
 assert.equal(e.scheduler.activeInterval,240000);assert.equal(e.scheduler.hasIncomingItems,true);
 assert.equal(e.sync.locked,true);
});

test('corrupt backup fails before changing native prefs and is retained for diagnosis',()=>{
 const e=environment();e.values.set(BACKUP,'not-json');const h=e.open();
 assert.equal(e.prefs.getIntPref(P[0]),600);assert.equal(e.prefs.getBoolPref(POPUP),true);
 assert.equal(e.values.get(BACKUP),'not-json');assert(e.errors.length);
 assert.match(h.win.__zenSafeCloseBrowserSettings.status.lastError,/JSON|Unexpected/);
});

test('core settings normalize empty, invalid, fractional and out-of-range inputs to supported integer seconds',()=>{
 const e=environment();const input={
  'zen-safe-close.syncActiveInterval':'0','zen-safe-close.syncIdleInterval':'999999',
  'zen-safe-close.syncImmediateInterval':'invalid'};
 for(const [k,v] of Object.entries(input))e.values.set(k,v);
 let observer;
 e.Services.prefs.addObserver=(prefix,o)=>{observer=o;};
 const win={location:{href:'chrome://browser/content/browser.xhtml'},gBrowser:{},
  addEventListener(){},removeEventListener(){},dispatchEvent(){},
  CustomEvent:class{constructor(type){this.type=type;}}};
 vm.runInNewContext(core,{window:win,Services:e.Services,Components:{utils:{reportError(){}}}});
 const api=win.__zenSafeClose;
 assert.equal(api.config.syncActiveInterval,60);assert.equal(api.config.syncIdleInterval,86400);
 assert.equal(api.config.syncImmediateInterval,90);assert.equal(api.config.folderPopup,false);
 e.values.set('zen-safe-close.syncActiveInterval','125.6');observer.observe();
 assert.equal(api.config.syncActiveInterval,126);
 e.values.set('zen-safe-close.syncActiveInterval','');observer.observe();
 assert.equal(api.config.syncActiveInterval,120);
});

test('Sine settings expose distinct fields whose defaults agree with the runtime',()=>{
 const prefs=JSON.parse(fs.readFileSync(path.join(__dirname,'../preferences.json'),'utf8'));
 const all=prefs.filter(p=>p.property);
 assert.equal(new Set(all.map(p=>p.property)).size,all.length);
 for(const [key,value] of Object.entries({manageSyncIntervals:true,syncActiveInterval:'120',
  syncIdleInterval:'600',syncImmediateInterval:'90',folderPopup:false})) {
  const control=all.find(p=>p.property==='zen-safe-close.'+key);assert(control,key);
  assert.equal(control.defaultValue,value);assert.equal(control.type,typeof value==='boolean'?'checkbox':'string');
 }
});
