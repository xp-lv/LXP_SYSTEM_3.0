import THREE from './three.js';
import {renderer,camera,fixAspect} from './scene.js';
import {state,pickMeshes,planetPick} from './state.js';
import {clamp} from './utils.js';
import {sph,sphGoal,tgtGoal,cancelCamFly} from './camera.js';
import {enterPlanet,exitPlanet,buildPlanet,snapPlanetCam} from './planet.js';
import {activateTreeByRef,getTrees} from './world.js';
import {setFocus,setHoverLock,escStep,clearAll} from './selection.js';

/* ================= 交互模块（08）——输入接听 + 拾取路由注册表 =================
   机制 D：一切可拾取物带 userData.pick={kind,...}；本表是 08.3 路由表的代码形态。
   机制 F：focus/selected/hoverLock 只经 selection.js 写（自动同步面包屑/卡片）。 */

const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(-2,-2);
export function pickHit(){
  ray.setFromCamera(mouse,camera);
  const pool=state.mode==='planet'?planetPick:pickMeshes;
  const hit=ray.intersectObjects(pool,false)[0];
  return hit?hit.object:null;
}
export function pickNode(){
  const o=pickHit();
  if(!o)return null;
  if(o.userData.pick)return o.userData.pick.node||null;
  return o.userData.node||null;
}

/* —— 路由注册表（08.3 的代码形态）：世界 4 条 + 星球 3 条 = 7 条，全部经 pick.kind 分发 —— */
var ROUTES={
  node:function(n){                              // 世界：点树=激活；今日：果不打勾（R28——完成/撤回唯一入口=清单点环）
    if(state.view==='today')return;
    if(getTrees().indexOf(n)>=0)activateTreeByRef(n);   // W4
  },
  fallen:function(n){                            // 落果 → 补点选择器（T5）
    import('./today.js').then(function(t){t.openFallenMkp(n)});
  },
  pile:function(){                               // 落叶堆 → 历史欠账
    import('./today.js').then(function(t){t.openBacklogPanel()});
  },
  'planet-center':function(n){                   // 星球：中心球 → 返回上级 / 到顶退出（P3）
    const up=n.parent;
    if(up&&!up.leaf){buildPlanet(up);state.planetT=0;snapPlanetCam(up,state.planetViewR);setHoverLock(null)}
    else exitPlanet();
  },
  'planet-child':function(n){                    // 星球：行星 → 下钻（P2）
    buildPlanet(n);state.planetT=0;snapPlanetCam(n,state.planetViewR);setHoverLock(null);
  },
  'planet-leaf':function(n){                     // 星球：叶球 → 悬停锁定
    setHoverLock(n);
  }
};

const cv=renderer.domElement;
let drag=null,downInfo=null;
cv.addEventListener('contextmenu',function(e){e.preventDefault()});
cv.addEventListener('pointerdown',function(e){cancelCamFly();downInfo={x:e.clientX,y:e.clientY,b:e.button};
  drag={x:e.clientX,y:e.clientY,mode:(e.button===2||e.button===1||e.shiftKey)?'pan':'rot'}});
addEventListener('pointerup',function(e){
  if(downInfo){
    const clicked=Math.hypot(e.clientX-downInfo.x,e.clientY-downInfo.y)<5;
    mouse.x=(e.clientX/innerWidth)*2-1;mouse.y=-(e.clientY/innerHeight)*2+1;
    const hit=pickHit(),pick=hit&&hit.userData.pick;
    if(e.button===2&&clicked){                          // 右键：星球进出（W6 仅树根）/ 叶子锁定
      if(state.mode==='planet'){exitPlanet();downInfo=null;drag=null;return}
      const n=pickNode();
      if(state.view!=='today'&&n&&getTrees().indexOf(n)>=0&&n.children&&n.children.length)enterPlanet(n);
      else if(n&&n.leaf)setHoverLock(n);
    }else if(e.button===0&&clicked){
      if(pick&&ROUTES[pick.kind])ROUTES[pick.kind](pick.node);
      else if(state.mode==='planet'){setHoverLock(null)}   /* 星球空白处点击=取消锁定 */
    }
  }
  downInfo=null;drag=null});
addEventListener('pointermove',function(e){
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
    if(drag.mode==='rot'){sphGoal.t-=dx*.0045;sphGoal.p=clamp(sphGoal.p-dy*.0045,.15,1.5)}
    else{const k=sph.r*.0011,right=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0),
      up=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);
      tgtGoal.addScaledVector(right,-dx*k).addScaledVector(up,dy*k)}}
  mouse.x=(e.clientX/innerWidth)*2-1;mouse.y=-(e.clientY/innerHeight)*2+1});
addEventListener('wheel',function(e){if(e.target!==cv)return;e.preventDefault();cancelCamFly();
  sphGoal.r=clamp(sphGoal.r*(1+e.deltaY*.001),150,3600)},{passive:false});

/* 双击聚焦（W5）：子树包围盒（pos 已全树回写，远景树可用） */
cv.addEventListener('dblclick',function(){
  cancelCamFly();
  const n=pickNode();
  if(!n||!n.pos)return;
  if(n===state.focus){setFocus(null);return}
  let cx=0,cy=0,cz=0,cnt=0;
  (function w(m){if(!m.pos)return;cx+=m.pos.x;cy+=m.pos.y;cz+=m.pos.z;cnt++;
    m.children.forEach(function(c){w(c)})})(n);
  if(!cnt)return;
  cx/=cnt;cy/=cnt;cz/=cnt;
  let R=0;
  (function w2(m){if(!m.pos)return;const d=Math.hypot(m.pos.x-cx,m.pos.y-cy,m.pos.z-cz)+(m.radius||8);
    if(d>R)R=d;m.children.forEach(function(c){w2(c)})})(n);
  if(!R)return;
  setFocus(n);
  tgtGoal.set(cx,cy,cz);sphGoal.r=clamp(R*2.6,320,2400);sphGoal.p=.98;
});

/* Esc 逐层退出（G3；链本体在 selection.escStep） */
addEventListener('keydown',function(e){
  if(state.view!=='world'&&state.view!=='today')return;
  if(e.key==='Escape'){
    if(state.view==='today'&&state.mode!=='planet'){   // 今日：回固定机位（T8，与进入同源 frameToday）
      import('./camera.js').then(function(c){c.frameToday()});
      setHoverLock(null);return;
    }
    escStep();
  }
});
addEventListener('resize',function(){fixAspect()});
document.getElementById('btnHome').onclick=function(){clearAll()};   // W11 回正
