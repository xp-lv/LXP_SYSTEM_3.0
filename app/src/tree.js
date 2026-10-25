import THREE from './three.js';
import {scene} from './scene.js';
import {state,data,pickMeshes} from './state.js';
import {clamp} from './utils.js';
import {renderCrumb} from './ui.js';
import {sph,tgt} from './camera.js';
import {getTrees,getWorldIsland,treeColorOf} from './world.js';
import {slotOf,crownScaleOf} from './slots.js';
import {weekTreeMounted} from './today.js';
import {appCfg,buildGoalTree,initGoalMats,clearBeacons} from './demo/goal.js';
import {buildEzTreeApp,onBarkReady,clearEzBeacons} from './demo/eztree.js';

/* ez-tree@lxp 管线开关（true=新管线；false 回退 goal.js 放样管线） */
const USE_EZTREE=true;
import {refreshTreePanels} from './demo/panels.js';

export const treeGroup=new THREE.Group();scene.add(treeGroup);
var treeReg=[];
function buildDemoTreeInto(t,active){
  const island=getWorldIsland();
  if(!island)return;
  const slot=slotOf(island,t);
  if(!slot)return;
  const px=slot.x, pz=slot.z;
  const gy=island._dH?island._dH(slot.x,slot.z):(slot.h||10);
  const H=Math.round(clamp((island.boundingBox?island.boundingBox.maxX:420)*0.50,140,700));
  const seed=(((t.id||1)*2654435761+getTrees().indexOf(t)*97+11)>>>0)%1000000;
  let tree;
  if(USE_EZTREE){
    tree=buildEzTreeApp(t,seed,H,{x:px,y:gy,z:pz},{
      perBranch:active,
      distant:!active,
      treeRoot:t,
      onMesh:function(m){
        pickMeshes.push(m);
        m.userData.pick={kind:'node',node:m.userData.node,distant:!active};
      }
    });
  }else{
    initGoalMats();
    const cfg=appCfg(t,seed,H);
    tree=buildGoalTree(cfg,{x:px,y:gy,z:pz},{
      perBranch:active, distant:!active, treeRoot:t,
      onMesh:function(m){
        pickMeshes.push(m);
        m.userData.pick={kind:'node',node:m.userData.node,distant:!active};
      }});
  }
  treeGroup.add(tree.grp);
  const reg={x:px,z:pz,color:treeColorOf(t),active:active,beacons:[]};
  (tree._beacons||[]).forEach(function(b){
    reg.beacons.push({x:b.core.position.x,z:b.core.position.z})});
  treeReg.push(reg);
  return tree}
export function treeHeightOf(){
  const isl=getWorldIsland();
  const R=isl&&isl.boundingBox?isl.boundingBox.maxX:420;
  return clamp(R*0.50,140,700);}
function buildAllTrees(){
  if(weekTreeMounted()){
    if(data.root&&getTrees().indexOf(data.root)<0)buildVirtualTree(data.root);
    return;}
  initGoalMats();
  getTrees().forEach(function(t){
    if(t===data.root)return;
    buildDemoTreeInto(t,false)});
  if(data.root&&getTrees().indexOf(data.root)>=0)
    buildDemoTreeInto(data.root,true);}
function buildVirtualTree(vr){
  if(!vr.children||!vr.children.length)return;   /* 整周无排程：不建树（空根会渲染成断梢红桩） */
  const H=170;
  const seed=(((vr.id||1)*2654435761)>>>0)%1000000;
  const base={x:vr._gx||0,y:vr._groundY||20,z:vr._gz||0};
  let tree;
  if(USE_EZTREE){
    tree=buildEzTreeApp(vr,seed,H,base,{
      perBranch:true,treeRoot:vr,
      onMesh:function(m){
        pickMeshes.push(m);
        m.userData.pick={kind:'node',node:m.userData.node,distant:false};
      }});
  }else{
    initGoalMats();
    const cfg=appCfg(vr,seed,H);
    tree=buildGoalTree(cfg,base,{
      perBranch:true,treeRoot:vr,
      onMesh:function(m){
        pickMeshes.push(m);
        m.userData.pick={kind:'node',node:m.userData.node,distant:false};
      }});
  }
  treeGroup.add(tree.grp);
}
export function disposeTree(){
  treeGroup.traverse(function(o){
    if(o.geometry)o.geometry.dispose();
    if(o.material&&!o.material.userData.shared){if(o.material.map)o.material.map.dispose();o.material.dispose()}});
  treeGroup.clear();
  pickMeshes.length=0;
  treeReg.length=0;
  clearBeacons();}
export function rebuild(){
  disposeTree();
  buildAllTrees();
  renderCrumb();
  refreshTreePanels();}
const mm=document.getElementById('minimap'),mg=mm.getContext('2d');
export function drawMap(){
  mg.clearRect(0,0,170,170);
  const s=(78)/640,cx=85,cy=88;
  mg.strokeStyle='rgba(140,170,255,.12)';mg.beginPath();mg.arc(cx,cy,52,0,7);mg.stroke();
  for(const reg of treeReg){
    const x=cx+reg.x*s,y=cy+reg.z*s;
    if(Math.hypot(x-cx,y-cy)>66)continue;
    mg.fillStyle=reg.color;mg.globalAlpha=reg.active?1:.55;
    mg.beginPath();mg.arc(x,y,reg.active?5:3.6,0,7);mg.fill();
    mg.globalAlpha=1;
    mg.fillStyle='#FF4433';
    for(const b of reg.beacons){
      mg.beginPath();mg.arc(cx+b.x*s,cy+b.z*s,1.8,0,7);mg.fill()}}
  mg.strokeStyle='rgba(255,255,255,.5)';mg.lineWidth=1.2;
  mg.beginPath();mg.arc(cx+tgt.x*s,cy+tgt.z*s,clamp(sph.r*.09,7,26),0,7);mg.stroke()}
