import './debug.js';                           // 调试探针（副作用模块）
import {state,data} from './state.js';
import {fixAspect,renderer} from './scene.js';
import {resetCam} from './camera.js';
import {animate} from './loop.js';
import {initWorld,onTreeChanged,autoArchive,exportDoc,getTrees} from './world.js';
import {rebuild} from './tree.js';
import {onRender,setWorldRef} from './mutations.js';
import * as worldMod from './world.js';
import {setSelected} from './planner.js';
import {renderWeek} from './weekview.js';
import {initViews} from './views.js';
import {store} from './store.js';
import * as persist from './persistence.js';
import {initDemoPanels} from './demo/panels.js';
import {initTodayStage} from './today.js';
import {setIdSalt} from './data.js';

/* ================= 启动装配（main.js） ================= */
/* 云端同步 v2：拉取 + 推送（乐观锁）+ 定期拉取（多设备同步） */
let _pushOnChange = null;

import('./sync.js')
  .then(function(sync) {
    return sync.pullOnBoot().then(function(r) {
      if (r && r.hasCloud) {
        console.log('[sync] 云端数据已' + (r.replaced ? '覆盖本地' : '保留（本地更新）'));
      }
      _pushOnChange = sync.pushOnChange;
      sync.startPeriodicPull();       /* 每 5 秒检查其他设备的更新 */
    });
  })
  .catch(function(e) {
    console.warn('[sync] 不可用（离线模式）：', e.message);
  })
  .finally(function() {
    boot();
  });

function boot(){
try{
  /* 多端同步：为本次会话分配独立 id 段（避免各端从同一存档续号撞 id，
     新任务的 id 因此远大于历史 id；seedIds 按段回播，不影响既有数据） */
  setIdSalt(1+Math.floor(Math.random()*65535));
  fixAspect();
  (function retryFix(k){
    setTimeout(function(){
      const ok=innerWidth>0&&innerHeight>0&&renderer.domElement.width>1;
      fixAspect();
      if(!ok&&k<12)retryFix(k+1);
    },Math.min(4000,60*Math.pow(1.6,k)));
  })(0);
  setWorldRef(function(){return worldMod});
  onRender(rebuild);                            // 变更链渲染回调（07.3：不直连渲染模块）
  initWorld();                                  // 单岛世界 + 领域数据 + 初始激活（内含 rebuild）
  initTodayStage();                             // 今日小岛：常驻同一片天空（世界视角也可见）
  onTreeChanged(function(){                     // 切树/种植/删树 → 清选中态并重渲染当前视图
    try{setSelected(null)}catch(e){}
    if(state.view==='plan')renderPlan();
    else if(state.view==='week')renderWeek();
  });
  resetCam();
  initViews();                                  // 视图路由（世界/宏观/周/今日）
  initDemoPanels();                             // 信息面板：选择框/大纲/时段
  store.on('data',function(){                   // 变更 → 自动归档 → 自动存档（A6）
    try{autoArchive()}catch(e){}
    persist.writeDoc(exportDoc());
    if(_pushOnChange)_pushOnChange(exportDoc);  // 云端同步（防抖 2s；离线时跳过）
  });
  /* 全局逾期扫描：启动 + 凌晨 5 点跨天都跑（R16/R21/R32） */
  function scanOverdue(forceRefresh){
    Promise.all([import('./queries.js'),import('./calendar.js'),import('./mutations.js')])
      .then(function(m){
        var q=m[0],cal=m[1],mut=m[2];
        var pend=q.pendingOverdue(getTrees(),cal.today().d);
        if(pend.length>0){
          console.log('[scan] 全局扫描：',pend.length,'项逾期');
          mut.bulkOverdue(pend);
        }else if(forceRefresh){
          mut.refresh();                         /* 日期变化：重算展示层逾期/聚合 */
        }
      })
      .catch(function(e){console.warn('[scan]',e.message)});
  }
  scanOverdue(false);
  animate();
  var _lastDay=(function(){var s=new Date();s.setHours(s.getHours()-5);return s.getDate()})(); /* R21/R32：凌晨5点分界 */            // 跨天重派生（A5）
  setInterval(function(){
    var s2=new Date();s2.setHours(s2.getHours()-5);var d=s2.getDate(); /* R21/R32：凌晨5点分界 */
    if(d!==_lastDay){
      _lastDay=d;
      console.log('[auto] 日期变化 → 重新扫描逾期');
      scanOverdue(true);
    }
  },60000);
  /* 备份：导出=下载存档 JSON；导入=校验后整体应用（H2/W12）
     （修复：备份钮原先错绑成导入的文件选择，且导入钮从未绑定） */
  var bk=document.getElementById('btnBackup'),
      bi=document.getElementById('btnImport'),
      bkf=document.getElementById('bkFile');
  if(bk)bk.onclick=function(){
    try{
      var blob=new Blob([persist.exportJSON(worldMod.exportDoc())],{type:'application/json'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      var d=new Date(),p2=function(n){return(n<10?'0':'')+n};
      a.download='lxp-backup-'+d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+'.json';
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},800);
    }catch(e){alert('备份导出失败：'+e.message)}
  };
  if(bi)bi.onclick=function(){bkf&&bkf.click()};
  if(bkf)bkf.onchange=function(){
    var f=bkf.files[0];if(!f)return;
    var rd=new FileReader();
    rd.onload=function(){
      import('./world.js').then(function(w){
        var doc=persist.importJSON(rd.result);
        if(!doc){alert('备份文件校验失败（非本系统存档）');return}
        w.importDoc(doc);
        try{persist.writeDoc(w.exportDoc())}catch(e){}
        alert('备份已导入');
      });
    };
    rd.readAsText(f);
    bkf.value='';
  };
  window.__BOOT_OK=true;
}catch(err){
  document.body.insertAdjacentHTML('beforeend',
    '<pre style="color:#f88;padding:30px;white-space:pre-wrap">'+(err.stack||err)+'</pre>');}
} /* end boot() */
