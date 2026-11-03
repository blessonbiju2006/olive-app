// PaintPro Command Hub - app logic (IndexedDB + PWA Engine)

// ===== 1. INDEXEDDB ENGINE & STORAGE MANAGEMENT =====

const DB_NAME = "olive_app_db";
const DB_VERSION = 1;
let db = null;

const idb = {
  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("memos")) d.createObjectStore("memos", { keyPath: "id" });
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e);
    });
  },
  getKV(key) {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },
  setKV(key, val) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => resolve();
    });
  },
  getMemos() {
    return new Promise((resolve) => {
      if (!db) return resolve([]);
      const tx = db.transaction("memos", "readonly");
      const req = tx.objectStore("memos").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  saveMemo(memo) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      const tx = db.transaction("memos", "readwrite");
      tx.objectStore("memos").put(memo);
      tx.oncomplete = () => resolve();
    });
  },
  deleteMemo(id) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      const tx = db.transaction("memos", "readwrite");
      tx.objectStore("memos").delete(id);
      tx.oncomplete = () => resolve();
    });
  }
};

const $=s=>document.querySelector(s);
let S=null;

const defaultState = {
  workers:[{id:1,name:"Ravi",rate:800},{id:2,name:"Suresh",rate:800}],
  att:{},floats:[],timers:[],appts:[],sites:[],theme:"dark",settled:{}
};

const migrate=()=>{
  S.settled=S.settled||{};
  S.workers.forEach(w=>{if(!w.rates)w.rates=[{from:"0000-01-01",rate:w.rate}]});
};

const save = async () => {
  try {
    localStorage.setItem("pp", JSON.stringify(S)); // LocalStorage mirror backup
  } catch(e){}
  await idb.setKV("state", S);
};

let view="dash",off=0,mode="week",sh=null,bk=null,rk=null,ew=null,armed=false,rtxt="",memos=[],rec=null,actx,an,raf,stream,chunks=[];

// Request Persistent Storage
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
}

// ===== 2. CONSTANTS & DATE HELPERS =====

const NAV=[["dash","Dashboard","📋"],["workers","Workers","👷"],["site","Site","🏠"],["appt","Appointment","📅"],["voice","Voice Memo","🎙"],["timers","Timers","⏱"]];
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today=()=>iso(new Date());
const mon=o=>{const d=new Date();d.setHours(12);d.setDate(d.getDate()-((d.getDay()+6)%7)+o*7);return d};
const weekDays=o=>[...Array(7)].map((_,i)=>{const d=mon(o);d.setDate(d.getDate()+i);return iso(d)});
const DN=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],LB={P:"PRESENT",H:"HALF-DAY",A:"ABSENT"},val={P:1,H:.5,A:0};

// ===== 3. FORMATTING & PAYROLL CALCULATION =====

const money=n=>(n<0?"-":"")+"₹"+Math.abs(Math.round(n)).toLocaleString("en-IN");
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const rateOn=(w,d)=>(w.rates.filter(x=>x.from<=d).sort((a,b)=>a.from<b.from?-1:1).pop()||w.rates[0]).rate;
const active=()=>S.workers.filter(w=>!w.archived);
const newId=()=>Date.now()+"-"+Math.random().toString(36).slice(2,6);
const calc=(w,days)=>{const z=S.settled[w.id+"|"+days[0]];if(z)return{e:z.e,f:z.f,n:z.n,paid:z.paid};let e=0,f=0;days.forEach(d=>{e+=(val[S.att[w.id+"|"+d]]||0)*rateOn(w,d);S.floats.filter(x=>x.w==w.id&&x.date==d).forEach(x=>f+=x.amt)});return{e,f,n:e-f}};
const owed=c=>c.paid===undefined?c.n:c.n-c.paid;
const mondayOf=d=>{const x=new Date(d+"T12:00:00");x.setDate(x.getDate()-((x.getDay()+6)%7));return iso(x)};
const isLocked=(w,d)=>!!S.settled[w+"|"+mondayOf(d)];
const cd=end=>{const s=Math.max(0,Math.round((end-Date.now())/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};

function toast(m){const t=$("#toast");t.textContent=m;t.style.display="block";setTimeout(()=>t.style.display="none",2200)}

// ===== 4. VIEWS =====

const tgs=(w,d)=>{const L=isLocked(w,d);return ["P","H","A"].map(k=>`<button class="tg ${k}${S.att[w+"|"+d]==k?" on":""}"${L?" disabled":""} data-a="set" data-w="${w}" data-d="${d}" data-v="${k}">${LB[k]}</button>`).join("")};

function vDash(){const t=today(),days=weekDays(0),n=active().length,mk=active().filter(w=>S.att[w.id+"|"+t]).length;let due=0;S.workers.forEach(w=>due+=owed(calc(w,days)));
 const up=S.appts.filter(a=>a.date>=t).sort((a,b)=>a.date<b.date?-1:1).slice(0,4),un=memos.filter(m=>!m.heard).length,bm=hasData()&&(backupAge()===null||backupAge()>6);
 let h=`<div class="grid"><div class="card stat">Attendance today<b>${mk}/${n}</b></div><div class="card stat">Week still to pay<b>${money(due)}</b></div><div class="card stat">Active timers<b>${S.timers.filter(x=>!x.fired).length}</b></div><div class="card stat">Unread memos<b>${un}</b></div></div><h3>Priority queue</h3>`;
 if(mk<n)h+=`<div class="card row">Attendance pending for ${n-mk} worker(s)<span class="sp"></span><button class="btn sm am" data-a="nav" data-v="workers">Open</button></div>`;
 up.forEach(a=>h+=`<div class="card">📅 <b>${esc(a.title)}</b> · ${a.type} · ${a.date}</div>`);
 if(bm)h+=`<div class="card row">💾 Backup is overdue<span class="sp"></span><button class="btn sm am" data-a="nav" data-v="workers">Back up</button></div>`;
 if(un)h+=`<div class="card row">🎙 ${un} unread voice memo(s)<span class="sp"></span><button class="btn sm" data-a="nav" data-v="voice">Listen</button></div>`;
 return h+(mk==n&&!up.length&&!un&&!bm?`<div class="card mu">All clear for now.</div>`:"")}

function ledger(){const os=[-3,-2,-1,0];let h=`<div class="card"><table><tr><th>Worker</th>${os.map(o=>`<th>${weekDays(o)[0].slice(5)}</th>`).join("")}<th>Total</th></tr>`;
 S.workers.forEach(w=>{if(w.archived&&!os.some(o=>{const c=calc(w,weekDays(o));return c.e||c.f||c.paid!==undefined}))return;let t=0;h+=`<tr><td>${esc(w.name)}${w.archived?" (archived)":""}</td>`;os.forEach(o=>{const c=calc(w,weekDays(o)),n=c.n;t+=n;h+=`<td class="${n<0?"neg":""}">${money(n)}${c.paid!==undefined?" ✓":""}</td>`});h+=`<td><b>${money(t)}</b></td></tr>`});
 return h+`</table></div><p class="mu">Net payable per week, last 4 weeks.</p>`}

function vWorkers(){const days=weekDays(off),t=today();
 let h=`<div class="row"><button class="btn am" data-a="all">✓ Mark All Present</button></div>
 <div class="row"><input id="wn" placeholder="New worker name"><input id="wr" type="number" inputmode="numeric" placeholder="Rate ₹/day"><button class="btn" data-a="addw">+ Add</button></div>
 <div class="row"><button class="btn sm" data-a="wk" data-v="-1">‹</button><b>${days[0].slice(5)} → ${days[6].slice(5)}</b><button class="btn sm" data-a="wk" data-v="1">›</button><span class="sp"></span><button class="btn sm${mode=="week"?" am":""}" data-a="mode" data-v="week">Week</button><button class="btn sm${mode=="month"?" am":""}" data-a="mode" data-v="month">Month</button><button class="btn sm" data-a="exp">Export Summary</button></div>`;
 if(mode=="month")return h+ledger()+backupCard();
 active().forEach(w=>{const c=calc(w,days);
  h+=`<div class="card"><div class="row"><b>${esc(w.name)}</b><span class="mu">${money(rateOn(w,t))}/day</span><span class="sp"></span><button class="x" data-a="edit" data-w="${w.id}">✎ Edit</button></div>${ew==w.id?editPanel(w):""}<div class="row">${tgs(w.id,t)}</div>
  <div class="chips">${days.map((d,i)=>{const s=S.att[w.id+"|"+d]||"";return `<button class="chip ${s}" data-a="sheet" data-w="${w.id}" data-d="${d}">${DN[i]}<small>${s||"–"}</small></button>`}).join("")}</div>
  <div class="sum"><div>Earned<b>${money(c.e)}</b></div><div>Float<b>${money(c.f)}</b></div><div>Net payable<b class="${c.n<0?"neg":"pos"}">${money(c.n)}</b></div></div>${settleRow(w,days,c)}</div>`});
 return h+(active().length?"":`<p class="mu">Add your first worker above.</p>`)+archivedCard()+backupCard()}

function sheetHTML(){const w=S.workers.find(x=>x.id==sh.w),d=sh.d,fl=S.floats.filter(x=>x.w==w.id&&x.date==d),tot=fl.reduce((a,x)=>a+x.amt,0);
 return `<div class="back" data-a="close"></div><div class="sheet"><div class="row"><b>${esc(w.name)} · ${d}</b><span class="sp"></span><button class="x" data-a="close">✕</button></div>
 <div class="row">${tgs(w.id,d)}</div>${isLocked(w.id,d)?'<p class="mu">🔒 This week is settled. Reopen it on the Workers screen to make changes.</p>':""}<div class="row"${isLocked(w.id,d)?" hidden":""}>${[100,200,500,1000].map(v=>`<button class="btn" data-a="fl" data-v="${v}">+₹${v.toLocaleString("en-IN")}</button>`).join("")}</div>
 <div class="row"${isLocked(w.id,d)?" hidden":""}><input id="fa" type="number" inputmode="numeric" placeholder="Custom ₹"><button class="btn am" data-a="flc">Add float</button></div>
 <p class="mu">Float this day: <b>${money(tot)}</b></p>${fl.map(x=>{const tm=new Date(x.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});return `<div class="row mu" style="margin-bottom:6px"><span${x.rv?' style="text-decoration:line-through"':""}>${tm} · ${x.rev?"↩ Reversal ":""}${money(x.amt)}</span>${!x.rv&&!x.rev&&!isLocked(w.id,d)?`<button class="btn sm" data-a="rev" data-id="${x.id}">Reverse</button>`:""}</div>`}).join("")}
 </div>`}

function vSite(){return `<div class="row"><input id="sn" placeholder="Site name"><button class="btn am" data-a="adds">+ Add site</button></div>`+S.sites.map(s=>`<div class="card"><div class="row"><b>${esc(s.name)}</b><span class="sp"></span><b>${s.pct}%</b></div><input type="range" min="0" max="100" step="5" value="${s.pct}" data-a="pct" data-id="${s.id}"></div>`).join("")+(S.sites.length?"":`<p class="mu">No job sites yet.</p>`)}

function vAppt(){return `<div class="row"><input id="at" placeholder="Client / purpose"><input id="ad" type="date" value="${today()}"><select id="ay"><option>Consultation</option><option>Site visit</option></select><button class="btn am" data-a="adda">+ Add</button></div>`+[...S.appts].sort((a,b)=>a.date<b.date?-1:1).map(a=>`<div class="card row"><span><b>${esc(a.title)}</b><br><span class="mu">${a.type} · ${a.date}</span></span><span class="sp"></span><button class="x" data-a="dela" data-id="${a.id}">✕</button></div>`).join("")}
const qt=()=>`<div class="row">${[5,15,30,60].map(m=>`<button class="btn" data-a="tm" data-v="${m}">+${m} min</button>`).join("")}</div>`;

function vVoice(){
  return `<div class="card"><canvas id="wave"></canvas><div class="row" style="margin-top:10px">${rec?`<button class="btn" style="background:var(--ro);color:#fff" data-a="stop">■ Stop</button>`:`<button class="btn am" data-a="rec">● Record</button>`}</div><p class="mu">Memos are saved to IndexedDB on this device.</p></div><h3>Quick timers</h3>${qt()}<h3>Field notes</h3>`+
  memos.map((m,i)=>{
    const url = m.blob ? URL.createObjectURL(m.blob) : m.url;
    return `<div class="card"><div class="mu">${new Date(m.at).toLocaleString()}${m.heard?"":" · NEW"}</div><audio controls src="${url}" data-a="heard" data-id="${m.id}"></audio><div class="row" style="margin-top:6px"><a class="btn sm" href="${url}" download="memo-${i+1}.webm">Download</a><button class="btn sm" data-a="delmemo" data-id="${m.id}">Delete</button></div></div>`;
  }).join("");
}

function vTimers(){return `<div class="row"><input id="tl" placeholder="Label (e.g. Coat 1 drying)"><input id="tmn" type="number" inputmode="numeric" placeholder="Minutes"><button class="btn am" data-a="addt">Start</button></div>${qt()}`+S.timers.map(t=>`<div class="card row"><span><b>${esc(t.label)}</b><br>${t.fired?`<span class="mu">Done</span>`:`<span class="cd" data-end="${t.end}">${cd(t.end)}</span>`}</span><span class="sp"></span><button class="x" data-a="delt" data-id="${t.id}">✕</button></div>`).join("")}

// ===== 5. RENDER & EXPORT SUMMARY =====

function render(){
  const tb=document.querySelector("[data-a=theme]");
  if(tb)tb.textContent=S.theme=="dark"?"☀ Light Mode":"🌙 Dark Mode";
  const r=$("#rt");if(r&&bk=="restore")rtxt=r.value;
  document.documentElement.dataset.theme=S.theme;
  $("#nav").innerHTML=NAV.map(([k,l,i])=>`<button class="nv${view==k?" on":""}" data-a="nav" data-v="${k}"><span>${i}</span>${l}</button>`).join("");
  $("#main").innerHTML={dash:vDash,workers:vWorkers,site:vSite,appt:vAppt,voice:vVoice,timers:vTimers}[view]();
  if(sh&&!S.workers.find(x=>x.id==sh.w))sh=null;
  $("#sheet").innerHTML=sh?sheetHTML():"";
}

function summary(){const os=mode=="month"?[-3,-2,-1,0]:[off];let t="PaintPro payroll summary\n";os.forEach(o=>{const d=weekDays(o);t+="\nWeek "+d[0]+" to "+d[6]+"\n";S.workers.forEach(w=>{const c=calc(w,d);if(w.archived&&!c.e&&!c.f&&c.paid===undefined)return;t+=w.name+": earned "+money(c.e)+", float "+money(c.f)+", net "+money(c.n)+(c.paid!==undefined?", PAID "+money(c.paid)+(c.n-c.paid?" (balance "+money(c.n-c.paid)+")":"")+" [settled]":"")+"\n"})});return t}

// ===== 6. ACTIONS & RECONCILIATION =====

const addFloat=a=>{if(a>0&&!isLocked(sh.w,sh.d)){S.floats.push({id:newId(),w:sh.w,date:sh.d,amt:a,ts:new Date().toISOString()});save();render()}};
const addTimer=(label,min)=>{if(min>0){S.timers.unshift({id:Date.now(),label:label||"Timer "+min+" min",end:Date.now()+min*60000,fired:false});save();toast("Timer started: "+min+" min");if(view=="timers")render()}};

function editPanel(w){const hist=[...w.rates].sort((a,b)=>a.from<b.from?-1:1).map(x=>(x.from=="0000-01-01"?"Start":"From "+x.from)+": "+money(x.rate)).join(" · ");
 return `<div class="card" style="margin-bottom:10px"><div class="row"><input id="en" value="${esc(w.name)}" placeholder="Name"><input id="er" type="number" inputmode="numeric" placeholder="New rate ₹/day"><input id="ed" type="date" value="${today()}"></div>
 <p class="mu">A new rate applies from the date shown. Earlier days keep their old rate. Leave the rate empty to just rename.<br>Rate history: ${hist}</p>
 <div class="row"><button class="btn am" data-a="esave" data-w="${w.id}">Save</button><button class="btn" data-a="ecancel">Cancel</button><span class="sp"></span><button class="btn" data-a="earch" data-w="${w.id}">Archive worker</button></div></div>`}

function archivedCard(){const a=S.workers.filter(w=>w.archived);if(!a.length)return "";
 return `<div class="card"><b>Archived workers</b><p class="mu">History is kept. Restore to bring a worker back.</p>${a.map(w=>`<div class="row"><span>${esc(w.name)}</span><span class="sp"></span><button class="btn sm" data-a="eunarch" data-w="${w.id}">Restore</button></div>`).join("")}</div>`}

function settleRow(w,days,c){const k=w.id+"|"+days[0],z=S.settled[k];
 if(z){const b=z.n-z.paid;return `<div class="row" style="margin-top:10px"><span class="mu">🔒 Settled ${new Date(z.at).toLocaleDateString()} · Paid <b>${money(z.paid)}</b>${b?` · ${b>0?"Still owed":"Overpaid"} <b class="${b>0?"":"neg"}">${money(Math.abs(b))}</b>`:""}</span><span class="sp"></span><button class="btn sm" data-a="reopen" data-k="${k}">${rk==k?"Tap again to reopen":"Reopen"}</button></div>`}
 return `<div class="row" style="margin-top:10px"><input id="pd${w.id}" type="number" inputmode="numeric" value="${Math.max(0,Math.round(c.n))}" aria-label="Amount paid"><button class="btn am" data-a="settle" data-w="${w.id}">Settle week</button></div>`}

const backupText=()=>JSON.stringify({app:"paintpro",v:1,at:new Date().toISOString(),data:{workers:S.workers,att:S.att,floats:S.floats,timers:S.timers,appts:S.appts,sites:S.sites,settled:S.settled,theme:S.theme}});
const markBackup=()=>{S.lastBackup=new Date().toISOString();save();render()};
const backupAge=()=>S.lastBackup?Math.floor((Date.now()-new Date(S.lastBackup))/864e5):null;
const hasData=()=>S.floats.length>0||Object.keys(S.att).length>0;

function restoreFrom(text){let o;try{o=JSON.parse(text.trim())}catch(e){return "That text is not a valid backup"}
 const d=o&&o.app=="paintpro"?o.data:null;
 if(!d||!Array.isArray(d.workers)||!Array.isArray(d.floats)||!d.att||typeof d.att!="object")return "This is not a PaintPro backup";
 S={...S,...d,timers:d.timers||[],appts:d.appts||[],sites:d.sites||[],settled:d.settled||{}};migrate();save();return ""}

function backupCard(){const a=backupAge(),st=a===null?"Never backed up":a==0?"Backed up today":"Last backup: "+a+" day(s) ago";
 let h=`<div class="card"><div class="row"><b>Backup</b><span class="mu${a===null||a>6?" neg":""}">${st}</span></div>
 <div class="row"><button class="btn am" data-a="bcopy">Copy backup</button><button class="btn" data-a="bfile">Download file</button><button class="btn" data-a="brestore">Restore…</button></div>`;
 if(bk=="restore")h+=`<textarea id="rt" placeholder="Paste backup text here">${esc(rtxt)}</textarea><div class="row"><button class="btn am" data-a="bapply">${armed?"Tap again to replace ALL current data":"Restore from text"}</button><button class="btn" data-a="bcancel">Cancel</button></div>`;
 if(bk=="show")h+=`<textarea readonly onfocus="this.select()">${esc(backupText())}</textarea><p class="mu">Copy was blocked here. Tap the box, select all, copy it yourself, then tap the button.</p><div class="row"><button class="btn am" data-a="bdone">I copied it</button></div>`;
 return h+`<p class="mu">Voice memos are stored separately in IndexedDB.</p></div>`}

// ===== 7. VOICE MEMO RECORDER =====

async function startRec(){
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(e){toast("Microphone blocked");return}
  actx=new(window.AudioContext||window.webkitAudioContext)();an=actx.createAnalyser();an.fftSize=128;actx.createMediaStreamSource(stream).connect(an);
  rec=new MediaRecorder(stream);chunks=[];rec.ondataavailable=e=>chunks.push(e.data);
  rec.onstop=async ()=>{
    const blob = new Blob(chunks, { type: rec.mimeType });
    const newMemo = { id: newId(), blob: blob, at: new Date().toISOString(), heard: false };
    await idb.saveMemo(newMemo);
    memos.unshift(newMemo);
    stream.getTracks().forEach(t=>t.stop());actx.close();cancelAnimationFrame(raf);rec=null;render();
  };
  rec.start();render();draw();
}

function draw(){const c=$("#wave");if(!c||!an||!rec)return;const x=c.getContext("2d"),d=new Uint8Array(an.frequencyBinCount);an.getByteFrequencyData(d);c.width=c.clientWidth;c.height=120;const bw=c.width/d.length;d.forEach((v,i)=>{const h=Math.max(3,v/255*110);x.fillStyle="#f59e0b";x.fillRect(i*bw+1,60-h/2,bw-2,h)});raf=requestAnimationFrame(draw)}

// ===== 8. EVENT HANDLERS =====

document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-a]");if(!b||b.tagName=="INPUT"||b.tagName=="AUDIO")return;
  const a=b.dataset.a,D=b.dataset,v=D.v;

  if(a=="nav"){view=v;render()}
  else if(a=="theme"){S.theme=S.theme=="dark"?"light":"dark";save();render()}
  else if(a=="notify"){if(!("Notification" in window))toast("Not supported here");else Notification.requestPermission().then(p=>toast("Notifications: "+p))}
  else if(a=="all"){
    const t=today();let sk=0, updated=0;
    active().forEach(w=>{
      if(isLocked(w.id,t)) sk++;
      else if(!S.att[w.id+"|"+t]) { S.att[w.id+"|"+t]="P"; updated++; }
    });
    save();render();
    if(sk || updated) toast(`Updated ${updated} worker(s)` + (sk ? `, ${sk} locked skipped` : ""));
  }
  else if(a=="addw"){const n=$("#wn").value.trim(),r=+$("#wr").value;if(n&&r>0){S.workers.push({id:Date.now(),name:n,rate:r,rates:[{from:"0000-01-01",rate:r}]});save();render()}else toast("Enter name and rate")}
  else if(a=="wk"){off+=+v;render()}
  else if(a=="mode"){mode=v;render()}
  else if(a=="exp"){
    const t=summary();
    if(navigator.share){
      navigator.share({text:t}).catch(err=>{ if(err.name!=='AbortError') toast("Share cancelled"); });
    } else if(navigator.clipboard){
      navigator.clipboard.writeText(t).then(()=>toast("Summary copied")).catch(()=>toast("Copy blocked"));
    }
  }
  else if(a=="set"){if(isLocked(D.w,D.d)){toast("Week is settled. Reopen it to edit");return}const k=D.w+"|"+D.d;if(S.att[k]==v)delete S.att[k];else S.att[k]=v;save();render()}
  else if(a=="sheet"){sh={w:D.w,d:D.d};render()}
  else if(a=="close"){sh=null;render()}
  else if(a=="fl")addFloat(+v);
  else if(a=="flc")addFloat(+$("#fa").value);
  else if(a=="rev"){const f=S.floats.find(x=>x.id==D.id);if(!f||f.rv||f.rev||isLocked(f.w,f.date))return;f.rv=true;S.floats.push({id:newId(),w:f.w,date:f.date,amt:-f.amt,ts:new Date().toISOString(),rev:f.id});save();toast("Float reversed");render()}
  else if(a=="edit"){ew=D.w;render()}
  else if(a=="ecancel"){ew=null;render()}
  else if(a=="esave"){const w=S.workers.find(x=>x.id==D.w),n=$("#en").value.trim(),r=Math.round(+$("#er").value),f=$("#ed").value;
   if(!n){toast("Name cannot be empty");return}
   if(r>0&&!f){toast("Pick effective date");return}
   w.name=n;let m="Saved";
   if(r>0){w.rates=w.rates.filter(x=>x.from!=f);w.rates.push({from:f,rate:r});if(S.settled[w.id+"|"+mondayOf(f)])m="Saved (week settled)"}
   ew=null;save();toast(m);render()}
  else if(a=="earch"){const w=S.workers.find(x=>x.id==D.w);w.archived=true;ew=null;save();toast(w.name+" archived");render()}
  else if(a=="eunarch"){S.workers.find(x=>x.id==D.w).archived=false;save();render()}
  else if(a=="adds"){const n=$("#sn").value.trim();if(n){S.sites.push({id:Date.now(),name:n,pct:0});save();render()}}
  else if(a=="adda"){const n=$("#at").value.trim();if(n){S.appts.push({id:Date.now(),title:n,date:$("#ad").value,type:$("#ay").value});save();render()}}
  else if(a=="dela"){S.appts=S.appts.filter(x=>x.id!=D.id);save();render()}
  else if(a=="tm")addTimer("",+v);
  else if(a=="addt")addTimer($("#tl").value.trim(),+$("#tmn").value);
  else if(a=="delt"){S.timers=S.timers.filter(x=>x.id!=D.id);save();render()}
  else if(a=="delmemo"){await idb.deleteMemo(D.id);memos=memos.filter(x=>x.id!=D.id);render()}
  else if(a=="bcopy"){const t=backupText(),fb=()=>{bk="show";render()};try{navigator.clipboard.writeText(t).then(()=>{toast("Backup copied");markBackup()}).catch(fb)}catch(x){fb()}}
  else if(a=="bfile"){const u=URL.createObjectURL(new Blob([backupText()],{type:"application/json"})),l=document.createElement("a");l.href=u;l.download="paintpro-backup-"+today()+".json";l.click();setTimeout(()=>URL.revokeObjectURL(u),1000);markBackup()}
  else if(a=="bdone"){bk=null;markBackup()}
  else if(a=="brestore"){bk="restore";armed=false;render()}
  else if(a=="bcancel"){bk=null;armed=false;rtxt="";render()}
  else if(a=="bapply"){rtxt=$("#rt").value;if(!rtxt.trim()){toast("Paste backup text");return}
   if(!armed){armed=true;render();return}
   const err=restoreFrom(rtxt);if(err){armed=false;toast(err);render();return}
   bk=null;armed=false;rtxt="";toast("Backup restored");render()}
  else if(a=="settle"){const w=S.workers.find(x=>x.id==D.w),days=weekDays(off),c=calc(w,days),p=Math.round(+document.getElementById("pd"+D.w).value);
   if(!(p>=0)){toast("Enter amount paid");return}
   S.settled[w.id+"|"+days[0]]={e:c.e,f:c.f,n:c.n,paid:p,at:new Date().toISOString()};save();toast("Week settled");render()}
  else if(a=="reopen"){if(rk!=D.k){rk=D.k;render();return}delete S.settled[D.k];rk=null;save();toast("Week reopened");render()}
  else if(a=="rec")startRec();
  else if(a=="stop"&&rec)rec.stop();
});

document.addEventListener("change",e=>{const t=e.target;if(t.dataset.a=="pct"){const s=S.sites.find(x=>x.id==t.dataset.id);s.pct=+t.value;save();render()}});
document.addEventListener("play",e=>{const t=e.target;if(t.dataset&&t.dataset.a=="heard"){
  const memo = memos.find(m=>m.id==t.dataset.id);
  if(memo){ memo.heard=true; idb.saveMemo(memo); }
}},true);

// Keyboard dismiss sheet
document.addEventListener("keydown", e => { if (e.key === "Escape" && sh) { sh = null; render(); } });

// ===== 9. TIMER ALERTS & INITIALIZATION =====

function ring(t){
  toast("⏱ "+t.label+" is done");
  try{if(navigator.vibrate)navigator.vibrate([300,150,300])}catch(e){}
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIFICATION',
      title: 'PaintPro Timer Expired',
      body: t.label + ' is done'
    });
  } else if ("Notification" in window && Notification.permission === "granted") {
    new Notification("PaintPro timer", { body: t.label + " is done" });
  }
}

setInterval(()=>{
  let ch=false;
  S.timers.forEach(t=>{if(!t.fired&&t.end<=Date.now()){t.fired=true;ch=true;ring(t)}});
  if(ch){
    save();
    // Prevent wiping form typing if user is currently typing in an input
    if (document.activeElement && document.activeElement.tagName !== "INPUT") {
      render();
    }
  }
  document.querySelectorAll("[data-end]").forEach(el=>el.textContent=cd(+el.dataset.end));
}, 1000);

// Initialize IndexedDB and migrate data from localStorage
(async function initApp() {
  await idb.init();
  const idbState = await idb.getKV("state");
  let lsState = null;
  try { lsState = JSON.parse(localStorage.getItem("pp") || "null"); } catch(e){}

  if (idbState) {
    S = idbState;
  } else if (lsState) {
    S = lsState;
    await idb.setKV("state", S);
  } else {
    S = defaultState;
    await idb.setKV("state", S);
  }

  migrate();
  memos = await idb.getMemos();
  render();
})();