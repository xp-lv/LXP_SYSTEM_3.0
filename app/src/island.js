import THREE from './three.js';
import {scene} from './scene.js';
import {buildFloatingIslandBody} from './demo/floatingIsland.js';
import {setClouds} from './demo/env.js';

/* ================= 岛体建造（island.js）——单岛无标志 =================
   唯一一座世界岛：demo「三峰一谷」地形管线（地形 / 溪流 / 岛缘跌水）。
   固定六坑布局（01.3 v2）：中心 1 + 五边形 5，坑位硬编码于 slots.js。 */

export const WORLD_ISLAND_R=880;                 /* 与 demo 同尺：三峰一谷的基准半径 */

export function buildIslandMesh(island){
  disposeIslandMesh(island);

  const scale=WORLD_ISLAND_R/21.5;
  const flattenLocal=island.treeSlots.map(function(s){
    return {x:s.x/scale,z:s.z/scale,r:90/scale};
  });
  const body=buildFloatingIslandBody({
    R0:WORLD_ISLAND_R,
    flattenLocal:flattenLocal,
    includeMini:true,
    includeClouds:true,
    includeBirds:true
  });
  setClouds(body.clouds);
  island._dH=body.heightAt;
  island._body=body;
  island._R=WORLD_ISLAND_R;
  const g=new THREE.Group();
  g.add(body.inner);
  island.boundingBox={cx:0,cz:0,minX:-WORLD_ISLAND_R,maxX:WORLD_ISLAND_R,
    minZ:-WORLD_ISLAND_R,maxZ:WORLD_ISLAND_R};
  island.group=g;
  scene.add(g);
  return g;
}

export function disposeIslandMesh(island){
  if(!island||!island.group)return;
  if(island._body&&island._body.dispose)island._body.dispose();
  else island.group.traverse(function(o){
    if(o.geometry)o.geometry.dispose();
    if(o.material)o.material.dispose()});
  try{setClouds([])}catch(e){}
  scene.remove(island.group);
  island.group=null;
  island._body=null;
  island._dH=null;
}

/* 树的世界坐标：单岛无偏移；Y=新地形实算（坑位落点） */
export function getTreeWorldPos(island,slot){
  const y=island._dH?island._dH(slot.x,slot.z):(slot.h||10);
  return{x:slot.x,y:y,z:slot.z};
}
