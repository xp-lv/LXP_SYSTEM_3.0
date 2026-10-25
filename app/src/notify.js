/* ================= 反馈通道（机制 C/B 的 UI 面） =================
   toast：操作反馈（完成/归档/撤销…，09.6）
   banner：存储/系统级通知（存档损坏已备份、版本过高、写满建议导出、
   检测到旧版存档已忽略——6号 §F 全部走这一个出口） */
(function(){
  var wrap=null,stack=[];
  function ensure(){
    if(!wrap){wrap=document.createElement('div');
      wrap.style.cssText='position:fixed;left:50%;bottom:64px;transform:translateX(-50%);'+
        'z-index:80;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none';
      document.body.appendChild(wrap)}
    return wrap}
  window.__notify={
    toast:function(msg,ms){
      var t=document.createElement('div');
      t.style.cssText='padding:8px 16px;border-radius:20px;white-space:nowrap;'+
        'background:rgba(12,14,22,.92);border:1px solid rgba(232,194,74,.35);'+
        'font:600 12px "Microsoft YaHei",sans-serif;color:#EFD9A0;opacity:0;'+
        'transition:opacity .3s,transform .3s;transform:translateY(8px)';
      t.textContent=msg;ensure().appendChild(t);
      requestAnimationFrame(function(){t.style.opacity=1;t.style.transform='none'});
      setTimeout(function(){t.style.opacity=0;t.style.transform='translateY(-8px)';
        setTimeout(function(){t.remove()},350)},ms||2600)},
    banner:function(msg){
      if(stack.indexOf(msg)>=0)return;stack.push(msg);
      var b=document.createElement('div');
      b.style.cssText='padding:10px 18px;border-radius:10px;max-width:520px;'+
        'background:rgba(40,26,10,.94);border:1px solid rgba(217,161,62,.55);'+
        'font:600 12.5px/1.6 "Microsoft YaHei",sans-serif;color:#F2D8A0;'+
        'pointer-events:auto;box-shadow:0 12px 40px rgba(0,0,0,.5)';
      b.textContent=msg;
      var x=document.createElement('span');
      x.textContent=' ×';x.style.cssText='cursor:pointer;color:#B99B5E;margin-left:10px';
      b.appendChild(x);
      x.onclick=function(){stack.splice(stack.indexOf(msg),1);b.remove()};
      ensure().appendChild(b)}
  };
})();
export var notify=window.__notify;
