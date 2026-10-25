/* ================= 树坑（slots.js）——固定六坑布局 =================
   中心 1 棵 + 外围正五边形 5 棵，共 6 棵（上限）。
   墓碑制：坑与树按 treeId 关联；删树只置空、活树永不移动（R37）。 */
import {mulberry32,clamp} from './utils.js';

export const ISLAND_SEED=20260924;
export const CROWN_R=340;
export const TREE_CAP=6;                        /* 中心 1 + 五边形 5 */

/* 固定坑位：硬编码坐标（01.3 v2：简化布局） */
const CENTER_R=0;
const PENTAGON_R=430;
const PENTAGON_ANGLES=[
  -Math.PI/2,                                    /* 正北 */
  -Math.PI/2+Math.PI*2/5,                        /* 72° 递增 */
  -Math.PI/2+Math.PI*4/5,
  -Math.PI/2+Math.PI*6/5,
  -Math.PI/2+Math.PI*8/5,
];
export const FIXED_SLOTS=[
  {x:0,z:0,h:52,r:200},                          /* 中心：最高最大的坑 */
  ...PENTAGON_ANGLES.map(a=>({
    x:Math.cos(a)*PENTAGON_R,
    z:Math.sin(a)*PENTAGON_R,
    h:38,r:170
  }))
];

export function crownScaleOf(n){
  const k=Math.max(1,n|0);
  return clamp(1.15/Math.sqrt(k),.5,1);
}
export function crownRadiusOf(n){return CROWN_R*crownScaleOf(n)}

export function islandRadiusOf(island){
  const slots=island.treeSlots.filter(s=>s.treeId!=null);
  const n=Math.max(1,island.trees.length);
  if(!slots.length)return crownRadiusOf(n)*1.05;
  const cx=slots.reduce((s,q)=>s+q.x,0)/slots.length;
  const cz=slots.reduce((s,q)=>s+q.z,0)/slots.length;
  let maxD=0;
  slots.forEach(s=>{maxD=Math.max(maxD,Math.hypot(s.x-cx,s.z-cz))});
  return maxD+crownRadiusOf(n)*1.05;
}

/* 分配树坑（墓碑制）：优先复用空坑；固定 6 坑用完返回 null */
export function allocateTreeSlot(island){
  const empty=island.treeSlots.find(t=>t.treeId==null);
  if(empty)return empty;
  if(island.treeSlots.length>=TREE_CAP)return null;
  const idx=island.treeSlots.length;
  const rc=mulberry32(ISLAND_SEED+idx*77);
  const fixed=FIXED_SLOTS[idx]||FIXED_SLOTS[FIXED_SLOTS.length-1];
  const slot={x:fixed.x,z:fixed.z,h:fixed.h,r:fixed.r,treeId:null};
  island.treeSlots.push(slot);
  return slot;
}
export function slotOf(island,tree){
  return island.treeSlots.find(t=>t.treeId===tree.id)||null;
}
export function releaseTreeSlot(island,tree){
  const s=slotOf(island,tree);
  if(s)s.treeId=null;
}
