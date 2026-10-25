/* ================= 全局配置与色表（纯数据，零依赖——node 可测） ================= */
export const CFG={rMin:6,rMax:42,labelMax:8};

export const AGGNAME={overdue:'含过期',floating:'含断梢 · 未排',done:'全部完成',assigned:'进行中'};

/* 机制 G：PALETTE 是唯一色源——COL/RINGCSS/SKIN 全部派生（06.1 三态对齐只改这一处） */
export const PALETTE={done:'#D9C46A',overdue:'#F5222D',assigned:'#74A95C',
  floating:'#E8604A'};
function hex(h){return parseInt(h.slice(1),16)}
export const COL={};for(const k in PALETTE)COL[k]=hex(PALETTE[k]);
export const RINGCSS=PALETTE;
export const SKIN={};                                /* 材质性格自 PALETTE 派生 */
(function(){
  const M={done:{r:.42,emI:.5},overdue:{r:.48,emI:.62},assigned:{r:.38,emI:.45},
           floating:{r:.52,emI:.3}};
  const mul=(h,f)=>{const n=hex(h);
    return((Math.round((n>>16&255)*f)<<16)|(Math.round((n>>8&255)*f)<<8)|Math.round((n&255)*f))};
  for(const k in PALETTE){
    SKIN[k]={c:mul(PALETTE[k],.16),
      r:M[k].r,cR:M[k].r*.55,em:hex(PALETTE[k]),emI:M[k].emI,env:.25+M[k].emI*.4};
  }
})();
