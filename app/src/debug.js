import THREE from './three.js';
import {scene} from './scene.js';
import {state,data,pickMeshes} from './state.js';
function require_state(){return{state:state}}
import {byTitle} from './data.js';
import {sph,sphGoal,tgtGoal} from './camera.js';
import {getDomains,getTrees,getWorldIsland,getActiveIsland,getActiveTree} from './world.js';
import {addSubtask,addTopBranch,updateTask,removeNode,assignPeriod,unassignPeriod} from './mutations.js';
import {rebuild} from './tree.js';
import {resetCam,flyTo} from './camera.js';
import {updateCard,renderCrumb} from './ui.js';
import {setHoverLock} from './selection.js';
import {enterPlanet,exitPlanet,buildPlanet,snapPlanetCam} from './planet.js';

/* ================= 调试探针（E2）——只读检查口，回归基础设施 ================= */
window.__demo={
  errs:function(){return(window.__errs||[]).slice(0,8)},
  hover:function(t){
    const st=require_state();
    if(t===null){setHoverLock(null);return{ok:true}}
    const n=byTitle(t);if(!n)return{ok:false};
    setHoverLock(n);return{ok:true,title:n.title}},
  cardText:function(){const c=document.getElementById('hoverCard');
    return c?c.textContent.slice(0,120):'missing'},
  world:function(){
    const t=getActiveTree();
    return{view:state.view,mode:state.mode,preset:state.demoPreset,
      root:t?t.title:null,
      domains:getDomains().map(d=>({name:d.name,trees:getTrees().filter(x=>x.domainId===d.id).length})),
      trees:getTrees().length,
      island:{slots:getWorldIsland().treeSlots.length,
        occupied:getWorldIsland().treeSlots.filter(s=>s.treeId!=null).length,
        hasGroup:!!getWorldIsland().group},
      picks:pickMeshes.length}
  },
  step:function(k){for(let i=0;i<(k||30);i++)window.__render()},
  render:function(){window.__render()},
  pose:function(){return{r:Math.round(sph.r),t:+sph.t.toFixed(3),p:+sph.p.toFixed(3),gr:Math.round(sphGoal.r),gp:+sphGoal.p.toFixed(3),tx:+tgtGoal.x.toFixed(0),ty:+tgtGoal.y.toFixed(0),tz:+tgtGoal.z.toFixed(0)}},
  cam:function(r,t,p,x,y,z){
    sphGoal.r=r;sphGoal.t=t;sphGoal.p=p;tgtGoal.set(x||0,y||150,z||0);
    sph.r=r+80;sph.t=t+.3;sph.p=p+.2;return{ok:true}},
  flyIsland:function(){import('./world.js').then(w=>w.flyToActive&&w.flyToActive());return true},
  plant:function(title){
    return import('./world.js').then(w=>w.plantTree(w.getActiveIsland(),title))},
  assign:function(title,level,key){const n=byTitle(title);if(!n)return{ok:false};
    var lv={week:'w',month:'m',day:'d'}[level]||level;
    assignPeriod(n,lv,key);return{ok:true,title:n.title,level:lv,key:key}},
  unassign:function(title,level){const n=byTitle(title);if(!n)return{ok:false};
    unassignPeriod(n,level);return{ok:true}},
  updateTask:function(t,patch){const n=byTitle(t);if(!n||!n.leaf)return{ok:false};
    updateTask(n,patch||{});return{ok:true,title:n.title,progress:n.progress}},
  addSubtask:function(parentTitle,f){const p=byTitle(parentTitle);if(!p)return{ok:false};
    const nd=addSubtask(p,f||{});return{ok:true,id:nd.id,title:nd.title}},
  addTopBranch:function(f){const nd=addTopBranch(f||{});return{ok:true,id:nd.id,title:nd.title}},
  removeNode:function(t){const n=byTitle(t);if(!n||!n.parent)return{ok:false};
    removeNode(n);return{ok:true}},
  planet:function(t){
    if(t==null&&state.mode==='planet'){exitPlanet();return{ok:true,exited:true}}
    const n=byTitle(t);if(!n)return{ok:false};
    if(state.mode==='planet'){exitPlanet();return{ok:true,exited:true}}
    if(n.leaf)return{ok:false,why:'leaf'};
    enterPlanet(n);return{ok:true,root:n.title}},
  scan:function(){
    const bad=[];
    (function walk(o,path){
      for(const c of o.children){
        if(!c||!c.isObject3D){bad.push(path);continue}
        walk(c,path+'>'+(c.type||'?'))}
    })(scene,'scene');
    return{bad:bad.slice(0,5),total:bad.length}}
};
window.__render=function(){import('./loop.js').then(l=>l.frame&&l.frame())};
/* 备份回路探针（W12/H2） */
window.__demo.backup=function(){
  return Promise.all([import('./persistence.js'),import('./world.js')])
    .then(function(m){return m[0].exportJSON(m[1].exportDoc())})};
window.__demo.restoreTest=function(json){
  return Promise.all([import('./persistence.js'),import('./world.js')])
    .then(function(m){var d=m[0].importJSON(json);if(!d)return{ok:false,why:'reject'};
      m[1].importDoc(d);return{ok:true,domains:d.domains.length,trees:d.trees.length}})};
