const assert=require('node:assert/strict');
const vm=require('node:vm');
const {test}=require('node:test');
const {setup,code,HIDE}=require('./helpers/loaded-folders.cjs');
const RESTORE='__zenSafeClosePendingFolderRestore';

function replace(h,on=true) {
 const api={config:{enabled:true,showLoadedInFolders:on},uninstall(){}};
 h.window.__zenSafeClose=api;
 vm.runInNewContext(code,h.context);
 return api;
}

test('Sine same-turn unload/reload starts no outgoing native folder animations',async()=>{
 const h=setup(),f=h.folder(),selected=h.tab(f),other=h.tab(f),sleep=h.tab(f,true);
 selected.selected=true;h.refresh();const observer=h.observer;
 h.api.uninstall();
 assert(observer.disconnected);assert(h.window[RESTORE]);assert.equal(h.calls.length,0);
 await Promise.resolve(); // Sine awaits its unload callback before loadSubScript.
 replace(h);h.flushJobs();h.flush();
 assert(!h.window[RESTORE]);assert.equal(h.calls.length,0);
 assert(selected.visible);assert(other.visible);assert(sleep.hasAttribute(HIDE));
 assert(f.collapsed);assert(selected.selected);assert(!other.hasAttribute('pending'));
});

test('final removal still restores native selected-tab visibility after the handoff turn',()=>{
 const h=setup(),f=h.folder(),selected=h.tab(f),other=h.tab(f);
 selected.selected=true;h.refresh();h.api.uninstall();
 assert.equal(h.calls.length,0);h.flushJobs();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'animateCollapse');
 assert(selected.visible);assert(!other.visible);assert(!h.window[RESTORE]);
 assert.equal(h.manager.animateCollapse,h.originals.animateCollapse);
});

test('replacement with loaded-folder mode disabled lets the pending native restore run',()=>{
 const h=setup(),f=h.folder(),selected=h.tab(f),other=h.tab(f);
 selected.selected=true;h.refresh();h.api.uninstall();replace(h,false);
 h.flushJobs();assert.equal(h.calls.length,1);
 assert(!h.window.__zenSafeCloseLoadedFolders.status.active);
 assert(selected.visible);assert(!other.visible);
});

test('repeated generations do not stack hooks, listeners, restoration timers or native animations',async()=>{
 const h=setup(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);h.refresh();
 let api=h.api;const listenerCount=()=>[...h.listeners.values()].reduce((n,set)=>n+set.size,0);
 const count=listenerCount();
 for(let i=0;i<12;i++){
   api.uninstall();await Promise.resolve();api=replace(h);h.flushJobs();h.flush();
   assert.equal(h.calls.length,0);assert.equal(listenerCount(),count);assert.equal(h.timers.size,0);
   f.collapsed=false;await h.manager.animateExpand(f);h.flush();
   assert(!sleep.hasAttribute(HIDE));
   f.collapsed=true;await h.manager.animateCollapse(f);h.flush();
   assert(sleep.hasAttribute(HIDE));assert(live.visible);
 }
 api.uninstall();h.flushJobs();
 assert.equal(h.manager.animateCollapse,h.originals.animateCollapse);
 assert.equal(h.calls.length,1);assert.equal(listenerCount(),0);
});

test('browser-window unload performs cleanup without launching pointless native restore animations',()=>{
 const h=setup(),f=h.folder();h.tab(f);h.refresh();
 h.fire('unload');h.flushJobs();
 assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);assert(!h.window[RESTORE]);
 assert.equal(h.manager.animateExpand,h.originals.animateExpand);
});

test('late hidden writes from a pre-fix native callback are observed and reconciled',()=>{
 const h=setup(),f=h.folder(),live=h.tab(f);h.refresh();
 assert(h.observer.options.attributeFilter.includes('hidden'));
 f.groupContainer.setAttribute('hidden','true');
 h.observer.callback([{type:'attributes',attributeName:'hidden',target:f.groupContainer}]);
 h.flush();assert(!f.groupContainer.hasAttribute('hidden'));assert(live.visible);
});

test('activation cancels inherited group-start motion and clears its native inline shift',()=>{
 const h=setup(),f=h.folder();h.tab(f);
 let cancelled=0;
 f.groupStartElement.style.setProperty('margin-top','-160px');
 f.groupStartElement.getAnimations=()=>[{effect:{getKeyframes:()=>[{marginTop:'-160px'}]},cancel(){cancelled++;}}];
 h.refresh();
 assert.equal(cancelled,1);assert.equal(f.groupStartElement.style.getPropertyValue('margin-top'),'');
 h.refresh();assert.equal(cancelled,1);
});

test('late native group-start writes after activation are selectively cleaned',()=>{
 const h=setup(),f=h.folder();h.tab(f);h.refresh();
 f.groupStartElement.style.setProperty('margin-top','-160px');
 f.groupStartElement.style.setProperty('--zen-folder-indent','14px');
 h.observer.callback([{type:'attributes',attributeName:'style',target:f.groupStartElement}]);h.flush();
 assert.equal(f.groupStartElement.style.getPropertyValue('margin-top'),'');
 assert.equal(f.groupStartElement.style.getPropertyValue('--zen-folder-indent'),'14px');
});
