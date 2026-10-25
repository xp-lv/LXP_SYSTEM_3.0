import THREE from '../three.js';
import {scene,renderer,amb,dl,fillLight,hemi,pl} from '../scene.js';
import {state} from '../state.js';
import {C,clamp,lerp,mulberry32,makeGlowTex} from './core.js';
import {setFloatingIslandEnv} from './floatingIsland.js';

/* ================= demo 环境层（移植自 demo/tree-proj/js/01-env.js + 03 时段预设） =================
   天穹/星空/云/光尘萤火虫 + 昼昏夜三预设（接管 app 的实时钟天光）。
   光源复用 scene.js 的 amb/dl/hemi/fillLight，不新增平行灯。 */

renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
scene.environment=null;                      /* demo 走三灯+天穹，不要 IBL 浸光 */
state.demoEnv=true;                          /* 接管天光：scene.updateDayLight 挂起 */

/* 自动昼夜（10.1 v3）：跟随时钟选时段预设——唯一行为（手动时段切换已按需求移除）。
   白天 6:00–17:00 · 黄昏 17:00–19:30 · 夜晚其余。 */
function autoPreset(){
  var d=new Date(),h=d.getHours()+d.getMinutes()/60;
  return h>=6&&h<17?'day':h>=17&&h<19.5?'dusk':'night'}

export var wind={uTime:{value:0},uGust:{value:1}};
export function windify(mat,mode){
  mat.onBeforeCompile=function(sh){
    sh.uniforms.uTime=wind.uTime;sh.uniforms.uGust=wind.uGust;
    var head='uniform float uTime;uniform float uGust;\n';
    if(mode==='leaf'){
      head+='attribute vec3 aSway;\n';
      sh.vertexShader=head+sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'+
        'float swF=uTime*aSway.z+aSway.x;\n'+
        'transformed.x+=sin(swF)*aSway.y*uGust;\n'+
        'transformed.z+=cos(swF*.83+aSway.x)*aSway.y*.6*uGust;\n');
    }else if(mode==='wood'){
      head+='attribute vec2 aWw;\n';
      sh.vertexShader=head+sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'+
        'transformed.x+=sin(uTime*1.35+aWw.y)*aWw.x*uGust;\n'+
        'transformed.z+=cos(uTime*1.07+aWw.y*1.3)*aWw.x*.7*uGust;\n');
    }else{ /* grass */
      head+='attribute float aPh;\n';
      sh.vertexShader=head+sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'+
        'float bend=pow(clamp(position.y/4.6,0.,1.),1.5);\n'+
        'float g=sin(uTime*1.7+aPh)*.62+sin(uTime*2.7+aPh*1.6)*.38;\n'+
        'transformed.x+=g*1.25*bend*uGust;transformed.z+=g*.8*bend*uGust;\n');
    }};
  return mat}

/* 木质影子深度材质:影子通道与 windify('wood') 同步摆 */
export var woodDepthMat=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
woodDepthMat.onBeforeCompile=function(sh){
  sh.uniforms.uTime=wind.uTime;sh.uniforms.uGust=wind.uGust;
  sh.vertexShader='uniform float uTime;uniform float uGust;attribute vec2 aWw;\n'+
    sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n'+
      'transformed.x+=sin(uTime*1.35+aWw.y)*aWw.x*uGust;\n'+
      'transformed.z+=cos(uTime*1.07+aWw.y*1.3)*aWw.x*.7*uGust;\n');
};
woodDepthMat.customProgramCacheKey=function(){return 'demo_wood_depth_sway'};

/* —— 天穹（渐变 + 太阳辉光） —— */
var skyUni={
  cTop:{value:C(0x35589e)},cMid:{value:C(0x6f8fc9)},cBot:{value:C(0x1a2440)},
  sunDir:{value:new THREE.Vector3(.35,.75,.4).normalize()},
  sunCol:{value:C(0xfff2d8)}};
var sky=new THREE.Mesh(new THREE.SphereGeometry(7200,32,20),new THREE.ShaderMaterial({
  side:THREE.BackSide,depthWrite:false,fog:false,uniforms:skyUni,
  vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:[
    'varying vec3 vP;uniform vec3 cTop,cMid,cBot,sunDir,sunCol;',
    'void main(){',
    ' vec3 d=normalize(vP);float h=d.y;',
    ' vec3 col=h>0.?mix(cMid,cTop,pow(h,.55)):mix(cMid,cBot,pow(-h,.7));',
    ' float s=max(dot(d,sunDir),0.);',
    ' col+=sunCol*(pow(s,420.)*1.4+pow(s,9.)*.16);',
    ' gl_FragColor=vec4(col,1.);}'
  ].join('\n')}));
scene.add(sky);

/* —— 星空（夜晚淡入） —— */
var starGeo=new THREE.BufferGeometry(),sp=[],sr=Math.random;
for(var si=0;si<420;si++){
  var th=sr()*Math.PI*2,ph=Math.acos(sr()*.92);
  var R=6600;
  sp.push(Math.sin(ph)*Math.cos(th)*R,Math.cos(ph)*R,Math.sin(ph)*Math.sin(th)*R)}
starGeo.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
var starMat=new THREE.PointsMaterial({color:0xcfe0ff,size:2.4,sizeAttenuation:false,
  transparent:true,opacity:0,depthWrite:false,fog:false});
scene.add(new THREE.Points(starGeo,starMat));

/* —— 太阳辉光 + 云 —— */
var glowTex=makeGlowTex();
var sunSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xfff2d8,
  transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
sunSprite.scale.set(900,900,1);scene.add(sunSprite);

/* 云由浮空岛造景模块（demo/floatingIsland.js）提供，保留 app 的时段染色与漂移。 */
var clouds=[];
export function setClouds(list){
  clouds.length=0;
  if(list)for(var i=0;i<list.length;i++)clouds.push(list[i]);
}

/* —— 光尘（昼）& 萤火虫（夜） —— */
function makeMotes(n,sx,y0,dy,col,size){
  var g=new THREE.BufferGeometry(),p=[],r=mulberry32(n*13),i;
  for(i=0;i<n;i++)p.push((r()-.5)*sx,y0+r()*dy,(r()-.5)*sx);
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  var m=new THREE.Points(g,new THREE.PointsMaterial({color:col,size:size,transparent:true,
    opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true,
    map:glowTex}));
  m.userData.base=p.slice();
  scene.add(m);return m}
var motes=makeMotes(80,900,10,260,0xffe9c0,2.4);
var flies=makeMotes(52,620,14,150,0xffdf8f,2.8);
flies.material.opacity=0;

/* ================= 时段预设（demo 原版） ================= */
var PRESETS={
  day:{skyT:0x35589e,skyM:0x6f8fc9,skyB:0x1a2440,sunC:0xfff2d8,
    sunD:[.35,.75,.42],sunI:1.55,ambC:0x8fa3c8,ambI:.5,
    hemS:0x7d95cf,hemG:0x3d5a3a,hemI:.55,fillC:0xffe8cf,fillI:.35,
    fogC:0x263a5e,fogD:.00016,exp:1.08,sunGlow:0xfff2d8,sunGlowO:.9,
    star:0,mote:.5,fly:0,cloud:0xffffff},
  dusk:{skyT:0x2b2a55,skyM:0xb46a4a,skyB:0x201830,sunC:0xff9a5a,
    sunD:[.82,.2,-.4],sunI:1.35,ambC:0x9a7d9a,ambI:.42,
    hemS:0xa06a7a,hemG:0x3a2f38,hemI:.45,fillC:0xffb27a,fillI:.3,
    fogC:0x4a3550,fogD:.00020,exp:1.12,sunGlow:0xff9a5a,sunGlowO:1,
    star:.15,mote:.6,fly:.3,cloud:0xe8b490},
  night:{skyT:0x060a1c,skyM:0x14204a,skyB:0x0a0e20,sunC:0x9db8ff,
    sunD:[-.3,.62,-.5],sunI:.38,ambC:0x6a7fb8,ambI:.26,
    hemS:0x4a5c96,hemG:0x1c2620,hemI:.3,fillC:0x8ca8e8,fillI:.15,
    fogC:0x0c1428,fogD:.00022,exp:1.0,sunGlow:0x9db8ff,sunGlowO:.55,
    star:1,mote:.06,fly:.8,cloud:0x232c4e}};
var COLOR_KEYS={skyT:1,skyM:1,skyB:1,sunC:1,ambC:1,hemS:1,hemG:1,
  fillC:1,fogC:1,sunGlow:1,cloud:1};
function resolvePreset(p){
  var o={},k,v;
  for(k in p){v=p[k];
    if(k==='sunD')o[k]=new THREE.Vector3(v[0],v[1],v[2]);
    else if(COLOR_KEYS[k])o[k]=C(v);
    else o[k]=v}
  return o}
var cur=resolvePreset(PRESETS.day);
var tgtP=resolvePreset(PRESETS.day);

/* 环境焦点：平行光阴影相机跟随当前聚焦的岛（世界岛 / 今日小岛）。
   radius 决定阴影视锥幅宽——大岛需要更宽，小岛收紧以保住阴影精度。 */
var focus=new THREE.Vector3(0,40,0);
export function setEnvFocus(x,y,z,radius){
  focus.set(x,y,z);
  if(radius){
    var e=Math.max(240,Math.min(1400,radius));
    var sc=dl.shadow.camera;
    if(Math.abs(sc.right-e)>.5){
      sc.left=-e;sc.right=e;sc.top=e;sc.bottom=-e;
      sc.updateProjectionMatrix()}
  }
}

function setPreset(name){
  if(PRESETS[name])tgtP=resolvePreset(PRESETS[name]);
  state.demoPreset=name}

var sunTarget=new THREE.Object3D();scene.add(sunTarget);dl.target=sunTarget;
dl.castShadow=true;
dl.shadow.mapSize.set(4096,4096);   /* 提升精度：草簇投影不再呈粗锯齿（效果优先） */
dl.shadow.camera.left=-620;dl.shadow.camera.right=620;
dl.shadow.camera.top=620;dl.shadow.camera.bottom=-620;
dl.shadow.camera.near=40;dl.shadow.camera.far=3200;
dl.shadow.bias=-.00016;dl.shadow.normalBias=.9;

export function applyEnv(dt){
  var k=1-Math.exp(-dt*2.4),key;
  for(key in tgtP){
    if(cur[key] instanceof THREE.Color)cur[key].lerp(tgtP[key],k);
    else if(cur[key] instanceof THREE.Vector3)cur[key].lerp(tgtP[key],k).normalize();
    else cur[key]=lerp(cur[key],tgtP[key],k)}
  var sd=cur.sunD;
  skyUni.cTop.value.copy(cur.skyT);skyUni.cMid.value.copy(cur.skyM);
  skyUni.cBot.value.copy(cur.skyB);skyUni.sunDir.value.copy(sd);
  skyUni.sunCol.value.copy(cur.sunC);
  dl.color.copy(cur.sunC);dl.intensity=cur.sunI;
  dl.position.copy(focus).addScaledVector(sd,900);
  sunTarget.position.copy(focus);
  amb.color.copy(cur.ambC);amb.intensity=cur.ambI;
  hemi.color.copy(cur.hemS);hemi.groundColor.copy(cur.hemG);hemi.intensity=cur.hemI;
  fillLight.color.copy(cur.fillC);fillLight.intensity=cur.fillI;
  pl.intensity=0;                                    /* demo 三灯体系：关掉旧蓝色点光 */
  scene.fog.color.copy(cur.fogC);scene.fog.density=cur.fogD;
  renderer.toneMappingExposure=cur.exp;
  starMat.opacity=cur.star;
  motes.material.opacity=cur.mote;flies.material.opacity=cur.fly;
  clouds.forEach(function(c){c.material.color.copy(cur.cloud)});
  setFloatingIslandEnv(cur.ambC,cur.ambI);
  sunSprite.material.color.copy(cur.sunGlow);
  sunSprite.material.opacity=cur.sunGlowO;
  sunSprite.position.copy(sd).multiplyScalar(6400)}

/* —— 环境步进（主循环调用）：预设缓动 + 云漂移 + 光尘浮游 + 自动昼夜对表 —— */
var envT=0,autoTick=0;
export function stepEnv(dt){
  envT+=dt;
  wind.uTime.value=envT;
  wind.uGust.value=1+Math.sin(envT*.31)*.35+Math.sin(envT*.11)*.25;
  applyEnv(dt);
  autoTick+=dt;                                /* 自动昼夜：每 15s 对表，跨过时段边界即缓动切换 */
  if(autoTick>15){autoTick=0;
    var ap=autoPreset();
    if(ap!==state.demoPreset)setPreset(ap)}
  clouds.forEach(function(c){
    c.position.x+=c.userData.vx*dt;
    if(c.position.x>3200)c.position.x=-3200;
    c.position.y=c.userData.y0+Math.sin(envT*.1+c.userData.ph)*(c.userData.bob||8)});
  floatPts(motes,dt,.5);floatPts(flies,dt,1.4)}
function floatPts(m,dt,sp){
  var p=m.geometry.attributes.position,b=m.userData.base,n=p.count,i;
  for(i=0;i<n;i++){
    p.array[i*3]=b[i*3]+Math.sin(envT*sp*.6+i*1.7)*11;
    p.array[i*3+1]=b[i*3+1]+Math.sin(envT*sp+i*.83)*8;
    p.array[i*3+2]=b[i*3+2]+Math.cos(envT*sp*.5+i*1.13)*11}
  p.needsUpdate=true}

/* 启动即按真实时间定时段 */
setPreset(autoPreset());
