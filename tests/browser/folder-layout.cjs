// Real Firefox layout checks for the shipped folder module; this is not Zen chrome.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {firefox}=require(path.join(process.env.ZSC_BROWSER_DEPS,'node_modules/playwright'));
const source=fs.readFileSync(process.env.ZSC_FOLDER_SOURCE||path.join(__dirname,'../../zen-safe-close.uc.js'),'utf8').replace(/\r\n/g,'\n');
const begin=source.lastIndexOf('(() => {',source.indexOf('const FLAG = "data-zsc-loaded-folders"'));
const code=source.slice(begin,source.indexOf('\n(() => {',begin+1));
const oldCode=code.replace("    [${FLAG}] [${BOX}]:not([${HIDE}]),\n    [${FLAG}] [${BOX}][${MOTION}] { display: flex !important; flex-direction: column; }","    [${FLAG}] [${BOX}]:not([${HIDE}]) { display: flex !important; flex-direction: column; }");
assert.notEqual(oldCode,code,'baseline must restore the pre-fix container rule');
const browser=awaitLaunch();
async function awaitLaunch(){
 const browser=await firefox.launch({headless:true});
 try{
  for(const {loaded,legacy,script} of [
   {loaded:0,legacy:true,script:oldCode},
   ...[0,1,2].map(loaded=>({loaded,legacy:false,script:code}))
  ]){
   const page=await browser.newPage({viewport:{width:600,height:900},reducedMotion:'no-preference'});
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.setContent(`<style>
    body{margin:0;padding:20px}#tabbrowser-tabs{width:280px}
    zen-folder{display:flex;flex-direction:column}
    .tab-group-label-container{height:32px;min-height:32px}
    .tab-group-container{display:block}
    .tabbrowser-tab{box-sizing:border-box;display:flex;height:32px;min-height:32px;min-width:0;margin:2px 0}
    .tab-stack{display:flex;align-items:center;overflow:hidden;background:#ddd;flex:1}
    .tab-group-start{height:0;min-height:0;margin:0}
   </style><div id="tabbrowser-tabs"></div>`);
   await page.evaluate(({code,loaded})=>{
    const container=document.querySelector('#tabbrowser-tabs');
    const folder=document.createElement('zen-folder');
    folder.innerHTML='<div class="tab-group-label-container"><span>Folder</span></div><div class="tab-group-container"><div class="tab-group-start"></div></div>';
    container.append(folder);
    folder.group=null;folder.collapsed=false;folder.activeTabs=[];
    folder.groupContainer=folder.querySelector('.tab-group-container');
    folder.groupStartElement=folder.querySelector('.tab-group-start');
    folder.labelElement=folder.querySelector('span');
    const rows=[];
    for(let i=0;i<loaded+6;i++){
     const row=document.createElement('div');row.className='tabbrowser-tab';
     row.innerHTML='<div class="tab-stack"><span>Tab '+i+'</span></div>';row.group=folder;
     if(i>=loaded)row.setAttribute('pending','true');
     row.selected=i===0&&loaded>0;folder.groupContainer.append(row);rows.push(row);
    }
    Object.defineProperty(folder,'tabs',{get:()=>rows});
    window.gBrowser={tabContainer:container};
    window.gZenFolders={updateFolderIcon(){}};
    for(const name of ['animateCollapse','animateExpand','animateSelect','animateUnload','animateUnloadAll']){
     window.gZenFolders[name]=async()=>false;
    }
    window.__zenSafeClose={config:{enabled:true,showLoadedInFolders:true},uninstall(){}};
    window.Components={utils:{reportError:e=>{throw Error(String(e));}}};
    (0,eval)(code);
    window.fixture={folder,rows};
    window.measureRows=()=>{
     const {folder,rows}=window.fixture;
     return {direction:getComputedStyle(folder.groupContainer).flexDirection,
      containerHeight:folder.groupContainer.getBoundingClientRect().height,
      hidden:folder.groupContainer.hasAttribute('data-zsc-folder-hidden'),
      rows:rows.map(row=>{const rect=row.getBoundingClientRect();return {
       left:rect.left,top:rect.top,width:rect.width,height:rect.height,
       hidden:row.hasAttribute('data-zsc-folder-hidden'),
       motion:row.hasAttribute('data-zsc-folder-motion'),pending:row.hasAttribute('pending')
      };}),
      active:window.__zenSafeCloseLoadedFolders.status.animatingRows};
    };
    window.sample=async(collapsed)=>{
     folder.collapsed=collapsed;
     await window.gZenFolders[collapsed?'animateCollapse':'animateExpand'](folder);
     for(const row of rows)for(const animation of row.getAnimations()){
      animation.pause();animation.currentTime=90;
     }
     return window.measureRows();
    };
    window.settle=async()=>{
     for(const row of rows)for(const animation of row.getAnimations())animation.finish();
     for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);
     return window.measureRows();
    };
   },{code:script,loaded});
   function vertical(sample,label){
    assert.equal(sample.direction,'column',label+' must retain column layout');
    assert(sample.rows.every(row=>row.width>250),label+' rows must retain sidebar width');
    for(let i=1;i<sample.rows.length;i++){
     assert(Math.abs(sample.rows[i].left-sample.rows[0].left)<1,label+' rows must align');
     assert(sample.rows[i].top>sample.rows[i-1].top,label+' rows must stack vertically');
    }
   }
   for(let cycle=0;cycle<4;cycle++){
    const collapsing=await page.evaluate(()=>window.sample(true));
    if(legacy){
     assert.equal(collapsing.direction,'row','pre-fix rule must reproduce horizontal layout');
     assert(collapsing.rows.every(row=>row.width<200),'pre-fix rows must squeeze side by side');
     assert(collapsing.rows.every(row=>Math.abs(row.top-collapsing.rows[0].top)<1));
     break;
    }
    vertical(collapsing,'collapse loaded='+loaded+' cycle='+cycle);
    if(loaded===0)assert(collapsing.hidden,'all-sleeping container needs temporary motion layout');
    const expandedMid=await page.evaluate(()=>window.sample(false));
    vertical(expandedMid,'reversal loaded='+loaded+' cycle='+cycle);
    const expanded=await page.evaluate(()=>window.settle());
    assert.equal(expanded.active,0);assert(!expanded.hidden);
    assert(expanded.rows.every(row=>!row.hidden&&!row.motion&&row.height>=31));
    assert.equal(expanded.rows.filter(row=>row.pending).length,6);
    await page.evaluate(()=>window.sample(true));
    const collapsed=await page.evaluate(()=>window.settle());
    assert.equal(collapsed.active,0);
    assert.equal(collapsed.rows.filter(row=>!row.hidden&&row.height>0).length,loaded);
    await page.evaluate(()=>window.sample(false));
    const reopened=await page.evaluate(()=>window.settle());
    assert(reopened.rows.every(row=>!row.hidden&&!row.motion&&row.height>=31));
   }
   assert.deepEqual(errors,[]);
   console.log(legacy?'PASS reproduced pre-fix horizontal squeeze in real Firefox':
    'PASS real Firefox: '+loaded+' loaded + 6 sleeping rows, collapse/reverse/reopen');
   await page.close();
  }
 }finally{await browser.close();}
}
browser.catch(error=>{console.error(error);process.exitCode=1;});
