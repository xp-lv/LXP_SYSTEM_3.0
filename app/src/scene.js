import THREE from './three.js';
import {state,DAY} from './state.js';

/* ================= 渲染底座 + 天光 ================= */
export const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.domElement.className='webgl';
document.body.appendChild(renderer.domElement);
export function fixAspect(){     // 强制校正：任何非法视口（0×0/NaN）兜底 16:9，绝不留 NaN
  const a=innerWidth/innerHeight;
  camera.aspect=(isFinite(a)&&a>0)?a:16/9;
  camera.updateProjectionMatrix();
  const w=Math.max(1,innerWidth|0),h=Math.max(1,innerHeight|0);
  if(renderer.domElement.width!==Math.round(w*Math.min(devicePixelRatio,2))||
     renderer.domElement.height!==Math.round(h*Math.min(devicePixelRatio,2)))
    renderer.setSize(w,h);
}
export const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b1224);
scene.fog=new THREE.FogExp2(0x0b1224,0.00022);
const ASP0=(innerHeight>0&&isFinite(innerWidth/innerHeight))?innerWidth/innerHeight:16/9;  // 嵌入式浏览器模块求值期视口可能 0×0
/* far=14000：天空球半径 7200 + 进入今日页的飞行相机偏移（~2000）必须全在远裁剪面内，
   否则天空球背侧被裁掉、露出背景清屏色（呈现为瞬态多边形暗块） */
export const camera=new THREE.PerspectiveCamera(50,ASP0,1,14000);
export const amb=new THREE.AmbientLight(0x9db8d8,0.6);scene.add(amb);
export const dl=new THREE.DirectionalLight(0xfff8f0,1.5);dl.position.set(320,520,260);scene.add(dl);
export const pl=new THREE.PointLight(0x88bbff,0.5,2000);pl.position.set(0,60,0);scene.add(pl);
export const fillLight=new THREE.PointLight(0xfff0e0,0.8,3000);scene.add(fillLight);
export const hemi=new THREE.HemisphereLight(0x8fa8d8,0x4a6b3a,0.4);scene.add(hemi);
(function buildEnv(){
  const pm=new THREE.PMREMGenerator(renderer);
  const es=new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(60,16,12),
    new THREE.MeshBasicMaterial({color:0x0d1322,side:THREE.BackSide})));
  const panel=(c,x,y,z,rx,ry,s,mul)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(s,s),
      new THREE.MeshBasicMaterial({color:new THREE.Color(c).multiplyScalar(mul)}));
    m.position.set(x,y,z);m.rotation.set(rx,ry,0);es.add(m)};
  panel(0xdfeaff,  0,42,  0, Math.PI/2,0, 26,1.5);
  panel(0x9ec5ff,-40, 8, 10, 0,Math.PI/2,18,0.95);
  panel(0xcfe8b3, 38,-6,-12, 0,-Math.PI/2,14,0.8);
  scene.environment=pm.fromScene(es,0.04).texture;
  pm.dispose();
})();

/* ================= 昼夜循环（真实时刻驱动，state.timeOverride 可预览） =================
   demo 环境层（demo/env.js）接管天光后挂起：光源/雾/背景由时段预设驱动 */
export function updateDayLight(){
  if(state.demoEnv){DAY.name=state.demoPreset==='night'?'夜晚':state.demoPreset==='dusk'?'黄昏':'白天';return}
  const d=new Date();
  const h=state.timeOverride!=null?state.timeOverride:d.getHours()+d.getMinutes()/60;
  const mix=(c1,c2,t)=>new THREE.Color(c1).lerp(new THREE.Color(c2),t);
  const lerp=(a,b,t)=>a+(b-a)*t;
  let x,y,c,i,name,glyph;
  if(h>=6&&h<12){const t=(h-6)/6;
    x=lerp(-0.9,0.05,t);y=lerp(0.18,0.95,t);
    c=mix(0xffb26b,0xfff4e0,t);i=lerp(.35,.6,t);name='上午';glyph='☀';
    amb.intensity=lerp(.22,.35,t);amb.color.copy(mix(0x7d8cb0,0x8fa3c8,t));
    renderer.toneMappingExposure=lerp(1.0,1.06,t);
    scene.background.copy(mix(new THREE.Color(0x0e1830),new THREE.Color(0x1b2542),t));}
  else if(h>=12&&h<18){const t=(h-12)/6;
    x=lerp(0.05,0.9,t);y=lerp(0.95,0.2,t);
    c=mix(0xfff4e0,0xff9a5a,t);i=lerp(.65,.35,t);name='下午';glyph='☀';
    amb.intensity=lerp(.35,.22,t);amb.color.copy(mix(0x8fa3c8,0x7d8cb0,t));
    renderer.toneMappingExposure=lerp(1.06,0.98,t);
    scene.background.copy(mix(new THREE.Color(0x1b2542),new THREE.Color(0x231a30),t));}
  else{const t=h>=18?(h-18)/12:(h+6)/12;
    x=lerp(0.7,-0.7,t);y=0.75;
    c=0xb8ccff;i=0.42;name='夜晚';glyph='☾';
    amb.intensity=.5;amb.color.set(0x9db8e8);
    renderer.toneMappingExposure=1.05;
    scene.background.copy(mix(new THREE.Color(0x1a2440),new THREE.Color(0x101830),t));}
  dl.position.set(x*500,y*500+60,180);
  // 灯色必须用 .set()：夜晚分支的 c 是裸 hex 数字，.copy() 会读出 NaN 并污染全部受光材质
  dl.color.set(c);dl.intensity=i;
  pl.color.set(c);pl.intensity=0.45+i*0.25;
  scene.fog.color.copy(scene.background).multiplyScalar(.85);
  DAY.name=name;DAY.glyph=glyph;
  const el=document.getElementById('dayInfo');
  if(el){const hh=Math.floor(h),mm2=state.timeOverride!=null?0:d.getMinutes();
    el.textContent=glyph+' '+name+' '+String(hh).padStart(2,'0')+':'+String(mm2).padStart(2,'0')+(state.timeOverride!=null?' ·预览':'');
    el.style.color=(name==='夜晚')?'#9db8ff':'#ffd9a0';}
}
