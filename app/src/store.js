/* ================= 微型事件 store =================
   数据变更广播的唯一通道：mutations 收口处 emit，
   任何需要感知数据的模块（3D loop、minimap、stats、未来 UI）on 订阅，
   取代跨模块直接调用。事件：
     'data'   —— 任何数据变更（结构或分配）后广播，payload = data.root
 */
var subs={};
export const store={
  on:function(ev,fn){
    (subs[ev]=subs[ev]||[]).push(fn);
    return function(){store.off(ev,fn)};
  },
  off:function(ev,fn){
    var a=subs[ev]||[];var i=a.indexOf(fn);
    if(i>=0)a.splice(i,1);
  },
  emit:function(ev,payload){
    (subs[ev]||[]).slice().forEach(function(fn){
      try{fn(payload)}catch(e){console.error('[store]',ev,e)}
    });
  }
};
