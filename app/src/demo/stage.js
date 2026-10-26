/* 今日小岛舞台的共享定位（camera / today 共用，避免循环依赖）。
   今日小岛不是另建的岛：它就是世界岛右下方那座带石环/心形耕地的卫星岛。
   today.js 在启动/进入今日时把 STAGE 写成该卫星岛的世界坐标与地面高度，
   相机只切换 tgt/r；世界视角与今日视角始终是同一座岛。 */
export const STAGE={
  R0:170,          /* 小岛半径（大岛 880 的约 1/5） */
  x:0,
  y:600,
  z:0,
  t:0.62,          /* 今日机位方位（与相机 module 的球坐标口径一致） */
  groundY:0,       /* 构建后写入：小岛中心的实际世界高度 */
  ready:false      /* ensureStageRock 完成后置 true（世界视角周树定位用） */
};
if(typeof window!=='undefined')window.__STAGE=STAGE;   /* 调试探针（debug.js 同风格） */
