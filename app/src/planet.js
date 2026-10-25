import THREE from './three.js';
import {scene,camera} from './scene.js';
import {effM,effW,effD,weekLabel,dayLabel,monthOf} from './calendar.js';
import {state,data,planetPick,planetNodes} from './state.js';
import {COL,RINGCSS,SKIN} from './config.js';
import {clamp,trunc,fmtH} from './utils.js';
import {sph,sphGoal,tgt,tgtGoal} from './camera.js';
import {treeGroup} from './tree.js';
import {renderCrumb} from './ui.js';
import {applyChrome} from './views.js';
import {setHoverLock,setSelected} from './selection.js';        // 循环依赖：仅运行期调用

/* ================= 星球模式（右键枝干进入，原星球方案视觉） ================= */
export const planetGroup=new THREE.Group();planetGroup.visible=false;scene.add(planetGroup);
const mm=document.getElementById('minimap');

export const planetStars=(function(){
  const g=new THREE.BufferGeometry(),pts=[];
  for(let i=0;i<650;i++){
    const v=new THREE.Vector3(Math.random()*2-1,Math.random()*2-1,Math.random()*2-1);
    if(v.lengthSq()<0.001)v.set(0,1,0);
    v.normalize().multiplyScalar(2200+Math.random()*600);
    pts.push(v.x,v.y,v.z)}
  g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  const p=new THREE.Points(g,new THREE.PointsMaterial({color:0x9db4e8,size:2.4,
    transparent:true,opacity:.55,sizeAttenuation:false,toneMapped:false}));
  p.visible=false;scene.add(p);return p})();

const planetGlowTex=(function(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,0,64,64,64);
  gr.addColorStop(0,'rgba(255,255,255,.85)');gr.addColorStop(.35,'rgba(255,255,255,.28)');
  gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr;g.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c)})();

function fader(op,cb){
  document.getElementById('fader').style.opacity=op;
  if(cb)setTimeout(cb,300)}

function ringSprite(node,size){   // 原方案的进度环：白底细环+按工时占比的状态色弧段
  const S=256,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');
  const cx=S/2,rR=S*0.40,rW=S*0.056;
  g.strokeStyle='rgba(255,255,255,.07)';g.lineWidth=rW;g.beginPath();g.arc(cx,cx,rR,0,7);g.stroke();
  const segs=[['done',node.buckets.done],['overdue',node.buckets.overdue],['assigned',node.buckets.assigned],
    ['floating',node.buckets.floating]].filter(s=>s[1]>0.001);
  const gap=0.07,usable=Math.PI*2-gap*segs.length;let a=-Math.PI/2+gap/2;
  for(const[k,h]of segs){const ang=usable*h/node.H;g.strokeStyle=RINGCSS[k];g.lineWidth=rW;
    g.beginPath();g.arc(cx,cx,rR,a,a+ang);g.stroke();a+=ang+gap}
  if(node.buckets.floating>0.001){g.setLineDash([7,7]);g.strokeStyle='rgba(255,255,255,.38)';
    g.lineWidth=2.5;g.beginPath();g.arc(cx,cx,rR-rW/2-8,0,7);g.stroke();g.setLineDash([])}
  const tex=new THREE.CanvasTexture(c);tex.minFilter=THREE.LinearFilter;tex.encoding=THREE.sRGBEncoding;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false}));
  sp.scale.set(size,size,1);
  return sp}

const PLANET_TIER={
  center:{t:17,s:13,tc:'#F4F8FF',sc:'#C9D6EE',mul:1.35},   // 中心球：大字亮白
  planet:{t:12,s:10,tc:'#EAF0FA',sc:'#9FB0CC',mul:1},      // 二级行星：基准
  moon:{t:10,s:0,tc:'#9FB0CC',sc:'',mul:0.85}};             // 三级卫星：小字仅标题
function planetSphere(node,r,tier){    // 原方案球体：clearcoat 玉质+状态辉光+进度环
  const s=SKIN[node.agg];
  const mat=new THREE.MeshPhysicalMaterial({color:s.c,roughness:s.r,metalness:.06,
    clearcoat:1,clearcoatRoughness:s.cR,emissive:s.em,emissiveIntensity:s.emI,envMapIntensity:s.env});
  mat.userData.emBase=s.emI;mat.transparent=true;   // 分配状态（灰暗/闪烁/高亮）调节用
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,28,20),mat);
  mesh.userData.node=node;planetPick.push(mesh);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:planetGlowTex,color:COL[node.agg],transparent:true,
    opacity:({done:.42,overdue:.45,assigned:.22,floating:.15,abandoned:.05}[node.agg]),
    blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  glow.scale.set(r*5.6,r*5.6,1);
  const ring=ringSprite(node,r*3.6);
  const TIER=PLANET_TIER[tier||'planet'];
  const cv=document.createElement('canvas');
  const lines=[{text:trunc(node.title),px:TIER.t,color:TIER.tc,bold:true}];
  if(TIER.s)lines.push({text:Math.round(node.pct*100)+'% · '+fmtH(node.H),px:TIER.s,color:TIER.sc});
  /* 深层折叠计数角标：孙级有子节点 → 标签下追加 ×N（06.1 已定） */
  if(node.children&&node.children.length&&!node.leaf)
    lines.push({text:'×'+node.children.length,px:9,color:'#8FA3B8'});
  const SS=3,padX=6,padY=4;let g=cv.getContext('2d'),w=0,h=padY*2;
  for(const L of lines){g.font=(L.bold?'bold ':'')+L.px+'px "Microsoft YaHei",sans-serif';
    w=Math.max(w,g.measureText(L.text).width);h+=L.px*1.4}
  cv.width=Math.ceil((w+padX*2)*SS);cv.height=Math.ceil(h*SS);
  g=cv.getContext('2d');g.scale(SS,SS);
  let y=padY;
  for(const L of lines){g.font=(L.bold?'bold ':'')+L.px+'px "Microsoft YaHei",sans-serif';
    g.textAlign='center';g.textBaseline='top';g.fillStyle=L.color;
    g.fillText(L.text,cv.width/SS/2,y);y+=L.px*1.4}
  const tex=new THREE.CanvasTexture(cv);tex.minFilter=THREE.LinearFilter;tex.encoding=THREE.sRGBEncoding;
  const lb=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,
    depthWrite:false,toneMapped:false}));
  lb.renderOrder=9;
  const wpp=2*600*Math.tan(camera.fov*Math.PI/360)/innerHeight*TIER.mul;
  lb.scale.set(cv.width/SS*wpp,h*wpp,1);
  return{mesh,glow,ring,lb}}

export let planetLinks=[];         // 卫星↔行星弧形连线组：[{pp,moons,line,mat,nodes}]，loop 每帧采样
const LINK_SEG=12;                 // 每条弧的离散段数（与 loop.js 保持一致）
export function buildPlanet(root,opts){
  opts=opts||{};
  clearPlanet();
  state.planetRoot=root;
  planetGroup.position.copy(root.pos);   // 星球系统锚定在枝干世界坐标
  const cR=clamp(2.4*Math.sqrt(root.H),16,34);
  const c=planetSphere(root,cR,'center');
  c.mesh.position.set(0,0,0);c.glow.position.set(0,0,0);c.ring.position.set(0,0,0);
  planetGroup.add(c.mesh,c.glow,c.ring,c.lb);
  const cPart={center:true,node:root,mesh:c.mesh,glow:c.glow,ring:c.ring,lb:c.lb,
    r:cR,pp:null,oc:null,angle:0,R:0,speed:0,phase:0};
  planetNodes.push(cPart);
  let extent=cR+14;
  const kids=root.children;
  const kr=cR*0.65;                     // 层级固定比 中心:行星:卫星 = 1:0.65:0.4
  const mr=cR*0.4;
  const R1=clamp(80+cR+(kids.length?24:0),120,220);
  const R2=R1+kr+mr+58;                 // 外环：卫星全部绕中心，半径加大留出灵动空间
  const nKids=Math.max(1,kids.length);
  const sector=Math.PI*2/nKids;         // 每颗行星分得的角扇区
  kids.forEach(function(k,i){
    const th=i/nKids*Math.PI*2;         // 行星方位角
    const s=planetSphere(k,kr);
    planetGroup.add(s.mesh,s.glow,s.ring,s.lb);
    const kPart={node:k,mesh:s.mesh,glow:s.glow,ring:s.ring,lb:s.lb,
      pp:cPart,oc:cPart,angle:th,R:R1,speed:.06,
      phase:Math.random()*6.28,r:kr,isMoon:false};
    if(opts.newNodeId===k.id)kPart.pop={t0:performance.now()/1000};   // 新建球：弹性生长
    planetNodes.push(kPart);
    // 卫星群以父行星方位角为中心聚簇：占本扇区 80% 弧段，(j+0.5)/m 自适应任意子任务数
    const moons=k.children,m=moons.length;
    moons.forEach(function(m2,j){
      const ms=planetSphere(m2,mr,'moon');
      planetGroup.add(ms.mesh,ms.glow,ms.ring,ms.lb);
      const mPart={node:m2,mesh:ms.mesh,glow:ms.glow,ring:ms.ring,lb:ms.lb,
        pp:kPart,oc:cPart,
        angle:th-sector*0.4+(j+0.5)/m*sector*0.8,
        R:R2,speed:.06,               // 与行星同角速度：连线不发生相对错位，整体刚性旋转
        phase:Math.random()*6.28,r:mr,isMoon:true};
      if(opts.newNodeId===m2.id)mPart.pop={t0:performance.now()/1000};
      planetNodes.push(mPart);
    });
  });
  extent=Math.max(extent,R2+mr+10);
  // 卫星↔行星弧形连线（A+B 方案）：按行星分组，每组一条 LineSegments；
  // 顶点色沿曲线从行星端亮 → 卫星端渐隐，加性混合在深空背景上等效端点透明渐变
  planetLinks=[];
  const c0=new THREE.Color(0x9cc7ff),c1=new THREE.Color(0x9cc7ff).multiplyScalar(0.04);
  for(const p of planetNodes){
    if(p.center||p.isMoon)continue;
    const moons=planetNodes.filter(function(q){return q.isMoon&&q.pp===p});
    if(!moons.length)continue;
    const nV=moons.length*LINK_SEG*2;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(nV*3),3));
    const cols=new Float32Array(nV*3);let ci=0;
    for(let s=0;s<moons.length;s++)for(let i=0;i<LINK_SEG;i++){
      const ca=c0.clone().lerp(c1,i/LINK_SEG),cb=c0.clone().lerp(c1,(i+1)/LINK_SEG);
      cols[ci++]=ca.r;cols[ci++]=ca.g;cols[ci++]=ca.b;
      cols[ci++]=cb.r;cols[ci++]=cb.g;cols[ci++]=cb.b;
    }
    geo.setAttribute('color',new THREE.BufferAttribute(cols,3));
    const mat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.3,
      blending:THREE.AdditiveBlending,depthWrite:false});
    const line=new THREE.LineSegments(geo,mat);
    planetGroup.add(line);
    planetLinks.push({pp:p,moons,line,mat,
      nodes:new Set([p.node].concat(moons.map(function(m){return m.node})))});
  }
  state.planetViewR=clamp(extent*2.2,380,820);
  if(opts.skipEntrance)state.planetT=1;   // 新建/刷新时不重放整体入场
}

export function snapPlanetCam(node,r){  // 星球视角瞬对：保证球心在屏幕中心
  tgt.copy(node.pos);tgtGoal.copy(node.pos);
  sph.r=r;sphGoal.r=r;sph.p=1.02;sphGoal.p=1.02;
}

function clearPlanet(){
  planetGroup.traverse(function(o){
    if(o.geometry)o.geometry.dispose();
    if(o.isSprite&&o.material.map&&o.material.map!==planetGlowTex)o.material.map.dispose();
    if(o.material)o.material.dispose();
  });
  planetGroup.clear();planetPick.length=0;planetNodes.length=0;planetLinks=[];
}

export function enterPlanet(node){       // 右键枝干：推进→压暗→星球展开
  if(state.mode!=='tree'||!node||node.leaf)return;
  state.mode='planet';state.planetRoot=node;
  state.savedPose={r:sphGoal.r,t:sphGoal.t,p:sphGoal.p,x:tgtGoal.x,y:tgtGoal.y,z:tgtGoal.z};
  sphGoal.r=Math.max(sph.r*.5,320);sphGoal.p=1.05;
  tgtGoal.copy(node.pos);
  fader(1,function(){
    treeGroup.visible=false;planetStars.visible=true;try{applyChrome(state.view)}catch(e){}
    buildPlanet(node);planetGroup.visible=true;state.planetT=0;
    snapPlanetCam(node,state.planetViewR);   // 黑屏瞬间瞬对，球心必在屏幕中心
    renderCrumb();
    fader(0,null);
  });
}

export function exitPlanet(){            // 返回树模式：收拢→压暗→还原
  if(state.mode!=='planet')return;
  state.mode='tree';
  fader(1,function(){
    planetGroup.visible=false;clearPlanet();
    treeGroup.visible=true;planetStars.visible=false;try{applyChrome(state.view)}catch(e){}
    setHoverLock(null);state.hovered=null;setSelected(null);
    if(state.savedPose){sph.r=state.savedPose.r;sphGoal.r=state.savedPose.r;
      sph.t=state.savedPose.t;sphGoal.t=state.savedPose.t;
      sph.p=state.savedPose.p;sphGoal.p=state.savedPose.p;
      tgt.set(state.savedPose.x,state.savedPose.y,state.savedPose.z);tgtGoal.copy(tgt)}
    renderCrumb();
    fader(0,null);
  });
}

/* ================= 周期星球（右键日历周期进入） =================
   中心球=周期本身；行星=该周期任务按顶级分支分组；卫星=具体任务。
   卫星用 _real 包装（不改动真实任务树的 parent 链），allocStateOf/分配交互自动回真。 */

function periodTitle(level,key){
  const y=+key.slice(0,4),m=+key.slice(5,7);
  if(level==='month')return y+'年'+m+'月';
  if(level==='week')return m+'月·'+weekLabel(monthOf(key),key);
  return m+'月'+(+key.slice(8,10))+'日·'+dayLabel(key);
}
function makePeriodRoot(level,key){
  const leaves=[];
  (function w(n){if(n.leaf)leaves.push(n);n.children.forEach(w)})(data.root);
  const match=level==='month'?effM:level==='week'?effW:effD;
  const sel=leaves.filter(l=>match(l)===key);
  if(!sel.length)return null;
  const groups=new Map();
  for(const l of sel){
    let top=l;while(top.parent&&top.parent.depth>0)top=top.parent;   // 顶级分支
    if(!groups.has(top.id))groups.set(top.id,{title:top.title,items:[]});
    groups.get(top.id).items.push(l);
  }
  const mkNode=title=>{
    const B={done:0,overdue:0,assigned:0,floating:0,abandoned:0};
    return{title,children:[],buckets:B,H:0,leafCount:0,pct:0,agg:'assigned',parent:null}};
  const root=mkNode(periodTitle(level,key));
  root.pos=data.root.pos.clone();
  let TH=0;
  for(const g of groups.values()){
    const gn=mkNode(g.title);gn.parent=root;
    for(const l of g.items){
      const wrap=mkNode(l.title);                     // _real 包装：真任务的展示壳
      Object.assign(wrap,{leaf:true,H:l.H,pct:l.pct,agg:l.agg,
        buckets:l.buckets,leafCount:1,_real:l,depth:2});
      wrap.parent=gn;gn.children.push(wrap);
      TH+=l.H;
    }
    let done=0;
    for(const l of g.items){
      gn.buckets.done+=l.buckets.done;gn.buckets.overdue+=l.buckets.overdue;
      gn.buckets.assigned+=l.buckets.assigned;gn.buckets.floating+=l.buckets.floating;
      gn.buckets.abandoned+=l.buckets.abandoned;done+=l.buckets.done;
    }
    gn.H=gn.children.reduce((a,c)=>a+c.H,0);
    gn.leafCount=gn.children.length;
    gn.pct=gn.H?done/gn.H:0;
    gn.agg=gn.buckets.overdue>0?'overdue':gn.buckets.floating>0?'floating':gn.pct>=1?'done':'assigned';
    root.children.push(gn);
  }
  for(const k in root.buckets)
    root.buckets[k]=root.children.reduce((a,c)=>a+c.buckets[k],0);
  root.H=TH;root.leafCount=sel.length;
  root.pct=TH?root.buckets.done/TH:0;
  root.agg=root.buckets.overdue>0?'overdue':root.buckets.floating>0?'floating':root.pct>=1?'done':'assigned';
  return root;
}
