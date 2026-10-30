const assert=require('node:assert/strict'),vm=require('node:vm');
const {test}=require('node:test');
const folders=require('./helpers/loaded-folders.cjs');
const session=require('./helpers/session-memory.cjs');
function combined() {
 const h=folders.setup(true,true,{skipModule:true,config:{rememberLoadedTabs:true}});
 const groups=[h.folder(),h.folder(),h.folder()];const live=[],sleep=[];
 for(const f of groups){for(let i=0;i<4;i++)live.push(h.tab(f,true));sleep.push(h.tab(f,true));}
 const tabs=[...live,...sleep],values=new Map(live.map(t=>[t,'1']));sleep.forEach(t=>values.set(t,'0'));
 const env=session.shared(),reloads=[];h.api.sharedHost=env.host;let resolve;const ready=new Promise(r=>{resolve=r;});
 Object.assign(h.window,{setTimeout:env.setTimeout,clearTimeout:env.clearTimeout,
  CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:e=>h.fire(e.type),
  SessionStore:{promiseAllWindowsRestored:ready,getCustomTabValue:t=>values.get(t)||'',
   setCustomTabValue:(t,k,v)=>values.set(t,v),deleteCustomTabValue:t=>values.delete(t)}});
 h.window.gBrowser.tabs=tabs;h.window.gBrowser.getBrowserForTab=t=>({reload:()=>reloads.push(t)});
 class MutationObserver {constructor(fn){this.fn=fn;}observe(){}disconnect(){}}
 vm.runInNewContext(session.code,{window:h.window,Services:env.services,MutationObserver,
  ChromeUtils:{importESModule:()=>({setTimeout:env.setTimeout,clearTimeout:env.clearTimeout,PrivateBrowsingUtils:{isWindowPrivate:()=>false}})},
  Components:{utils:{reportError:e=>h.errors.push(e)}}});
 vm.runInNewContext(folders.code,h.context);
 return {...h,groups,live,sleep,values,env,reloads,async initialized(){resolve();for(let i=0;i<3;i++)await Promise.resolve();env.tick();h.flush();}};
}
test('all remembered rows appear before native startup finishes and before any network load',async()=>{
 const h=combined();
 assert.equal(h.reloads.length,0);assert.equal(h.live.filter(t=>!t.hasAttribute(folders.HIDE)).length,12);
 assert(h.live.every(t=>t.visible));assert(h.sleep.every(t=>t.hasAttribute(folders.HIDE)));
 await h.initialized();assert.equal(h.reloads.length,2);
 assert(h.live.every(t=>t.hasAttribute('pending')),'visibility must not falsify native pending state');
 assert(h.live.every(t=>!t.hasAttribute(folders.HIDE)));
});
test('queued restores, completions and timeouts keep the sidebar row count stable',async()=>{
 const h=combined();await h.initialized();const count=()=>h.live.filter(t=>!t.hasAttribute(folders.HIDE)).length;
 assert.equal(count(),12);
 for(const tab of h.live.slice(0,5)){tab.removeAttribute('pending');h.fire('SSTabRestored',tab);h.env.tick();h.flush();assert.equal(count(),12);}
 h.env.tick(20000);h.flush();assert.equal(count(),12);assert(h.sleep.every(t=>t.hasAttribute(folders.HIDE)));
});
test('explicit discard removes only that remembered row immediately, including queued tabs',async()=>{
 const h=combined();await h.initialized();const tab=h.live[10];
 h.fire('TabBrowserDiscarded',tab);h.flush();
 assert(tab.hasAttribute(folders.HIDE));assert.equal(h.values.get(tab),'0');
 assert.equal(h.live.filter(t=>!t.hasAttribute(folders.HIDE)).length,11);
 h.env.tick(20000);h.flush();assert(!h.reloads.includes(tab));
});
test('turning off memory removes pending remembered rows without changing tab loading state',async()=>{
 const h=combined();await h.initialized();
 h.api.config.rememberLoadedTabs=false;h.fire('ZenSafeCloseConfigChanged');h.env.tick();h.flush();
 assert(h.live.every(t=>t.hasAttribute('pending')));assert(h.live.every(t=>t.hasAttribute(folders.HIDE)));
});
test('startup layout survives repeated interleavings of restore, folder toggles and refresh',async()=>{
 const h=combined();await h.initialized();let seed=81;
 for(let i=0;i<80;i++){
  seed=(seed*1664525+1013904223)>>>0;const f=h.groups[seed%3];
  if(seed%2){f.collapsed=!f.collapsed;await h.manager[f.collapsed?'animateCollapse':'animateExpand'](f);}
  else {const tab=h.live[seed%h.live.length];tab.removeAttribute('pending');h.fire('SSTabRestored',tab);}
  h.env.tick();h.flush();
  assert(h.live.every(t=>!t.hasAttribute(folders.HIDE)));assert(h.live.every(t=>t.visible));
 }
 assert.equal(h.errors.length,0);
 h.api.uninstall();h.env.tick();assert.equal(h.listeners.size,0);assert.equal(h.frames.size,0);
});
