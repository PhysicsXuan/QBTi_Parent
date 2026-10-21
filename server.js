/* ============================================================
   QBTI 家长端后端服务器（完全独立版 + 跨域 + 真实发信 + AI代理 + 限流 + 重置密码）
   ============================================================ */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));

// 跨域配置
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 托管静态页面
app.use(express.static(__dirname));

/* ---------- 环境变量配置 ---------- */
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

/* ---------- 加载 QBTI 纯逻辑（服务端构建提示词，客户端不能自定义 prompt） ---------- */
let QBTI = null;
try {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'qbti-core.js'), 'utf8'), sandbox);
  QBTI = sandbox.window.QBTI;
  console.log('✅ qbti-core 已加载（服务端提示词）');
} catch (err) {
  console.error('❌ qbti-core 加载失败:', err.message);
}

/* ---------- AI 防刷参数 ---------- */
const AI_COOLDOWN_MS = 60 * 1000;
const AI_HARD_MAX_TOKENS = 2600;
const AI_MAX_PROMPT_CHARS = 9000;
const AI_MAX_TOTAL_TOKENS = 9000;
const AI_LOCK_MS = 15 * 60 * 1000;
const AI_BURST_WINDOW_MS = 10 * 1000;
const AI_BURST_TOKEN_LIMIT = 20000;
const AI_BURST_LOCK_MS = 10 * 60 * 1000;
const AI_LANGS = ['zh-CN', 'zh-TW', 'en', 'es', 'pt', 'ko', 'ja', 'fr'];
const aiInFlight = new Set();
const aiCooldown = new Map();
const aiBurst = new Map();
const feedbackCooldowns = new Map();

/* ---------- 管理员账户（家长端最高权限） ---------- */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const ADMIN_TOKEN_TTL = 2 * 60 * 60 * 1000;
const adminTokens = new Map();

function safeEqual(a, b){
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function adminTokenFromReq(req){
  const h = String(req.headers.authorization || '');
  if(h.indexOf('Bearer ') === 0) return h.slice(7).trim();
  return String(req.headers['x-admin-token'] || '');
}
function isAdminToken(token){
  const exp = adminTokens.get(token);
  if(!exp) return false;
  if(exp < Date.now()){ adminTokens.delete(token); return false; }
  return true;
}
function requireAdmin(req, res, next){
  if(!isAdminToken(adminTokenFromReq(req))){
    return res.status(401).json({ error: '管理员登录已过期，请重新登录', code: 'ADMIN_AUTH' });
  }
  next();
}

/* 报告输出语言：由服务端强制覆盖，客户端只传语言代码 */
const AI_LANG_META = {
  'zh-TW': { name: '繁體中文', instr: '請使用繁體中文撰寫整份報告，不要使用簡體中文。' },
  en: { name: 'English', instr: 'Write the entire report in English, about 800-1000 words. Do not write in Chinese.', headings: ['1. Authenticity Score', '2. Your Child’s Quantum Portrait', '3. Your Child’s Energy Barriers', '4. Quantum Tunneling Paths', '5. A Note to Parents'] },
  es: { name: 'Español', instr: 'Escribe todo el informe en español, unas 800-1000 palabras. No escribas en chino.', headings: ['1. Puntuación de autenticidad', '2. Retrato cuántico de tu hijo/a', '3. Barreras de energía', '4. Rutas de efecto túnel cuántico', '5. Una nota para las familias'] },
  pt: { name: 'Português', instr: 'Escreva todo o relatório em português, com cerca de 800-1000 palavras. Não escreva em chinês.', headings: ['1. Pontuação de autenticidade', '2. Retrato quântico do seu filho', '3. Barreiras de energia', '4. Caminhos de tunelamento quântico', '5. Uma nota aos pais'] },
  ko: { name: '한국어', instr: '전체 보고서를 한국어로 800-1000자 정도로 작성하세요. 중국어로 쓰지 마세요.', headings: ['1. 진정성 점수', '2. 자녀의 양자 초상', '3. 자녀의 에너지 장벽', '4. 양자 터널링 경로', '5. 부모에게 드리는 말'] },
  ja: { name: '日本語', instr: 'レポート全体を日本語で800〜1000字程度に書いてください。中国語では書かないでください。', headings: ['1. 回答の信頼度', '2. 子どもの量子ポートレート', '3. 子どものエネルギーバリア', '4. 量子トンネル経路', '5. 保護者の方へ'] },
  fr: { name: 'Français', instr: 'Rédigez tout le rapport en français, environ 800 à 1000 mots. N’écrivez pas en chinois.', headings: ['1. Score d’authenticité', '2. Portrait quantique de votre enfant', '3. Barrières d’énergie', '4. Chemins d’effet tunnel quantique', '5. Un mot aux parents'] }
};

function addLanguageInstruction(prompt, lang) {
  if (!AI_LANGS.includes(lang) || lang === 'zh-CN') return prompt;
  if (lang === 'zh-TW') return prompt + '\n\n【輸出語言】\n' + AI_LANG_META['zh-TW'].instr;
  const m = AI_LANG_META[lang];
  if (!m) return prompt;
  return prompt
    + '\n\n【OUTPUT LANGUAGE — THIS OVERRIDES THE CHINESE INSTRUCTIONS ABOVE】\n'
    + m.instr + '\n'
    + 'Use exactly these five section headings:\n'
    + m.headings.join('\n') + '\n'
    + 'Translate every part of the report, including headings, advice, and the closing note, into ' + m.name + '. Do not output Chinese.';
}

function localDay() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function getAIUsage(parentEmail, day) {
  const r = await pool.query(
    'SELECT count, tokens, "lockedUntil" FROM ai_usage WHERE "parentEmail" = $1 AND day = $2',
    [parentEmail, day]
  );
  if (!r.rows[0]) return { count: 0, tokens: 0, lockedUntil: 0 };
  return {
    count: Number(r.rows[0].count) || 0,
    tokens: Number(r.rows[0].tokens) || 0,
    lockedUntil: Number(r.rows[0].lockedUntil) || 0
  };
}

async function incAIUsage(parentEmail, day) {
  await pool.query(
    `INSERT INTO ai_usage ("parentEmail", day, count) VALUES ($1, $2, 1)
     ON CONFLICT ("parentEmail", day) DO UPDATE SET count = ai_usage.count + 1`,
    [parentEmail, day]
  );
}

async function addAITokens(parentEmail, day, tokens) {
  const n = Math.max(0, Number(tokens) || 0);
  if (n <= 0) return 0;
  const r = await pool.query(
    `INSERT INTO ai_usage ("parentEmail", day, count, tokens) VALUES ($1, $2, 0, $3)
     ON CONFLICT ("parentEmail", day) DO UPDATE SET tokens = ai_usage.tokens + EXCLUDED.tokens
     RETURNING tokens`,
    [parentEmail, day, n]
  );
  return Number(r.rows[0] && r.rows[0].tokens) || 0;
}

function burstStatus(email){
  const now = Date.now();
  const entry = aiBurst.get(email) || { events: [], lockedUntil: 0 };
  entry.events = (entry.events || []).filter(e => e && e.ts > now - AI_BURST_WINDOW_MS);
  const tokens = entry.events.reduce((sum, e) => sum + (Number(e.tokens) || 0), 0);
  const locked = entry.lockedUntil > now || tokens >= AI_BURST_TOKEN_LIMIT;
  return { locked, tokens, count: entry.events.length, lockedUntil: entry.lockedUntil || 0 };
}

function recordAIBurst(email, tokens){
  const now = Date.now();
  const entry = aiBurst.get(email) || { events: [], lockedUntil: 0 };
  entry.events = (entry.events || []).filter(e => e && e.ts > now - AI_BURST_WINDOW_MS);
  const n = Math.max(0, Number(tokens) || 0);
  if(n <= 0) return burstStatus(email);
  entry.events.push({ ts: now, tokens: n });
  entry.events = entry.events.slice(-30);
  const total = entry.events.reduce((sum, e) => sum + (Number(e.tokens) || 0), 0);
  if(total >= AI_BURST_TOKEN_LIMIT){
    entry.lockedUntil = now + AI_BURST_LOCK_MS;
  }
  aiBurst.set(email, entry);
  return burstStatus(email);
}

async function lockAIUsage(parentEmail, day, ms) {
  const until = Date.now() + (ms || AI_LOCK_MS);
  await pool.query(
    `INSERT INTO ai_usage ("parentEmail", day, count, tokens, "lockedUntil")
     VALUES ($1, $2, 0, 0, $3)
     ON CONFLICT ("parentEmail", day) DO UPDATE
     SET "lockedUntil" = GREATEST(ai_usage."lockedUntil", $3)`,
    [parentEmail, day, until]
  );
  return until;
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 2);
}

function checkTokenAnomaly(usage, prompt, content) {
  const u = usage || {};
  const promptTokens = Number(u.prompt_tokens) || estimateTokens(prompt);
  const completionTokens = Number(u.completion_tokens) || estimateTokens(content);
  const total = Number(u.total_tokens) || (promptTokens + completionTokens);
  return {
    promptTokens,
    completionTokens,
    total,
    anomaly: total > AI_MAX_TOTAL_TOKENS ||
             promptTokens > AI_MAX_PROMPT_CHARS ||
             completionTokens > AI_HARD_MAX_TOKENS ||
             String(prompt || '').length > AI_MAX_PROMPT_CHARS
  };
}

/* 用数据库里的报告数据在服务端构建提示词；客户端不再传 prompt */
function buildServerPrompt(payload, lang) {
  if (!QBTI || !payload) return null;
  const p = payload;
  const res = p.fullResult || {
    letters: p.baseCode ? String(p.baseCode).split('') : [],
    suffix: { letter: p.suffixLetter || 'E', name: p.suffixName || '' },
    dimGroupRatio: p.dimGroupRatio || {},
    dimLeadInfo: p.dimLeadInfo || {},
    suffixRatio: p.suffixRatio || {},
    suffixGap: p.suffixGap || 0,
    dominanceScore: {}
  };
  try {
    return addLanguageInstruction(QBTI.buildPrompt(res, p.validity || null), lang);
  } catch (err) {
    console.error('[AI] 构建提示词失败:', err.message);
    return null;
  }
}

/* ---------- ai_usage 表（每次生成计数，重启不丢） ---------- */
async function initDB() {
  if (!DATABASE_URL) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage (
      "parentEmail" VARCHAR(255) NOT NULL,
      day VARCHAR(10) NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      tokens BIGINT NOT NULL DEFAULT 0,
      "lockedUntil" BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY ("parentEmail", day)
    );`);
    await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS tokens BIGINT NOT NULL DEFAULT 0;`);
    await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS "lockedUntil" BIGINT NOT NULL DEFAULT 0;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(255),
      role VARCHAR(20),
      type VARCHAR(20),
      content TEXT NOT NULL,
      "userEmail" VARCHAR(255),
      page VARCHAR(50),
      app VARCHAR(20) NOT NULL DEFAULT 'student',
      ip VARCHAR(64),
      "userAgent" TEXT,
      referer TEXT,
      reply TEXT,
      "replySubject" VARCHAR(255),
      "replyAt" BIGINT,
      "replyBy" VARCHAR(255),
      "replyTo" VARCHAR(255),
      "createdAt" BIGINT NOT NULL
    );`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS app VARCHAR(20) NOT NULL DEFAULT 'student';`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ip VARCHAR(64);`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS "userAgent" TEXT;`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS referer TEXT;`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS reply TEXT;`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS "replySubject" VARCHAR(255);`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS "replyAt" BIGINT;`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS "replyBy" VARCHAR(255);`);
    await pool.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS "replyTo" VARCHAR(255);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback ("createdAt" DESC);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_policy (
      id VARCHAR(32) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      salt VARCHAR(255) NOT NULL,
      "passwordHash" VARCHAR(255) NOT NULL,
      "updatedAt" BIGINT NOT NULL,
      "updatedBy" VARCHAR(255)
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_quiz_records (
      id SERIAL PRIMARY KEY,
      "studentEmail" VARCHAR(255) NOT NULL,
      "quizTs" BIGINT NOT NULL,
      payload JSONB,
      "createdAt" BIGINT NOT NULL,
      UNIQUE("studentEmail", "quizTs")
    );`);
    const salt = genSalt();
    await pool.query(
      `INSERT INTO admin_policy (id, enabled, salt, "passwordHash", "updatedAt", "updatedBy")
       VALUES ('student_admin', TRUE, $1, $2, $3, 'system')
       ON CONFLICT (id) DO NOTHING`,
      [salt, hashAdminPolicyPassword('admin123456', salt), Date.now()]
    );
    console.log('✅ ai_usage / admin_policy 表检查完成');
  } catch (err) {
    console.error('❌ 数据库表初始化失败:', err.message);
  }
}

/* ---------- 工具函数 ---------- */
function hashPassword(pw, salt) {
  return crypto.createHash('sha256').update(pw + ':' + salt).digest('hex');
}
function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function hashAdminPolicyPassword(pw, salt) {
  return 'scrypt$' + crypto.scryptSync(String(pw), String(salt), 64).toString('hex');
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
          html: [
            '<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0B0D1C;color:#E9EBFF;border-radius:16px;">',
            '  <h2 style="color:#fff;margin-bottom:16px;">家长端邮箱验证</h2>',
            '  <p style="color:#8B90B8;line-height:1.6;">你的 QBTI 家长端验证码：</p>',
            '  <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#FF8A48;margin:24px 0;text-align:center;">' + code + '</div>',
            '  <p style="color:#8B90B8;font-size:13px;">5 分钟内有效，请勿泄露。</p>',
            '</div>'
          ].join('\n')
        })
      }
    );
    return { ok: sendRes.ok };
  } catch (err) {
    return { ok: false };
  }
}

function escapeEmailHtml(text){
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendFeedbackReplyEmail(to, subject, body, feedback) {
  if (!AGENTMAIL_API_KEY) return { ok: false, error: '未配置邮件服务' };
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: '收件邮箱无效' };
  const inbox = await ensureInbox();
  if (!inbox) return { ok: false, error: '邮件服务不可用' };
  const safeBody = escapeEmailHtml(body).replace(/\n/g, '<br>');
  const safeOriginal = escapeEmailHtml(String(feedback.content || '').slice(0, 600)).replace(/\n/g, '<br>');
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
          subject: '【QBTI 家长端】' + (subject || '关于你的反馈回复'),
          html: [
            '<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px;background:#0B0D1C;color:#E9EBFF;border-radius:16px;">',
            '  <h2 style="color:#fff;margin-bottom:16px;">QBTI 反馈回复</h2>',
            '  <p style="color:#8B90B8;line-height:1.7;">你好，感谢你的反馈。以下是管理员给你的回复：</p>',
            '  <div style="margin:20px 0;padding:16px;border-radius:12px;background:rgba(124,92,255,.12);color:#E9EBFF;line-height:1.8;">' + safeBody + '</div>',
            '  <p style="color:#8B90B8;font-size:12px;margin-top:24px;">你提交的原始反馈：</p>',
            '  <div style="padding:12px;border-left:3px solid #5A8CF5;color:#A8AEDA;font-size:13px;line-height:1.7;">' + safeOriginal + '</div>',
            '  <p style="color:#8B90B8;font-size:12px;margin-top:24px;">如需继续沟通，请联系：1182332400@qq.com</p>',
            '</div>'
          ].join('\n')
        })
      }
    );
    if (!sendRes.ok) return { ok: false, error: '邮件发送失败' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: '邮件发送异常' };
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

/* ============================================================
   API: 发送验证码（注册 / 重置密码共用）
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
      if (r.rows.length > 0) return res.json({ available: false, msg: '该邮箱已注册为学生账号，请勿重复注册' });
    }
    res.json({ available: true });
  } catch(err) {
    res.status(500).json({ error: '服务器异常' });
  }
});

/* ============================================================
   API: 家长注册 / 登录 / 重置密码
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
    if (checkP.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为家长账号' });
    const checkS = await pool.query('SELECT email FROM student_emails WHERE email = $1', [emailLower]);
    if (checkS.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为学生账号，不能同时注册为家长' });

    const salt = genSalt();
    const passwordHash = hashPassword(password, salt);
    const createdAt = Date.now();

    await pool.query(
      `INSERT INTO parents (email, phone, username, salt, "passwordHash", "createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [emailLower, phone, username, salt, passwordHash, createdAt]
    );
    res.json({ success: true, user: { email: emailLower, phone, username, createdAt } });
  } catch (err) {
    res.status(500).json({ error: '服务器数据库异常' });
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
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/parent/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: '参数不完整' });
  if (newPassword.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const emailLower = email.toLowerCase().trim();
  const target = 'email:' + emailLower;

  const entry = codeStore.get(target);
  if (!entry) return res.status(400).json({ error: '请先发送验证码' });
  if (Date.now() > entry.expiresAt) {
    codeStore.delete(target);
    return res.status(400).json({ error: '验证码已过期' });
  }
  if (entry.attempts >= 5) {
    codeStore.delete(target);
    return res.status(400).json({ error: '错误次数过多' });
  }
  if (entry.code !== String(code)) {
    entry.attempts++;
    return res.status(400).json({ error: '验证码不正确' });
  }
  codeStore.delete(target);

  try {
    const checkP = await pool.query('SELECT email FROM parents WHERE email = $1', [emailLower]);
    if (checkP.rows.length === 0) return res.status(404).json({ error: '该邮箱未注册家长账号' });

    const salt = genSalt();
    const passwordHash = hashPassword(newPassword, salt);

    await pool.query(
      `UPDATE parents SET salt = $1, "passwordHash" = $2 WHERE email = $3`,
      [salt, passwordHash, emailLower]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

// 家长注销账户（删除注册信息/绑定关系/AI 用量）
app.post('/api/parent/delete-account', async (req, res) => {
  const { email, password } = req.body || {};
  const emailLower = String(email || '').trim().toLowerCase();
  if (!emailLower || !password) return res.status(400).json({ error: '参数不完整' });

  try {
    const r = await pool.query('SELECT * FROM parents WHERE email = $1', [emailLower]);
    const parent = r.rows[0];
    if (!parent) return res.status(404).json({ error: '账号不存在' });
    if (hashPassword(password, parent.salt) !== parent.passwordHash) {
      return res.status(401).json({ error: '密码不正确' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM bindings WHERE "parentEmail" = $1', [emailLower]);
      await client.query('DELETE FROM ai_usage WHERE "parentEmail" = $1', [emailLower]);
      await client.query('DELETE FROM parents WHERE email = $1', [emailLower]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[家长注销账户] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pCheck = await client.query('SELECT email FROM parents WHERE email = $1', [pe]);
    if (pCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '家长账号不存在' });
    }

    const invRes = await client.query('SELECT * FROM invites WHERE code = $1 FOR UPDATE', [c]);
    const inv = invRes.rows[0];
    if (!inv) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '邀请码不存在' });
    }
    if (inv.used) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: '邀请码已被使用' });
    }
    if (Number(inv.expiresAt) < Date.now()) {
      await client.query('DELETE FROM invites WHERE code = $1', [c]);
      await client.query('COMMIT');
      return res.status(410).json({ error: '邀请码已过期' });
    }

    const se = inv.studentEmail;
    /* 同一学生的绑定串行化，硬性限制最多 2 位家长；家长端绑定学生数量不限 */
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [se]);
    const countRes = await client.query('SELECT COUNT(*) FROM bindings WHERE "studentEmail" = $1', [se]);
    if (parseInt(countRes.rows[0].count, 10) >= 2) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '该学生已达到绑定上限（最多绑定 2 位家长）' });
    }

    const bindCheck = await client.query('SELECT id FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [se, pe]);
    if (bindCheck.rows.length > 0) {
      await client.query('UPDATE invites SET used = true WHERE code = $1', [c]);
      await client.query('COMMIT');
      return res.status(409).json({ error: '您已绑定该学生' });
    }

    await client.query(
      `INSERT INTO bindings ("studentEmail", "studentUsername", "parentEmail", "boundAt") VALUES ($1, $2, $3, $4)`,
      [se, inv.studentUsername || '', pe, Date.now()]
    );
    await client.query('UPDATE invites SET used = true WHERE code = $1', [c]);
    await client.query('COMMIT');

    const totalRes = await pool.query('SELECT COUNT(*) FROM bindings WHERE "parentEmail" = $1', [pe]);
    res.json({
      success: true,
      studentEmail: se,
      studentUsername: inv.studentUsername || '',
      parentStudentCount: parseInt(totalRes.rows[0].count, 10),
      maxStudents: null
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch(e){}
    if (err.code === 'STUDENT_BIND_LIMIT' || String(err.message || '').indexOf('STUDENT_BIND_LIMIT') >= 0) {
      return res.status(409).json({ error: '该学生已达到绑定上限（最多绑定 2 位家长）' });
    }
    console.error('[绑定] 接受邀请失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  } finally {
    client.release();
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
    res.json({ success: true, list, maxStudents: null, unlimited: true });
  } catch (err) {
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/bind/remove', async (req, res) => {
  const { studentEmail, parentEmail } = req.body || {};
  if (!studentEmail || !parentEmail) return res.status(400).json({ error: '参数不完整' });
  try {
    await pool.query('DELETE FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [studentEmail.toLowerCase().trim(), parentEmail.toLowerCase().trim()]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器数据库异常' });
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
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

/* ============================================================
   管理员接口（Administrator / ADMIN_PASSWORD）
   ============================================================ */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: '请输入管理员密码' });
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: '管理员密码不正确', code: 'ADMIN_AUTH' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
  res.json({
    success: true,
    token,
    user: { email: 'administrator@qbti.local', username: 'Administrator', phone: '', role: 'admin' }
  });
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM parents) AS parents,
        (SELECT COUNT(*) FROM student_emails) AS students,
        (SELECT COUNT(*) FROM bindings) AS bindings,
        (SELECT COUNT(*) FROM reports) AS reports,
        (SELECT COUNT(*) FROM reports WHERE payload->>'aiReport' IS NOT NULL) AS "aiReports"
    `);
    let todayAI = 0;
    try {
      const u = await pool.query('SELECT COALESCE(SUM(count), 0) AS used FROM ai_usage WHERE day = $1', [localDay()]);
      todayAI = Number(u.rows[0] && u.rows[0].used) || 0;
    } catch(e){}
    const row = counts.rows[0] || {};
    res.json({
      success: true,
      overview: {
        parents: Number(row.parents) || 0,
        students: Number(row.students) || 0,
        bindings: Number(row.bindings) || 0,
        reports: Number(row.reports) || 0,
        aiReports: Number(row.aiReports) || 0,
        todayAI
      }
    });
  } catch (err) {
    console.error('[管理员概览] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const like = '%' + q + '%';
  try {
    const result = await pool.query(`
      SELECT s.email, s.username,
             COALESCE(to_jsonb(s)->>'phone', '') AS phone,
             s."createdAt",
             (to_jsonb(s)->>'passwordHash' IS NOT NULL) AS "hasPassword",
             r."updatedAt" AS "reportUpdatedAt",
             (r.payload->>'aiReport' IS NOT NULL) AS "hasAI",
             (r.payload->>'aiReportLang') AS "aiLang",
             (r.payload->>'code') AS "code",
             (SELECT COUNT(*) FROM bindings b WHERE b."studentEmail" = s.email) AS "boundCount"
      FROM student_emails s
      LEFT JOIN reports r ON r."studentEmail" = s.email
      WHERE ($1 = '' OR LOWER(s.email) LIKE $2 OR LOWER(COALESCE(s.username, '')) LIKE $2)
      ORDER BY s."createdAt" DESC NULLS LAST
      LIMIT 100
    `, [q, like]);
    const list = result.rows.map(row => ({
      email: row.email,
      username: row.username || '',
      phone: row.phone || '',
      createdAt: row.createdAt ? Number(row.createdAt) : null,
      hasPassword: !!row.hasPassword,
      hasReport: !!row.reportUpdatedAt,
      reportUpdatedAt: row.reportUpdatedAt ? Number(row.reportUpdatedAt) : null,
      hasAI: !!row.hasAI,
      aiLang: row.aiLang || null,
      code: row.code || null,
      boundCount: Number(row.boundCount) || 0
    }));
    res.json({ success: true, list });
  } catch (err) {
    console.error('[管理员学生列表] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.get('/api/admin/report/:studentEmail', requireAdmin, async (req, res) => {
  const se = String(req.params.studentEmail || '').trim().toLowerCase();
  if (!se) return res.status(400).json({ error: '缺少邮箱' });
  try {
    const repRes = await pool.query('SELECT * FROM reports WHERE "studentEmail" = $1', [se]);
    const r = repRes.rows[0];
    if (!r) return res.status(404).json({ error: '该学生尚未提交报告' });
    res.json({
      success: true,
      report: {
        studentEmail: r.studentEmail,
        studentUsername: r.studentUsername,
        payload: r.payload,
        updatedAt: Number(r.updatedAt)
      }
    });
  } catch (err) {
    console.error('[管理员报告] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/admin/clear-ai', requireAdmin, async (req, res) => {
  const se = String((req.body && req.body.studentEmail) || '').trim().toLowerCase();
  if (!se) return res.status(400).json({ error: '缺少学生邮箱' });
  try {
    const repRes = await pool.query('SELECT payload FROM reports WHERE "studentEmail" = $1', [se]);
    if (repRes.rows.length === 0) return res.status(404).json({ error: '报告不存在' });
    const payload = repRes.rows[0].payload || {};
    delete payload.aiReport;
    delete payload.aiReportLang;
    delete payload.aiReportSource;
    delete payload.aiReportAt;
    await pool.query(
      'UPDATE reports SET payload = $1, "updatedAt" = $2 WHERE "studentEmail" = $3',
      [JSON.stringify(payload), Date.now(), se]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[管理员清除 AI] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

/* ============================================================
   管理员：学生端管理员账户策略
   学生端 Administrator 的启用状态与密码由家长端管理员控制
   ============================================================ */
app.get('/api/admin/student-admin', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT enabled, "updatedAt", "updatedBy" FROM admin_policy WHERE id = $1',
      ['student_admin']
    );
    if (r.rows.length === 0) return res.status(404).json({ error: '学生端管理员策略不存在' });
    const row = r.rows[0];
    res.json({
      success: true,
      policy: {
        enabled: !!row.enabled,
        updatedAt: Number(row.updatedAt) || null,
        updatedBy: row.updatedBy || ''
      }
    });
  } catch (err) {
    console.error('[学生端管理员策略] 读取失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/admin/student-admin', requireAdmin, async (req, res) => {
  const { enabled, password } = req.body || {};
  if (enabled == null && !password) {
    return res.status(400).json({ error: '没有需要更新的内容' });
  }
  if (password && String(password).length < 6) {
    return res.status(400).json({ error: '学生端管理员密码至少 6 位' });
  }
  try {
    const cur = await pool.query('SELECT * FROM admin_policy WHERE id = $1', ['student_admin']);
    if (cur.rows.length === 0) return res.status(404).json({ error: '学生端管理员策略不存在' });
    const row = cur.rows[0];
    const nextEnabled = (enabled == null) ? !!row.enabled : !!enabled;
    let salt = row.salt;
    let passwordHash = row.passwordHash;
    if (password) {
      salt = genSalt();
      passwordHash = hashAdminPolicyPassword(password, salt);
    }
    await pool.query(
      `UPDATE admin_policy
       SET enabled = $1, salt = $2, "passwordHash" = $3, "updatedAt" = $4, "updatedBy" = $5
       WHERE id = $6`,
      [nextEnabled, salt, passwordHash, Date.now(), 'parent-admin', 'student_admin']
    );
    res.json({ success: true, policy: { enabled: nextEnabled, updatedAt: Date.now(), updatedBy: 'parent-admin' } });
  } catch (err) {
    console.error('[学生端管理员策略] 更新失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

/* ============================================================
   管理员：学生端管理员的全部历史问卷
   ============================================================ */
app.get('/api/admin/student-admin-records', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, "quizTs", "createdAt",
             payload->>'code' AS code,
             (payload->>'aiReport' IS NOT NULL) AS "hasAI",
             payload->>'aiReportLang' AS "aiLang",
             payload->>'aiReportSource' AS "aiSource"
      FROM admin_quiz_records
      WHERE LOWER("studentEmail") = 'administrator@qbti.local'
      ORDER BY "quizTs" DESC
      LIMIT 200
    `);
    const list = r.rows.map(row => ({
      id: Number(row.id),
      quizTs: Number(row.quizTs) || null,
      createdAt: Number(row.createdAt) || null,
      code: row.code || '',
      hasAI: !!row.hasAI,
      aiLang: row.aiLang || null,
      aiSource: row.aiSource || null
    }));
    res.json({ success: true, list });
  } catch (err) {
    console.error('[学生端管理员历史] 读取失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.get('/api/admin/student-admin-record/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: '记录 ID 不正确' });
  try {
    const r = await pool.query('SELECT * FROM admin_quiz_records WHERE id = $1', [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (String(row.studentEmail).toLowerCase() !== 'administrator@qbti.local') {
      return res.status(403).json({ error: '不是学生端管理员记录' });
    }
    res.json({
      success: true,
      record: {
        id: Number(row.id),
        quizTs: Number(row.quizTs) || null,
        createdAt: Number(row.createdAt) || null,
        payload: row.payload
      }
    });
  } catch (err) {
    console.error('[学生端管理员历史] 单条读取失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/admin/student-admin-record/:id/generate', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const lang = AI_LANGS.includes(req.body && req.body.lang) ? req.body.lang : 'zh-CN';
  if (!id) return res.status(400).json({ error: '记录 ID 不正确' });
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY', code: 'NO_KEY' });
  if (!QBTI) return res.status(500).json({ error: '服务端提示词模块未加载', code: 'NO_CORE' });

  const adminEmail = 'admin@qbti.local';
  try {
    const r = await pool.query('SELECT * FROM admin_quiz_records WHERE id = $1', [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: '记录不存在', code: 'NO_RECORD' });
    if (String(row.studentEmail).toLowerCase() !== 'administrator@qbti.local') {
      return res.status(403).json({ error: '不是学生端管理员记录', code: 'NOT_ADMIN_RECORD' });
    }
    const payload = row.payload || {};
    const cachedLang = payload.aiReportLang || 'zh-CN';
    const cachedSource = payload.aiReportSource || 'ai';
    if (payload.aiReport && cachedSource === 'ai' && cachedLang === lang) {
      return res.json({ success: true, text: payload.aiReport, lang: lang, cached: true, id: id });
    }
    if (aiInFlight.has(adminEmail)) {
      return res.status(429).json({ error: '正在生成，请稍候', code: 'IN_FLIGHT' });
    }
    const cooldownKey = adminEmail + '|record:' + id;
    const last = aiCooldown.get(cooldownKey) || 0;
    const now = Date.now();
    if (now - last < AI_COOLDOWN_MS) {
      const wait = Math.ceil((AI_COOLDOWN_MS - (now - last)) / 1000);
      return res.status(429).json({ error: '请求过于频繁，请稍后再试', code: 'COOLDOWN', wait });
    }
    const day = localDay();
    const burstBefore = burstStatus(adminEmail);
    if (burstBefore.locked) {
      return res.status(429).json({ error: '加载失败，请稍后再试', code: 'TOKEN_BURST' });
    }
    const prompt = buildServerPrompt(payload, lang);
    if (!prompt) return res.status(500).json({ error: '构建提示词失败', code: 'PROMPT_FAILED' });
    if (prompt.length > AI_MAX_PROMPT_CHARS) {
      return res.status(429).json({ error: '报告生成错误，请稍后再试', code: 'TOKEN_ANOMALY' });
    }

    aiInFlight.add(adminEmail);
    aiCooldown.set(cooldownKey, now);

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
        max_tokens: Math.min(2400, AI_HARD_MAX_TOKENS),
        stream: false
      })
    });
    if (!response.ok) throw new Error('DeepSeek API 返回错误');
    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('API 返回内容为空');

    const tokenCheck = checkTokenAnomaly(data.usage, prompt, content);
    const burstAfter = recordAIBurst(adminEmail, tokenCheck.total);
    if (tokenCheck.anomaly || burstAfter.locked) {
      return res.status(429).json({ error: '加载失败，请稍后再试', code: 'TOKEN_BURST' });
    }
    try { await addAITokens(adminEmail, day, tokenCheck.total); } catch(e){}

    payload.aiReport = content;
    payload.aiReportLang = lang;
    payload.aiReportSource = 'ai';
    payload.aiReportAudience = 'parent';
    payload.aiReportAt = Date.now();
    await pool.query(
      'UPDATE admin_quiz_records SET payload = $1, "createdAt" = $2 WHERE id = $3',
      [JSON.stringify(payload), Date.now(), id]
    );
    try { await incAIUsage(adminEmail, day); } catch(e){}
    res.json({ success: true, text: content, lang: lang, cached: false, id: id });
  } catch (err) {
    console.error('[学生端管理员历史] AI 生成失败:', err.message);
    res.status(500).json({ error: '生成失败，请稍后再试', code: 'AI_ERROR' });
  } finally {
    aiInFlight.delete(adminEmail);
  }
});

/* ============================================================
   API: AI 代理生成
   屏障：绑定校验 + 同语言缓存 + 并发锁 + 60 秒冷却 + 每日上限
   客户端只传 parentEmail / studentEmail / lang，不能传 prompt
   ============================================================ */
app.post('/api/generate-ai-report', async (req, res) => {
  const { parentEmail, studentEmail, lang } = req.body || {};
  let pe = String(parentEmail || '').trim().toLowerCase();
  const se = String(studentEmail || '').trim().toLowerCase();
  const lg = AI_LANGS.includes(lang) ? lang : 'zh-CN';
  const adminReq = isAdminToken(adminTokenFromReq(req));
  if (adminReq && !pe) pe = 'admin@qbti.local';

  if (!pe || !se) return res.status(400).json({ error: '参数不完整', code: 'BAD_REQUEST' });
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY', code: 'NO_KEY' });
  if (!QBTI) return res.status(500).json({ error: '服务端提示词模块未加载', code: 'NO_CORE' });

  try {
    /* 1) 普通家长必须已绑定；管理员 token 可跨学生生成 */
    if (!adminReq) {
      const bind = await pool.query(
        'SELECT id FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2',
        [se, pe]
      );
      if (bind.rows.length === 0) {
        return res.status(403).json({ error: '未绑定该学生', code: 'NOT_BOUND' });
      }
    }

    /* 2) 同语言已有 AI 报告：直接返回缓存，零 token */
    const repRes = await pool.query('SELECT payload FROM reports WHERE "studentEmail" = $1', [se]);
    const report = repRes.rows[0];
    if (!report || !report.payload) {
      return res.status(404).json({ error: '该学生尚未提交报告', code: 'NO_REPORT' });
    }
    const payload = report.payload;
    const cachedLang = payload.aiReportLang || 'zh-CN';
    const cachedSource = payload.aiReportSource || 'ai';
    /* 只把真正的 AI 报告当缓存；学生端的本地兜底报告（local）允许家长重新生成 */
    if (payload.aiReport && cachedSource === 'ai' && cachedLang === lg) {
      return res.json({ success: true, text: payload.aiReport, lang: lg, cached: true });
    }

    /* 3) 同一家长同时只允许一个生成请求，防止连点并发 */
    if (aiInFlight.has(pe)) {
      return res.status(429).json({ error: '正在生成，请稍候', code: 'IN_FLIGHT' });
    }

    /* 4) 同一家长 + 学生 60 秒冷却 */
    const cooldownKey = pe + '|' + se;
    const last = aiCooldown.get(cooldownKey) || 0;
    const now = Date.now();
    if (now - last < AI_COOLDOWN_MS) {
      const wait = Math.ceil((AI_COOLDOWN_MS - (now - last)) / 1000);
      return res.status(429).json({ error: '请求过于频繁，请稍后再试', code: 'COOLDOWN', wait });
    }

    /* 5) 每日上限（数据库持久化，重启不重置） */
    const day = localDay();
    const burstBefore = burstStatus(pe);
    if (burstBefore.locked) {
      return res.status(429).json({ error: '加载失败，请稍后再试', code: 'TOKEN_BURST' });
    }

    /* 6) 服务端构建提示词，客户端不能传任意 prompt */
    const prompt = buildServerPrompt(payload, lg);
    if (!prompt) return res.status(500).json({ error: '构建提示词失败', code: 'PROMPT_FAILED' });
    if (prompt.length > AI_MAX_PROMPT_CHARS) {
      return res.status(429).json({ error: '报告生成错误，请稍后再试', code: 'TOKEN_ANOMALY' });
    }

    aiInFlight.add(pe);
    aiCooldown.set(cooldownKey, now);

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
        max_tokens: Math.min(2400, AI_HARD_MAX_TOKENS),
        stream: false
      })
    });

    if (!response.ok) throw new Error('DeepSeek API 返回错误');
    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('API 返回内容为空');

    const tokenCheck = checkTokenAnomaly(data.usage, prompt, content);
    const burstAfter = recordAIBurst(pe, tokenCheck.total);
    if (tokenCheck.anomaly || burstAfter.locked) {
      return res.status(429).json({ error: '加载失败，请稍后再试', code: 'TOKEN_BURST' });
    }
    try { await addAITokens(pe, day, tokenCheck.total); } catch(e){}

    /* 7) 服务端直接落库，客户端不再调 update-ai */
    payload.aiReport = content;
    payload.aiReportLang = lg;
    payload.aiReportSource = 'ai';
    payload.aiReportAudience = 'parent';
    payload.aiReportAt = Date.now();
    let saved = true;
    try {
      await pool.query(
        `UPDATE reports SET payload = $1, "updatedAt" = $2 WHERE "studentEmail" = $3`,
        [JSON.stringify(payload), Date.now(), se]
      );
    } catch (dbErr) {
      saved = false;
      console.error('[AI] 报告落库失败:', dbErr.message);
    }
    try {
      await incAIUsage(pe, day);
    } catch (usageErr) {
      console.error('[AI] 用量计数失败:', usageErr.message);
    }

    res.json({ success: true, text: content, lang: lg, cached: false, saved });
  } catch (err) {
    console.error('[DeepSeek] 代理请求失败:', err.message);
    res.status(500).json({ error: '生成失败，请稍后再试', code: 'AI_ERROR' });
  } finally {
    aiInFlight.delete(pe);
  }
});

/* ============================================================
   投诉与反馈（家长端）
   ============================================================ */
app.post('/api/feedback', async (req, res) => {
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || 'unknown').trim();
  const now = Date.now();
  const last = feedbackCooldowns.get(ip) || 0;
  if (now - last < 15 * 1000) {
    return res.status(429).json({ error: '提交太频繁，请稍后再试', code: 'RATE_LIMIT' });
  }

  const body = req.body || {};
  const type = ['suggestion', 'complaint', 'other'].includes(body.type) ? body.type : 'suggestion';
  const content = String(body.content || '').trim();
  if (content.length < 5 || content.length > 2000) {
    return res.status(400).json({ error: '反馈内容需要 5-2000 字', code: 'BAD_CONTENT' });
  }
  const name = String(body.name || '').trim().slice(0, 50);
  const email = String(body.email || '').trim().slice(0, 255);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: '请填写正确的联系邮箱', code: 'BAD_EMAIL' });
  }
  const role = ['student', 'parent', 'admin', 'guest'].includes(body.role) ? body.role : 'parent';
  const userEmail = String(body.userEmail || '').trim().toLowerCase().slice(0, 255);
  const page = String(body.page || 'parent-contact').trim().slice(0, 50);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const referer = String(req.headers.referer || req.headers.origin || '').slice(0, 500);

  try {
    const r = await pool.query(
      `INSERT INTO feedback (name, email, role, type, content, "userEmail", page, app, ip, "userAgent", referer, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'parent', $8, $9, $10, $11)
       RETURNING id, "createdAt"`,
      [name, email, role, type, content, userEmail, page, ip, userAgent, referer, now]
    );
    feedbackCooldowns.set(ip, now);
    if (feedbackCooldowns.size > 2000) {
      const cutoff = now - 5 * 60 * 1000;
      for (const [k, v] of feedbackCooldowns) {
        if (v < cutoff) feedbackCooldowns.delete(k);
      }
    }
    res.json({ success: true, id: r.rows[0].id, createdAt: Number(r.rows[0].createdAt) });
  } catch (err) {
    console.error('[家长反馈] 保存失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常', code: 'DB_ERROR' });
  }
});

app.get('/api/admin/feedback', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, name, email, role, type, content, "userEmail", page, "createdAt",
             app, ip, "userAgent", referer, reply, "replySubject", "replyAt", "replyBy", "replyTo"
      FROM feedback
      WHERE app = 'parent'
      ORDER BY "createdAt" DESC
      LIMIT 500
    `);
    const list = r.rows.map(row => Object.assign({}, row, { createdAt: Number(row.createdAt) || 0, replyAt: row.replyAt ? Number(row.replyAt) : null }));
    res.json({ success: true, list: list, count: list.length });
  } catch (err) {
    console.error('[家长反馈] 管理员读取失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常', code: 'DB_ERROR' });
  }
});

app.post('/api/admin/feedback/:id/reply', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: '反馈 ID 不正确' });
  const subject = String((req.body && req.body.subject) || '').trim().slice(0, 120) || '关于你的反馈回复';
  const body = String((req.body && req.body.body) || '').trim();
  if (body.length < 1 || body.length > 5000) {
    return res.status(400).json({ error: '回复内容需要 1-5000 字' });
  }
  try {
    const r = await pool.query(
      `SELECT id, name, email, content, "userEmail" FROM feedback WHERE id = $1 AND app = 'parent'`,
      [id]
    );
    const fb = r.rows[0];
    if (!fb) return res.status(404).json({ error: '反馈不存在' });
    const to = String(fb.email || fb.userEmail || '').trim();
    if (!to) return res.status(400).json({ error: '该反馈没有可回复的邮箱' });

    const sent = await sendFeedbackReplyEmail(to, subject, body, fb);
    if (!sent.ok) return res.status(502).json({ error: sent.error || '邮件发送失败', code: 'MAIL_FAILED' });

    const now = Date.now();
    await pool.query(
      `UPDATE feedback
       SET reply = $1, "replySubject" = $2, "replyAt" = $3, "replyBy" = $4, "replyTo" = $5
       WHERE id = $6`,
      [body, subject, now, 'Administrator', to, id]
    );
    res.json({ success: true, replyAt: now, replyTo: to });
  } catch (err) {
    console.error('[家长反馈回复] 失败:', err.message);
    res.status(500).json({ error: '服务器数据库异常', code: 'DB_ERROR' });
  }
});

// 启动服务：先补齐表结构/管理员策略，再开始接收请求
initDB().finally(() => {
  app.listen(PORT, () => {
    console.log('===========================================');
    console.log('  QBTI 家长端独立服务器已启动');
    console.log('  端口: ' + PORT);
    console.log('  数据库: ' + (DATABASE_URL ? '✅ 已配置' : '❌ 未配置'));
    console.log('  邮件: ' + (AGENTMAIL_API_KEY ? '✅ 已启用' : '⚠️ 未配置'));
    console.log('  DeepSeek: ' + (DEEPSEEK_API_KEY ? '✅ 已启用' : '⚠️ 未配置'));
    console.log('===========================================');
  });
});