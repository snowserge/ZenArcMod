const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup, code } = require('./helpers/loaded-folders.cjs');
const vm = require('node:vm');

const HIDE='data-zsc-folder-hidden', MOTION='data-zsc-folder-motion';
// A deterministic WAAPI/layout fixture. No Gecko rendering or native input.
function fixture({ reduced=false, nativeOff=false, ResizeObserver }={}) {
  const h=setup(true,true,{ResizeObserver}), animations=[];
  h.window.matchMedia=()=>({matches:reduced});
  h.manager._dontAnimateFolder=nativeOff;
  function shown(n) {
    if(n.hasAttribute(HIDE)&&!n.hasAttribute(MOTION))return false;
    for(let g=n.group;g;g=g.group) {
      if(g.hasAttribute(HIDE)&&!g.hasAttribute(MOTION))return false;
      if(g.groupContainer.hasAttribute(HIDE)&&!g.groupContainer.hasAttribute(MOTION))return false;
    }
    return true;
  }
  function natural(n) {
    if(n.localName!=='zen-folder')return 32;
    if(n.groupContainer.hasAttribute(HIDE)&&!n.groupContainer.hasAttribute(MOTION))return 32;
    return 32+[...n.direct,...h.folders.filter(f=>f.group===n)].reduce((sum,x)=>sum+height(x),0);
  }
  function height(n) {
    if(!shown(n))return 0;
    if(n.motion?.playState==='running')return n.motion.sample('height');
    return natural(n);
  }
  function attach(n) {
    n.getBoundingClientRect=()=>({height:height(n)});
    n.getAnimations=()=>n.motion?.playState==='running'?[n.motion]:[];
    n.animate=(frames,options)=>{
      let resolve,reject;
      const animation={node:n,frames,options,progress:0,playState:'running',
        finished:new Promise((ok,fail)=>{resolve=ok;reject=fail;}),
        sample(key) {
          const a=parseFloat(frames[0][key]),b=parseFloat(frames[1][key]);
          return a+(b-a)*this.progress;
        },
        finish(){this.playState='finished';resolve();},
        cancel(){this.playState='idle';reject(Error('cancelled'));}};
      n.motion=animation;animations.push(animation);return animation;
    };
    return n;
  }
  const folder=h.folder,tab=h.tab;
  h.folder=(parent)=>attach(folder(parent));
  h.tab=(...args)=>attach(tab(...args));
  h.window.getComputedStyle=n=>({
    overflowY:'auto',height:height(n)+'px',
    opacity:n.motion?.playState==='running'?String(n.motion.sample('opacity')):'1',
    marginTop:n.motion?.playState==='running'?n.motion.sample('marginTop')+'px':'2px',
    marginBottom:n.motion?.playState==='running'?n.motion.sample('marginBottom')+'px':'2px'
  });
  async function finish(animation) {animation.finish();await Promise.resolve();h.flush();}
  return {...h,animations,finish,height};
}

test('expansion animates only entering rows; scheduled refresh does not cancel it',async()=>{
  const h=fixture(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);h.refresh();
  f.collapsed=false;await h.manager.animateExpand(f);
  assert.equal(h.animations.length,1);
  const a=h.animations[0];assert.equal(a.node,sleep);
  assert.equal(a.frames[0].height,'0px');assert.equal(a.frames[1].height,'32px');
  assert.equal(a.frames[0].opacity,0);assert.equal(a.options.duration,180);
  assert(!live.hasAttribute(MOTION));h.flush();assert.equal(a.playState,'running');
  await h.finish(a);assert(!sleep.hasAttribute(MOTION));assert(!sleep.hasAttribute(HIDE));
  assert.equal(h.window.__zenSafeCloseLoadedFolders.status.animatingRows,0);
});

test('collapse shrinks and fades unloaded rows while selected loaded rows remain visible',async()=>{
  const h=fixture(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);live.selected=true;
  f.collapsed=false;h.refresh();f.collapsed=true;await h.manager.animateCollapse(f);
  const a=h.animations[0];assert.equal(a.node,sleep);
  assert.equal(a.frames[0].height,'32px');assert.equal(a.frames[1].height,'0px');
  assert.equal(a.frames[1].marginTop,'0px');assert.equal(a.frames[1].opacity,0);
  assert(sleep.hasAttribute(HIDE));assert(sleep.hasAttribute(MOTION));
  assert(live.visible);assert(!live.hasAttribute(MOTION));assert(live.selected);
  await h.finish(a);assert(!sleep.hasAttribute(MOTION));assert(sleep.hasAttribute(HIDE));
  assert(f.collapsed);assert(live.visible);assert(!live.hasAttribute('pending'));
});

test('rapid reversal starts from current geometry and stale completion cannot erase the new motion',async()=>{
  const h=fixture(),f=h.folder();h.tab(f);const sleep=h.tab(f,true);h.refresh();
  f.collapsed=false;await h.manager.animateExpand(f);
  const first=h.animations[0];first.progress=0.5;
  f.collapsed=true;await h.manager.animateCollapse(f);
  const second=h.animations[1];assert.equal(first.playState,'idle');
  assert.equal(second.frames[0].height,'16px');assert.equal(second.frames[0].opacity,'0.5');
  await Promise.resolve();assert(sleep.hasAttribute(MOTION));assert.equal(second.playState,'running');
  await h.finish(second);assert(!sleep.hasAttribute(MOTION));assert(sleep.hasAttribute(HIDE));
});

test('a folder without loaded rows keeps its container alive only until collapse finishes',async()=>{
  const h=fixture(),f=h.folder(),sleep=h.tab(f,true);f.collapsed=false;h.refresh();
  f.collapsed=true;await h.manager.animateCollapse(f);
  assert(f.groupContainer.hasAttribute(HIDE));assert(f.groupContainer.hasAttribute(MOTION));
  assert.equal(h.animations.length,1);assert(h.height(sleep)>0);
  await h.finish(h.animations[0]);
  assert(!f.groupContainer.hasAttribute(MOTION));assert.equal(h.height(sleep),0);
});

test('nested hidden branches animate once, rather than animating both branch and child',async()=>{
  const h=fixture(),parent=h.folder(),child=h.folder(parent),sleep=h.tab(child,true);
  parent.collapsed=child.collapsed=false;h.refresh();
  parent.collapsed=true;await h.manager.animateCollapse(parent);
  assert.equal(h.animations.length,1);assert.equal(h.animations[0].node,child);
  assert(child.hasAttribute(HIDE));assert(sleep.hasAttribute(HIDE));
  assert(!sleep.hasAttribute(MOTION));await h.finish(h.animations[0]);
  assert(!child.hasAttribute(MOTION));assert(!parent.groupContainer.hasAttribute(MOTION));
});

for(const option of [{reduced:true},{nativeOff:true}]) {
  test('reduced motion and native animation disable use immediate final layout: '+JSON.stringify(option),async()=>{
    const h=fixture(option),f=h.folder();h.tab(f);const sleep=h.tab(f,true);h.refresh();
    f.collapsed=false;await h.manager.animateExpand(f);
    assert.equal(h.animations.length,0);assert(!sleep.hasAttribute(HIDE));
    f.collapsed=true;await h.manager.animateCollapse(f);
    assert.equal(h.animations.length,0);assert(sleep.hasAttribute(HIDE));
  });
}

test('ResizeObserver does not rebuild all folders for every animated height frame',async()=>{
  let sizes;class ResizeObserver{constructor(fn){sizes=this;this.fn=fn;}observe(){}unobserve(){}disconnect(){}}
  const h=fixture({ResizeObserver}),f=h.folder();h.tab(f);h.tab(f,true);h.refresh();
  f.collapsed=false;await h.manager.animateExpand(f);h.flush();
  assert.equal(h.frames.size,0);sizes.fn();assert.equal(h.frames.size,0);
  h.animations[0].finish();await Promise.resolve();assert(h.frames.size>0);h.flush();
});

for(const action of ['disable','uninstall']) {
  test(action+' cancels animations and removes every temporary row/container attribute',async()=>{
    const h=fixture(),f=h.folder(),sleep=h.tab(f,true);f.collapsed=false;h.refresh();
    f.collapsed=true;await h.manager.animateCollapse(f);
    const a=h.animations[0];assert(f.groupContainer.hasAttribute(MOTION));
    if(action==='disable')h.change(false);else h.api.uninstall();
    await Promise.resolve();assert.equal(a.playState,'idle');
    assert(!sleep.hasAttribute(MOTION));assert(!f.groupContainer.hasAttribute(MOTION));
    assert(!h.root.hasAttribute('data-zsc-loaded-folders'));
  });
}

test('moving an animated tab out of the folder cancels its stale effect',async()=>{
  const h=fixture(),f=h.folder(),sleep=h.tab(f,true);f.collapsed=false;h.refresh();
  f.collapsed=true;await h.manager.animateCollapse(f);
  f.direct=[];sleep.group=null;h.refresh();await Promise.resolve();
  assert.equal(h.animations[0].playState,'idle');assert(!sleep.hasAttribute(MOTION));
  assert(!f.groupContainer.hasAttribute(MOTION));
});

test('animation failure restores final layout and leaves no forced-visible container',async()=>{
  const h=fixture(),f=h.folder(),sleep=h.tab(f,true);f.collapsed=false;h.refresh();
  sleep.animate=()=>{throw Error('WAAPI unavailable');};
  f.collapsed=true;await h.manager.animateCollapse(f);
  assert(!sleep.hasAttribute(MOTION));assert(!f.groupContainer.hasAttribute(MOTION));
  assert(sleep.hasAttribute(HIDE));assert.equal(h.errors.length,1);
});

test('independent folders release their temporary containers independently',async()=>{
  const h=fixture(),a=h.folder(),b=h.folder();h.tab(a,true);h.tab(b,true);
  a.collapsed=b.collapsed=false;h.refresh();
  a.collapsed=true;await h.manager.animateCollapse(a);
  b.collapsed=true;await h.manager.animateCollapse(b);
  assert.equal(h.animations.length,2);
  await h.finish(h.animations[0]);
  assert(!a.groupContainer.hasAttribute(MOTION));assert(b.groupContainer.hasAttribute(MOTION));
  await h.finish(h.animations[1]);assert(!b.groupContainer.hasAttribute(MOTION));
});

test('hot reload during a toggle cancels old effects before the new generation owns the rows',async()=>{
  const h=fixture(),f=h.folder(),live=h.tab(f),sleep=h.tab(f,true);
  live.selected=true;f.collapsed=false;h.refresh();
  f.collapsed=true;await h.manager.animateCollapse(f);
  const old=h.animations[0];old.progress=0.4;
  h.api.uninstall();await Promise.resolve();
  h.window.__zenSafeClose={config:{enabled:true,showLoadedInFolders:true},uninstall(){}};
  vm.runInNewContext(code,h.context);h.flushJobs();h.flush();
  assert.equal(old.playState,'idle');assert(!sleep.hasAttribute(MOTION));
  assert(!f.groupContainer.hasAttribute(MOTION));assert(sleep.hasAttribute(HIDE));
  assert(live.visible);assert(live.selected);assert(f.collapsed);
  assert.equal(h.calls.length,0);
  f.collapsed=false;await h.manager.animateExpand(f);
  assert.equal(h.animations.length,2);await h.finish(h.animations[1]);
  assert(!sleep.hasAttribute(MOTION));assert(!sleep.hasAttribute(HIDE));
  assert.equal(h.window.__zenSafeCloseLoadedFolders.status.animatingRows,0);
});

test('temporary animation containers retain column layout even when logically hidden',()=>{
  assert.match(code,/\[\$\{BOX\}\]\[\$\{MOTION\}\] \{ display: flex !important; flex-direction: column;/);
});
