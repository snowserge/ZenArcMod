const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const source=fs.readFileSync(process.env.ZSC_SESSION_SOURCE || path.join(__dirname,'../../zen-safe-close.uc.js'),'utf8');
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
 const win={__zenSafeClose:api,SessionStore:ss,closed:false,
  CustomEvent:class {constructor(type){this.type=type;}},dispatchEvent(event){fire(event.type);},gBrowser:{tabs,tabContainer:{},getBrowserForTab:t=>t.linkedBrowser},
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

module.exports={setup,shared,KEY,BACKUP,POLICY,code};
