/* 架构规则可执行化（7号 §D 基础设施）——node tests/check.mjs
   规则来源：README 原则 + 各机制红线。失败即架构已漂移。 */
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','src');
let fails=0;
const fail=m=>{console.error('  ✗ '+m);fails++};
const ok=m=>console.log('  ✓ '+m);

function walk(d,out=[]){
  for(const f of readdirSync(d)){
    const p=join(d,f);
    if(statSync(p).isDirectory())walk(p,out);
    else if(f.endsWith('.js'))out.push(p);
  }
  return out;
}
const files=walk(ROOT);
const src=Object.fromEntries(files.map(p=>[p,readFileSync(p,'utf-8')]));
const all=Object.values(src).join('\n');

console.log('[机制 A] id 单口分配：构造器禁止局部 uid 计数');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    if(/let uid\s*=\s*\d+/.test(s))bad.push(p);
  }
  bad.length?fail('局部 uid 计数残留: '+bad):ok('无局部 uid');
}
console.log('[机制 A] id 唯一性在写档边界断言');
all.includes('assertUniqueIds')?ok('persistence 写边界断言存在'):fail('writeDoc 缺 assertUniqueIds');

console.log('[机制 B] world 单口提交：world.js 内 touch() 只允许出现在 commit() 内');
{
  const s=code3(src[join(ROOT,'world.js')]);
  const lines=s.split('\n');const bad=[];
  let inCommit=false;
  lines.forEach((l,i)=>{
    if(/function commit\(/.test(l))inCommit=true;
    if(inCommit&&/^}/.test(l))inCommit=false;
    if(!inCommit&&/\btouch\(\)/.test(l))bad.push(i+1);
  });
  bad.length?fail('world.js 行外 touch(): '+bad):ok('touch 仅在 commit()');
}

console.log('[机制 C] 存储单拥有者：localStorage 只许 persistence.js 触碰（sync.js 豁免：存令牌/云数据桥接）');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    if(p.endsWith('persistence.js')||p.endsWith('sync.js'))continue;
    if(/localStorage/.test(code3(s)))bad.push(p.split(/[\\/]/).pop());
  }
  bad.length?fail('越权 localStorage: '+bad):ok('存储单拥有者');
}

console.log('[机制 E] chrome 单拥有者：display 写权只在 views.js 的 applyChrome');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    if(p.endsWith('views.js'))continue;
    const code=code3(s);
    if(/getElementById\('(treeSel|outlineD|dctrl|hoverCard|minimap|legend|hint|crumb)'\)[\s\S]{0,80}\.style\.display/.test(code))
      bad.push(p.split(/[\\/]/).pop());
    if(/mm\.style\.display/.test(code))bad.push(p.split(/[\\/]/).pop()+'(mm)');
  }
  bad.length?fail('越权 display: '+bad):ok('chrome 单拥有者');
}

console.log('[机制 D] 拾取契约：pickMeshes.push 的网格必须带 pick 标（静态抽查 push 点）');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    let idx=0;
    while((idx=s.indexOf('pickMeshes.push(',idx))>=0){
      const seg=s.slice(Math.max(0,idx-320),idx+700);
      if(!seg.includes('userData.pick')){bad.push(p.split(/[\\/]/).pop()+':'+s.slice(0,idx).split('\n').length);break}
      idx+=10;
    }
  }
  bad.length?fail('无 pick 契约的注册: '+bad):ok('拾取契约完整');
}

function code3(s){return s.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*')&&!l.trim().startsWith('/*')).join('\n')}
console.log('[机制 F] 选中单口：state.focus/selected/hoverLock 的赋值只许 selection.js 与 state 定义');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    if(p.endsWith('selection.js'))continue;
    const hits=[...code3(s).matchAll(/state\.(focus|selected|hoverLock)\s*=(?!=)/g)];
    if(hits.length)bad.push(p.split(/[\\/]/).pop()+'×'+hits.length);
  }
  bad.length?fail('越权选中写: '+bad):ok('选中单口');
}

console.log('[机制] 死导出检查：导出符号至少被引用一次（跨文件）');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    for(const m of s.matchAll(/export (?:function|const|var|let) ([A-Za-z_$][\w$]*)/g)){
      const name=m[1];
      const pat=new RegExp('\\b'+name+'\\b');
      const others=files.filter(f=>f!==p).some(f=>pat.test(src[f]))
        ||existsSync(join(ROOT,'..','tests'))&&
          readdirSync(join(ROOT,'..','tests')).some(tf=>tf.endsWith('.mjs')&&
            pat.test(readFileSync(join(ROOT,'..','tests',tf),'utf-8')));
      const selfUses=(s.match(new RegExp('\\b'+name+'\\b','g'))||[]).length>1;
      if(!others&&!selfUses)bad.push(name+'@'+p.split(/[\\/]/).pop());
    }
  }
  bad.length?fail('死导出: '+bad):ok('无死导出');
}

console.log('[机制] 退役物黑名单：旧物候/退役状态不得复活');
{
  const bad=[];
  const bans=[
    ['data.js',/phenoKeyOf|n\.ph\s*=|branchStage/,'旧物候派生'],
    ['state.js',/corridorHide|elNodes|labelNodes|branchMeshList|flowLines|tintMats|sharedGeom/,'退役状态字段'],
    ['config.js',/abandoned/,'废弃态色键'],
    ['calendar.js',/allocStateOf|monthTint|effMonthOf/,'分配模式残件'],
  ];
  for(const[f,pat,label]of bans){
    const s2=code3(src[join(ROOT,f)]||'');
    if(pat.test(s2))bad.push(label+'@'+f);
  }
  bad.length?fail('退役物复活: '+bad):ok('退役物清零');
}

console.log('[机制] 导入图闭合：所有相对导入存在');
{
  const bad=[];
  for(const[p,s]of Object.entries(src)){
    for(const m of s.matchAll(/from '(\.[^']+)'/g)){
      const t=join(dirname(p),m[1]);
      if(!existsSync(t))bad.push(m[1]+'@'+p.split(/[\\/]/).pop());
    }
  }
  bad.length?fail('断链: '+bad):ok('导入图闭合');
}

console.log(fails?`\n✗ ${fails} 项架构规则失败`:'\n✓ 架构规则全部通过');
process.exit(fails?1:0);
