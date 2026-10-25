/* 跨模块共享的可变状态与注册表。
   基本类型一律挂在 state 对象上——模块导入的是绑定，原地修改才全局可见。 */
export const state={
  mode:'tree',                 // 'tree' | 'planet'
  view:'world',                // 应用视图：'world' | 'plan' | 'week' | 'today'
  renderPaused:false,          // plan/week 全屏时挂起 3D 渲染（省 GPU）
  hovered:null,selected:null,hoverLock:null,focus:null,
  planetRoot:null,planetT:1,planetViewR:520,savedPose:null,
  timeOverride:null,           // 昼夜预览时刻（null=跟随系统时间）
  demoEnv:false,demoPreset:'day'   // demo 环境层接管天光后，实时钟天光挂起
};
export const DAY={name:'',glyph:''};
export const data={root:null,taskLevels:4};   // main.js 装配时填充
/* 全局日程池（临时任务 lvl='temp'，不进任务树）：world.initWorld 载入时填充 */
data.temps=[];
/* 日容量设置（weekday 小时数 / weekend 小时数），周画布点改 */
data.caps=null;
/* 果园：已完成归档的树记录 {id,title,domainName,color,archivedAt,tree(plain)}（§四/§3.4） */
data.orchard=null;
/* 执行区状态（05.6 v10）：{items:[{nodeId,startedAt,decomposed,page}],collapsed}
   ——入档字段（随文档同步服务器，多设备一致）；world.initWorld 载入时填充 */
data.exec=null;


export const pickMeshes=[];
export const planetPick=[],planetNodes=[];
