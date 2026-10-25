import {CFG} from './config.js';

export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// 工时约定：8 小时 = 1 天，56 小时 = 1 周
export function fmtH(h){const t=Math.round(h),w=Math.floor(t/56),d=Math.floor((t%56)/8),x=t%8,p=[];
  if(w)p.push(w+'周');if(d)p.push(d+'天');if(x||!p.length)p.push(x+'小时');return p.join('')}
export const trunc=t=>t.length>CFG.labelMax?t.slice(0,CFG.labelMax)+'…':t;
/* HTML 文本/属性统一转义（页面模块共用；decomposer 保持零依赖自带一份） */
export function escHtml(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
