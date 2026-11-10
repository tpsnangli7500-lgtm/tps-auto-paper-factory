'use strict';
/* ============ helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const store = {
  get(k, d){ try { const v = localStorage.getItem('tpf_' + k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('tpf_' + k, JSON.stringify(v)); } catch(e){} }
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0,10);
function daysAgo(n){ const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }

/* ============ providers ============ */
const PROVIDERS = {
  gemini: { name:'Gemini (Google AI Studio)', base:'https://generativelanguage.googleapis.com/v1beta/openai', prefer:['gemini-2.5-flash','gemini-3-flash','gemini-2.0-flash','flash'] },
  groq:   { name:'Groq', base:'https://api.groq.com/openai/v1', prefer:['gpt-oss-120b','llama-3.3-70b','qwen','llama-3.1-8b','llama'] },
  openrouter: { name:'OpenRouter (300+ models, kai FREE)', base:'https://openrouter.ai/api/v1', freeFirst:true, prefer:['nemotron-3-ultra','gemma-4-31b','gemma','deepseek','llama-3.3','qwen','llama'], note:'Ek key, 300+ models. Test dabane par FREE (:free wale) models pehle chunega — free list me sabse bada model (Nemotron 3 Ultra 550B) apne aap lagega. Key yahan se banti hai: openrouter.ai/keys (free account, card nahi lagta). Free models par roz ki seema hoti hai aur free list samay-samay par badalti rehti hai.' },
  nvidia: { name:'NVIDIA NIM', base:'https://integrate.api.nvidia.com/v1', prefer:['nemotron','llama'], note:'⚠️ NVIDIA apni API ko website/browser se seedha call karne nahi deta (CORS bandish) — isiliye ye key yaha Test me fail hogi, key galat nahi hai. NVIDIA sirf Babu ke FreeLLMAPI (server) se chalta hai; is dabbe ko khali chhod do.' }
};
function getKeys(){ return store.get('keys', {}); }
function anyKey(){ const k = getKeys(); return Object.keys(PROVIDERS).some(p => k[p] && k[p].key && k[p].model); }
function refreshKeyPill(){
  const el = $('#keyStatus'); if(!el) return;
  if (anyKey()){ el.textContent = '🔑 AI Key: Taiyaar ✔'; el.className = 'pill green'; }
  else { el.textContent = '🔑 Key: Settings me daalo'; el.className = 'pill violet'; }
}
async function fetchModels(p, key){
  const r = await fetch(PROVIDERS[p].base + '/models', { headers:{ 'Authorization':'Bearer ' + key } });
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).map(m => m.id).filter(Boolean);
}
function pickModel(p, ids){
  const pref = PROVIDERS[p].prefer;
  let pool = ids;
  if (PROVIDERS[p].freeFirst){ const f = ids.filter(id => id.toLowerCase().includes(':free')); if (f.length) pool = f; }
  for (const want of pref){ const hit = pool.find(id => id.toLowerCase().includes(want)); if (hit) return hit; }
  return pool[0] || ids[0] || null;
}
async function callAI(messages, maxTokens){
  const keys = getKeys();
  let lastErr = null;
  for (const p of Object.keys(PROVIDERS)){
    const cfg = keys[p];
    if(!cfg || !cfg.key || !cfg.model) continue;
    try {
      const r = await fetch(PROVIDERS[p].base + '/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.key },
        body: JSON.stringify({ model: cfg.model, messages, temperature: 0.4, max_tokens: maxTokens || 1800 })
      });
      if(!r.ok) throw new Error(p + ' HTTP ' + r.status);
      const j = await r.json();
      const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (txt) return txt.trim();
      throw new Error(p + ' khaali jawab');
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Koi AI key nahi mili — Settings me key daalo.');
}

/* ============ navigation ============ */
function showView(v){
  ['dashboard','editor','settings'].forEach(x => $('#view-' + x).classList.toggle('hidden', x !== v));
  $$('.side nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  window.scrollTo({ top:0 });
}
$$('.side nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    if (a.dataset.view) showView(a.dataset.view);
    else if (a.dataset.scroll){
      showView('dashboard');
      setTimeout(() => { const t = document.getElementById(a.dataset.scroll); if(t) t.scrollIntoView({ behavior:'smooth', block:'start' }); }, 60);
    }
  });
});

/* ============ Scanner (Europe PMC — asal papers) ============ */
const DEFAULT_AREAS = ['neuropharmacology', 'phytomedicine', 'insomnia sleep disorders', 'natural products neuroprotection'];
function getAreas(){ return store.get('areas', DEFAULT_AREAS); }
function renderAreasLine(){ $('#areaLine').textContent = getAreas().join(' • '); }
async function scanNow(){
  const box = $('#scanCards');
  box.innerHTML = '<div class="scan-note">⏳ Scan ho raha hai… Europe PMC se asal taaza papers aa rahe hain.</div>';
  $('#scanBtn').disabled = true;
  try {
    const from = daysAgo(45), to = today();
    const seen = new Set(); const papers = [];
    for (const area of getAreas()){
      const q = encodeURIComponent('(' + area + ') AND (FIRST_PDATE:[' + from + ' TO ' + to + '])');
      const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' + q + '&format=json&resultType=core&pageSize=5&sortBy=date';
      const r = await fetch(url);
      if(!r.ok) throw new Error('Europe PMC HTTP ' + r.status);
      const j = await r.json();
      for (const p of (j.resultList && j.resultList.result) || []){
        const key = p.doi || p.id || p.title;
        if(!key || seen.has(key)) continue;
        seen.add(key);
        papers.push({
          title: p.title || 'Untitled',
          authors: (p.authorString || '').split(',').slice(0,3).join(', ') + ((p.authorString||'').split(',').length > 3 ? ' et al.' : ''),
          journal: (p.journalInfo && p.journalInfo.journal && p.journalInfo.journal.title) || '',
          date: p.firstPublicationDate || '',
          doi: p.doi || '',
          abs: (p.abstractText || '').replace(/<[^>]+>/g,'')
        });
      }
    }
    if (!papers.length){
      /* Fallback: Crossref (agar Europe PMC na mile to) */
      for (const area of getAreas()){
        const cu = 'https://api.crossref.org/works?query=' + encodeURIComponent(area) + '&filter=from-pub-date:' + from + ',until-pub-date:' + to + ',type:journal-article&sort=published&order=desc&rows=4&select=title,author,container-title,DOI,published,abstract';
        const cr = await fetch(cu, { headers:{ 'Accept':'application/json' } });
        if(!cr.ok) continue;
        const cj = await cr.json();
        for (const w of (cj.message && cj.message.items) || []){
          const key = w.DOI || (w.title && w.title[0]);
          if(!key || seen.has(key)) continue;
          seen.add(key);
          const dp = w.published && w.published['date-parts'] && w.published['date-parts'][0];
          papers.push({
            title: (w.title && w.title[0]) || 'Untitled',
            authors: (w.author || []).slice(0,3).map(a => ((a.given || '') + ' ' + (a.family || '')).trim()).join(', '),
            journal: (w['container-title'] && w['container-title'][0]) || '',
            date: dp ? dp.join('-') : '',
            doi: w.DOI || '',
            abs: (w.abstract || '').replace(/<[^>]+>/g,'')
          });
        }
      }
    }
    papers.sort((a,b) => (b.date || '').localeCompare(a.date || ''));
    const top = papers.slice(0, 6);
    store.set('scan', { at: Date.now(), papers: top });
    renderScan(top);
    if(!top.length) box.innerHTML = '<div class="scan-note">Is samay in vishayon me naye papers nahi mile. Thodi der baad dobara scan karo.</div>';
  } catch(e){
    box.innerHTML = '<div class="scan-note">⚠️ Scan nahi ho paya (' + esc(e.message) + '). Internet jaanch karke “Abhi Scan Karo” dobara dabao.</div>';
  } finally { $('#scanBtn').disabled = false; }
}
function renderScan(papers){
  const box = $('#scanCards');
  box.innerHTML = '';
  papers.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'scard';
    d.innerHTML =
      '<div class="src">🌍 DUNIYA ME NAYA • ' + esc(p.journal || 'Journal') + '</div>' +
      '<div class="ttl">' + (p.doi ? '<a href="https://doi.org/' + esc(p.doi) + '" target="_blank" rel="noopener" style="color:#0d2149; text-decoration:none;">' + esc(p.title) + '</a>' : esc(p.title)) + '</div>' +
      '<div class="meta">' + esc(p.authors) + (p.date ? ' • ' + esc(p.date) : '') + (p.doi ? ' • DOI: ' + esc(p.doi) : '') + '</div>' +
      (p.abs ? '<div class="abs">' + esc(p.abs.slice(0, 240)) + '…</div>' : '') +
      '<div class="idea hidden"></div>' +
      '<div class="acts"><button class="btn small primary act-add">🚀 Is par kaam shuru karo</button>' +
      '<button class="btn small act-an">💡 Analysis (Kami + Humari Research)</button></div>';
    d.querySelector('.act-add').addEventListener('click', () => {
      addToQueue(p.title.replace(/\.$/,''), store.get('target','Indian Journal of Pharmacology'), 'Scanner se — ' + (p.journal || '') + (p.doi ? ' • DOI ' + p.doi : ''));
      alert('Topic Queue me jud gaya ✔ Neeche Queue me dekho.');
      document.getElementById('queueSec').scrollIntoView({ behavior:'smooth' });
    });
    d.querySelector('.act-an').addEventListener('click', async (ev) => {
      const idea = d.querySelector('.idea');
      if(!anyKey()){ idea.classList.remove('hidden'); idea.textContent = '💡 Analysis ke liye Settings me AI key daalo — ya is paper ko Babu ko chat me bhejo, wahi pura analysis milega.'; return; }
      ev.target.disabled = true; ev.target.textContent = '⏳ Analysis ho raha hai…';
      try {
        const out = await callAI([
          { role:'system', content:'You help a pharmacology researcher in India (mice models; endpoints GSH, TBARS, IL-6; plants: Chenopodium album, Nerium oleander terpenoids). Answer in Roman Hinglish, exactly 2 short lines: line 1 starts "Kami: " (the gap/limitation of this paper), line 2 starts "Humari nayi research: " (a modified study idea fitted to his lab). Never invent data.' },
          { role:'user', content:'Paper: ' + p.title + '\nAbstract: ' + (p.abs || '').slice(0, 1200) }
        ], 300);
        idea.classList.remove('hidden'); idea.textContent = out;
      } catch(e){ idea.classList.remove('hidden'); idea.textContent = '⚠️ Analysis nahi ho paya: ' + e.message; }
      ev.target.disabled = false; ev.target.textContent = '💡 Analysis (Kami + Humari Research)';
    });
    box.appendChild(d);
  });
}
$('#scanBtn').addEventListener('click', scanNow);

/* ============ Topic Queue + AI Draft ============ */
function getQueue(){ return store.get('queue', []); }
function saveQueue(q){ store.set('queue', q); renderQueue(); }
function addToQueue(topic, journal, note){
  const q = getQueue();
  q.unshift({ id: Date.now(), topic, journal: journal || 'Indian Journal of Pharmacology', note: note || '', at: today() });
  saveQueue(q);
}
function renderQueue(){
  const q = getQueue();
  $('#sideQueueCount').textContent = q.length;
  $('#stQueue').textContent = q.length;
  const list = $('#queueList'); list.innerHTML = '';
  if(!q.length) list.innerHTML = '<div class="muted" style="margin-bottom:9px;">Queue khaali hai. Scanner se topic chuno ya neeche naya topic likho.</div>';
  q.forEach(item => {
    const d = document.createElement('div'); d.className = 'qitem';
    d.innerHTML = '<div class="qt">' + esc(item.topic) + '</div><div class="qm">Target: ' + esc(item.journal) + (item.note ? ' • ' + esc(item.note) : '') + ' • ' + esc(item.at) + '</div>' +
      '<div class="qa"><button class="btn small primary qa-draft">✨ AI Draft Banao</button><button class="btn small qa-del">🗑️ Hatao</button></div>';
    d.querySelector('.qa-del').addEventListener('click', () => saveQueue(getQueue().filter(x => x.id !== item.id)));
    d.querySelector('.qa-draft').addEventListener('click', (ev) => makeDraft(item, ev.target));
    list.appendChild(d);
  });
}
const DRAFT_SYS = 'You are a research-writing agent for a pharmacology researcher (SVSU Meerut, India). Write in clear academic English. STRICT RULES: never invent results, numbers, or references; where information is missing write [AUTHOR TO PROVIDE]; do not copy text from anywhere. Produce: (1) a Title line, (2) a structured Abstract draft (Background/Objective/Methods-outline/Conclusion with placeholders where data is missing), (3) an Introduction draft of 2 short paragraphs, (4) a section outline for the rest of the review. Keep it under 700 words.';
async function makeDraft(item, btn){
  if(!anyKey()){ alert('Pehle Settings me kam se kam ek AI key daalo (Gemini/Groq/NVIDIA) — bina key ke draft nahi ban sakta.'); showView('settings'); return; }
  btn.disabled = true; btn.textContent = '⏳ Draft ban raha hai…';
  try {
    const out = await callAI([
      { role:'system', content: DRAFT_SYS },
      { role:'user', content:'Topic: ' + item.topic + '\nTarget journal: ' + item.journal + (item.note ? '\nNote: ' + item.note : '') }
    ], 1600);
    const drafts = store.get('drafts', []);
    drafts.unshift({ at: Date.now(), topic: item.topic, journal: item.journal, text: out });
    store.set('drafts', drafts);
    $('#stDrafts').textContent = drafts.length;
    setEditorText(out);
    $('#docName').value = item.topic.slice(0, 40).replace(/[^\w\- ]+/g,'') + '.docx';
    renderProd(item, out);
    showView('editor');
  } catch(e){ alert('Draft nahi ban paya: ' + e.message); }
  btn.disabled = false; btn.textContent = '✨ AI Draft Banao';
}
function renderProd(item, text){
  $('#prodCard').innerHTML = '<div style="font-size:14px; font-weight:800; line-height:1.45;">' + esc(item.topic) + '</div>' +
    '<div class="muted" style="margin:4px 0 8px;">AI Draft taiyaar — Editor me khula hai • Target: ' + esc(item.journal) + '</div>' +
    '<ul class="pack"><li>✔ Outline + Abstract + Introduction draft</li><li>✔ [AUTHOR TO PROVIDE] nishan jahan jaankari kam hai</li><li>⏳ References — raat ke full run me Crossref se verify hokar lagenge</li><li>⏳ Figures + Cover Letter — full run me</li></ul>' +
    '<button class="btn small primary" onclick="showView(\'editor\')">✍️ Editor me kholo</button>';
}
$('#qAdd').addEventListener('click', () => {
  const t = $('#qTopic').value.trim();
  if(!t){ alert('Pehle topic likho.'); return; }
  addToQueue(t, $('#qJournal').value, '');
  $('#qTopic').value = '';
});

/* ============ Journal Khoj Desk (verified suchi) ============ */
const JOURNALS = [
  { n:'Indian Journal of Pharmacology', scopus:true, wos:'SCIE', fee:0, feeNote:'Fee ₹0 (koi APC nahi)', q:'Q3', reviews:'yes', speed:'~4–6 mahine', kw:'pharmacology drug review india clinical experimental' },
  { n:'Journal of Ethnopharmacology', scopus:true, wos:'SCIE', fee:0, feeNote:'Subscription route ₹0', q:'Q1', reviews:'yes', speed:'Selection sakht', kw:'ethnopharmacology plant extract traditional medicine phytomedicine herbal' },
  { n:'Bangladesh Journal of Pharmacology', scopus:true, wos:'SCIE', fee:0, feeNote:'Fee ₹0', q:'Q3', reviews:'mini', speed:'Sabse tez ~8 hafte • swikriti ~10%', kw:'pharmacology experimental mini review bangladesh' },
  { n:'Turkish Journal of Pharmaceutical Sciences', scopus:true, wos:'ESCI', fee:0, feeNote:'Fee ₹0', q:'Q2', reviews:'invited', speed:'~12 hafte', kw:'pharmaceutical sciences research article turkey' },
  { n:'Journal of Natural Remedies', scopus:true, wos:null, fee:0, feeNote:'Fee ₹0', q:'—', reviews:'yes', speed:'—', kw:'natural remedies herbal ayurveda plant natural products' },
  { n:'Molecular Neurobiology', scopus:true, wos:'SCIE', fee:0, feeNote:'Subscription route ₹0', q:'Q1', reviews:'yes', speed:'IF 5.5 • Q1 ka sabse asal lakshya', kw:'neurobiology neuroscience neuroprotection molecular brain neurodegeneration' },
  { n:'Metabolic Brain Disease', scopus:true, wos:'SCIE', fee:0, feeNote:'Subscription route ₹0', q:'Q2', reviews:'yes', speed:'—', kw:'brain metabolism neuro metabolic disease' },
  { n:'Journal of Pharmacology & Pharmacotherapeutics', scopus:true, wos:'ESCI', fee:35400, feeNote:'Fee ₹35,400 (sirf acceptance ke baad)', q:'—', reviews:'yes', speed:'~3–4 mahine', kw:'pharmacology pharmacotherapeutics clinical' }
];
const WARN_J = [
  { n:'Indian Journal of Pharmaceutical Sciences', why:'⛔ Scopus coverage 2022 me BAND ho chuki hai aur post-acceptance levy bhi hai — isme paper mat bhejo.' },
  { n:'Neurochemical Research', why:'⚠️ 2027 se pura paid (APC) model — ab free nahi raha.' },
  { n:'Journal of Ayurveda and Integrative Medicine', why:'⚠️ Scopus hai lekin APC ~$2,070 (bahut mehenga paid).' }
];
const JF = { scopus:true, wos:true, free:true, paid:false, review:false };
function journalMatch(j, topic){
  if(!topic) return 70 + Math.floor(Math.random()*0); // no topic → neutral order
  const words = topic.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  const hay = (j.n + ' ' + j.kw).toLowerCase();
  if(!words.length) return 60;
  let hit = 0; words.forEach(w => { if (hay.includes(w)) hit++; });
  return Math.min(98, Math.round(55 + (hit / words.length) * 43));
}
function renderJournals(){
  const topic = $('#jTopic').value.trim();
  const budget = parseInt($('#jBudget').value || '', 10);
  const rows = JOURNALS.filter(j => {
    if (JF.scopus && !j.scopus) return false;
    if (JF.wos && !j.wos) return false;
    if (JF.free && !JF.paid && j.fee > 0) return false;
    if (!JF.free && JF.paid && j.fee === 0) return false;
    if (!isNaN(budget) && j.fee > budget) return false;
    if (JF.review && j.reviews === 'invited') return false;
    return true;
  }).map(j => ({ j, m: journalMatch(j, topic) })).sort((a,b) => b.m - a.m);
  const box = $('#jResults'); box.innerHTML = '';
  if(!rows.length){ box.innerHTML = '<div class="scan-note" style="margin-top:9px;">In filteron par koi journal nahi mila. Filter halka karke dobara dekho.</div>'; return; }
  rows.forEach(({ j, m }) => {
    const d = document.createElement('div'); d.className = 'jrow';
    d.innerHTML = '<div><div class="jn">' + esc(j.n) + (j.fee > 0 ? ' <span class="tag paid">💰 PAID</span>' : '') + '</div><div class="jm">' +
      (j.scopus ? '<span class="tag">SCOPUS ✔</span> ' : '') + (j.wos ? '<span class="tag wos">' + j.wos + ' ✔</span> ' : '') +
      '• ' + esc(j.feeNote) + (j.q !== '—' ? ' • ' + j.q : '') +
      (j.reviews === 'yes' ? ' • Review chhaapta hai' : j.reviews === 'mini' ? ' • Sirf Mini-Review' : ' • Review sirf bulave par') +
      ' • ' + esc(j.speed) + '</div></div>' +
      '<div class="match"><div class="mp">' + m + '%</div><div class="ml">Tumhare paper se match</div><button class="tb2 tb">🎯 Target rakho</button></div>';
    const b = d.querySelector('.tb2');
    b.style.cssText = 'margin-top:4px; font-size:11px; font-weight:800; background:#2e5fe3; color:#fff; padding:5px 10px; border-radius:8px; border:none; cursor:pointer;';
    b.addEventListener('click', () => { store.set('target', j.n); fillJournalSelect(); b.textContent = '✔ Target Rakha'; setTimeout(()=> b.textContent = '🎯 Target rakho', 1500); });
    box.appendChild(d);
  });
}
$$('#jFilters span[data-f]').forEach(sp => sp.addEventListener('click', () => {
  const f = sp.dataset.f;
  if (f === 'free' || f === 'paid'){
    if (f === 'free'){ JF.free = true; JF.paid = false; }
    else { JF.paid = !JF.paid; if (JF.paid) JF.free = true; }
  } else JF[f] = !JF[f];
  $$('#jFilters span[data-f]').forEach(s => {
    const k = s.dataset.f;
    s.classList.toggle('on', k === 'free' ? (JF.free && !JF.paid) : k === 'paid' ? JF.paid : !!JF[k]);
  });
  renderJournals();
}));
$('#jSearchBtn').addEventListener('click', renderJournals);
$('#jBudget').addEventListener('input', renderJournals);
$('#sachBtn').addEventListener('click', () => {
  const name = $('#sachName').value.trim().toLowerCase();
  const out = $('#sachOut');
  if(!name){ out.textContent = 'Pehle journal ka naam likho.'; return; }
  const w = WARN_J.find(x => x.n.toLowerCase().includes(name) || name.includes(x.n.toLowerCase()));
  if (w){ out.innerHTML = '🔴 <b>' + esc(w.n) + ':</b> ' + esc(w.why); return; }
  const j = JOURNALS.find(x => x.n.toLowerCase().includes(name) || name.includes(x.n.toLowerCase()));
  if (j){ out.innerHTML = '🟢 <b>' + esc(j.n) + '</b> — hamari verified suchi me hai. ' + (j.scopus ? 'Scopus ✔ ' : '') + (j.wos ? j.wos + ' ✔ ' : '') + '• ' + esc(j.feeNote) + '. Bhej sakte ho.'; return; }
  out.innerHTML = '🟡 Ye journal hamari <b>haath se verify ki hui suchi me nahi</b> hai — iska matlab ye nahi ki wo kharab hai. Faisla lene se pehle Babu ko chat me naam bhejo, wahan Scopus/WoS ki asal jaanch hogi. Aur “UGC CARE approved 2026” wala dawa dikhe to turant savdhaan — CARE list Feb 2025 me band ho chuki hai.';
});
function fillJournalSelect(){
  const sel = $('#qJournal'); if(!sel) return;
  const target = store.get('target', 'Indian Journal of Pharmacology');
  sel.innerHTML = JOURNALS.map(j => '<option' + (j.n === target ? ' selected' : '') + '>' + esc(j.n) + '</option>').join('');
}

/* ============ Editor ============ */
const page = $('#wordPage');
const SAMPLE = 'Beyond Cardenolides: Pentacyclic Triterpenoids of Nerium oleander — A Review\nTeenu Pal, Prabhat Singh — SVSU, Meerut\n\nAbstract\nUrsolic acid and oleanolic acid are pentacyclic triterpenoids reported in the leaves of Nerium oleander. The extract was showed significant neuroprotective activity in rodent models. Oxidative stress markers such as GSH, TBARS and IL-6 were measured in brain homogenates.\n\nRecent evidence suggests that both compounds activate the Nrf2 pathway and suppress NF-kB-driven neuroinflammation, although neither compound obtained from oleander itself has yet been tested in a neural model.';
function setEditorText(t){ page.innerText = t; store.set('doc', t); updateWC(); }
function getEditorText(){ return page.innerText || ''; }
let wcTimer = null;
function updateWC(){
  const t = getEditorText().trim();
  $('#wcLine').textContent = 'Shabd: ' + (t ? t.split(/\s+/).length : 0);
}
page.addEventListener('input', () => { clearTimeout(wcTimer); wcTimer = setTimeout(() => { store.set('doc', getEditorText()); updateWC(); }, 400); });
$$('.wtoolbar [data-cmd]').forEach(b => b.addEventListener('click', () => { document.execCommand(b.dataset.cmd, false, null); page.focus(); }));
$('#fontSel').addEventListener('change', e => { page.style.fontFamily = e.target.value + ', Georgia, serif'; });
$('#sizeSel').addEventListener('change', e => { page.style.fontSize = e.target.value + 'pt'; });
$('#docName').addEventListener('input', e => store.set('docName', e.target.value));
$('#dlTxt').addEventListener('click', () => {
  const blob = new Blob([getEditorText()], { type:'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = ($('#docName').value || 'paper').replace(/\.docx$/i,'') + '.txt'; a.click(); URL.revokeObjectURL(a.href);
});
$('#copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(getEditorText()); alert('Copy ho gaya ✔'); } catch(e){ alert('Copy nahi ho paya — text chun kar haath se copy karo.'); } });

function aiCard(html){
  const out = $('#aiOut');
  out.innerHTML = '';
  const d = document.createElement('div'); d.className = 'ai-card'; d.innerHTML = html;
  out.appendChild(d); return d;
}
function needKey(){
  if (anyKey()) return false;
  aiCard('🔑 Is upkaran ke liye pehle <b>Settings</b> me AI key daalo (Gemini / Groq / NVIDIA).');
  showView('editor'); return true;
}
function spliceReplace(oldTxt, newTxt){
  const t = getEditorText();
  const i = t.indexOf(oldTxt);
  if (i < 0){ alert('Chuna hua hissa nahi mila (shayad badal gaya hai). Dobara chun kar koshish karo.'); return false; }
  setEditorText(t.slice(0, i) + newTxt + t.slice(i + oldTxt.length));
  return true;
}
function selText(){ const s = window.getSelection(); return s ? s.toString() : ''; }

$('#tGrammar').addEventListener('click', async () => {
  if (needKey()) return;
  const t = getEditorText().trim();
  if (t.length < 40){ alert('Pehle Editor me kuch text rakho.'); return; }
  const card = aiCard('⏳ Grammar jaanch ho rahi hai…');
  try {
    const fixed = await callAI([
      { role:'system', content:'You are a meticulous academic copy-editor. Correct ONLY grammar, spelling and punctuation. Do not change scientific terms, doses, units, numbers, citations or meaning. Return ONLY the fully corrected text, nothing else.' },
      { role:'user', content: t.slice(0, 6000) }
    ], 2200);
    card.innerHTML = '<b>✔ Sudhaara hua roop (preview):</b>\n' + esc(fixed.slice(0, 700)) + (fixed.length > 700 ? '…' : '') + '<div class="acts"><button class="yn y">✔ Lagao</button><button class="yn n">✖ Chhodo</button></div>';
    card.querySelector('.y').addEventListener('click', () => { setEditorText(fixed); card.innerHTML = '✔ Sudhaar lag gaya. Purana roop chahiye to “Purana Roop Wapas” me snapshot rakha karo.'; });
    card.querySelector('.n').addEventListener('click', () => { card.remove(); });
  } catch(e){ card.textContent = '⚠️ Nahi ho paya: ' + e.message; }
});
$('#tRewrite').addEventListener('click', async () => {
  if (needKey()) return;
  const s = selText().trim();
  if (s.length < 10){ alert('Pehle Editor me ek vaakya chun (select) karo.'); return; }
  const card = aiCard('⏳ Teen naye roop ban rahe hain…');
  try {
    const out = await callAI([
      { role:'system', content:'Rewrite the given academic sentence in 3 different ways, keeping the meaning and all scientific terms/numbers/units exactly. Separate the 3 versions with a line containing only %%% . No explanations.' },
      { role:'user', content: s }
    ], 500);
    const vars = out.split('%%%').map(x => x.trim()).filter(Boolean);
    card.innerHTML = '<b>♻️ Teen roop — jo pasand aaye, use dabao:</b>';
    vars.forEach(v => {
      const b = document.createElement('button'); b.className = 'tbtn'; b.textContent = v;
      b.addEventListener('click', () => { if (spliceReplace(s, v)) card.innerHTML = '✔ Vaakya badal gaya.'; });
      card.appendChild(b);
    });
  } catch(e){ card.textContent = '⚠️ Nahi ho paya: ' + e.message; }
});
$('#tSynonym').addEventListener('click', async () => {
  if (needKey()) return;
  const s = selText().trim();
  if (!s || /\s/.test(s)){ alert('Pehle Editor me EK shabd chun (select) karo.'); return; }
  const card = aiCard('⏳ Paryay khoj raha hai…');
  try {
    const out = await callAI([
      { role:'system', content:'Give 6 English synonyms for the word, suitable for academic writing, comma-separated only. Never change scientific/drug names — if the word is a scientific term, reply: NONE' },
      { role:'user', content: s }
    ], 120);
    if (/^NONE/i.test(out)){ card.textContent = '🔒 Ye vaigyanik shabd hai — iska paryay nahi badalna chahiye.'; return; }
    card.innerHTML = '<b>🔁 “' + esc(s) + '” ke paryay — dabao to badle:</b>';
    out.split(',').map(x => x.trim()).filter(Boolean).forEach(v => {
      const b = document.createElement('button'); b.className = 'tbtn'; b.textContent = v;
      b.addEventListener('click', () => { if (spliceReplace(s, v)) card.innerHTML = '✔ Shabd badal gaya.'; });
      card.appendChild(b);
    });
  } catch(e){ card.textContent = '⚠️ Nahi ho paya: ' + e.message; }
});
$('#tShorten').addEventListener('click', async () => {
  if (needKey()) return;
  const s = selText().trim();
  if (s.length < 30){ alert('Pehle Editor me ek bada hissa chun (select) karo.'); return; }
  const card = aiCard('⏳ Chhota ho raha hai…');
  try {
    const out = await callAI([
      { role:'system', content:'Shorten the text by about 30% keeping every fact, number, unit and citation. Return only the shortened text.' },
      { role:'user', content: s }
    ], 700);
    card.innerHTML = '<b>✂️ Chhota roop:</b>\n' + esc(out) + '<div class="acts"><button class="yn y">✔ Lagao</button><button class="yn n">✖ Chhodo</button></div>';
    card.querySelector('.y').addEventListener('click', () => { if (spliceReplace(s, out)) card.innerHTML = '✔ Lag gaya.'; });
    card.querySelector('.n').addEventListener('click', () => card.remove());
  } catch(e){ card.textContent = '⚠️ Nahi ho paya: ' + e.message; }
});
const MISSPELL = { dizepam:'diazepam', diazepan:'diazepam', recieved:'received', seperate:'separate', occured:'occurred', occuring:'occurring', teh:'the', wiht:'with', adress:'address', langauge:'language', enviroment:'environment', goverment:'government', pharamcology:'pharmacology', phamacology:'pharmacology', neuroprotctive:'neuroprotective', triterpeniod:'triterpenoid', homogenat:'homogenate', sigificant:'significant', signifcant:'significant', treatement:'treatment', experment:'experiment', anaysis:'analysis', funtion:'function', protien:'protein', memebrane:'membrane' };
function findingsCard(title, lines){
  const out = $('#aiOut'); out.innerHTML = '';
  const d = document.createElement('div'); d.className = 'ai-card';
  d.innerHTML = '<b>' + esc(title) + '</b>' + (lines.length ? lines.map(l => '<div class="finding">' + l + '</div>').join('') : '<div class="finding">✔ Kuch nahi mila — saaf hai.</div>');
  out.appendChild(d);
}
$('#tSpell').addEventListener('click', () => {
  const t = getEditorText().toLowerCase(); const lines = [];
  Object.keys(MISSPELL).forEach(w => { const c = (t.match(new RegExp('\\b' + w + '\\b','g')) || []).length; if (c) lines.push('🔤 <b>' + w + '</b> → <b>' + MISSPELL[w] + '</b> (' + c + ' baar)'); });
  const dbl = getEditorText().match(/\b(\w+)\s+\1\b/gi) || [];
  if (dbl.length) lines.push('🔁 Dohraaye shabd: ' + [...new Set(dbl)].slice(0,6).map(esc).join(', '));
  findingsCard('🔤 Spelling Suchi (aam galtiyaan, device par)', lines);
});
$('#tSentence').addEventListener('click', () => {
  const sents = getEditorText().replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const longs = sents.map(s => ({ s, n: s.split(/\s+/).length })).filter(x => x.n > 25).slice(0, 8);
  findingsCard('🧩 Lambe Vaakya (25+ shabd) — kul ' + longs.length, longs.map(x => '📏 <b>' + x.n + ' shabd:</b> ' + esc(x.s.slice(0, 160)) + '…'));
});
$('#tNumbers').addEventListener('click', () => {
  const t = getEditorText();
  const re = /\d+(?:\.\d+)?\s?(mg\/kg|mg|µg|μg|ug|mcg|µM|μM|uM|µmol\/mg|μmol\/mg|nmol\/g|pg\/mL|pg\/ml|mL|ml|%|IU|g\/kg)/g;
  const found = {}; let m;
  while ((m = re.exec(t))){ const u = m[1]; found[u] = (found[u] || 0) + 1; }
  const lines = Object.keys(found).sort().map(u => '🔢 <b>' + esc(u) + '</b> — ' + found[u] + ' baar');
  const fams = [ ['µg','μg','ug','mcg'], ['µM','μM','uM'], ['mL','ml'], ['pg/mL','pg/ml'] ];
  fams.forEach(f => { const present = f.filter(x => found[x]); if (present.length > 1) lines.push('⚠️ <b>Ekroopta ki chook:</b> ek hi unit ke kai roop mile — ' + present.map(esc).join(', ') + '. Ek roop chun kar “Sarvatra Badlo” se ek karo.'); });
  findingsCard('🔢 Sankhya / Unit Jaanch (device par)', lines);
});
$('#tFind').addEventListener('click', (e) => {
  if (e.target.closest('input,select')) return;
  const f = $('#frFind').value, r = $('#frRepl').value;
  if (!f){ alert('“Purana shabd” likho pehle (isi dabbe ke andar).'); return; }
  const t = getEditorText(); const count = t.split(f).length - 1;
  if (!count){ alert('“' + f + '” paper me nahi mila.'); return; }
  setEditorText(t.split(f).join(r));
  findingsCard('🔎 Sarvatra Badlaav', ['✔ <b>' + esc(f) + '</b> → <b>' + esc(r) + '</b> : ' + count + ' jagah badla.']);
});
$('#tFormat').addEventListener('click', (e) => {
  if (e.target.closest('select')) return;
  const v = $('#fmtSel').value;
  const presets = {
    ijp:  { font:'Times New Roman', size:'12', lh:'1.5', note:'Indian J Pharmacology preset: Times 12, 1.5 line antar. (Antim jaanch journal ki site par submission se pehle.)' },
    tjps: { font:'Times New Roman', size:'12', lh:'1.15', note:'Turkish J Pharm Sci preset: Times 12, ghana antar ke saath structured abstract taiyaar rakho.' },
    gen:  { font:'Times New Roman', size:'12', lh:'1.5', note:'Aam preset lag gaya.' }
  };
  const p = presets[v] || presets.gen;
  page.style.fontFamily = p.font + ', Georgia, serif'; page.style.fontSize = p.size + 'pt'; page.style.lineHeight = p.lh;
  $('#fontSel').value = p.font; $('#sizeSel').value = p.size;
  findingsCard('🎨 Journal Format', ['✔ ' + esc(p.note)]);
});
$('#tVersions').addEventListener('click', () => {
  const vers = store.get('versions', []);
  vers.unshift({ at: new Date().toLocaleString('en-IN'), text: getEditorText() });
  store.set('versions', vers.slice(0, 10));
  renderVersions();
});
function renderVersions(){
  const vers = store.get('versions', []);
  $('#verList').innerHTML = vers.map((v, i) => '<div class="finding">🕘 ' + esc(v.at) + ' <button class="yn y" data-vi="' + i + '">↩ Yahi Wapas Laao</button></div>').join('');
  $$('#verList [data-vi]').forEach(b => b.addEventListener('click', () => { setEditorText(vers[+b.dataset.vi].text); alert('Purana roop wapas aa gaya ✔'); }));
}
$('#tDiff').addEventListener('click', () => $('#diffBox').classList.toggle('hidden'));
$('#diffGo').addEventListener('click', () => {
  const a = new Set(getEditorText().replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean));
  const b = new Set($('#diffText').value.replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean));
  const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x));
  $('#diffOut').innerHTML = '<div class="finding">🔴 Sirf is paper me (' + onlyA.length + ' vaakya):<br>' + onlyA.slice(0,6).map(s => '• ' + esc(s.slice(0,140))).join('<br>') + '</div>' +
    '<div class="finding">🟢 Sirf dusre roop me (' + onlyB.length + ' vaakya):<br>' + onlyB.slice(0,6).map(s => '• ' + esc(s.slice(0,140))).join('<br>') + '</div>';
});

/* ============ Settings ============ */
function renderKeys(){
  const keys = getKeys();
  const box = $('#keyCards'); box.innerHTML = '';
  Object.keys(PROVIDERS).forEach(p => {
    const cfg = keys[p] || {};
    const d = document.createElement('div'); d.className = 'keycard';
    d.innerHTML = '<div class="kh"><span class="kn">' + PROVIDERS[p].name + '</span><span class="muted">' + (cfg.key ? 'Key save hai' + (cfg.model ? ' • Model: ' + esc(cfg.model) : ' • Model nahi chuna — Test karo') : 'Key nahi hai') + '</span></div>' +
      '<div class="kr"><input type="password" placeholder="API key yahan chipkao" value="' + (cfg.key ? '••••••••••••' : '') + '">' +
      '<select>' + (cfg.model ? '<option>' + esc(cfg.model) + '</option>' : '<option value="">— model —</option>') + '</select>' +
      '<button class="btn small save">💾 Save</button><button class="btn small primary test">🧪 Test</button></div>' +
      (PROVIDERS[p].note ? '<div class="muted" style="margin-top:6px;font-size:.85em;">' + esc(PROVIDERS[p].note) + '</div>' : '') + '<div class="kmsg"></div>';
    const input = d.querySelector('input'), sel = d.querySelector('select'), msg = d.querySelector('.kmsg');
    d.querySelector('.save').addEventListener('click', () => {
      const v = input.value.trim();
      const all = getKeys(); all[p] = all[p] || {};
      if (v && !v.startsWith('••')) all[p].key = v;
      if (sel.value) all[p].model = sel.value;
      store.set('keys', all); msg.textContent = '✔ Save ho gaya.'; refreshKeyPill();
    });
    d.querySelector('.test').addEventListener('click', async () => {
      let v = input.value.trim();
      const saved = (getKeys()[p] || {}).key;
      if (!v || v.startsWith('••')) v = saved;
      if (!v){ msg.textContent = '⚠️ Pehle key chipkao.'; return; }
      msg.textContent = '⏳ Test ho raha hai…';
      try {
        const ids = await fetchModels(p, v);
        if (PROVIDERS[p].freeFirst) ids.sort((a, b) => (b.toLowerCase().includes(':free') ? 1 : 0) - (a.toLowerCase().includes(':free') ? 1 : 0));
        const model = pickModel(p, ids);
        sel.innerHTML = ids.map(id => '<option' + (id === model ? ' selected' : '') + '>' + esc(id) + '</option>').join('');
        const all = getKeys(); all[p] = { key: v, model };
        store.set('keys', all);
        msg.textContent = '✔ Chal gaya! Model: ' + model + ' (' + ids.length + ' models mile)';
        refreshKeyPill();
      } catch(e){ msg.textContent = '⚠️ Test fail: ' + e.message + ' — key sahi se chipkai hai, jaanch lo.'; }
    });
    let modelsLoaded = false;
    async function loadModels(){
      if (modelsLoaded || sel.options.length > 1) return;
      let v = input.value.trim();
      const saved = (getKeys()[p] || {}).key;
      if (!v || v.startsWith('••')) v = saved;
      if (!v) return;
      msg.textContent = '⏳ Models load ho rahe hain…';
      try {
        const ids = await fetchModels(p, v);
        if (PROVIDERS[p].freeFirst) ids.sort((a, b) => (b.toLowerCase().includes(':free') ? 1 : 0) - (a.toLowerCase().includes(':free') ? 1 : 0));
        const cur = (getKeys()[p] || {}).model;
        sel.innerHTML = ids.map(id => '<option' + (id === cur ? ' selected' : '') + '>' + esc(id) + '</option>').join('');
        modelsLoaded = true;
        msg.textContent = '✔ ' + ids.length + ' models load ho gaye — model chuno, wo turant save ho jayega.';
      } catch(e){ msg.textContent = '⚠️ Models load nahi hue: ' + e.message; }
    }
    sel.addEventListener('focus', loadModels);
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      const all = getKeys(); all[p] = all[p] || {};
      all[p].model = sel.value;
      store.set('keys', all); refreshKeyPill();
      msg.textContent = '✔ Model save ho gaya: ' + sel.value;
    });
    box.appendChild(d);
    if (cfg.key && p !== 'nvidia') loadModels();
  });
}
$('#areasSave').addEventListener('click', () => {
  const arr = $('#areasText').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (arr.length){ store.set('areas', arr); renderAreasLine(); $('#areasMsg').textContent = ' ✔ Save — agla scan inhi par hoga.'; }
});

/* ============ init ============ */
renderAreasLine();
$('#areasText').value = getAreas().join('\n');
fillJournalSelect();
renderJournals();
renderQueue();
renderVersions();
refreshKeyPill();
$('#stJournals').textContent = JOURNALS.length;
$('#stDrafts').textContent = store.get('drafts', []).length;
const savedDoc = store.get('doc', '');
setEditorText(savedDoc || SAMPLE);
const dn = store.get('docName', ''); if (dn) $('#docName').value = dn;
const lastScan = store.get('scan', null);
if (lastScan && lastScan.papers && lastScan.papers.length) renderScan(lastScan.papers); else scanNow();
if (location.hash === '#editor') showView('editor');
if (location.hash === '#settings') showView('settings');
renderKeys();
