require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
}));

const CLIENT_ID     = process.env.NOTION_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.NOTION_OAUTH_CLIENT_SECRET;
const REDIRECT_URI  = process.env.NOTION_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const USERS_DIR     = path.join(__dirname, 'data', 'users');

if (!process.env.NETLIFY) {
  try {
    if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
  } catch (_) {}
}

// ─── 유저 데이터 ─────────────────────────────────────────────────────────────

async function getUserData(userId) {
  if (process.env.NETLIFY) {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('users');
    const raw = await store.get(userId);
    return raw ? JSON.parse(raw) : { databaseId: null, supplements: [] };
  }
  const file = path.join(USERS_DIR, `${userId}.json`);
  if (!fs.existsSync(file)) return { databaseId: null, supplements: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { databaseId: null, supplements: [] }; }
}

async function saveUserData(userId, data) {
  if (process.env.NETLIFY) {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('users');
    await store.set(userId, JSON.stringify(data));
    return;
  }
  fs.writeFileSync(path.join(USERS_DIR, `${userId}.json`), JSON.stringify(data, null, 2));
}

// ─── 미들웨어 ─────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.notionToken) return res.status(401).json({ success: false, error: 'unauthorized' });
  next();
}

function getClient(req) {
  return new Client({ auth: req.session.notionToken });
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

app.get('/auth/notion', (_req, res) => {
  const url = `https://api.notion.com/v1/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=access_denied');

  try {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error_description || 'token exchange failed');

    req.session.notionToken   = data.access_token;
    req.session.userId        = data.owner?.user?.id || data.workspace_id;
    req.session.userName      = data.owner?.user?.name || data.workspace_name;
    req.session.workspaceName = data.workspace_name;

    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/auth/status', async (req, res) => {
  if (!req.session.notionToken) return res.json({ loggedIn: false });
  const userData = await getUserData(req.session.userId);
  res.json({
    loggedIn: true,
    userName: req.session.userName,
    workspaceName: req.session.workspaceName,
    databaseId: userData.databaseId,
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// ─── 데이터베이스 ─────────────────────────────────────────────────────────────

app.get('/api/databases', requireAuth, async (req, res) => {
  try {
    const notion = getClient(req);
    const response = await notion.search({
      filter: { property: 'object', value: 'database' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    });
    const databases = response.results.map(db => ({
      id: db.id,
      title: db.title?.[0]?.plain_text || '(제목 없음)',
    }));
    res.json({ success: true, data: databases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/databases/select', requireAuth, async (req, res) => {
  const { databaseId } = req.body;
  if (!databaseId) return res.status(400).json({ success: false, error: 'databaseId required' });
  const data = await getUserData(req.session.userId);
  data.databaseId = databaseId;
  await saveUserData(req.session.userId, data);
  res.json({ success: true });
});

// ─── 영양제 설정 CRUD ─────────────────────────────────────────────────────────

app.get('/api/supplements', requireAuth, async (req, res) => {
  const data = await getUserData(req.session.userId);
  res.json({ success: true, data: data.supplements });
});

app.post('/api/supplements', requireAuth, async (req, res) => {
  const { name, qty, time, days } = req.body;
  if (!name || !Array.isArray(time) || time.length === 0 || !Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ success: false, error: '이름, 복용시간, 요일을 모두 입력해주세요' });
  }
  const data = await getUserData(req.session.userId);
  const newSupp = { id: uuidv4(), name: name.trim(), qty: parseInt(qty) || 1, time, days };
  data.supplements.push(newSupp);
  await saveUserData(req.session.userId, data);
  res.json({ success: true, data: newSupp });
});

app.put('/api/supplements/:id', requireAuth, async (req, res) => {
  const { name, qty, time, days } = req.body;
  if (!name || !Array.isArray(time) || time.length === 0 || !Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ success: false, error: '이름, 복용시간, 요일을 모두 입력해주세요' });
  }
  const data = await getUserData(req.session.userId);
  const idx = data.supplements.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '영양제를 찾을 수 없습니다' });
  data.supplements[idx] = { id: req.params.id, name: name.trim(), qty: parseInt(qty) || 1, time, days };
  await saveUserData(req.session.userId, data);
  res.json({ success: true, data: data.supplements[idx] });
});

app.delete('/api/supplements/:id', requireAuth, async (req, res) => {
  const data = await getUserData(req.session.userId);
  const filtered = data.supplements.filter(s => s.id !== req.params.id);
  if (filtered.length === data.supplements.length) {
    return res.status(404).json({ success: false, error: '영양제를 찾을 수 없습니다' });
  }
  data.supplements = filtered;
  await saveUserData(req.session.userId, data);
  res.json({ success: true });
});

// ─── 노션 일정 추가 ──────────────────────────────────────────────────────────

app.post('/api/schedule/week', requireAuth, async (req, res) => {
  const userData = await getUserData(req.session.userId);
  if (!userData.databaseId) return res.status(400).json({ success: false, error: '데이터베이스를 먼저 선택해주세요' });
  if (userData.supplements.length === 0) return res.status(400).json({ success: false, error: '등록된 영양제가 없습니다' });

  const notion    = getClient(req);
  const startDate = req.body.startDate ? new Date(req.body.startDate + 'T00:00:00') : new Date();
  startDate.setHours(0, 0, 0, 0);

  const toLocalDateStr = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const created = [];
  const errors  = [];

  for (let offset = 0; offset < 7; offset++) {
    const date      = new Date(startDate);
    date.setDate(startDate.getDate() + offset);
    const dayOfWeek = date.getDay();
    const dateStr   = toLocalDateStr(date);

    for (const supp of userData.supplements) {
      if (!supp.days.includes(dayOfWeek)) continue;
      const times = Array.isArray(supp.time) ? supp.time : [supp.time];

      for (const t of times) {
        try {
          const page = await notion.pages.create({
            parent: { type: 'database_id', database_id: userData.databaseId },
            properties: {
              '종류': { title: [{ text: { content: supp.name } }] },
              '날짜': { date: { start: dateStr } },
              '시점': { multi_select: [{ name: t }] },
              '개수': { number: supp.qty ?? 1 },
              '상태': { checkbox: false },
            },
          });
          created.push({ name: supp.name, date: dateStr, time: t, pageId: page.id });
        } catch (err) {
          errors.push({ name: supp.name, date: dateStr, time: t, error: err.message });
        }
      }
    }
  }

  res.json({
    success: true,
    created: created.length,
    errors: errors.length,
    startDate: toLocalDateStr(startDate),
    pageIds: created.map(c => c.pageId),
    details: { created, errors },
  });
});

// ─── 일정 취소 (추가한 페이지 일괄 아카이브) ─────────────────────────────────

app.delete('/api/schedule/undo', requireAuth, async (req, res) => {
  const { pageIds } = req.body;
  if (!Array.isArray(pageIds) || pageIds.length === 0)
    return res.status(400).json({ success: false, error: 'pageIds required' });

  const notion = getClient(req);
  const errors = [];
  for (const pageId of pageIds) {
    try {
      await notion.pages.update({ page_id: pageId, archived: true });
    } catch (err) {
      errors.push({ pageId, error: err.message });
    }
  }
  res.json({ success: true, deleted: pageIds.length - errors.length, errors: errors.length });
});

// ─── DB 속성 확인 ─────────────────────────────────────────────────────────────

app.get('/api/db-info', requireAuth, async (req, res) => {
  const userData = await getUserData(req.session.userId);
  if (!userData.databaseId) return res.status(400).json({ success: false, error: '데이터베이스를 먼저 선택해주세요' });
  try {
    const notion = getClient(req);
    const db     = await notion.databases.retrieve({ database_id: userData.databaseId });
    const props  = Object.entries(db.properties).map(([key, val]) => ({ name: key, type: val.type }));
    res.json({ success: true, title: db.title[0]?.plain_text, properties: props });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 서버 시작 / 모듈 export ──────────────────────────────────────────────────

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;
