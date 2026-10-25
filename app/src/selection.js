import {state} from './state.js';
import {renderCrumb,updateCard} from './ui.js';
import {exitPlanet} from './planet.js';
import {resetCam} from './camera.js';

/* ================= 选中/聚焦生命周期（机制 F） =================
   focus/selected/hoverLock 的唯一写口：任何变更自动同步面包屑与卡片。
   Esc 退出链=数据驱动（星球→聚焦→选中→回正，G3 逐层）。 */

export function setFocus(n){state.focus=n||null;_sync()}
export function setSelected(n){state.selected=n||null;_sync()}
export function setHoverLock(n){state.hoverLock=n||null;_sync()}

/* 逐层退出：返回本层名称；到底返回 null */
export function escStep(){
  if(state.mode==='planet'){exitPlanet();return 'planet'}
  if(state.focus){state.focus=null;_sync();return 'focus'}
  if(state.selected){state.selected=null;_sync();return 'selected'}
  if(state.hoverLock){state.hoverLock=null;_sync();return 'lock'}
  resetCam();return 'home'
}
export function clearAll(){
  state.focus=null;state.selected=null;state.hoverLock=null;_sync();
  resetCam();
}
function _sync(){
  try{renderCrumb()}catch(e){}
  try{updateCard()}catch(e){}
}
