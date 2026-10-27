/* Feelings Wall – frontend (no dependencies) */
(() => {
  'use strict';

  const MOODS = {
    happy:    { e: '😊', label: 'Happy',    h: 48 },
    grateful: { e: '🙏', label: 'Grateful', h: 30 },
    excited:  { e: '🤩', label: 'Excited',  h: 320 },
    calm:     { e: '😌', label: 'Calm',     h: 170 },
    tired:    { e: '😴', label: 'Tired',    h: 250 },
    confused: { e: '😕', label: 'Confused', h: 200 },
    anxious:  { e: '😰', label: 'Anxious',  h: 280 },
    sad:      { e: '😢', label: 'Sad',      h: 215 },
    lonely:   { e: '🥀', label: 'Lonely',   h: 340 },
    angry:    { e: '😠', label: 'Angry',    h: 5 }
  };
  const REACTS = [
    { k: 'heart',  e: '❤️', t: 'Love' },
    { k: 'hug',    e: '🤗', t: 'Hug' },
    { k: 'strong', e: '💪', t: 'Stay strong' },
    { k: 'same',   e: '🫂', t: 'Me too' }
  ];
  const PROMPTS = [
    "One thing that made me smile today was…",
    "Something I've been carrying that I haven't told anyone…",
    "Right now my body feels…",
    "I wish someone would ask me…",
    "A small win I'm proud of this week…",
    "What I need to hear right now is…",
    "The hardest part of today was…",
    "If my feelings were weather, today would be…",
    "Something I'm scared to admit…",
    "A person I'm grateful for, and why…",
    "What I'd tell my younger self…",
    "I'm tired of pretending that…"
  ];

  /* ---------- tiny helpers ---------- */
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    kids.flat().forEach(c => el.append(c instanceof Node ? c : document.createTextNode(c)));
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const ago = t => {
    const s = Math.max(1, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString();
  };
  function toast(msg, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
  }
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  /* ---------- state ---------- */
  let mood = store.get('ej_mood', 'happy');
  let visibility = 'public';
  let filter = '';
  let sort = 'new';
  let offset = 0;
  let topId = null;
  let mine = store.get('ej_mine', []);          // my entries (private + shared)
  let myReacts = store.get('ej_reacts', {});    // { postId: ['heart', ...] }
  const PAGE = 15;

  // migrate entries from the old version of this app
  (function migrate() {
    const old = store.get('entries', null);
    if (!Array.isArray(old) || store.get('ej_migrated', false)) return;
    const known = new Set(mine.map(m => m.local));
    const moodByEmoji = Object.fromEntries(Object.entries(MOODS).map(([k, v]) => [v.e, k]));
    old.forEach(o => {
      if (!o.text || known.has(o.id)) return;
      mine.push({ local: o.id, text: o.text, mood: moodByEmoji[o.mood] || 'calm', at: Number(o.id) || Date.now(), shared: false });
    });
    mine.sort((a, b) => b.at - a.at);
    store.set('ej_mine', mine); store.set('ej_migrated', true);
  })();

  /* ---------- theme & mood ambience ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
    store.set('ej_theme', t);
  }
  applyTheme(store.get('ej_theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

  function setMood(m) {
    mood = m; store.set('ej_mood', m);
    document.documentElement.style.setProperty('--h', MOODS[m].h);
    document.querySelectorAll('.mood').forEach(b => {
      const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });
  }

  /* ---------- composer ---------- */
  const input = $('#emotionInput');
  $('#moodPicker').append(...Object.entries(MOODS).map(([k, v]) =>
    h('button', { class: 'mood', type: 'button', role: 'radio', 'data-m': k, onclick: () => setMood(k) },
      h('span', { class: 'e' }, v.e), v.label)));
  $('#filterChips').append(h('button', { class: 'chip on', 'data-m': '' }, 'All'),
    ...Object.entries(MOODS).map(([k, v]) => h('button', { class: 'chip', 'data-m': k }, v.e + ' ' + v.label)));

  const CRISIS_RE = /(suicid|kill myself|end my life|self[- ]?harm|want to die|don'?t want to live|hurt myself)/i;
  function onType() {
    $('#charCount').textContent = input.value.length + '/1000';
    $('#crisis').hidden = !CRISIS_RE.test(input.value);
    store.set('ej_draft', input.value);
    $('#draftNote').textContent = input.value ? 'Draft saved on this device' : '';
  }
  input.addEventListener('input', onType);
  input.value = store.get('ej_draft', ''); $('#emotionInput').dispatchEvent(new Event('input'));
  $('#nickInput').value = store.get('ej_nick', '');

  $('#promptBtn').onclick = () => {
    const p = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    input.value = input.value ? input.value + '\n\n' + p + ' ' : p + ' ';
    input.focus(); onType();
  };
  $('#visSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    visibility = b.dataset.v;
    $('#visSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#submitBtn').textContent = visibility === 'public' ? 'Let it out' : 'Save to my journal';
  });

  $('#submitBtn').onclick = async () => {
    const text = input.value.trim();
    const nick = $('#nickInput').value.trim();
    if (text.length < 3) { toast('Write a little more first 💭', true); input.focus(); return; }
    store.set('ej_nick', nick);
    const btn = $('#submitBtn'); btn.disabled = true;
    let entry = { text, mood, at: Date.now(), shared: false, local: String(Date.now()) };

    if (visibility === 'public') {
      try {
        const r = await api('/feelings', { method: 'POST', body: { text, mood, nick } });
        entry = { ...entry, id: r.entry.id, deleteKey: r.deleteKey, shared: true, nick: r.entry.nick };
        toast('Shared. You are not alone 💛');
      } catch (err) {
        if (/Slow down|Links|Write|Pick/.test(err.message)) { toast(err.message, true); btn.disabled = false; return; }
        toast("Couldn't reach the wall – saved privately instead.", true);
      }
    } else toast('Saved to your private journal 🔒');

    mine.unshift(entry); store.set('ej_mine', mine);
    input.value = ''; onType(); burst(MOODS[mood].e);
    btn.disabled = false;
    renderJournal(); refreshStats();
    if (entry.shared) { offset = 0; loadWall(true); }
    openShare(entry);
  };

  function burst(emoji) {
    for (let i = 0; i < 14; i++) {
      const s = h('span', { class: 'float-emoji' }, emoji);
      s.style.left = 10 + Math.random() * 80 + 'vw';
      s.style.setProperty('--r', (Math.random() * 80 - 40) + 'deg');
      s.style.animationDelay = Math.random() * .5 + 's';
      document.body.append(s); setTimeout(() => s.remove(), 3000);
    }
  }

  /* ---------- community pulse ---------- */
  async function refreshStats() {
    try {
      const s = await api('/stats');
      const entries = Object.entries(s.moods).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      const bar = $('#pulseBar'); bar.replaceChildren();
      if (!entries.length) {
        $('#pulseTitle').textContent = 'The wall is quiet right now – be the first to share ✨';
        $('#pulseSub').textContent = `${s.total} feelings shared so far`;
        return;
      }
      const [top] = entries[0];
      $('#pulseTitle').textContent = `Right now the world is feeling ${MOODS[top].e} ${MOODS[top].label.toLowerCase()}`;
      entries.forEach(([k, n]) => {
        const b = h('b', { title: `${MOODS[k].label}: ${n}` });
        b.style.flex = n; b.style.background = `hsl(${MOODS[k].h} 80% 62%)`; bar.append(b);
      });
      $('#pulseSub').textContent = `${s.last24} feelings in the last 24h · ${s.support} hugs & hearts sent`;
    } catch { $('#pulseTitle').textContent = 'Offline – your journal still works 🔒'; }
  }

  /* ---------- wall ---------- */
  function entryCard(e, opts = {}) {
    const m = MOODS[e.mood] || MOODS.calm;
    const own = mine.find(x => x.id === e.id);
    const card = h('article', { class: 'entry card' + (opts.hl ? ' hl' : ''), 'data-id': e.id });
    card.style.setProperty('--eh', m.h);

    const menu = h('div', { class: 'menu' },
      h('button', { title: 'Share', onclick: () => openShare({ ...e, shared: true }) }, '📤'),
      own ? h('button', { title: 'Delete my post', onclick: () => deleteMine(own) }, '🗑')
          : h('button', { title: 'Report', onclick: () => report(e.id) }, '🚩'));

    card.append(
      h('div', { class: 'entry-head' },
        h('span', { class: 'big' }, m.e),
        h('div', {}, h('div', { class: 'who' }, e.nick || 'Anonymous', own ? h('span', { class: 'badge' }, 'you') : ''),
          h('div', { class: 'when' }, `feeling ${m.label.toLowerCase()} · ${ago(e.at)}`)),
        menu),
      h('p', { class: 'entry-text' }, e.text));

    const mineSet = new Set(myReacts[e.id] || []);
    const bar = h('div', { class: 'reacts' });
    REACTS.forEach(r => {
      const btn = h('button', { class: 'react' + (mineSet.has(r.k) ? ' on' : ''), title: r.t }, `${r.e} ${e.reactions[r.k] || 0}`);
      btn.onclick = async () => {
        const on = btn.classList.contains('on');
        try {
          const res = await api(`/feelings/${e.id}/react`, { method: 'POST', body: { key: r.k, undo: on } });
          e.reactions = res.reactions;
          const set = new Set(myReacts[e.id] || []); on ? set.delete(r.k) : set.add(r.k);
          myReacts[e.id] = [...set]; store.set('ej_reacts', myReacts);
          btn.classList.toggle('on', !on); btn.textContent = `${r.e} ${res.reactions[r.k]}`;
          if (!on) burst(r.e);
        } catch (err) { toast(err.message, true); }
      };
      bar.append(btn);
    });

    const repWrap = h('div', { class: 'replies', hidden: true });
    const toggle = h('button', { class: 'react reply-toggle' }, `💬 ${e.replies.length}`);
    const drawReplies = () => {
      repWrap.replaceChildren(...e.replies.map(r =>
        h('div', { class: 'reply' }, h('b', {}, r.nick), h('span', { class: 'when' }, ago(r.at)), h('div', {}, r.text))));
      const ri = h('input', { placeholder: 'Send a kind word…', maxlength: 240 });
      const send = async () => {
        const text = ri.value.trim(); if (!text) return;
        try {
          const r = await api(`/feelings/${e.id}/replies`, { method: 'POST', body: { text, nick: store.get('ej_nick', '') } });
          e.replies.push(r); toggle.textContent = `💬 ${e.replies.length}`; drawReplies(); repWrap.querySelector('input').focus();
        } catch (err) { toast(err.message, true); }
      };
      ri.addEventListener('keydown', ev => { if (ev.key === 'Enter') send(); });
      repWrap.append(h('div', { class: 'reply-form' }, ri, h('button', { class: 'ghost', onclick: send }, 'Send')));
    };
    toggle.onclick = () => { repWrap.hidden = !repWrap.hidden; if (!repWrap.hidden) drawReplies(); };
    bar.append(toggle);
    card.append(bar, repWrap);
    return card;
  }

  async function loadWall(reset) {
    if (reset) offset = 0;
    const list = $('#wallList');
    try {
      const q = new URLSearchParams({ sort, limit: PAGE, offset });
      if (filter) q.set('mood', filter);
      const data = await api('/feelings?' + q);
      if (reset) list.replaceChildren();
      if (reset && sort === 'new' && !filter) topId = data.items[0] ? data.items[0].id : null;
      if (reset && !data.items.length)
        list.append(h('div', { class: 'empty' }, filter ? 'Nobody has shared this mood yet. Be the first 💛' : 'No feelings yet. Start the conversation ✨'));
      data.items.forEach(e => list.append(entryCard(e)));
      offset += data.items.length;
      $('#moreBtn').hidden = offset >= data.total;
      $('#newPill').hidden = true;
    } catch {
      if (reset) list.replaceChildren(h('div', { class: 'empty' }, "Couldn't load the wall. Is the server running?"));
    }
  }
  $('#moreBtn').onclick = () => loadWall(false);
  $('#newPill').onclick = () => { loadWall(true); scrollTo({ top: $('#wallView').offsetTop - 20, behavior: 'smooth' }); };
  $('#sortSel').onchange = e => { sort = e.target.value; loadWall(true); };
  $('#filterChips').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    filter = c.dataset.m;
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
    loadWall(true);
  };

  async function poll() {
    if (document.hidden) return;
    refreshStats();
    if (sort !== 'new' || filter) return;
    try {
      const d = await api('/feelings?limit=1');
      if (d.items[0] && topId && d.items[0].id !== topId && !mine.some(m => m.id === d.items[0].id)) $('#newPill').hidden = false;
    } catch {}
  }
  setInterval(poll, 20000);

  async function report(id) {
    if (!confirm('Report this post as harmful or inappropriate?')) return;
    try { await api(`/feelings/${id}/report`, { method: 'POST' }); toast('Thanks – we will review it 🙏'); } catch (e) { toast(e.message, true); }
  }
  async function deleteMine(m) {
    if (!confirm('Delete this post?')) return;
    try {
      if (m.id) await api(`/feelings/${m.id}`, { method: 'DELETE', headers: { 'x-delete-key': m.deleteKey || '' } });
      mine = mine.filter(x => x !== m); store.set('ej_mine', mine);
      toast('Deleted'); renderJournal(); loadWall(true); refreshStats();
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- journal ---------- */
  function streak() {
    const days = new Set(mine.map(m => new Date(m.at).toDateString()));
    let n = 0, d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function renderJournal() {
    const counts = {}; mine.forEach(m => (counts[m.mood] = (counts[m.mood] || 0) + 1));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const s = streak();
    $('#journalStats').replaceChildren(
      h('div', { class: 'card stat' }, h('b', {}, String(mine.length)), h('span', {}, 'entries')),
      h('div', { class: 'card stat' }, h('b', {}, s ? `🔥 ${s}` : '0'), h('span', {}, s === 1 ? 'day streak' : 'day streak')),
      h('div', { class: 'card stat' }, h('b', {}, top ? MOODS[top[0]].e : '–'), h('span', {}, top ? `most common: ${MOODS[top[0]].label.toLowerCase()}` : 'no data yet')));
    const list = $('#journalList');
    if (!mine.length) { list.replaceChildren(h('div', { class: 'empty' }, 'Your entries will show up here – only on this device.')); return; }
    list.replaceChildren(...mine.map(m => {
      const mo = MOODS[m.mood] || MOODS.calm;
      const c = h('article', { class: 'entry card' });
      c.style.setProperty('--eh', mo.h);
      c.append(
        h('div', { class: 'entry-head' }, h('span', { class: 'big' }, mo.e),
          h('div', {}, h('div', { class: 'who' }, mo.label, h('span', { class: 'badge' }, m.shared ? '🌍 public' : '🔒 private')),
            h('div', { class: 'when' }, new Date(m.at).toLocaleString())),
          h('div', { class: 'menu' },
            h('button', { title: 'Share', onclick: () => openShare(m) }, '📤'),
            h('button', { title: 'Delete', onclick: () => deleteMine(m) }, '🗑'))),
        h('p', { class: 'entry-text' }, m.text));
      return c;
    }));
  }
  $('#exportBtn').onclick = () => {
    const txt = mine.map(m => `${new Date(m.at).toLocaleString()} – ${MOODS[m.mood]?.e || ''} ${m.mood}\n${m.text}\n`).join('\n---\n\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([txt || 'Empty journal'], { type: 'text/plain' })), download: 'my-feelings-journal.txt' });
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#clearBtn').onclick = () => {
    if (!confirm('Remove all journal entries from this device? Posts already on the wall stay there.')) return;
    mine = []; store.set('ej_mine', mine); renderJournal();
  };

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
    $('#wallView').hidden = t.dataset.tab !== 'wall';
    $('#journalView').hidden = t.dataset.tab !== 'journal';
    if (t.dataset.tab === 'journal') renderJournal();
  });

  /* ---------- share cards ---------- */
  let shareEntry = null;
  function wrapText(ctx, text, maxW) {
    const lines = [];
    text.split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
      });
      lines.push(line);
    });
    return lines;
  }
  function drawCard(entry) {
    const c = $('#shareCanvas'), ctx = c.getContext('2d'), W = c.width, H = c.height;
    const m = MOODS[entry.mood] || MOODS.calm;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${m.h} 70% 22%)`); g.addColorStop(1, `hsl(${m.h + 60} 70% 12%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    [[W * .85, H * .1, 380, .35], [W * .1, H * .95, 420, .3]].forEach(([x, y, r, a]) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `hsla(${m.h + 30} 90% 65% / ${a})`); rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    });
    ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
    ctx.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText(m.e, 90, 90);
    ctx.font = '600 44px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(`feeling ${m.label.toLowerCase()}`, 90, 250);

    let text = entry.text.length > 330 ? entry.text.slice(0, 327).trimEnd() + '…' : entry.text;
    let size = text.length > 200 ? 46 : text.length > 100 ? 56 : 68;
    ctx.fillStyle = '#fff'; ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
    let lines = wrapText(ctx, '“' + text + '”', W - 180);
    const maxLines = Math.floor((H - 520) / (size * 1.3));
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…'); }
    lines.forEach((l, i) => ctx.fillText(l, 90, 340 + i * size * 1.3));

    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(90, H - 140, W - 180, 2);
    ctx.font = '600 36px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText('💌 Feelings Wall', 90, H - 110);
    ctx.font = '30px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.textAlign = 'right'; ctx.fillText(location.host, W - 90, H - 106); ctx.textAlign = 'left';
  }
  const linkFor = e => e.id ? `${location.origin}/p/${e.id}` : location.origin;

  function openShare(entry) {
    shareEntry = entry;
    const link = linkFor(entry), m = MOODS[entry.mood] || MOODS.calm;
    $('#shareHeading').textContent = entry.shared ? 'Thank you for sharing 💛' : 'Share this feeling';
    $('#shNote').textContent = entry.id
      ? 'Share the link – friends can read it and send you support.'
      : 'This entry is private, so only the image can be shared.';
    $('#shCopy').hidden = !entry.id;
    $('#shWhats').href = 'https://wa.me/?text=' + encodeURIComponent(`${m.e} ${entry.text.slice(0, 200)}${entry.id ? '\n' + link : ''}`);
    drawCard(entry);
    $('#shareModal').hidden = false;
  }
  const closeShare = () => ($('#shareModal').hidden = true);
  $('#shareClose').onclick = closeShare;
  $('#shareModal').addEventListener('click', e => { if (e.target.id === 'shareModal') closeShare(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeShare(); });

  const cardBlob = () => new Promise(r => $('#shareCanvas').toBlob(r, 'image/png'));
  $('#shDownload').onclick = async () => {
    const a = h('a', { href: URL.createObjectURL(await cardBlob()), download: 'my-feeling.png' });
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#shCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(linkFor(shareEntry)); toast('Link copied 🔗'); }
    catch { prompt('Copy this link:', linkFor(shareEntry)); }
  };
  $('#shNative').onclick = async () => {
    const m = MOODS[shareEntry.mood] || MOODS.calm;
    const data = { title: 'Feelings Wall', text: `${m.e} Feeling ${m.label.toLowerCase()} – come say something kind.`, url: linkFor(shareEntry) };
    try {
      const file = new File([await cardBlob()], 'my-feeling.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ ...data, files: [file] }); return; }
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    $('#shCopy').hidden ? $('#shDownload').click() : $('#shCopy').click();
  };

  /* ---------- deep link (/p/:id) ---------- */
  async function showDeepLink() {
    const meta = document.querySelector('meta[name="ej-post"]');
    const id = (meta && meta.content && !meta.content.includes('<!--') ? meta.content : '') ||
      (location.pathname.match(/^\/p\/([a-f0-9]+)/) || [])[1] || new URLSearchParams(location.search).get('post');
    if (!id) return;
    try {
      const e = await api('/feelings/' + id);
      const card = entryCard(e, { hl: true });
      card.prepend(h('div', { class: 'small muted', style: 'margin-bottom:8px' }, '💌 Someone shared this with you – send them a kind word'));
      $('#wallList').before(card);
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    } catch { toast('That post is no longer available.', true); }
  }

  /* ---------- go ---------- */
  setMood(mood);
  renderJournal();
  refreshStats();
  loadWall(true).then(showDeepLink);
})();
