import THREE from '../three.js';
import {clamp,lerp,smooth01,mulberry32,snoise,C,makeBarkTex,makeGlowTex} from './core.js';
import {windify,woodDepthMat} from './env.js';

/* ================= demo 任务树建造器（移植自 demo/tree-proj/js/02-tree.js 骨架版） =================
   骨架+树皮蒙皮+断面红光+完成叶团。在 app 中的语义映射：
   末梢任务已排期/已完成 → 单日末梢（完成即叶团）
   末梢任务未排期未完成   → 断梢红光（待分解/待排期）
   子树全部完成 → 分叉处叶团；骨架永不消失 */

var barkMat=null,leafMatShared=null,GLOWTEX=null;
export function initGoalMats(){
  if(barkMat)return;
  var bark=makeBarkTex();
  barkMat=windify(new THREE.MeshStandardMaterial({map:bark.map,bumpMap:bark.bump,bumpScale:.14,
    roughness:.76,metalness:0,vertexColors:true,side:THREE.DoubleSide}),'wood');
  leafMatShared=windify(new THREE.MeshStandardMaterial({vertexColors:true,color:0xcfc0a0,
    flatShading:false,roughness:.65,metalness:0,emissive:0x6a4a10,emissiveIntensity:.22}),'leaf');
  GLOWTEX=makeGlowTex();
}

var GOLD=C(0xE8A820),GOLD_DEEP=C(0x6a4a0c);
var FROST=C(0xbfd4de);

/* —— 补间 —— */
var tweens=[];
function tween(dur,delay,fn,done){tweens.push({t:-(delay||0),dur:dur,fn:fn,done:done})}
function stepTweens(dt){
  for(var i=tweens.length-1;i>=0;i--){var tw=tweens[i];tw.t+=dt;
    if(tw.t<0)continue;
    var k=Math.min(1,tw.t/tw.dur);tw.fn(k);
    if(k>=1){tweens.splice(i,1);tw.done&&tw.done()}}}

/* —— 断面红光注册表 —— */
var beacons=[];
export function clearBeacons(){beacons.length=0}
function stepBeacons(tG){
  for(var i=0;i<beacons.length;i++){
    var b=beacons[i],w=Math.sin(tG*2.2+b.ph);
    b.core.scale.setScalar(1+w*.12);
    b.spr.material.opacity=b.op*(.78+.22*w);
    b.spr.scale.setScalar(b.r*7.5*(1+w*.16));
  }
}

/* —— 小 toast（完成叶团反馈） —— */
var toastEl=null,toastTimer=null;
function showToast(t,ms){
  if(!toastEl){toastEl=document.createElement('div');
    toastEl.style.cssText='position:fixed;z-index:60;left:50%;bottom:64px;transform:translateX(-50%);'+
      'padding:9px 16px;border-radius:20px;white-space:nowrap;pointer-events:none;'+
      'background:rgba(12,14,22,.92);border:1px solid rgba(232,194,74,.35);'+
      'font:600 12px "Microsoft YaHei",sans-serif;color:#EFD9A0;opacity:0;transition:opacity .4s';
    document.body.appendChild(toastEl)}
  toastEl.textContent=t;toastEl.style.opacity=1;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){toastEl.style.opacity=0},ms||2600)}

/* —— 叶团（可重染色聚合球） —— */
function buildBlob(center,R,rng,rough){
  rough=rough||.12;
  var base=new THREE.SphereGeometry(1,30,22),bp=base.attributes.position,bn=base.attributes.normal;
  var phase=rng()*6.28;
  var pos=[],nrm=[],sway=[],vH=[],vJ=[],vF=[],i;
  for(i=0;i<bp.count;i++){
    var v=new THREE.Vector3().fromBufferAttribute(bp,i);
    var d=1+(snoise(v.x*1.5+phase,v.y*1.5)*.5+snoise(v.y*1.7,v.z*1.7+phase)*.5)*rough;
    v.multiplyScalar(d);v.y*=.78;
    pos.push(center.x+v.x*R,center.y+v.y*R,center.z+v.z*R);
    nrm.push(bn.getX(i),bn.getY(i),bn.getZ(i));
    vH.push(clamp(v.y*.5+.5,0,1));
    vJ.push(rng()-.5);
    vF.push(rng());
    sway.push(phase,.7+rng()*.9,.8+rng()*.8)}
  var g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(bp.count*3),3));
  g.setAttribute('aSway',new THREE.Float32BufferAttribute(sway,3));
  g.setIndex(base.index);
  g.computeVertexNormals();
  var mesh=new THREE.Mesh(g,leafMatShared);mesh.castShadow=true;
  var rec={mesh:mesh,R:R,
    recolor:function(gold,frost){
      var gg=Math.pow(clamp(gold,0,1),.8);
      var lo=C(0x241a06).lerp(GOLD_DEEP,.5*gg),
          hi=C(0x8a6414).lerp(GOLD,gg),
          arr=g.attributes.color.array,c=C(0),k;
      for(k=0;k<vH.length;k++){
        c.copy(lo).lerp(hi,.35+.65*vH[k]);
        if(vJ[k]>0)c.lerp(C(0xE8C878),vJ[k]*vH[k]*.4);
        else c.lerp(C(0x9a7a22),-vJ[k]*vH[k]*.4);
        if(vF[k]<frost)c.lerp(FROST,.82);
        arr[k*3]=c.r;arr[k*3+1]=c.g;arr[k*3+2]=c.b}
      g.attributes.color.needsUpdate=true}};
  rec.recolor(1,0);
  rec.recolorLeaf=function(){
    var arr=g.attributes.color.array,c=C(0),k;
    for(k=0;k<vH.length;k++){
      c.copy(C(0x2e5a22)).lerp(C(0x86b45e),.25+.75*vH[k]);
      if(vJ[k]>0)c.lerp(C(0x9cb86a),vJ[k]*vH[k]*.3);
      arr[k*3]=c.r;arr[k*3+1]=c.g;arr[k*3+2]=c.b}
    g.attributes.color.needsUpdate=true};
  return rec}

/* —— 分枝路径工具 —— */
function dirFromPolar(parent,tilt,az){
  var q=new THREE.Quaternion().setFromAxisAngle(parent,az);
  var side=new THREE.Vector3(1,0,0);
  if(Math.abs(parent.x)>.9)side.set(0,0,1);
  var perp=new THREE.Vector3().crossVectors(parent,side).normalize();
  return perp.applyQuaternion(q).multiplyScalar(Math.sin(tilt))
    .addScaledVector(parent,Math.cos(tilt)).normalize()}
function curvePoint(pts,t){
  var f=clamp(t,0,1)*(pts.length-1),i=Math.floor(f),fr=f-i;
  return pts[Math.min(i,pts.length-1)].clone().lerp(pts[Math.min(i+1,pts.length-1)],fr)}
function capsAlong(curve,rAt,t0,t1,n){
  var caps=[],i;
  for(i=0;i<n;i++){
    var ta=t0+(t1-t0)*i/n,tb=t0+(t1-t0)*(i+1)/n;
    caps.push({a:curve.getPoint(ta),b:curve.getPoint(tb),ra:rAt(ta),rb:rAt(tb)})}
  return caps}
function segSegDist(p1,q1,p2,q2){
  var d1x=q1.x-p1.x,d1y=q1.y-p1.y,d1z=q1.z-p1.z;
  var d2x=q2.x-p2.x,d2y=q2.y-p2.y,d2z=q2.z-p2.z;
  var rx=p1.x-p2.x,ry=p1.y-p2.y,rz=p1.z-p2.z;
  var a=d1x*d1x+d1y*d1y+d1z*d1z;
  var e=d2x*d2x+d2y*d2y+d2z*d2z;
  var f=d2x*rx+d2y*ry+d2z*rz;
  var s,t;
  if(a<=1e-9&&e<=1e-9){s=0;t=0}
  else if(a<=1e-9){s=0;t=clamp(f/e,0,1)}
  else{
    var c=d1x*rx+d1y*ry+d1z*rz;
    if(e<=1e-9){s=clamp(-c/a,0,1);t=0}
    else{
      var b=d1x*d2x+d1y*d2y+d1z*d2z;
      var den=a*e-b*b;
      s=den>1e-9?clamp((b*f-c*e)/den,0,1):0;
      t=(b*s+f)/e;
      if(t<0){s=clamp(-c/a,0,1);t=0}
      else if(t>1){s=clamp((b-e)/a,0,1);t=1}}}
  var dx=p1.x+d1x*s-(p2.x+d2x*t),
      dy=p1.y+d1y*s-(p2.y+d2y*t),
      dz=p1.z+d1z*s-(p2.z+d2z*t);
  return Math.sqrt(dx*dx+dy*dy+dz*dz)}
function pathCollides(colliders,newSegs,exempt){
  for(var i=0;i<colliders.length;i++){
    var col=colliders[i],own=(col===exempt),j,k;
    for(j=own?2:1;j<newSegs.length;j++){
      var ns=newSegs[j];
      for(k=0;k<col.segs.length;k++){
        var os=col.segs[k];
        if(segSegDist(ns.a,ns.b,os.a,os.b)<ns.ra+os.rb+1.1)return true}}}
  return false}

/* —— 扫掠管缓冲 —— */
function TubeWriter(){
  this.pos=[];this.nrm=[];this.uv=[];this.idx=[];this.col=[];this.aww=[];this.vLen=0}
TubeWriter.prototype.mesh=function(mat){
  var g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nrm,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));
  g.setAttribute('aWw',new THREE.Float32BufferAttribute(this.aww,2));
  g.setIndex(this.idx);
  var m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;
  m.customDepthMaterial=woodDepthMat;
  return m};

/* —— 扫掠一根枝 —— */
function sweepTube(w,pts,r0,r1,o){
  o=o||{};
  var curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.3);
  var LEN=curve.getLength();
  var segs=clamp(Math.round(LEN/(o.den||4.5))+2,3,18);
  var rad=o.radial||9;
  var i,j,Tp=curve.getTangent(0).normalize(),Np=new THREE.Vector3(1,0,0);
  if(Math.abs(Tp.x)>.9)Np.set(0,0,1);
  Np.crossVectors(Tp,Np).normalize();
  var norm=[],bin=[];
  for(var q2=0;q2<=segs;q2++){
    var tg=curve.getTangent(clamp(q2/segs,0,1)).normalize();
    Np.sub(tg.clone().multiplyScalar(Np.dot(tg)));
    if(Np.lengthSq()<1e-8){Np.set(tg.z,0,-tg.x);if(Np.lengthSq()<1e-8)Np.set(0,-tg.z,tg.x)}
    Np.normalize();
    norm.push(Np.clone());bin.push(new THREE.Vector3().crossVectors(tg,Np))}
  var rAvg=(r0+r1)*.5;
  var uWrap=clamp(Math.round(2*Math.PI*rAvg/9.5),1,6);
  var vJit=(o.vJit||0);
  var ringBase=w.pos.length/3;
  var v0=w.vLen;
  var aoLen=Math.max(r0*1.5,1.5);
  var wnd=o.wind,phase=wnd?wnd.phase:0;
  var wf=wnd?wnd.base*(.35+.65*clamp((curve.getPoint(.5).y-wnd.baseY)/wnd.H,0,1)):0;
  for(i=0;i<=segs;i++){
    var t=i/segs,p=curve.getPoint(t),rr=lerp(r0,r1,Math.pow(t,.9)),fl=0;
    if(o.flare){fl=Math.pow(Math.max(0,1-t*LEN/o.flare),2);
      rr+=r0*o.flareMul*fl}
    var N=norm[Math.min(i,segs)],B=bin[Math.min(i,segs)];
    var tg=curve.getTangent(Math.min(t,1));
    var arc=t*LEN;
    var ao=o.ao?lerp(.8,1,smooth01(arc/aoLen)):1;
    var wv=fl*.45;
    for(j=0;j<rad;j++){
      var a=j/rad*Math.PI*2,cx=Math.cos(a),sx=Math.sin(a);
      var nx=N.x*cx+B.x*sx,ny=N.y*cx+B.y*sx,nz=N.z*cx+B.z*sx;
      var vx=p.x+nx*rr,vy=p.y+ny*rr,vz=p.z+nz*rr;
      w.pos.push(vx,vy,vz);
      w.nrm.push(nx*(1-wv)-tg.x*wv,ny*(1-wv)-tg.y*wv,nz*(1-wv)-tg.z*wv);
      w.col.push(ao,ao,ao);
      w.uv.push(j/rad*uWrap+vJit*.13,(v0+arc)/9.5);
      w.aww.push(wf,phase)}}
  for(i=0;i<segs;i++)for(j=0;j<rad;j++){
    var r1i=ringBase+i*rad+j,r2i=ringBase+i*rad+(j+1)%rad,
        r3i=ringBase+(i+1)*rad+j,r4i=ringBase+(i+1)*rad+(j+1)%rad;
    w.idx.push(r1i,r3i,r2i,r2i,r3i,r4i)}
  var lastP=curve.getPoint(1);
  var fn=norm[segs],fb=bin[segs];
  var mainRing=ringBase+segs*rad;
  var tip=o.tip||'round';
  if(tip==='point'){
    var tan=curve.getTangent(1).normalize();
    var CAPS=[{o:.45,s:.5,w:.42},{o:.9,s:.12,w:.72}];
    var prev=mainRing,cap,q3;
    for(q3=0;q3<CAPS.length;q3++){
      cap=w.pos.length/3;
      var CP=CAPS[q3],cc=lastP.clone().addScaledVector(tan,CP.o*r1);
      for(j=0;j<rad;j++){
        var a4=j/rad*Math.PI*2,cx4=Math.cos(a4),sx4=Math.sin(a4);
        var rx=fn.x*cx4+fb.x*sx4,ry=fn.y*cx4+fb.y*sx4,rz=fn.z*cx4+fb.z*sx4;
        w.pos.push(cc.x+rx*r1*CP.s,cc.y+ry*r1*CP.s,cc.z+rz*r1*CP.s);
        w.nrm.push(rx*(1-CP.w)+tan.x*CP.w,ry*(1-CP.w)+tan.y*CP.w,rz*(1-CP.w)+tan.z*CP.w);
        w.col.push(1,1,1);
        w.uv.push(j/rad*uWrap,(v0+LEN)/9.5+CP.o*r1/9.5);
        w.aww.push(wf,phase)}
      for(j=0;j<rad;j++){
        var pj=prev+j,pj2=prev+(j+1)%rad,cj=cap+j,cj2=cap+(j+1)%rad;
        w.idx.push(pj,cj,pj2,pj2,cj,cj2)}
      prev=cap}
    var apex=w.pos.length/3;
    var apexP=lastP.clone().addScaledVector(tan,r1);
    w.pos.push(apexP.x,apexP.y,apexP.z);
    w.nrm.push(tan.x,tan.y,tan.z);w.col.push(1,1,1);w.uv.push(.5,(v0+LEN)/9.5+r1/9.5);
    w.aww.push(wf,phase);
    for(j=0;j<rad;j++)w.idx.push(apex,prev+j,prev+(j+1)%rad)}
  w.vLen=v0+LEN/9.5;
  return w}

/* ================= 数据适配：app 任务树 → demo cfg =================
   内节点 → ch 分叉；叶子任务：
     已完成/已排期 → 单日末梢（days:[{done}]）
     未排期未完成   → 断梢（无 days → 红光，语义=待分解/待排期） */
export function cfgFromApp(n){
  var kids=n.children&&n.children.length;
  if(kids)return{t:n.title,app:n,ch:n.children.map(cfgFromApp)};
  var done=(n.progress||0)>=1;
  var planned=!!(n.assignD||n.assignW);            /* assignM 不算已排期（bare 定义已定） */
  var hours=Math.max(1,n.hours||2);
  if(done||planned)return{t:n.title,app:n,est:hours,
    days:[{t:n.title,h:hours,done:done,app:n}]};
  return{t:n.title,app:n,est:hours}}
export function appCfg(root,seed,H){
  return{name:root.title,seed:seed,H:H,
    trunkR:H*.06,rootR:H*.28,leafScale:clamp(H/190,.6,2.2),lean:.2,
    data:{t:root.title,app:root,ch:(root.children||[]).map(cfgFromApp)}}}

/* —— 完成判定（demo 语义） —— */
function estOf(n){
  if(n.days&&n.days.length){var s=0,i;for(i=0;i<n.days.length;i++)s+=n.days[i].h;return s}
  if(n.ch&&n.ch.length){var s2=0,j;for(j=0;j<n.ch.length;j++)s2+=estOf(n.ch[j]);return s2}
  return n.est||0}
function isCompleteNode(n){
  if(n.days&&n.days.length)return n.days.every(function(d){return d.done});
  if(n.ch&&n.ch.length)return n.ch.every(isCompleteNode);
  return false}
function isCompleteGoal(cfg){
  return !!(cfg.data.ch&&cfg.data.ch.length&&cfg.data.ch.every(isCompleteNode))}

/* ================= 建树 =================
   cfg: appCfg 输出；base:{x,y,z} 树基世界坐标（y=岛面高度）
   opts: {perBranch:每枝独立网格(激活树,可按节点拾取), onMesh:注册回调,
          distant:远景树标记, treeRoot:远景树拾取时激活的 app 根节点} */
export function buildGoalTree(cfg,base,opts){
  var o=opts||{};
  initGoalMats();                                /* 任何调用顺序都先备好共享材质 */
  base=new THREE.Vector3(base.x,base.y,base.z);   /* 兼容普通坐标对象 */
  var rng=mulberry32(cfg.seed);
  var grp=new THREE.Group();
  var tree={cfg:cfg,grp:grp,rng:rng,recs:[],colliders:[],
    baseY:base.y,wPh:(cfg.seed*.73)%6.283,
    rootSlot:{pos:null,seed:cfg.seed*3+1,tuft:null},
    appRoot:o.treeRoot||cfg.data.app||null};
  var lines=[],dots=[];
  var SKEL_COL=[C(0xF0D2A2),C(0xE0BC8C),C(0xCEA678),C(0xBC9266)];
  /* 骨架姿态路径:整枝平滑单弧 + 末两段抬头(趋光收尾) */
  function arcPath(rng2,p0,dir0,len,arc,tipUp,jit,nSeg){
    var pts=[p0.clone()],d=dir0.clone().normalize(),i;
    var bendAx=new THREE.Vector3(rng2()-.5,0,rng2()-.5);
    if(bendAx.lengthSq()<.01)bendAx.set(1,0,0);
    bendAx.normalize();
    var bendAmt=(rng2()-.5)*arc;
    for(i=0;i<nSeg;i++){
      d.normalize();
      d.addScaledVector(bendAx,bendAmt*2/nSeg);
      if(i>=nSeg-2)d.y+=tipUp*(.6+(i-(nSeg-2))*.8);
      d.x+=(rng2()-.5)*jit;d.z+=(rng2()-.5)*jit;
      d.normalize();
      pts.push(p0.clone().addScaledVector(d,len*(i+1)/nSeg))}
    return pts}
  /* 完成叶团 */
  function growTuft(anchor,tipDir,est,seed,instant){
    var R=(2.4+Math.sqrt(Math.max(1,est))*.6)*cfg.leafScale;
    var off;
    if(tipDir){off=tipDir.clone();off.y*=.55;
      if(off.lengthSq()<1e-4)off.set(0,1,0);off.normalize()}
    else{off=new THREE.Vector3(anchor.x-base.x,0,anchor.z-base.z);
      if(off.lengthSq()<1e-4)off.set(0,1,0);else off.normalize()}
    var c=anchor.clone().addScaledVector(off,R*.62);c.y+=R*.3;
    var tRec=buildBlob(c,R,mulberry32(seed),.28);
    tRec.recolorLeaf();
    if(instant)tRec.mesh.scale.set(1,1,1);
    else{tRec.mesh.scale.set(.01,.01,.01);
      tween(.65,0,function(k){
        var e=Math.max(.01,1+2.7*Math.pow(k-1,3)+1.7*Math.pow(k-1,2));
        tRec.mesh.scale.set(e,e,e)})}
    grp.add(tRec.mesh);
    return tRec}
  function dropTuft(slot){
    var tRec=slot.tuft;if(!tRec)return;
    tween(.4,0,function(k){var s=Math.max(.01,1-k);tRec.mesh.scale.set(s,s,s)},
      function(){if(tRec.mesh.parent)grp.remove(tRec.mesh)});
    slot.tuft=null}
  tree.syncTufts=function(instant){
    var newly=[];
    tree.recs.forEach(function(rec){
      var want=isCompleteNode(rec.cfg);
      if(want&&!rec.tuft){
        rec.tuft=growTuft(rec.tip,rec.tipDir,estOf(rec.cfg),rec.seed*5+3,instant);
        if(!instant)newly.push(rec.cfg.t)}
      else if(!want&&rec.tuft)dropTuft(rec)});
    if(isCompleteGoal(cfg)){
      if(!tree.rootSlot.tuft){
        tree.rootSlot.tuft=growTuft(tree.rootSlot.pos,null,estOf(cfg.data),
          tree.rootSlot.seed*5+3,instant);
        if(!instant)newly.push(cfg.name)}}
    else if(tree.rootSlot.tuft)dropTuft(tree.rootSlot);
    if(newly.length)showToast('「'+newly.join('」「')+'」全部完成 · 长出叶团')};
  /* 日梢指线:已排期/已完成末梢的短果枝 */
  function dayFingers(rec,blen){
    var dirN=rec.tipDir.clone().normalize(),k=rec.cfg.days.length,i;
    for(i=0;i<k;i++){
      var sector=Math.PI*2/k;
      var az=i*sector+(rng()-.5)*sector*.5;
      var toDir=dirFromPolar(dirN,.4+rng()*.15,az);
      var flen=Math.max(blen*(.22+((i%2)?.05:0)),4);
      var fr=Math.max(rec.tipR*.62,.5);
      lines.push({pts:[rec.tip.clone(),
        rec.tip.clone().addScaledVector(toDir,flen*.55).add(new THREE.Vector3(0,flen*.1,0)),
        rec.tip.clone().addScaledVector(toDir,flen)],
        depth:Math.min(rec.depth+1,3),finger:true,
        r0:fr,r1:Math.max(fr*.5,.5),radial:5,den:2.4,tip:'point',
        p0:rec.tip.clone().addScaledVector(dirN,-fr*.6),
        app:rec.cfg.days[i].app})}}
  /* 递归生长 */
  function growNode(up,nd,attach,dir3,level,azj,parentEndR,parentLen,lead){
    var len=Math.max(parentLen*(lead?.72:.58)*(.88+.24*rng()),12);
    var hasKids=!!(nd.ch&&nd.ch.length);
    var blen=hasKids?len*.5:len;
    var bud=hasKids?len*.62:len;
    var pE=parentEndR||1;
    var share=up?Math.max(.12,estOf(nd)/Math.max(1,estOf(up.cfg))):1;
    var base0=lead?pE*.85:pE*.92*clamp(.62*Math.sqrt(share),.45,.75);
    base0=clamp(Math.max(base0,.9),0,pE);
    var endR=clamp(Math.max(base0*(lead?.62:.55),.6),0,base0);
    var a3=attach.clone().addScaledVector(dir3,-base0*(lead?.45:.5));
    var pts=null,curve=null,csegs=null,attempt=0,dirUse=dir3;
    var axis=(up&&up.tipDir)?up.tipDir.clone().normalize():null;
    while(attempt<5){
      pts=arcPath(rng,a3,dirUse,blen,.32,.16,.06,4);
      curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5);
      csegs=capsAlong(curve,function(tc){return lerp(base0,endR,Math.pow(tc,.9))},0,1,5);
      if(!pathCollides(tree.colliders,csegs,up?up.col:null))break;
      attempt++;
      if(attempt>=3)len*=.85;
      if(axis)dirUse=dir3.clone().applyAxisAngle(axis,(attempt%2?1:-1)*.22*Math.ceil(attempt/2))}
    var bare=!(nd.days&&nd.days.length)&&!(nd.ch&&nd.ch.length);
    lines.push({pts:pts,depth:Math.min(level,3),r0:base0,r1:endR,
      radial:6,den:3.2,tip:bare?'point':'round',
      p0:a3.clone().addScaledVector(dir3,-base0*.55),
      flare:base0*1.2,flareMul:.18,app:nd.app});
    tree.colliders.push({segs:csegs});
    var end=pts[pts.length-1];
    var dirE=end.clone().sub(pts[pts.length-2]).normalize();
    var rec={cfg:nd,up:up,col:{segs:csegs},seed:(cfg.seed*13+level*57+Math.round(azj*97))|0,
      pos:end.clone(),tip:end.clone(),tipDir:dirE,
      tipR:endR*.6,stemR:endR,
      R:(2.4+Math.sqrt(Math.max(1,estOf(nd)))*.6)*cfg.leafScale,
      depth:level,tuft:null};
    tree.recs.push(rec);nd._rec=rec;
    if(bare)dots.push({p:end.clone(),depth:level});
    if(nd.ch&&nd.ch.length){
      nd.ch.forEach(function(gk,j){
        var lead2=(j===0);
        var az2=azj+j*2.39996+(rng()-.5)*.4;
        var tilt4=lead2?(rng()-.5)*.28:.62-.18*(j/Math.max(1,nd.ch.length-1));
        var dir4=dirFromPolar(dirE,tilt4,az2);
        growNode(rec,gk,end.clone(),dir4,level+1,az2,endR,bud,lead2)})}
    else if(nd.days&&nd.days.length)dayFingers(rec,blen);
  }
  /* 根须 */
  var rootSegs=[],nRoot=4+Math.floor(rng()*2),ra;
  var az0=rng()*Math.PI*2;
  var tkR=cfg.trunkR*.15+cfg.H*.04;
  for(ra=0;ra<nRoot;ra++){
    var ang=ra/nRoot*Math.PI*2+rng()*.5,rr=cfg.rootR*(.7+rng()*.4);
    var outDir=new THREE.Vector3(Math.cos(ang),-.05,Math.sin(ang)).normalize();
    var mid=base.clone().addScaledVector(outDir,rr*.55);mid.y+=cfg.rootR*.28;
    var endP=base.clone().addScaledVector(outDir,rr);endP.y-=5+rng()*3;
    var rc=new THREE.CatmullRomCurve3([base.clone(),mid,endP.clone()],false,'catmullrom',.5);
    lines.push({pts:[base.clone(),mid,endP.clone()],depth:0,
      r0:tkR*.6,r1:tkR*.14,radial:9,den:6,tip:'round',app:cfg.data.app});
    rootSegs.push.apply(rootSegs,capsAlong(rc,
      function(tc){return lerp(tkR*.5,tkR*.11,tc)},0,1,3))}
  tree.colliders.push({segs:rootSegs});
  /* 主干 */
  var trunkDir=new THREE.Vector3((rng()-.5)*(cfg.lean||.2)*1.3,1,(rng()-.5)*(cfg.lean||.2)*1.3).normalize();
  var n2s=cfg.data.ch||[],n2=n2s.length;
  var estMax=1,i;
  for(i=0;i<n2;i++)estMax=Math.max(estMax,estOf(n2s[i]));
  var trunkPts=arcPath(rng,base,trunkDir,cfg.H,.34,.05,.10,7);
  var rEnd=tkR*.45;
  var trunkRat=function(t){return lerp(tkR*1.2,rEnd,Math.pow(t,.85))};
  var trunkCurve=new THREE.CatmullRomCurve3(trunkPts,false,'catmullrom',.5);
  lines.push({pts:trunkPts,depth:0,r0:tkR*1.2,r1:rEnd,
    radial:12,den:4.5,tip:'round',flare:tkR*1.6,flareMul:.4,app:cfg.data.app});
  var trunkCol={segs:capsAlong(trunkCurve,trunkRat,0,1,8)};
  tree.colliders.push(trunkCol);
  tree.rootSlot.pos=curvePoint(trunkPts,.88);
  if(!n2)dots.push({p:trunkPts[trunkPts.length-1].clone(),depth:0});   /* 断木桩 */
  /* 一级臂 */
  for(i=0;i<n2;i++){
    var n2c=n2s[i],f2=i/Math.max(1,n2-1);
    var isLead=(i===n2-1);
    var t2=isLead?.93:clamp(lerp(.30,.78,f2)+(rng()-.5)*.05,.26,.82);
    var az2b=isLead?az0:az0+i*2.39996+(rng()-.5)*.7;
    var tilt0=isLead?.38+(rng()-.5)*.1:clamp(lerp(1.15,.55,f2)+(rng()-.5)*.16,.35,1.3);
    var share1=Math.max(.1,estOf(n2c)/Math.max(1,estMax));
    var rt2b=trunkRat(t2);
    var rad=isLead?Math.max(1.4,rt2b*.7):clamp(rt2b*Math.sqrt(share1)*.62,.9,rt2b*.58);
    var anchor=curvePoint(trunkPts,t2);
    var len=isLead?cfg.H*.25:cfg.H*((1-t2)*.72+.16+rng()*.07);
    var kids2=(n2c.ch&&n2c.ch.length)?n2c.ch:null;
    var blen=kids2?len*.5:len;
    var bud=kids2?len*.62:len;
    var base1=Math.max(rad*1.05,1.0);
    var pts=null,dir2=null,attempt=0;
    while(attempt<5){
      dir2=dirFromPolar(trunkDir,clamp(tilt0+(attempt%2?1:-1)*.18*Math.ceil(attempt/2),.15,1.25),az2b);
      pts=arcPath(rng,anchor,dir2,blen,.36,.12,.08,5);
      var pc=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5);
      var cs=capsAlong(pc,function(tc){return lerp(base1,rad*.5,Math.pow(tc,.8))},0,1,6);
      if(!pathCollides(tree.colliders,cs,trunkCol))break;
      attempt++}
    var l1Curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',.5);
    lines.push({pts:pts,depth:1,r0:base1,r1:rad*.5,radial:9,den:4.5,
      tip:kids2?'round':'point',
      p0:anchor.clone().addScaledVector(dir2,-base1*.55),
      flare:base1*1.3,flareMul:.28,app:n2c.app});
    var l1Col={segs:capsAlong(l1Curve,function(tc){return lerp(base1,rad*.5,Math.pow(tc,.9))},0,1,6)};
    tree.colliders.push(l1Col);
    var tipPt=curvePoint(pts,1);
    var l1rec={cfg:n2c,up:null,col:l1Col,seed:cfg.seed*7+i+2,
      pos:curvePoint(pts,.5),tip:tipPt,
      tipDir:curvePoint(pts,1).clone().sub(curvePoint(pts,.85)).normalize(),
      tipR:rad*.5,R:(2.4+Math.sqrt(Math.max(1,estOf(n2c)))*.6)*cfg.leafScale,
      depth:1,tuft:null};
    tree.recs.push(l1rec);n2c._rec=l1rec;
    if(kids2){
      var dirE1=l1rec.tipDir,tip3=tipPt,rEnd1=rad*.5;
      kids2.forEach(function(n3,j){
        var lead=(j===0);
        var tilt3=lead?(rng()-.5)*.18:clamp(lerp(.5,1.1,rng())+(rng()-.5)*.2,.3,1.35);
        var az3=lead?az0+i*2.39996+(rng()-.5)*.2
                    :az0+i*2.39996+rng()*Math.PI*2;
        var dir3=dirFromPolar(dirE1,tilt3,az3);
        growNode(l1rec,n3,tip3,dir3,2,az0+i*2.39996+j*2.39996,rEnd1,bud,lead)});
    }else{
      dots.push({p:tipPt.clone(),depth:1});
      if(n2c.days&&n2c.days.length)dayFingers(l1rec,blen)}
  }
  /* —— 蒙皮:有子级预算的枝逐枝成网(激活树 perBranch=按节点拾取),远景树合并单网格 —— */
  if(o.perBranch){
    lines.forEach(function(L){
      var w=new TubeWriter();
      var dp=L.pts.slice();if(L.p0)dp[0]=L.p0;
      sweepTube(w,dp,L.r0,L.r1,{radial:L.radial||6,den:L.den||3.2,tip:L.tip||'round',
        ao:1,wind:{base:L.finger?1:(L.depth<=0?.1:(L.depth===1?.45:.8)),
                   phase:tree.wPh,baseY:tree.baseY,H:cfg.H},
        vJit:rng(),flare:L.flare,flareMul:L.flareMul});
      var m=w.mesh(barkMat);
      m.userData.node=L.app||tree.appRoot;
      if(o.onMesh)o.onMesh(m);
      grp.add(m)});
  }else{
    var w=new TubeWriter();
    lines.forEach(function(L){
      var dp=L.pts.slice();if(L.p0)dp[0]=L.p0;
      sweepTube(w,dp,L.r0,L.r1,{radial:L.radial||6,den:L.den||3.2,tip:L.tip||'round',
        ao:1,wind:{base:L.finger?1:(L.depth<=0?.1:(L.depth===1?.45:.8)),
                   phase:tree.wPh,baseY:tree.baseY,H:cfg.H},
        vJit:rng(),flare:L.flare,flareMul:L.flareMul})});
    var m=w.mesh(barkMat);
    m.userData.node=tree.appRoot;
    if(o.distant)m.userData.distant=true;
    if(o.onMesh)o.onMesh(m);
    grp.add(m);
  }
  /* —— 断面红光 —— */
  var dotMat=new THREE.MeshBasicMaterial({color:0xFF3B2A});
  dotMat.toneMapped=false;
  dots.forEach(function(d){
    var r=(d.depth<=1?2.6:1.9)*cfg.leafScale;
    var core=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),dotMat);
    core.position.copy(d.p);grp.add(core);
    var spr=new THREE.Sprite(new THREE.SpriteMaterial({map:GLOWTEX,color:0xFF4426,
      transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false}));
    spr.position.copy(d.p);
    spr.scale.setScalar(r*7.5);
    grp.add(spr);
    tree._beacons=tree._beacons||[];
    tree._beacons.push({core:core,spr:spr,r:r,op:.5,
      ph:(d.depth*3.7+d.p.x*.13+d.p.z*.17)%6.283})});
  beacons.push.apply(beacons,tree._beacons||[]);
  /* 完成叶团初始挂载 */
  tree.syncTufts(true);
  /* app 节点 pos 回写（全部树）：拾取/双击聚焦/星球/导航锚点与几何一致 */
  cfg.data.app.pos=tree.rootSlot.pos.clone();
  tree.recs.forEach(function(rec){
    if(rec.cfg.app)rec.cfg.app.pos=rec.tip.clone()})
  return tree}

/* —— 全局步进（主循环调用） —— */
export function stepGoal(dt,tG){
  stepTweens(dt);
  stepBeacons(tG)}
