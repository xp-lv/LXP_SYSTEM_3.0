import THREE from '../three.js';
import {snoise,fbm,clamp,lerp,smooth01,C,
  makeWaterTex,makeFallTex,makeCloudTex} from './core.js';

/* ================= 三峰一谷 · 岛屿地形（可复用岛体构建） =================
   世界岛与今日小岛共用同一条管线：基准半径 VALLEY_BASE_R（demo 原尺 880），
   构建后按 R0/BASE_R 对整组做等比缩放——大小岛的山形/河网/崖壁完全同构。
   只含地形 + 河流 + 岛缘跌水；植被与任务树由 app 自己的树管线承担。

   地形语法（按海岛地貌设计）：
     · 三座山峰围绕谷地分布（火山岛式中央山地）
     · 岛屿整体向河口一侧倾斜，给河流一个总坡度
     · 一条宽谷 + 河槽沿谷地穿流，两侧山体形成谷壁
     · 岛缘有崖壁裙边，河流在岛缘跌落 */

export const VALLEY_BASE_R=880;

const waterU={value:0};
export function stepValley(dt){waterU.value+=dt}

/* 贴图按进程共享：两座岛的水纹/水帘/水雾用同一份 CanvasTexture，
   重建岛体时只释放几何与材质，贴图常驻（避免反复生成 512² 画布）。 */
let sharedTex=null;
function textures(){
  if(sharedTex)return sharedTex;
  const water=makeWaterTex();water.wrapS=water.wrapT=THREE.RepeatWrapping;
  const fall=makeFallTex();fall.wrapS=fall.wrapT=THREE.RepeatWrapping;
  const cloud=makeCloudTex();
  sharedTex={water,fall,cloud};
  return sharedTex;
}

export function buildValleyIslandBody(opts){
  opts=opts||{};
  const R0=VALLEY_BASE_R;
  const SECTORS=opts.sectors||240,RINGS=opts.rings||80;

  /* —— 河口方位 / 岛缘轮廓 —— */
  const OUT=1.75;
  function rimR(th){
    const n=fbm(Math.cos(th)*2.1+7.3,Math.sin(th)*2.1-2.9,3)*.5+.5;
    const n2=fbm(Math.cos(th)*5.3-3.1,Math.sin(th)*5.3+1.7,2)*.5+.5;
    return R0*(0.86+0.10*n+0.05*n2);
  }
  /* 三峰：右、上、左下 */
  const PEAK_DEFS=[
    {th:0.95,r:0.42,h:0.245,w:0.138,el:1.22},
    {th:2.55,r:0.35,h:0.185,w:0.122,el:1.10},
    {th:4.20,r:0.40,h:0.212,w:0.130,el:1.28}];
  const PEAKS=PEAK_DEFS.map(function(p){
    return{th:p.th,x:Math.cos(p.th)*p.r*R0,z:Math.sin(p.th)*p.r*R0,
      h:p.h*R0,w:p.w*R0,el:p.el}});

  /* 河流中心线：高地鞍部 → 谷地 → 河口 */
  const CTRL_DEFS=[
    {th:4.98,r:0.58},{th:3.95,r:0.33},{th:3.10,r:0.14},
    {th:2.35,r:0.30},{th:1.86,r:0.62},{th:1.75,r:0.985}];
  const CTRL=CTRL_DEFS.map(function(c){
    return new THREE.Vector3(Math.cos(c.th)*c.r*R0,0,Math.sin(c.th)*c.r*R0)});
  const curve=new THREE.CatmullRomCurve3(CTRL);
  const PATH=[];
  for(let i=0;i<150;i++){
    const pt=curve.getPoint(i/149);
    PATH.push({x:pt.x,z:pt.z})}
  for(let ps=0;ps<3;ps++)
    for(let i=1;i<PATH.length-1;i++){
      PATH[i].x=(PATH[i-1].x+PATH[i].x*2+PATH[i+1].x)/4;
      PATH[i].z=(PATH[i-1].z+PATH[i].z*2+PATH[i+1].z)/4}
  PATH.forEach(function(p,idx){
    const u=idx/(PATH.length-1);
    p.w=22+26*u;                                /* 河道半宽：下游更宽 */
  });
  /* —— 水面纵剖面：沿河道取原始地面高度，强平滑后单调下降 ——
     （隧道式：地形再按这个水位挖槽，河一定连续） */
  (function waterProfile(){
    const raw=[];
    for(let k=0;k<PATH.length;k++){
      const h=baseH(PATH[k].x,PATH[k].z);
      raw.push((h==null?0:h)+3.2)}
    for(let pass=0;pass<10;pass++)
      for(let k=1;k<raw.length-1;k++)raw[k]=(raw[k-1]+raw[k]*2+raw[k+1])/4;
    let prev=1e9;
    for(let k=0;k<raw.length;k++){
      if(raw[k]>prev)raw[k]=prev;prev=raw[k];
      PATH[k].wy=raw[k]}
  })();

  /* 最近河道距离（快速盒剔除 + 线性扫描） */
  const PBOX={minx:1e9,maxx:-1e9,minz:1e9,maxz:-1e9};
  PATH.forEach(function(p){
    if(p.x<PBOX.minx)PBOX.minx=p.x;if(p.x>PBOX.maxx)PBOX.maxx=p.x;
    if(p.z<PBOX.minz)PBOX.minz=p.z;if(p.z>PBOX.maxz)PBOX.maxz=p.z});
  const PAD=260;
  function pathNear(x,z){
    if(x<PBOX.minx-PAD||x>PBOX.maxx+PAD||z<PBOX.minz-PAD||z>PBOX.maxz+PAD)return null;
    let bd=1e9,bi=-1;
    for(let k=0;k<PATH.length;k++){
      const dx=x-PATH[k].x,dz=z-PATH[k].z,d=dx*dx+dz*dz;
      if(d<bd){bd=d;bi=k}}
    return{d:Math.sqrt(bd),i:bi,w:PATH[bi].w}}

  function baseH(x,z){
    const th=Math.atan2(z,x),Rt=rimR(th),r=Math.hypot(x,z),t=r/Rt;
    if(t>1)return null;
    let h=8+fbm(x*.0055+3.1,z*.0055-2.2,4)*18
         +snoise(x*.02-.6,z*.02+2.2)*5+snoise(x*.06+4.4,z*.06-1.7)*2;
    /* 整体倾斜：河口侧低、对侧高（河流的总坡度） */
    h+=30*(0.5-0.5*Math.cos(th-OUT));
    /* 三峰（沿各自径向拉长的穹丘 + 脊线噪声） */
    for(let k=0;k<PEAKS.length;k++){
      const pk=PEAKS[k],dx=x-pk.x,dz=z-pk.z;
      const ca=Math.cos(pk.th),sa=Math.sin(pk.th);
      const u=dx*ca+dz*sa,v=-dx*sa+dz*ca;
      const d2=(u*u)/(pk.w*pk.el*pk.w*pk.el)+(v*v)/(pk.w*pk.w);
      const ridge=1+.16*snoise(u*.006+3.3,v*.006-2.2);
      h+=pk.h*Math.exp(-d2*1.02)*ridge}
    h+=snoise(x*.012+9.1,z*.012-3.3)*7;
    const sm=smooth01((1-t)/.10);
    return 2+h*sm;
  }
  function heightAt(x,z){
    let h=baseH(x,z);
    if(h===null)return null;
    const sn=pathNear(x,z);
    if(sn){
      /* 宽谷：谷壁平缓过渡 */
      const uw=sn.w*5.2;
      if(sn.d<uw)h-=26*smooth01(1-sn.d/uw);
      /* 河槽：按已定水面纵剖面挖出连续河床 */
      const wY=PATH[sn.i].wy;
      if(wY!=null&&sn.d<sn.w*2.2){
        const bedT=wY-2.6-1.4*smooth01(1-sn.d/(sn.w*2.2));
        const bw=smooth01(1-sn.d/(sn.w*1.25));
        h=lerp(h,bedT,bw*.96)}
    }
    return h;
  }

  const inner=new THREE.Group();

  /* ================= 顶面地形网格 ================= */
  const rimPts=[];
  let terrainMat=null;
  (function terrain(){
    const pos=[],col=[],idx=[];
    const SC=function(h){return C(h).convertSRGBToLinear()};
    const cGrass=SC(0x55703c),cGrass2=SC(0x77814a),cRock=SC(0x7b7062),
        cRock2=SC(0x968b7c),cWet=SC(0x40522f),cSand=SC(0x8d7f63);
    for(let jj=0;jj<=RINGS;jj++){
      const fr=jj/RINGS,rr=lerp(.004,1,fr);
      for(let kk=0;kk<SECTORS;kk++){
        const th=kk/SECTORS*Math.PI*2,Rt=rimR(th)*rr;
        const x=Math.cos(th)*Rt,z=Math.sin(th)*Rt,h=heightAt(x,z);
        pos.push(x,h,z);
        /* 坡度 */
        const e=4,hx=heightAt(x+e,z),hz=heightAt(x,z+e);
        const slope=Math.hypot(((hx==null?h:hx)-h)/e,((hz==null?h:hz)-h)/e);
        const nA=fbm(x*.010+11,z*.010-5,3)*.5+.5;
        const nB=snoise(x*.05,z*.05)*.5+.5;
        const c=cGrass.clone().lerp(cGrass2,nA*.7+nB*.25);
        /* 高处岩石化 */
        if(h>95)c.lerp(cRock,clamp((h-95)/85,0,.85));
        /* 陡坡露岩 */
        c.lerp(cRock,clamp((slope-1.05)/.85,0,.9));
        c.lerp(cRock2,clamp((slope-1.9)/1.2,0,.6)*.5);
        /* 河谷湿地 */
        const sn=pathNear(x,z);
        if(sn&&sn.d<sn.w*4.5)
          c.lerp(cWet,clamp(1-sn.d/(sn.w*4.5),0,.55));
        /* 岛缘沙土 */
        const tt=Math.hypot(x,z)/rimR(th);
        if(tt>.90)c.lerp(cSand,clamp((tt-.90)/.10,0,1)*.75);
        c.multiplyScalar(.94+fbm(x*.07-3,z*.07+6,2)*.08);
        col.push(c.r,c.g,c.b);
        if(jj===RINGS)rimPts.push([x,h,z]);
      }
    }
    for(let jj=0;jj<RINGS;jj++)for(let kk=0;kk<SECTORS;kk++){
      const a=jj*SECTORS+kk,b=jj*SECTORS+(kk+1)%SECTORS,
          c2=(jj+1)*SECTORS+kk,d2=(jj+1)*SECTORS+(kk+1)%SECTORS;
      idx.push(a,b,c2,b,d2,c2)}
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    g.setIndex(idx);g.computeVertexNormals();
    terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0});
    const m=new THREE.Mesh(g,terrainMat);
    m.castShadow=true;m.receiveShadow=true;
    inner.add(m);
  })();

  /* ================= 崖壁裙边（岛底） ================= */
  (function cliff(){
    const radii=[1,.965,.915,.85,.76,.64,.50,.36,.22,.12];
    const depths=[0,28,66,112,168,232,304,386,470,540];
    const pos=[],col=[],idx=[];
    let prev=[];
    const dark=C(0x6a5945).convertSRGBToLinear();
    for(let r=0;r<radii.length;r++){
      const ring=[];
      for(let j=0;j<=SECTORS;j++){
        const jw=j%SECTORS,th=jw/SECTORS*Math.PI*2,rim=rimPts[jw];
        const t=r/(radii.length-1);
        const nz=fbm(Math.cos(th)*3.4+t*7.5,Math.sin(th)*3.4-t*5.2,3);
        const s=radii[r]*(1+nz*.05*t);
        const dep=depths[r]*R0/880*(1+.18*nz);
        let x=rim[0]*s,z=rim[2]*s,y=rim[1]-dep;
        if(r===0){x=rim[0]*1.002;z=rim[2]*1.002;y=rim[1]}
        pos.push(x,y,z);
        const cc=dark.clone().multiplyScalar(1-t*.55*(.8+nz*.4));
        cc.lerp(C(0x2b2520).convertSRGBToLinear(),t*.55);
        col.push(cc.r,cc.g,cc.b);
        ring.push(pos.length/3-1)}
      if(r>0)for(let j=0;j<SECTORS;j++)
        idx.push(prev[j],ring[j],prev[j+1],prev[j+1],ring[j],ring[j+1]);
      prev=ring}
    /* 底面收口 */
    let minY=1e9;
    for(let k2=0;k2<prev.length;k2++)minY=Math.min(minY,pos[prev[k2]*3+1]);
    const capC=C(0x2a241f).convertSRGBToLinear();
    let b0=pos.length/3;
    for(let j=0;j<SECTORS;j++){
      const iA=prev[j],iB=prev[(j+1)%SECTORS];
      pos.push(0,minY-30,0, pos[iA*3],pos[iA*3+1],pos[iA*3+2], pos[iB*3],pos[iB*3+1],pos[iB*3+2]);
      col.push(capC.r,capC.g,capC.b, capC.r,capC.g,capC.b, capC.r,capC.g,capC.b);
      idx.push(b0,b0+1,b0+2);b0+=3}
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    g.setIndex(idx);g.computeVertexNormals();
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({
      vertexColors:true,roughness:.96,metalness:.02,side:THREE.DoubleSide}));
    m.receiveShadow=true;
    inner.add(m);
  })();

  /* ================= 河流水面 + 源头湖 + 岛缘跌水 ================= */
  (function water(){
    const texes=textures();
    /* 水面高程：直接使用预计算的纵剖面（地形已按该水位挖槽） */
    const wy=PATH.map(function(p){return p.wy});
    /* 水面带：5 列，边缘贴地 */
    const COLS=5,v=[],uv=[],idx=[];
    let acc=0;
    for(let k=0;k<PATH.length;k++){
      const p=PATH[k];
      let nx=0,nz=0;
      if(k>0){const dx=p.x-PATH[k-1].x,dz=p.z-PATH[k-1].z,tl=Math.hypot(dx,dz)||1;nx=-dz/tl;nz=dx/tl}
      if(k>0)acc+=Math.hypot(p.x-PATH[k-1].x,p.z-PATH[k-1].z);
      for(let c=0;c<COLS;c++){
        const a=(c/(COLS-1))*2-1;
        const ww=p.w*.82;
        const wx=p.x+nx*ww*a,wz=p.z+nz*ww*a;
        let y2=wy[k];
        if(Math.abs(a)>.01){
          const th2=heightAt(wx,wz);
          if(th2!==null&&th2+.08>y2)y2=Math.min(th2+.08,wy[k]+.25)}
        v.push(wx,y2,wz);uv.push((a+1)/2,acc/(p.w*4))}
    }
    for(let k=0;k<PATH.length-1;k++)
      for(let c2=0;c2<COLS-1;c2++){
        const A=k*COLS+c2,B=(k+1)*COLS+c2;
        idx.push(A,B,A+1,A+1,B,B+1)}
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(idx);g.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({map:texes.water,transparent:true,opacity:.9,
      roughness:.92,metalness:0,color:new THREE.Color(0x4e6d78).convertSRGBToLinear(),side:THREE.DoubleSide,depthWrite:false});
    mat.onBeforeCompile=function(sh){
      sh.uniforms.uTime=waterU;
      sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace(
        '#include <uv_vertex>','#include <uv_vertex>\n\tvUv += vec2(0.0, uTime*0.22);')};
    const mesh=new THREE.Mesh(g,mat);mesh.renderOrder=2;inner.add(mesh);
    /* 源头小湖 */
    const src=PATH[0];
    const lg=new THREE.CircleGeometry(46,30);lg.rotateX(-Math.PI/2);
    const lm=new THREE.MeshStandardMaterial({color:new THREE.Color(0x4e6d78).convertSRGBToLinear(),transparent:true,opacity:.9,
      roughness:.92,metalness:0,side:THREE.DoubleSide,depthWrite:false});
    const lake=new THREE.Mesh(lg,lm);lake.position.set(src.x,wy[0]+.05,src.z);
    lake.renderOrder=2;inner.add(lake);
    /* 岛缘跌水 */
    const last=PATH[PATH.length-1];
    const end={x:last.x,z:last.z,y:wy[wy.length-1]-1.2,th:Math.atan2(last.z,last.x)};
    const fw=28,fh=200;
    const fg=new THREE.PlaneGeometry(fw,fh,8,3);
    const fp=fg.attributes.position;
    for(let k=0;k<fp.count;k++){
      const fx=fp.getX(k),fy=fp.getY(k);
      fp.setZ(k,Math.cos(fx/fw*Math.PI)*fw*.06)}
    fg.computeVertexNormals();
    const fm=new THREE.MeshStandardMaterial({map:texes.fall,transparent:true,opacity:.65,
      roughness:.3,metalness:0,color:new THREE.Color(0xdfeef2).convertSRGBToLinear(),side:THREE.DoubleSide,depthWrite:false});
    fm.onBeforeCompile=function(sh){
      sh.uniforms.uTime=waterU;
      sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace(
        '#include <uv_vertex>','#include <uv_vertex>\n\tvUv += vec2(0.0, uTime*0.55);')};
    const fall=new THREE.Mesh(fg,fm);
    fall.position.set(end.x,end.y-fh/2,end.z);
    fall.rotation.y=Math.PI/2-end.th;
    fall.renderOrder=3;inner.add(fall);
    /* 落点水雾 */
    for(let k=0;k<3;k++){
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:texes.cloud,color:0xeef6f8,
        transparent:true,opacity:.16+depthRnd(k)*.03,depthWrite:false,fog:false,toneMapped:false}));
      const tnx=Math.cos(end.th+Math.PI/2),tnz=Math.sin(end.th+Math.PI/2);
      sp.position.set(end.x+tnx*(k-1)*fw*.35,end.y-fh*.98,end.z+tnz*(k-1)*fw*.35);
      sp.scale.set(fw*1.6,fw*.7,1);
      sp.renderOrder=4;inner.add(sp)}
    function depthRnd(k){return ((k*37)%10)/10}
  })();

  /* —— 等比缩放：大岛 S=1；今日小岛 S<1，轮廓与河网保持一致 —— */
  const S=(opts.R0||VALLEY_BASE_R)/VALLEY_BASE_R;
  if(S!==1)inner.scale.setScalar(S);

  function dispose(){
    inner.traverse(function(o){
      if(o.geometry)o.geometry.dispose();
      if(o.material)o.material.dispose()});
    if(inner.parent)inner.parent.remove(inner);
    inner.clear();
  }

  return {
    inner:inner,
    scale:S,
    R0:opts.R0||VALLEY_BASE_R,
    heightAt:function(x,z){
      const h=heightAt(x/S,z/S);
      return h==null?null:h*S},
    peaks:PEAKS,
    path:PATH,
    terrainMat:terrainMat,
    dispose:dispose
  };
}
