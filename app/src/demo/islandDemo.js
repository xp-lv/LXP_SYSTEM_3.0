import THREE from '../three.js';
import {buildValleyIslandBody,stepValley,VALLEY_BASE_R} from './valley.js';

/* ================= 岛屿地形 Demo（独立页面 /app/island-demo.html） =================
   与 app 内世界岛/今日小岛共用 ../demo/valley.js 的同一套岛体管线：
   三峰一谷 + 宽谷河槽 + 岛缘跌水，只保留地形与水（不加载树/草/装饰）。
   本页只是预览台：轨道相机 + 天穹 + 状态读数。
   操作：拖拽旋转 / 滚轮缩放 / W 线框；R 重置视角。 */

const R0=VALLEY_BASE_R;
const cv=document.getElementById('cv');
const statsEl=document.getElementById('stats');

const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x93a9c4,0.000052);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,5,20000);

/* —— 天穹（竖直渐变） —— */
(function sky(){
  const g=new THREE.SphereGeometry(6500,32,18);
  const m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    uniforms:{cT:{value:new THREE.Color(0x2c4670).convertSRGBToLinear()},
      cB:{value:new THREE.Color(0xa8c0dc).convertSRGBToLinear()}},
    vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 vP;uniform vec3 cT;uniform vec3 cB;'+
      'void main(){float h=clamp(normalize(vP).y*.5+.5,0.,1.);'+
      'gl_FragColor=vec4(mix(cB,cT,pow(h,1.35)),1.0);}'});
  scene.add(new THREE.Mesh(g,m));
})();

/* —— 光照：一盏平行光（投影）+ 环境/半球补光 —— */
const sun=new THREE.DirectionalLight(0xfff0d8,1.32);
sun.position.set(-780,1250,-620);
sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);
sun.shadow.camera.left=-1150;sun.shadow.camera.right=1150;
sun.shadow.camera.top=1150;sun.shadow.camera.bottom=-1150;
sun.shadow.camera.near=300;sun.shadow.camera.far=4200;
sun.shadow.bias=-0.0002;sun.shadow.normalBias=1.2;
scene.add(sun);scene.add(sun.target);
scene.add(new THREE.AmbientLight(0x8fa3c8,0.28));
const hemi=new THREE.HemisphereLight(0xbdd0ea,0x3c4a34,0.42);
scene.add(hemi);

const body=buildValleyIslandBody({R0:R0});
scene.add(body.inner);
window.__terrainMat=body.terrainMat;
window.__h=body.heightAt;window.__path=body.path;

/* ================= 相机轨道控制 ================= */
const tgt=new THREE.Vector3(0,60,0);
const sph={r:2450,t:0.95,p:0.95};
const goal={r:2450,t:0.95,p:0.95};
let drag=null;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
cv.addEventListener('pointerdown',function(e){
  drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointerup',function(e){drag=null;try{cv.releasePointerCapture(e.pointerId)}catch(e){}});
cv.addEventListener('pointermove',function(e){
  if(!drag)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  drag.x=e.clientX;drag.y=e.clientY;
  goal.t-=dx*.0045;
  goal.p=clamp(goal.p-dy*.0045,.16,1.50)});
cv.addEventListener('wheel',function(e){
  e.preventDefault();
  goal.r=clamp(goal.r*(1+e.deltaY*.001),600,4200)},{passive:false});
cv.addEventListener('contextmenu',function(e){e.preventDefault()});
addEventListener('keydown',function(e){
  if(e.key==='w'||e.key==='W'){
    const m=window.__terrainMat;if(m)m.wireframe=!m.wireframe}
  if(e.key==='r'||e.key==='R'){goal.r=2450;goal.t=.95;goal.p=.95}});
addEventListener('resize',function(){
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight)});

/* ================= 循环 ================= */
window.__view=function(r,t,p){goal.r=r;goal.t=t;goal.p=p};
let lastT=0,shown=false;
function frame(t){
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(t-lastT)/1000||0);lastT=t;
  stepValley(dt);
  /* 阻尼 */
  sph.r+=(goal.r-sph.r)*.12;
  sph.t+=(goal.t-sph.t)*.12;
  sph.p+=(goal.p-sph.p)*.12;
  const sp=Math.sin(sph.p);
  camera.position.set(
    tgt.x+sph.r*sp*Math.cos(sph.t),
    tgt.y+sph.r*Math.cos(sph.p),
    tgt.z+sph.r*sp*Math.sin(sph.t));
  camera.lookAt(tgt);
  renderer.render(scene,camera);
  if(!shown&&t>600){shown=true;updateStats()}
}

function updateStats(){
  let maxH=-1e9,minH=1e9;
  for(let k=0;k<600;k++){
    const a=Math.random()*6.28,rr=Math.sqrt(Math.random())*R0*.95;
    const h=body.heightAt(Math.cos(a)*rr,Math.sin(a)*rr);
    if(h===null)continue;
    if(h>maxH)maxH=h;if(h<minH)minH=h}
  statsEl.innerHTML=
    '地形高度：'+minH.toFixed(0)+' ~ '+maxH.toFixed(0)+'<br>'+
    '三峰高程：'+body.peaks.map(function(p){const h=body.heightAt(p.x,p.z);return h==null?'-':h.toFixed(0)}).join(' / ')+'<br>'+
    '河谷出口高程：'+(body.heightAt(body.path[body.path.length-1].x,body.path[body.path.length-1].z)||0).toFixed(0);
}
requestAnimationFrame(frame);
