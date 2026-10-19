/* ============================================================
   QBTI 家长端后端服务器（完全独立版 + 防刷限流版）
   ============================================================ */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(__dirname));

/* ---------- 配置 ---------- */
const DATABASE_URL = process.env.DATABASE_URL;
const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const AGENTMAIL_BASE = 'https://api.agentmail.to/v0';

if (!DATABASE_URL) console.log('❌ 未配置 DATABASE_URL！');
if (!AGENTMAIL_API_KEY) console.log('⚠️ 未配置 AGENTMAIL_API_KEY');
if (!DEEPSEEK_API_KEY) console.log('⚠️ 未配置 DEEPSEEK_API_KEY');

/* ---------- 数据库连接池 ---------- */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('PostgreSQL 连接池异常:', err.message);
});

/* ---------- 工具函数 ---------- */
function hashPassword(pw, salt) {
  return crypto.createHash('sha256').update(pw + ':' + salt).digest('hex');
}
function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/* ============================================================
   AgentMail 发信逻辑
   ============================================================ */
let inboxId = null;

async function ensureInbox() {
  if (!AGENTMAIL_API_KEY) return null;
  if (inboxId) return inboxId;
  try {
    const listRes = await fetch(AGENTMAIL_BASE + '/inboxes', {
      headers: { 'Authorization': 'Bearer ' + AGENTMAIL_API_KEY }
    });
    let inboxes = [];
    try {
      const listData = await listRes.json();
      inboxes = listData.inboxes || listData.data || (Array.isArray(listData) ? listData : []);
    } catch (e) {}
    if (inboxes.length > 0) {
      inboxId = inboxes[0].inboxId || inboxes[0].id || inboxes[0].inbox_id;
      return inboxId;
    }
    const createRes = await fetch(AGENTMAIL_BASE + '/inboxes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + AGENTMAIL_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    inboxId = created.inboxId || created.id || created.inbox_id;
    return inboxId;
  } catch (err) {
    return null;
  }
}

async function sendCodeEmail(to, code) {
  if (!AGENTMAIL_API_KEY) return { ok: false };
  const inbox = await ensureInbox();
  if (!inbox) return { ok: false };
  try {
    const sendRes = await fetch(
      AGENTMAIL_BASE + '/inboxes/' + inbox + '/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + AGENTMAIL_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to,
          subject: '【QBTI 家长端】你的验证码',
          html: '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0B0D1C;color:#E9EBFF;border-radius:16px;"><h2 style="color:#fff;">家长端验证</h2><div style="font-size:36px;font-weight:800;color:#FF8A48;text-align:center;">' + code + '</div></div>'
        })
      }
    );
    return { ok: sendRes.ok };
  } catch (err) {
    return { ok: false };
  }
}

/* ---------- 验证码内存存储 ---------- */
const codeStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of codeStore) {
    if (val.expiresAt < now && (now - val.lastSentAt) > 10 * 60 * 1000) codeStore.delete(key);
  }
}, 60 * 1000);

// ============================================================
// 🚨 新增：AI 接口防刷限流（记录每个学生的最后请求时间）
// ============================================================
const aiCooldown = new Map(); 

/* ============================================================
   API: 发送验证码
   ============================================================ */
app.post('/api/send-code', async (req, res) => {
  const { email, phone } = req.body || {};
  const target = email ? 'email:' + email.toLowerCase().trim() : phone ? 'phone:' + phone.trim() : null;
  if (!target) return res.status(400).json({ error: '缺少邮箱或手机号' });

  const now = Date.now();
  const existing = codeStore.get(target);
  if (existing && (now - existing.lastSentAt) < 60 * 1000) {
    return res.status(429).json({ error: '请 ' + Math.ceil((60 * 1000 - (now - existing.lastSentAt)) / 1000) + ' 秒后再试' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  codeStore.set(target, { code, expiresAt: now + 5 * 60 * 1000, attempts: 0, lastSentAt: now });

  if (email && AGENTMAIL_API_KEY) {
    const r = await sendCodeEmail(email, code);
    if (!r.ok) return res.status(500).json({ error: '邮件发送失败' });
  }

  res.json({ success: true, message: '验证码已发送', devCode: !AGENTMAIL_API_KEY ? code : undefined });
});

/* ============================================================
   API: 邮箱角色排他检查
   ============================================================ */
app.get('/api/check-email', async (req, res) => {
  const { email, role } = req.query;
  if(!email || !role) return res.status(400).json({ error: '参数不完整' });
  try {
    if (role === 'parent') {
      const r = await pool.query('SELECT email FROM student_emails WHERE email = $1', [email.toLowerCase().trim()]);
      if (r.rows.length > 0) return res.json({ available: false, msg: '该邮箱已注册为学生账号' });
    }
    res.json({ available: true });
  } catch(err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

/* ============================================================
   API: 家长注册 / 登录
   ============================================================ */
app.post('/api/parent/register', async (req, res) => {
  const { email, phone, code, username, password } = req.body || {};
  if (!email || !phone || !code || !username || !password) return res.status(400).json({ error: '参数不完整' });
  
  const emailLower = email.toLowerCase().trim();
  const entry = codeStore.get('email:' + emailLower);
  
  if (!entry || entry.code !== String(code)) return res.status(400).json({ error: '验证码不正确或已过期' });
  codeStore.delete('email:' + emailLower);

  try {
    const checkP = await pool.query('SELECT email FROM parents WHERE email = $1', [emailLower]);
    if (checkP.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为家长' });
    const checkS = await pool.query('SELECT email FROM student_emails WHERE email = $1', [emailLower]);
    if (checkS.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为学生，不能作为家长' });

    const salt = genSalt();
    const passwordHash = hashPassword(password, salt);
    const createdAt = Date.now();

    await pool.query(
      `INSERT INTO parents (email, phone, username, salt, "passwordHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [emailLower, phone, username, salt, passwordHash, createdAt]
    );
    res.json({ success: true, user: { email: emailLower, phone, username, createdAt } });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

app.post('/api/parent/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: '参数不完整' });
  const id = String(identifier).trim().toLowerCase();

  try {
    const result = await pool.query('SELECT * FROM parents WHERE email = $1', [id]);
    const parent = result.rows[0];
    if (!parent) return res.status(404).json({ error: '账号不存在' });
    if (hashPassword(password, parent.salt) !== parent.passwordHash) return res.status(401).json({ error: '密码不正确' });
    
    res.json({ success: true, user: { email: parent.email, phone: parent.phone, username: parent.username, createdAt: Number(parent.createdAt) } });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

/* ============================================================
   API: 绑定与查看报告
   ============================================================ */
app.post('/api/bind/accept', async (req, res) => {
  const { parentEmail, code } = req.body || {};
  if (!parentEmail || !code) return res.status(400).json({ error: '参数不完整' });
  const pe = String(parentEmail).trim().toLowerCase();
  const c = String(code).trim().toUpperCase();

  try {
    const invRes = await pool.query('SELECT * FROM invites WHERE code = $1', [c]);
    const inv = invRes.rows[0];
    if (!inv || inv.used || Number(inv.expiresAt) < Date.now()) return res.status(400).json({ error: '邀请码无效或已过期' });

    const se = inv.studentEmail;
    const bindCheck = await pool.query('SELECT id FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [se, pe]);
    if (bindCheck.rows.length > 0) return res.status(409).json({ error: '您已绑定该学生' });

    await pool.query(
      `INSERT INTO bindings ("studentEmail", "studentUsername", "parentEmail", "boundAt") VALUES ($1, $2, $3, $4)`,
      [se, inv.studentUsername || '', pe, Date.now()]
    );
    await pool.query('UPDATE invites SET used = true WHERE code = $1', [c]);

    res.json({ success: true, studentEmail: se, studentUsername: inv.studentUsername || '' });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

app.get('/api/parent/students', async (req, res) => {
  const pe = String(req.query.email || '').trim().toLowerCase();
  if (!pe) return res.status(400).json({ error: '缺少邮箱' });

  try {
    const result = await pool.query(`
      SELECT b."studentEmail", b."studentUsername", b."boundAt", r."updatedAt" AS "reportUpdatedAt"
      FROM bindings b LEFT JOIN reports r ON b."studentEmail" = r."studentEmail"
      WHERE b."parentEmail" = $1 ORDER BY b."boundAt" DESC
    `, [pe]);

    const list = result.rows.map(row => ({
      studentEmail: row.studentEmail,
      studentUsername: row.studentUsername,
      boundAt: Number(row.boundAt),
      hasReport: !!row.reportUpdatedAt,
      reportUpdatedAt: row.reportUpdatedAt ? Number(row.reportUpdatedAt) : null
    }));
    res.json({ success: true, list });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

app.post('/api/bind/remove', async (req, res) => {
  const { studentEmail, parentEmail } = req.body || {};
  if (!studentEmail || !parentEmail) return res.status(400).json({ error: '参数不完整' });
  try {
    await pool.query('DELETE FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [studentEmail.toLowerCase().trim(), parentEmail.toLowerCase().trim()]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

app.get('/api/parent/report/:studentEmail', async (req, res) => {
  const se = String(req.params.studentEmail || '').trim().toLowerCase();
  const pe = String(req.query.parentEmail || '').trim().toLowerCase();
  if (!se || !pe) return res.status(400).json({ error: '参数不完整' });

  try {
    const bindCheck = await pool.query('SELECT id FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [se, pe]);
    if (bindCheck.rows.length === 0) return res.status(403).json({ error: '未绑定该学生' });

    const repRes = await pool.query('SELECT * FROM reports WHERE "studentEmail" = $1', [se]);
    const r = repRes.rows[0];
    if (!r) return res.status(404).json({ error: '该学生尚未提交报告' });

    res.json({ success: true, report: { studentEmail: r.studentEmail, studentUsername: r.studentUsername, payload: r.payload, updatedAt: Number(r.updatedAt) } });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

/* ============================================================
   API: AI 代理生成（严格 60 秒冷却限制）
   ============================================================ */
app.post('/api/generate-ai-report', async (req, res) => {
  const { prompt, studentEmail } = req.body || {};
  if (!prompt || !studentEmail) return res.status(400).json({ error: '参数不完整' });
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY 环境变量' });

  // 🚨 核心防御：拦截同一学生 60 秒内的重复请求
  const se = String(studentEmail).toLowerCase().trim();
  const lastTime = aiCooldown.get(se) || 0;
  const now = Date.now();
  if (now - lastTime < 60 * 1000) {
    const wait = Math.ceil((60 * 1000 - (now - lastTime)) / 1000);
    return res.status(429).json({ error: `请求过于频繁，请 ${wait} 秒后再试（防止重复扣费）` });
  }
  // 记录本次请求时间
  aiCooldown.set(se, now);

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一位擅长用隐喻理解青少年学习状态的教育引导顾问，语气温暖、具体、不评判。你的报告面向家长，帮助家长理解孩子，而不是评判孩子。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.85,
        max_tokens: 2400,
        stream: false
      })
    });

    if (!response.ok) throw new Error(`DeepSeek API 返回错误`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('API 返回内容为空');
    
    res.json({ success: true, text: content });
  } catch (err) {
    console.error('[DeepSeek] 代理请求失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parent/report/update-ai', async (req, res) => {
  const { studentEmail, aiReport } = req.body || {};
  if (!studentEmail || !aiReport) return res.status(400).json({ error: '参数不完整' });
  const se = String(studentEmail).trim().toLowerCase();

  try {
    const repRes = await pool.query('SELECT payload FROM reports WHERE "studentEmail" = $1', [se]);
    if (repRes.rows.length === 0) return res.status(404).json({ error: '报告不存在' });
    const payload = repRes.rows[0].payload;
    payload.aiReport = aiReport;
    await pool.query(`UPDATE reports SET payload = $1, "updatedAt" = $2 WHERE "studentEmail" = $3`, [JSON.stringify(payload), Date.now(), se]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

app.listen(PORT, () => {
  console.log('===========================================');
  console.log('  QBTI 家长端已启动，端口: ' + PORT);
  console.log('===========================================');
});