# -*- coding: utf-8 -*-
"""把演示数据与界面打包成一个可离线双击的 HTML。"""
import base64
import json
from pathlib import Path

ROOT = Path(r"C:\Users\Public\给ai\dsh\柒柿AI")
qa = json.loads((ROOT / "demo-site/data/qa.json").read_text(encoding="utf-8"))
icon = base64.b64encode((ROOT / "frontend/public/icons/cheese-app.png").read_bytes()).decode()
payload = json.dumps(qa, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

HTML = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>柒柿AI · Demo 主响应</title>
<style>
:root{--paper:#f6f5ef;--ink:#141414;--muted:#6f6b63;--line:#ddd8cd;--yellow:#ffd84a;--deep:#e0a800;--white:#fff}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--paper);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",system-ui,sans-serif;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-bottom:1px solid var(--line);background:rgba(246,245,239,.94);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:12px}.logo{width:42px;height:42px;border-radius:12px}
.name{font-size:20px;font-weight:700}.name span{font-size:12px;color:var(--muted);font-weight:500;margin-left:6px}
.tag{font-size:12px;color:var(--muted);margin-top:2px}
main{width:min(900px,calc(100% - 28px));margin:0 auto;flex:1;padding:20px 0 8px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.stats div{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column}
.stats b{font-size:20px}.stats span{font-size:11px;color:var(--muted);margin-top:3px}
.chat{background:var(--white);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(20,20,20,.06);display:flex;flex-direction:column;height:min(64vh,620px)}
.messages{padding:18px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;flex:1}
.msg{display:flex;gap:10px;align-items:flex-start}.msg.user{flex-direction:row-reverse}
.avatar{width:30px;height:30px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--yellow)}
.msg.user .avatar{background:var(--ink);color:var(--yellow)}
.bubble{background:#fbfaf6;border:1px solid var(--line);border-radius:14px;padding:11px 14px;max-width:min(720px,88%);line-height:1.75;font-size:14px}
.msg.user .bubble{background:#fff6d6;border-color:#f0dfa0}
.bubble p{margin:0 0 8px;white-space:pre-wrap}.bubble p:last-child{margin-bottom:0}
.meta{margin-top:8px;font-size:11.5px;color:var(--muted);border-top:1px dashed var(--line);padding-top:7px}
.meta b{color:var(--deep)}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.chips button{border:1px solid var(--line);background:var(--white);border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit}
.chips button:hover{border-color:var(--deep);background:#fffaf0}
.composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:#fbfaf6}
.composer input{flex:1;border:1px solid var(--line);border-radius:12px;padding:11px 13px;font-size:14px;font-family:inherit;outline:none}
.composer input:focus{border-color:var(--deep);box-shadow:0 0 0 3px rgba(224,168,0,.14)}
.composer button{border:0;background:var(--ink);color:var(--yellow);border-radius:12px;padding:0 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
details{margin-top:10px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px 10px}
summary{cursor:pointer;color:var(--deep);font-size:12.5px}
pre{max-height:260px;overflow:auto;font-size:11px;line-height:1.5;background:#0f0f0f;color:#e8e4d8;padding:10px;border-radius:8px;white-space:pre-wrap}
.note{color:var(--muted);font-size:12px;margin:12px 2px 4px;line-height:1.6}
footer{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;padding:12px 26px;border-top:1px solid var(--line)}
@media(max-width:620px){.stats{grid-template-columns:repeat(3,1fr)}.chat{height:68vh}}
</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <img class="logo" alt="" src="data:image/png;base64,__ICON__" />
    <div><div class="name">柒柿AI <span>Cheese AI</span></div><div class="tag">Demo 主响应 · 本地问答库命中</div></div>
  </div>
  <span class="tag">离线单文件</span>
</header>
<main>
  <section class="stats">
    <div><b>__COUNT__</b><span>内置问答</span></div>
    <div><b>0</b><span>命中时云端调用</span></div>
    <div><b>&lt; 1 ms</b><span>本地匹配</span></div>
  </section>
  <section class="chat">
    <div class="messages" id="messages">
      <div class="msg bot"><div class="avatar">柒</div><div class="bubble">
        <p>你好，我是柒柿AI。演示「先查本地问答库，命中就直接回答」：答案来自已收录的问答，不调用云端。</p>
        <p>试试：</p>
        <div class="chips" id="chips">
          <button data-q="校园卡丢了怎么挂失？">校园卡丢了怎么挂失？</button>
          <button data-q="食堂几点开门？">食堂几点开门？</button>
          <button data-q="补考没过怎么办？">补考没过怎么办？</button>
          <button data-q="画个骑车的鹈鹕">画个骑车的鹈鹕</button>
        </div>
      </div></div>
    </div>
    <form class="composer" id="composer">
      <input id="input" maxlength="120" placeholder="问一个校园问题，比如：校园卡丢了怎么挂失？" />
      <button type="submit">发送</button>
    </form>
  </section>
  <p class="note">静态 Demo：只演示本地命中，未命中时给出相近问题，不调用大模型。完整版含登录、治理、云端兜底与文件/图片。</p>
</main>
<footer><span>柒柿AI · Cheese AI</span><span>命中不出网，未命中才请大模型</span></footer>
<script>
const DATA = __DATA__;
const norm = (s) => String(s||'').toLowerCase().replace(/[\\s\\p{P}\\p{S}]/gu,'');
const grams = (s) => { const set = new Set(); for (let i=0;i<s.length-1;i++) set.add(s.slice(i,i+2)); return set; };
const dice = (a,b) => { if(!a||!b) return 0; if(a===b) return 1; const A=grams(a),B=grams(b); let c=0; A.forEach(g=>{if(B.has(g))c++}); return 2*c/(A.size+B.size||1); };
const index = new Map();
DATA.forEach(item => { [item.q, ...(item.v||[])].forEach((text, i) => { const k=norm(text); if(k && !index.has(k)) index.set(k,{item,kind:i===0?'原问':'等价问法'}); }); });
const messages = document.getElementById('messages');
const input = document.getElementById('input');
function add(role, build){ const wrap=document.createElement('div'); wrap.className='msg '+role; const a=document.createElement('div'); a.className='avatar'; a.textContent=role==='user'?'我':'柒'; const b=document.createElement('div'); b.className='bubble'; build(b); wrap.append(a,b); messages.append(wrap); messages.scrollTop=messages.scrollHeight; return b; }
function find(q){ const k=norm(q); if(!k) return null; if(index.has(k)){ const e=index.get(k); return {item:e.item,kind:e.item.tool?'本地工具':e.kind,score:1}; } let best=null; DATA.forEach(item=>{ const s=dice(k,norm(item.q)); if(!best||s>best.score) best={item,kind:'语义近似',score:s}; }); if(best && best.item.tool) best.kind='本地工具'; return best && best.score>=0.55 ? best : null; }
function nearest(q){ const k=norm(q); return DATA.map(item=>({item,score:dice(k,norm(item.q))})).sort((a,b)=>b.score-a.score).slice(0,3); }
function render(q, hit){ add('bot', b => {
  if (hit && hit.item.tool === 'pelican') {
    const parts = hit.item.a.split(/```html\\n?/);
    const intro = document.createElement('p'); intro.textContent = parts[0].trim(); b.append(intro);
    const det = document.createElement('details'); const sum=document.createElement('summary'); sum.textContent='查看完整 HTML（可另存为 pelican.html）'; det.append(sum);
    const pre=document.createElement('pre'); pre.textContent = parts[1] ? parts[1].replace(/```[\\s\\S]*$/,'').trim() : hit.item.a; det.append(pre); b.append(det);
  } else {
    const p=document.createElement('p'); p.textContent = hit ? hit.item.a : '这个问题还不在演示库里；静态 Demo 不会调用模型，你可以试试相近问题：';
    b.append(p);
    if (!hit) { const chips=document.createElement('div'); chips.className='chips'; nearest(q).forEach(({item})=>{ const btn=document.createElement('button'); btn.textContent=item.q; btn.addEventListener('click',()=>ask(item.q)); chips.append(btn); }); b.append(chips); }
  }
  const meta=document.createElement('div'); meta.className='meta';
  meta.innerHTML = hit ? `<b>${hit.kind}</b> · 匹配度 ${Math.round(hit.score*100)}% · 0 次云端调用 · 答案来自共享问答库` : '<b>未命中</b> · 静态 Demo 不调用模型';
  b.append(meta);
}); }
function ask(q){ q=String(q||'').trim(); if(!q) return; add('user',b=>{const p=document.createElement('p');p.textContent=q;b.append(p);}); input.value=''; add('bot',b=>{const p=document.createElement('p');p.textContent='正在查本地问答库…';b.append(p);}).parentElement.remove(); const t=performance.now(); const hit=find(q); render(q,hit); }
document.getElementById('composer').addEventListener('submit',e=>{e.preventDefault();ask(input.value);});
document.getElementById('chips').addEventListener('click',e=>{const btn=e.target.closest('button[data-q]'); if(btn) ask(btn.dataset.q);});
</script>
</body>
</html>
"""

html = HTML.replace("__ICON__", icon).replace("__COUNT__", str(len(qa))).replace("__DATA__", payload)
out = ROOT / "pitch/demo-standalone.html"
out.write_text(html, encoding="utf-8")
print("bytes:", out.stat().st_size, "items:", len(qa))
