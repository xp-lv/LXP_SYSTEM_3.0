import THREE from './three.js';
import {clamp} from './utils.js';
import {STAGE} from './demo/stage.js';

/* ================= 轨道相机（缓动量 sph/tgt + 目标量 sphGoal/tgtGoal） =================
   世界岛半径 880（三峰一谷），总览距离按岛幅自适应；
   今日小岛悬在同一片天空的另一处，frameToday 只改 tgt/r，不切换场景。 */
export const sph={r:1900,t:.6,p:.92},sphGoal={r:1900,t:.6,p:.92};
export const tgt=new THREE.Vector3(0,150,0),tgtGoal=tgt.clone();
let camHome=null;                                  /* 回中目标由 world 注入（跟随世界岛） */

/* 视图切换：球坐标缓动（不改变视角，只改目标/距离），2.2s 精确到位 */
export const camEase={
  active:false,t0:0,dur:2200,
  fromR:0,fromT:0,fromP:0,fromTgt:new THREE.Vector3(),
  toR:0,toT:0,toP:0,toTgt:new THREE.Vector3()
};
export function cancelCamFly(){camEase.active=false}
export function startCamEase(dur){
  camEase.active=true;
  camEase.t0=performance.now();
  camEase.dur=dur||2200;
  camEase.fromR=sph.r;camEase.fromT=sph.t;camEase.fromP=sph.p;camEase.fromTgt.copy(tgt);
  camEase.toR=sphGoal.r;camEase.toT=sphGoal.t;camEase.toP=sphGoal.p;camEase.toTgt.copy(tgtGoal);
}
export function setCamHome(fn){camHome=fn}
export function resetCam(){
  cancelCamFly();
  sphGoal.r=1900;sphGoal.t=0;sphGoal.p=.85;
  if(camHome)camHome();else tgtGoal.set(0,150,0);
}
export function flyTo(n){cancelCamFly();tgtGoal.copy(n.pos);sphGoal.r=clamp(n.radius*10+170,180,640)}
/* 今日小岛固定机位（与 Esc 回机位共用同一取景） */
let todayCamInit=false;
export function frameToday(){
  /* 今日页 = 世界岛右下方那座石环卫星岛；只改目标/距离，不改当前视角。
     首次进入今日时，初始视角正对心形底部尖尖（local +Z）。 */
  if(!todayCamInit){
    sphGoal.t=0;
    sphGoal.p=.85;
    todayCamInit=true;
  }
  sphGoal.r=500;
  tgtGoal.set(STAGE.tipX,STAGE.tipY,STAGE.tipZ);
  startCamEase(2200);
}
