// Feelings Wall - backend
// Run: npm install && npm start   ->  http://localhost:5000
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
try { require('dotenv').config(); } catch (_) { }

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '20kb' }));

/* ---------- storage (JSON file, atomic writes) ---------- */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'feelings.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = [];
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { db = []; }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), err => {
      if (!err) fs.rename(tmp, DATA_FILE, () => { });
    });
  }, 200);
}
process.on('SIGINT', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (_) { } process.exit(0); });

/* ---------- helpers ---------- */
const MOODS = ['happy', 'grateful', 'excited', 'calm', 'tired', 'confused', 'anxious', 'sad', 'lonely', 'angry'];
const REACTS = ['heart', 'hug', 'strong', 'same'];
const HIDE_AFTER_REPORTS = 3;
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ly|me|xyz)\b)/i;

const clean = (s, max) =>
  String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const uid = () => crypto.randomBytes(5).toString('hex');

const publicEntry = e => ({
  id: e.id, text: e.text, mood: e.mood, nick: e.nick, at: e.at,
  reactions: e.reactions,
  replies: e.replies.map(r => ({ id: r.id, text: r.text, nick: r.nick, at: r.at }))
});
const visible = () => db.filter(e => e.reports.length < HIDE_AFTER_REPORTS);

// tiny in-memory rate limiter
const hits = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + req.ip, now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Slow down a little - try again in a moment.' });
    arr.push(now); hits.set(key, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

/* ---------- optional WhatsApp ping (only if Twilio env vars are set) ---------- */
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try { twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); }
  catch (e) { console.warn('Twilio not available:', e.message); }
}
function notify(entry) {
  if (!twilioClient || !process.env.WHATSAPP_FROM || !process.env.WHATSAPP_TO) return;
  twilioClient.messages.create({
    from: process.env.WHATSAPP_FROM,
    to: `whatsapp:${process.env.WHATSAPP_TO.replace(/^whatsapp:/, '')}`,
    body: `💌 New feeling (${entry.mood}):\n${entry.text.slice(0, 300)}`
  }).catch(err => console.error('WhatsApp error:', err.message));
}

/* ---------- API ---------- */
app.get('/api/health', (_req, res) => res.json({ ok: true, entries: db.length }));

app.get('/api/feelings', (req, res) => {
  const mood = MOODS.includes(req.query.mood) ? req.query.mood : null;
  const sort = req.query.sort === 'top' ? 'top' : 'new';
  const limitN = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let list = visible();
  if (mood) list = list.filter(e => e.mood === mood);
  const score = e => Object.values(e.reactions).reduce((a, b) => a + b, 0) * 2 + e.replies.length;
  list = sort === 'top'
    ? list.slice().sort((a, b) => score(b) - score(a) || b.at - a.at)
    : list.slice().sort((a, b) => b.at - a.at);

  res.json({ total: list.length, items: list.slice(offset, offset + limitN).map(publicEntry) });
});

app.get('/api/feelings/:id', (req, res) => {
  const e = visible().find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json(publicEntry(e));
});

app.get('/api/stats', (_req, res) => {
  const list = visible(), since = Date.now() - 24 * 3600e3;
  const moods = {}; MOODS.forEach(m => (moods[m] = 0));
  let last24 = 0, hugs = 0;
  list.forEach(e => {
    if (e.at >= since) { moods[e.mood]++; last24++; }
    hugs += Object.values(e.reactions).reduce((a, b) => a + b, 0);
  });
  res.json({ total: list.length, last24, moods, support: hugs });
});

app.post('/api/feelings', limit('post', 6, 10 * 60e3), (req, res) => {
  const text = clean(req.body.text, 1000);
  const mood = MOODS.includes(req.body.mood) ? req.body.mood : null;
  const nick = clean(req.body.nick, 24);
  if (text.length < 3) return res.status(400).json({ error: 'Write a little more.' });
  if (!mood) return res.status(400).json({ error: 'Pick a mood.' });
  if (URL_RE.test(text) || URL_RE.test(nick)) return res.status(400).json({ error: "Links aren't allowed here - this is a space for feelings." });

  const entry = {
    id: uid(), text, mood, nick: nick || 'Anonymous', at: Date.now(),
    reactions: { heart: 0, hug: 0, strong: 0, same: 0 },
    replies: [], reports: [], deleteKey: crypto.randomBytes(12).toString('hex')
  };
  db.push(entry); save(); notify(entry);
  res.status(201).json({ entry: publicEntry(entry), deleteKey: entry.deleteKey });
});

app.post('/api/feelings/:id/react', limit('react', 60, 60e3), (req, res) => {
  const e = db.find(x => x.id === req.params.id);
  const key = req.body.key;
  if (!e || !REACTS.includes(key)) return res.status(404).json({ error: 'Not found' });
  e.reactions[key] = Math.max(0, e.reactions[key] + (req.body.undo ? -1 : 1));
  save(); res.json({ reactions: e.reactions });
});

app.post('/api/feelings/:id/replies', limit('reply', 10, 10 * 60e3), (req, res) => {
  const e = db.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const text = clean(req.body.text, 240), nick = clean(req.body.nick, 24);
  if (text.length < 2) return res.status(400).json({ error: 'Write a kind word.' });
  if (URL_RE.test(text)) return res.status(400).json({ error: "Links aren't allowed here." });
  if (e.replies.length >= 50) return res.status(400).json({ error: 'This thread is full.' });
  const reply = { id: uid(), text, nick: nick || 'A kind stranger', at: Date.now() };
  e.replies.push(reply); save(); res.status(201).json(reply);
});

app.post('/api/feelings/:id/report', limit('report', 10, 10 * 60e3), (req, res) => {
  const e = db.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  if (!e.reports.includes(req.ip)) e.reports.push(req.ip);
  save(); res.json({ ok: true });
});

app.delete('/api/feelings/:id', (req, res) => {
  const i = db.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  const key = req.get('x-delete-key') || '';
  const ok = key.length === db[i].deleteKey.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(db[i].deleteKey));
  if (!ok) return res.status(403).json({ error: 'Not yours to delete.' });
  db.splice(i, 1); save(); res.json({ ok: true });
});

/* ---------- shareable post pages with rich link previews ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMOJI = { happy: '😊', grateful: '🙏', excited: '🤩', calm: '😌', tired: '😴', confused: '😕', anxious: '😰', sad: '😢', lonely: '🥀', angry: '😠' };

app.get('/p/:id', (req, res, next) => {
  const e = visible().find(x => x.id === req.params.id);
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    let og = '';
    if (e) {
      const url = `${req.protocol}://${req.get('host')}/p/${e.id}`;
      const title = `${EMOJI[e.mood]} Someone is feeling ${e.mood}`;
      const desc = e.text.length > 160 ? e.text.slice(0, 157) + '...' : e.text;
      og = `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">` +
        `<meta property="og:url" content="${esc(url)}"><meta property="og:type" content="article">` +
        `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}">` +
        `<meta name="twitter:description" content="${esc(desc)}">`;
    }
    res.type('html').send(html.replace('<!--OG-->', og).replace('<!--POST-->', e ? esc(e.id) : ''));
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`💌 Feelings Wall running on https://shareur-filing-io.onrender.com`));
