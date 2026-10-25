import THREE from './three.js';
import {renderer,scene,camera,updateDayLight} from './scene.js';
import {sph,sphGoal,tgt,tgtGoal,camEase} from './camera.js';
import {state,planetNodes} from './state.js';
import {drawMap,treeGroup} from './tree.js';
import {planetGroup,planetLinks} from './planet.js';
import {pickNode} from './interact.js';
import {getIslands} from './world.js';
import {updateCard} from './ui.js';
import {stepEnv} from './demo/env.js';
import {stepValley} from './demo/valley.js';
import {stepFloatingIslands} from './demo/floatingIsland.js';
import {stepGoal} from './demo/goal.js';
import {stepEzTree} from './demo/eztree.js';

/* ================= 主循环（树/星球两态 + 环境 + 岛效果） ================= */
const clock=new THREE.Clock();let frameNo=0;
export function frame(){
  const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;
  if(camEase.active){
    const k=Math.min(1,(performance.now()-camEase.t0)/camEase.dur);
    const e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
    sph.r=camEase.fromR+(camEase.toR-camEase.fromR)*e;
    sph.t=camEase.fromT+(camEase.toT-camEase.fromT)*e;
    sph.p=camEase.fromP+(camEase.toP-camEase.fromP)*e;
    tgt.lerpVectors(camEase.fromTgt,camEase.toTgt,e);
    camera.position.setFromSphericalCoords(sph.r,sph.p,sph.t).add(tgt);
    camera.lookAt(tgt);
    if(k>=1){
      camEase.active=false;
      sph.r=sphGoal.r;sph.t=sphGoal.t;sph.p=sphGoal.p;
      tgt.copy(tgtGoal);
    }
  }else{
    sph.r+=(sphGoal.r-sph.r)*.12;sph.t+=(sphGoal.t-sph.t)*.14;sph.p+=(sphGoal.p-sph.p)*.14;
    tgt.lerp(tgtGoal,.12);
    camera.position.setFromSphericalCoords(sph.r,sph.p,sph.t).add(tgt);
    camera.lookAt(tgt);
  }
  camera.updateMatrixWorld();
  if(frameNo%90===0)updateDayLight();
  stepEnv(dt);                                  /* demo 环境：预设缓动/风/云/光尘 */
  stepValley(dt);                               /* 旧岛体时钟（demo 预览/回退用） */
  stepFloatingIslands(t);                       /* 浮空岛：草/水/泉/瀑布/鸟动画 */
  stepGoal(dt,t);
  stepEzTree(t);                                 /* ez-tree：断梢红光呼吸（同节奏） */                               /* demo 树：补间/红光脉冲 */
  stepGoal(dt,t);                                 /* ez-tree：断梢红光呼吸（同节奏） */
  if(state.mode==='tree'){
    const n=state.hoverLock||pickNode();
    if(n!==state.hovered){state.hovered=n;renderer.domElement.style.cursor=n?'pointer':'grab'}
    if(frameNo%3===0)drawMap();
  }else{
    /* 星球模式：展开动画 + 轨道公转 + 标签贴球 + 连线呼吸 + 悬停 */
    state.planetT=Math.min(1,state.planetT+dt*1.3);
    const e=1-Math.pow(1-state.planetT,3);
    planetGroup.scale.setScalar(.04+.96*e);
    CUP.setFromMatrixColumn(camera.matrixWorld,1);
    for(const p of planetNodes){
      if(!p.center){
        p.angle+=p.speed*dt;
        const oc=p.oc||p.pp;              // 轨道中心（二级/三级都绕中心球）
        const sway=p.isMoon?Math.sin(t*.45+p.phase)*.06:0;
        const Rw=p.R+Math.sin(t*.3+p.phase*1.7)*(p.isMoon?14:4);
        const ang=p.angle+sway;
        p.mesh.position.set(
          oc.mesh.position.x+Math.cos(ang)*Rw,
          oc.mesh.position.y+Math.sin(t*.9+p.phase)*(p.isMoon?3.4:2.2),
          oc.mesh.position.z+Math.sin(ang)*Rw);
        p.glow.position.copy(p.mesh.position);
        p.ring.position.copy(p.mesh.position);
      }
      const off=p.r*1.15+p.lb.scale.y*0.65;   // 球半径×1.15 + 半标签高+呼吸余量（局部单位）
      p.lb.position.set(
        p.mesh.position.x+CUP.x*off,
        p.mesh.position.y+CUP.y*off,
        p.mesh.position.z+CUP.z*off);
      if(p.pop){                              // 新球弹性生长（easeOutBack 轻微过冲）
        const age=performance.now()/1000-p.pop.t0,x=Math.min(1,age/0.4);
        const c1=1.70158,c3=c1+1;
        const e2=1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);
        const b=p.pop.base||(p.pop.base={glow:p.glow.scale.x,ring:p.ring.scale.x,lw:p.lb.scale.x,lh:p.lb.scale.y});
        p.mesh.scale.setScalar(e2);
        p.glow.scale.set(b.glow*e2,b.glow*e2,1);
        p.ring.scale.set(b.ring*e2,b.ring*e2,1);
        p.lb.scale.set(b.lw*e2,b.lh*e2,1);
        if(x>=1){p.mesh.scale.setScalar(1);
          p.glow.scale.set(b.glow,b.glow,1);p.ring.scale.set(b.ring,b.ring,1);
          p.lb.scale.set(b.lw,b.lh,1);p.pop=null}
      }
    }
    const n=state.hoverLock||pickNode();
    if(n!==state.hovered){state.hovered=n;renderer.domElement.style.cursor=n?'pointer':'grab'}
    /* 弧形连线：贝塞尔弓形 + 悬停组缓动点亮 */
    const LINK_SEG=12;
    for(const g of planetLinks){
      const pos=g.line.geometry.attributes.position;
      const P=g.pp.mesh.position;
      let vi=0;
      for(const m of g.moons){
        const M=m.mesh.position;
        const mx=(P.x+M.x)/2,mz=(P.z+M.z)/2,ml=Math.hypot(mx,mz)||1;
        const d=Math.hypot(M.x-P.x,M.z-P.z);
        const bow=d*0.3;
        const cx=mx-mz/ml*bow, cz=mz+mx/ml*bow;
        const cy=(P.y+M.y)/2+Math.min(6,d*0.06);
        let px,py,pz;
        for(let i=0;i<=LINK_SEG;i++){
          const tt=i/LINK_SEG,u=1-tt;
          const bx=u*u*P.x+2*u*tt*cx+tt*tt*M.x;
          const by=u*u*P.y+2*u*tt*cy+tt*tt*M.y;
          const bz=u*u*P.z+2*u*tt*cz+tt*tt*M.z;
          if(i>0){pos.setXYZ(vi++,px,py,pz);pos.setXYZ(vi++,bx,by,bz)}
          px=bx;py=by;pz=bz;
        }
      }
      pos.needsUpdate=true;
      const tgt2=(n&&g.nodes.has(n))?.95:.3;
      g.mat.opacity+=(tgt2-g.mat.opacity)*.12;
    }
    planetLabelDeclutter();
  }
  updateIslandFx(t,dt);
  updateCard();
  frameNo++;
  renderer.render(scene,camera)}

/* 岛效果：无光环/字碑（单岛版），保留 nameSign 空防护 */
function updateIslandFx(t,dt){
  for(const isle of getIslands()){
    if(!isle.group)continue;
  }
}

export function animate(){requestAnimationFrame(animate);
  if(state.renderPaused)return;               // 视图隐藏时挂起重渲染
  try{frame()}catch(e){                                  // 防黑屏：单帧异常不终止循环
    if(!window.__frameErr){window.__frameErr=e.message;
      document.body.insertAdjacentHTML('beforeend',
        '<pre style="color:#f88;padding:30px;white-space:pre-wrap">'+(e.stack||e)+'</pre>');}
    throw e}}

/* ================= 星球标签互斥（屏幕空间贪心放置） ================= */
const TMPV=new THREE.Vector3();
const CUP=new THREE.Vector3();   // 相机 up（世界系），标签避让方向
function planetLabelDeclutter(){
  const gs=planetGroup.scale.x;
  const px2=(innerHeight/2)/Math.tan(camera.fov*Math.PI/360);
  const items=[];
  for(const p of planetNodes){
    p.lb.getWorldPosition(TMPV);
    const v=TMPV.project(camera);
    const dist=camera.position.distanceTo(TMPV);
    const k=px2/dist;
    const w=p.lb.scale.x*gs*k,h=p.lb.scale.y*gs*k;
    const sx=(v.x*.5+.5)*innerWidth, sy=(-v.y*.5+.5)*innerHeight;
    if(v.z>1||sx<-w||sx>innerWidth+w||sy<-h||sy>innerHeight+h){p.lb.visible=false;continue}
    const pri=(state.hovered===p.node||state.hoverLock===p.node)?0:p.center?1:p.isMoon?3:2;
    items.push({p,sx,sy,w,h,pri,dist});
  }
  items.sort(function(a,b){return a.pri-b.pri||a.dist-b.dist});
  const placed=[];
  for(const it of items){
    const r={x:it.sx-it.w/2,y:it.sy-it.h/2,w:it.w,h:it.h};
    const hit=placed.find(function(q){
      return r.x<q.x+q.w+6&&r.x+r.w+6>q.x&&r.y<q.y+q.h+4&&r.y+r.h+4>q.y});
    if(hit&&it.pri>0){it.p.lb.visible=false;continue}   // 悬停/中心标签不避让
    placed.push(r);
    it.p.lb.visible=true;
  }
}
