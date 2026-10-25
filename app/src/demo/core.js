import THREE from '../three.js';

/* ================= demo 美术核心（移植自 demo/tree-proj/js/00-bootstrap.js） =================
   确定性随机 + Simplex 噪声 + Canvas 程序化贴图。纯函数集合，无副作用。 */
export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
var SEED=20260930;
var F2=0.5*(Math.sqrt(3)-1),G2=(3-Math.sqrt(3))/6;
var GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function makePerm(seed){var r=mulberry32(seed),p=new Uint8Array(512),b=[],i,j,t;
  for(i=0;i<256;i++)b.push(i);
  for(i=255;i>0;i--){j=Math.floor(r()*(i+1));t=b[i];b[i]=b[j];b[j]=t}
  for(i=0;i<512;i++)p[i]=b[i&255];return p}
var PERM=makePerm(SEED);
export function snoise(x,y){var s=(x+y)*F2,i=Math.floor(x+s),j=Math.floor(y+s),t=(i+j)*G2;
  var x0=x-(i-t),y0=y-(j-t),i1=x0>y0?1:0,j1=x0>y0?0:1;
  var x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;
  var ii=i&255,jj=j&255,n=0,g,t0;
  t0=0.5-x0*x0-y0*y0;if(t0>0){t0*=t0;g=GRAD[PERM[ii+PERM[jj]]%8];n+=t0*t0*(g[0]*x0+g[1]*y0)}
  t0=0.5-x1*x1-y1*y1;if(t0>0){t0*=t0;g=GRAD[PERM[ii+i1+PERM[jj+j1]]%8];n+=t0*t0*(g[0]*x1+g[1]*y1)}
  t0=0.5-x2*x2-y2*y2;if(t0>0){t0*=t0;g=GRAD[PERM[ii+1+PERM[jj+1]]%8];n+=t0*t0*(g[0]*x2+g[1]*y2)}
  return 70*n}
export function fbm(x,y,oct){var v=0,a=.5,f=1,m=0,i;for(i=0;i<oct;i++){v+=a*snoise(x*f,y*f);m+=a;a*=.5;f*=2.03}return v/m}
export function clamp(v,a,b){return v<a?a:v>b?b:v}
export function lerp(a,b,t){return a+(b-a)*t}
export function smooth01(x){x=clamp(x,0,1);return x*x*(3-2*x)}
export function C(h){return new THREE.Color(h)}

/* —— Canvas 全程离线贴图（水面/水帘/云/辉光/树皮） —— */

/* （旧岛草地/岩石/花草贴图已随旧岛体退役：新岛体走顶点色，
   视觉资产只保留树皮与水面/水帘/云/辉光。） */

/* 树皮 v4：极简竖纹+偶发横裂 */
export function makeBarkTex(){
  var cvC=document.createElement('canvas'),cvB=document.createElement('canvas');
  cvC.width=cvB.width=cvC.height=cvB.height=256;
  var g=cvC.getContext('2d'),b=cvB.getContext('2d'),r=mulberry32(97),S=256;
  var bg=g.createLinearGradient(0,0,0,S);
  bg.addColorStop(0,'#6e5238');bg.addColorStop(.5,'#6b5139');bg.addColorStop(1,'#6d5340');
  g.fillStyle=bg;g.fillRect(0,0,S,S);
  b.fillStyle='#8a8a8a';b.fillRect(0,0,S,S);
  for(var i=0;i<26;i++){
    var bx=r()*S,bw=1.5+r()*2.5,dk=r()<.55;
    g.fillStyle=dk?'rgba(52,38,26,'+(.07+r()*.07).toFixed(2)+')':'rgba(150,120,86,'+(.05+r()*.06).toFixed(2)+')';
    g.fillRect(bx,0,bw,S);g.fillRect(bx-S,0,bw,S);
    b.fillStyle=dk?'rgba(96,96,96,.09)':'rgba(168,168,168,.07)';
    b.fillRect(bx,0,bw,S);b.fillRect(bx-S,0,bw,S)}
  for(i=0;i<44;i++){
    var bx2=r()*S,bw2=.8+r()*1.4;
    g.fillStyle='rgba(58,44,30,'+(.03+r()*.04).toFixed(2)+')';
    g.fillRect(bx2,0,bw2,S);g.fillRect(bx2-S,0,bw2,S);
    b.fillStyle='rgba(110,110,110,.04)';
    b.fillRect(bx2,0,bw2,S);b.fillRect(bx2-S,0,bw2,S)}
  for(i=0;i<10;i++){
    var cx=r()*S,cy=r()*S,ln=8+r()*22;
    g.strokeStyle='rgba(40,30,20,'+(.08+r()*.06).toFixed(2)+')';g.lineWidth=1;
    g.beginPath();g.moveTo(cx,cy);g.lineTo(cx+(r()-.5)*4,cy+ln);g.stroke();
    b.strokeStyle='rgba(90,90,90,.09)';b.beginPath();
    b.moveTo(cx,cy);b.lineTo(cx+(r()-.5)*4,cy+ln);b.stroke()}
  var tC=new THREE.CanvasTexture(cvC),tB=new THREE.CanvasTexture(cvB);
  tC.encoding=THREE.sRGBEncoding;
  tC.wrapS=tC.wrapT=tB.wrapS=tB.wrapT=THREE.RepeatWrapping;
  return{map:tC,bump:tB}}

/* 水纹贴图（溪流）：纵向流线 + 细碎波光——UV 的 v 沿流向滚动 */
export function makeWaterTex(){
  var S=128,cv=document.createElement('canvas');cv.width=S;cv.height=S;
  var g=cv.getContext('2d'),r=mulberry32(41),i;
  g.fillStyle='#6b8b93';g.fillRect(0,0,S,S);      /* 中灰蓝底（材质色再乘） */
  for(i=0;i<46;i++){                               /* 纵向流线 */
    var x=r()*S,y0=r()*S,len=18+r()*46;
    g.strokeStyle='rgba(255,255,255,'+(.10+r()*.20)+')';
    g.lineWidth=.8+r()*1.4;
    g.beginPath();g.moveTo(x,y0);g.lineTo(x+(r()-.5)*4,y0+len);g.stroke()}
  for(i=0;i<70;i++){                               /* 波光点 */
    var px=r()*S,py=r()*S,pr=.5+r()*1.3;
    g.fillStyle='rgba(238,250,253,'+(.14+r()*.22)+')';
    g.beginPath();g.arc(px,py,pr,0,7);g.fill()}
  /* 两侧暗岸渐变（u=横跨水面）：水缘融进湿地，不再是被裁出来的硬边 */
  var eg=g.createLinearGradient(0,0,S,0);
  eg.addColorStop(0,'rgba(26,32,30,.46)');
  eg.addColorStop(.15,'rgba(26,32,30,0)');
  eg.addColorStop(.85,'rgba(26,32,30,0)');
  eg.addColorStop(1,'rgba(26,32,30,.46)');
  g.fillStyle=eg;g.fillRect(0,0,S,S);
  /* 中心略深的"水脊"：远看有体积，不再是一片平板 */
  var cg=g.createLinearGradient(0,0,S,0);
  cg.addColorStop(0,'rgba(38,52,54,0)');
  cg.addColorStop(.38,'rgba(38,52,54,0)');
  cg.addColorStop(.5,'rgba(38,52,54,.16)');
  cg.addColorStop(.62,'rgba(38,52,54,0)');
  cg.addColorStop(1,'rgba(38,52,54,0)');
  g.fillStyle=cg;g.fillRect(0,0,S,S);
  var t=new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;return t}

/* 瀑布贴图：纵向水帘条纹 + 自上而下的透明度衰减（顶部实、底部散） */
export function makeFallTex(){
  var W=64,H=256,cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var g=cv.getContext('2d'),r=mulberry32(53),i;
  g.clearRect(0,0,W,H);
  /* 半透明水幕底层：整幅铺一层水色，再叠亮条纹——读作"水幕"而非细线帘 */
  g.fillStyle='rgba(224,240,246,.30)';g.fillRect(0,0,W,H);
  for(i=0;i<70;i++){
    var x=r()*W,w=1.0+r()*2.6,y0=r()*40,len=H*.55+r()*H*.45;
    var gr=g.createLinearGradient(0,y0,0,y0+len);
    gr.addColorStop(0,'rgba(240,250,252,'+(.45+r()*.35)+')');
    gr.addColorStop(.75,'rgba(225,240,245,.20)');
    gr.addColorStop(1,'rgba(220,238,244,0)');
    g.fillStyle=gr;g.fillRect(x,y0,w,len)}
  /* 整幅自上而下淡出（CanvasTexture flipY：画布顶部=uv v 上端） */
  var fade=g.createLinearGradient(0,0,0,H);
  fade.addColorStop(0,'rgba(0,0,0,0)');
  fade.addColorStop(.52,'rgba(0,0,0,.35)');
  fade.addColorStop(1,'rgba(0,0,0,1)');
  g.globalCompositeOperation='destination-out';
  g.fillStyle=fade;g.fillRect(0,0,W,H);
  g.globalCompositeOperation='source-over';
  var t=new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;return t}

/* 柔云贴图（512px） */
export function makeCloudTex(){
  var cv=document.createElement('canvas');cv.width=512;cv.height=256;
  var g=cv.getContext('2d'),r=mulberry32(23);
  /* 底填充"白色透明"（而非默认黑透明）：透明区 RGB=白，缩小/mip 混合时
     不会把黑色混进云团（否则今日视角大 sprite 会偶发暗块） */
  g.fillStyle='rgba(255,255,255,0)';g.fillRect(0,0,512,256);
  for(var i=0;i<64;i++){
    var x=80+r()*352,y=88+r()*92,rr=32+r()*68;
    var rg=g.createRadialGradient(x,y,1,x,y,rr);
    rg.addColorStop(0,'rgba(255,255,255,'+(.09+r()*.13)+')');
    rg.addColorStop(.55,'rgba(255,255,255,'+(.04+r()*.06)+')');
    rg.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=rg;g.beginPath();g.arc(x,y,rr,0,7);g.fill()}
  var t=new THREE.CanvasTexture(cv);t.encoding=THREE.sRGBEncoding;return t}

/* 辉光点贴图 */
export function makeGlowTex(){
  var cv=document.createElement('canvas');cv.width=cv.height=64;
  var g=cv.getContext('2d');
  var rg=g.createRadialGradient(32,32,1,32,32,32);
  rg.addColorStop(0,'rgba(255,255,255,1)');rg.addColorStop(.3,'rgba(255,255,255,.5)');
  rg.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=rg;g.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(cv)}
