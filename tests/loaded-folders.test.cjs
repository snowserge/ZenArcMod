const assert=require('node:assert/strict');
const {test}=require('node:test');
const {setup,node,code,HIDE}=require('./helpers/loaded-folders.cjs');

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

test('repeated renders never temporarily reveal pending rows or drop container layout',()=>{
  const h=setup(),f=h.folder(),sleep=h.tab(f,true);h.tab(f);h.refresh();
  const removals=[];
  for (const n of [sleep,f.groupContainer,f.groupStartElement]) {
    const original=n.removeAttribute;
    n.removeAttribute=name=>{if(n.hasAttribute(name)) removals.push(name);original(name);};
  }
  h.refresh();h.refresh();
  assert.deepEqual(removals,[],'unchanged nodes must not be torn down and re-added during layout reads');
});
function attachScroller(h,f) {
  const box=node('scrollbox');Object.assign(box,{scrollTop:240,scrollLeft:7,clientHeight:400,scrollHeight:1800,
    getBoundingClientRect:()=>({top:0,bottom:400})});
  const header=f.labelElement.parentElement;header.parentElement=box;
  header.getBoundingClientRect=()=>({top:500-box.scrollTop,bottom:532-box.scrollTop});
  h.window.gZenWorkspaces={activeScrollbox:box,activeWorkspace:'one'};
  return {box,header};
}
test('expansion preserves sidebar position and header through deferred layout',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.tab(f,true);h.refresh();
  const {box,header}=attachScroller(h,f),top=header.getBoundingClientRect().top;
  h.window.gBrowser.tabContainer._invalidateCachedVisibleTabs=()=>{box.scrollTop+=180;};
  f.collapsed=false;await h.manager.animateExpand(f);
  assert.equal(box.scrollTop,240);assert.equal(header.getBoundingClientRect().top,top);
  h.flush();assert.equal(box.scrollTop,240);h.flush();assert.equal(box.scrollTop,240);
  assert.equal(box.scrollLeft,7);assert.equal(h.frames.size,0);
});
test('wheel, pointer, keyboard and tab selection cancel deferred position correction',async()=>{
  for(const event of ['wheel','touchstart','pointerdown','mousedown','keydown','TabSelect','blur']) {
    const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box}=attachScroller(h,f);
    await h.manager.animateExpand(f);box.scrollTop=680;h.fire(event);h.flush();h.flush();
    assert.equal(box.scrollTop,680,event+' must keep the newer position');
  }
});
test('new folder toggle supersedes old position correction; workspace change cancels it',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box}=attachScroller(h,f);
  await h.manager.animateExpand(f);box.scrollTop=300;
  await h.manager.animateCollapse(f);h.flush();assert.equal(box.scrollTop,300);
  h.window.gZenWorkspaces.activeWorkspace='two';box.scrollTop=550;h.flush();
  assert.equal(box.scrollTop,550);
});
test('uninstall cancels position guard callbacks and all temporary input listeners',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();attachScroller(h,f);
  await h.manager.animateExpand(f);assert(h.frames.size>1);
  h.api.uninstall();assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);
});

test('opening a folder that first makes the sidebar scrollable keeps its visible header',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.tab(f,true);h.refresh();
  const {box,header}=attachScroller(h,f);box.scrollTop=0;box.scrollHeight=400;
  header.getBoundingClientRect=()=>({top:100-box.scrollTop,bottom:132-box.scrollTop});
  h.window.gBrowser.tabContainer._invalidateCachedVisibleTabs=()=>{box.scrollHeight=1800;box.scrollTop=180;};
  f.collapsed=false;await h.manager.animateExpand(f);assert.equal(box.scrollTop,0);
  h.flush();h.flush();assert.equal(header.getBoundingClientRect().top,100);
});

test('late native scrolling after many frames still preserves the clicked header without polling',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box,header}=attachScroller(h,f);
  await h.manager.animateExpand(f);for(let i=0;i<12;i++)h.flush();assert.equal(h.frames.size,0);
  box.scrollTop=430;box.emit('scroll');h.flush();assert.equal(box.scrollTop,240);
  assert.equal(header.getBoundingClientRect().top,260);
  h.fire('wheel');box.scrollTop=520;box.emit('scroll');h.flush();assert.equal(box.scrollTop,520);
});
test('unrelated native selection/unload callbacks do not cancel the clicked-header anchor',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box}=attachScroller(h,f);
  await h.manager.animateExpand(f);h.flush();h.flush();
  await h.manager.animateSelect(f);await h.manager.animateUnload(f);
  box.scrollTop=430;box.emit('scroll');h.flush();assert.equal(box.scrollTop,240);
});
test('shadow scroller owns anchoring and uses instant scrollTo rather than CSS smooth assignment',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box,header}=attachScroller(h,f);
  header.parentElement=null;h.window.gZenWorkspaces.activeScrollbox={scrollbox:box};
  const calls=[];box.scrollTo=options=>{calls.push(options);box.scrollTop=options.top;box.scrollLeft=options.left;box.emit('scroll');};
  await h.manager.animateExpand(f);h.flush();h.flush();
  assert.equal(box.style.getPropertyValue('overflow-anchor'),'none');
  box.scrollTop=480;box.scrollLeft=60;box.emit('scroll');h.flush();h.flush();
  assert.equal(box.scrollTop,240);assert.equal(box.scrollLeft,7);
  assert(calls.length);assert(calls.every(x=>x.behavior==='instant'));
  h.api.uninstall();assert.equal(box.listenerCount('scroll'),0);assert.equal(box.style.getPropertyValue('overflow-anchor'),'');
});
test('late folder ResizeObserver updates preserve the header through content growth',async()=>{
  let sizes;class ResizeObserver {constructor(fn){this.fn=fn;sizes=this;}observe(){}unobserve(){}disconnect(){this.disconnected=true;}}
  const h=setup(true,true,{ResizeObserver}),f=h.folder();h.tab(f);h.refresh();const {box,header}=attachScroller(h,f);
  let contentTop=500;header.getBoundingClientRect=()=>({top:contentTop-box.scrollTop,bottom:contentTop+32-box.scrollTop});
  await h.manager.animateExpand(f);h.flush();h.flush();contentTop+=90;sizes.fn();h.flush();
  assert.equal(box.scrollTop,330);assert.equal(header.getBoundingClientRect().top,260);
  h.api.uninstall();assert(sizes.disconnected);
});
test('stable rendering preserves indentation and does not repeatedly cancel native transitions',()=>{
  const h=setup(),f=h.folder(),t=h.tab(f);let reads=0;
  t.style.setProperty('--zen-folder-indent','14px');t.getAnimations=()=>{reads++;return[];};
  h.refresh();h.refresh();h.refresh();
  assert.equal(t.style.getPropertyValue('--zen-folder-indent'),'14px');assert.equal(reads,1);
  h.change(false);t.style.setProperty('opacity','0');h.change(true);
  assert.equal(t.style.getPropertyValue('opacity'),'');
});

test('late native row styles are cleaned selectively without erasing indentation',()=>{
  const h=setup(),f=h.folder(),t=h.tab(f);h.refresh();
  t.style.setProperty('--zen-folder-indent','14px');t.style.setProperty('opacity','0');t.style.setProperty('height','0px');
  h.observer.callback([{type:'attributes',attributeName:'style',target:t}]);h.flush();
  assert.equal(t.style.getPropertyValue('opacity'),'');assert.equal(t.style.getPropertyValue('height'),'');
  assert.equal(t.style.getPropertyValue('--zen-folder-indent'),'14px');
});
test('disconnected workspace scrollers release anchoring styles and scroll listeners',async()=>{
  const h=setup(),f=h.folder();h.tab(f);h.refresh();const {box,header}=attachScroller(h,f);
  await h.manager.animateExpand(f);h.flush();h.flush();
  box.isConnected=false;header.isConnected=false;f.isConnected=false;h.refresh();
  assert.equal(box.style.getPropertyValue('overflow-anchor'),'');assert.equal(box.listenerCount('scroll'),0);
  assert.equal(h.window.__zenSafeCloseLoadedFolders.status.scrollers,0);
});

test('active child never prevents repeated folder toggles (ARM macOS regression)', async () => {
  const h=setup(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);
  live.selected=true;h.refresh();
  for(let i=0;i<6;i++) {
    f.collapsed=false;await h.manager.animateExpand(f);h.flush();
    assert(!sleep.hasAttribute(HIDE));assert(live.visible);
    f.collapsed=true;await h.manager.animateCollapse(f);h.flush();
    assert(sleep.hasAttribute(HIDE));assert(live.visible);assert(f.collapsed);
  }
  h.change(false);
  assert.equal(h.manager.animateCollapse,h.originals.animateCollapse);
  assert(f.collapsed);assert(live.selected);
});
