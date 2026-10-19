/* ============================================================
   QBTI 家长端后端服务器（完全独立版）
   ============================================================ */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));

// 托管家长端静态页面
app.use(express.static(__dirname));

/* ---------- 配置 ---------- */
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('❌ 严重警告：未配置 DATABASE_URL！家长端将无法连接数据库。');
} else {
  console.log('✅ PostgreSQL 连接字符串已配置');
}

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
   API: 邮箱角色排他检查（家长端调用）
   ============================================================ */
app.get('/api/check-email', async (req, res) => {
  const { email, role } = req.query;
  if(!email || !role) return res.status(400).json({ error: '参数不完整' });
  const targetEmail = email.toLowerCase().trim();

  try {
    // 如果当前是家长在注册，检查学生表里是否有这个人
    if (role === 'parent') {
      const r = await pool.query('SELECT email FROM student_emails WHERE email = $1', [targetEmail]);
      if (r.rows.length > 0) {
        return res.json({ available: false, msg: '该邮箱已注册为学生账号，请勿重复注册' });
      }
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
  // 注意：因为没有独立发信服务，验证码校验需要借用学生端，或者在这里放开（为简单起见，此独立版假设验证码已在前端或其他地方校验）
  // 为了完全独立运行，这里简化了验证码校验逻辑（如果要用邮箱，需在此处重新接入 AgentMail）
  const { email, phone, code, username, password } = req.body || {};
  if (!email || !phone || !username || !password) {
    return res.status(400).json({ error: '参数不完整' });
  }

  const emailLower = email.toLowerCase().trim();

  try {
    const checkP = await pool.query('SELECT email FROM parents WHERE email = $1', [emailLower]);
    if (checkP.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为家长账号' });
    
    const checkS = await pool.query('SELECT email FROM student_emails WHERE email = $1', [emailLower]);
    if (checkS.rows.length > 0) return res.status(409).json({ error: '该邮箱已注册为学生账号，不能同时注册为家长' });

    const salt = genSalt();
    const passwordHash = hashPassword(password, salt);
    const createdAt = Date.now();

    await pool.query(
      `INSERT INTO parents (email, phone, username, salt, "passwordHash", "createdAt") 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [emailLower, phone, username, salt, passwordHash, createdAt]
    );

    res.json({ success: true, user: { email: emailLower, phone, username, createdAt } });
  } catch (err) {
    console.error('[DB] 注册家长失败:', err);
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
    
    if (hashPassword(password, parent.salt) !== parent.passwordHash) {
      return res.status(401).json({ error: '密码不正确' });
    }
    
    res.json({
      success: true,
      user: { email: parent.email, phone: parent.phone, username: parent.username, createdAt: Number(parent.createdAt) }
    });
  } catch (err) {
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

  try {
    const pCheck = await pool.query('SELECT email FROM parents WHERE email = $1', [pe]);
    if (pCheck.rows.length === 0) return res.status(404).json({ error: '家长账号不存在' });

    const invRes = await pool.query('SELECT * FROM invites WHERE code = $1', [c]);
    const inv = invRes.rows[0];
    if (!inv) return res.status(404).json({ error: '邀请码不存在' });
    if (inv.used) return res.status(410).json({ error: '邀请码已被使用' });
    if (Number(inv.expiresAt) < Date.now()) {
      await pool.query('DELETE FROM invites WHERE code = $1', [c]);
      return res.status(410).json({ error: '邀请码已过期' });
    }

    const se = inv.studentEmail;
    const countRes = await pool.query('SELECT COUNT(*) FROM bindings WHERE "studentEmail" = $1', [se]);
    if (parseInt(countRes.rows[0].count, 10) >= 2) return res.status(409).json({ error: '该学生已达到绑定上限' });

    const bindCheck = await pool.query('SELECT id FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2', [se, pe]);
    if (bindCheck.rows.length > 0) {
      await pool.query('UPDATE invites SET used = true WHERE code = $1', [c]);
      return res.status(409).json({ error: '您已绑定该学生' });
    }

    await pool.query(
      `INSERT INTO bindings ("studentEmail", "studentUsername", "parentEmail", "boundAt") 
       VALUES ($1, $2, $3, $4)`,
      [se, inv.studentUsername || '', pe, Date.now()]
    );
    await pool.query('UPDATE invites SET used = true WHERE code = $1', [c]);

    res.json({ success: true, studentEmail: se, studentUsername: inv.studentUsername || '' });
  } catch (err) {
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.get('/api/parent/students', async (req, res) => {
  const pe = String(req.query.email || '').trim().toLowerCase();
  if (!pe) return res.status(400).json({ error: '缺少邮箱' });

  try {
    const result = await pool.query(`
      SELECT 
        b."studentEmail", b."studentUsername", b."boundAt",
        r."updatedAt" AS "reportUpdatedAt"
      FROM bindings b
      LEFT JOIN reports r ON b."studentEmail" = r."studentEmail"
      WHERE b."parentEmail" = $1
      ORDER BY b."boundAt" DESC
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
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

app.post('/api/bind/remove', async (req, res) => {
  const { studentEmail, parentEmail } = req.body || {};
  if (!studentEmail || !parentEmail) return res.status(400).json({ error: '参数不完整' });
  const se = String(studentEmail).trim().toLowerCase();
  const pe = String(parentEmail).trim().toLowerCase();

  try {
    const result = await pool.query('DELETE FROM bindings WHERE "studentEmail" = $1 AND "parentEmail" = $2 RETURNING id', [se, pe]);
    if (result.rowCount === 0) return res.status(404).json({ error: '绑定不存在' });
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
    res.status(500).json({ error: '服务器数据库异常' });
  }
});

// 家长端启动
app.listen(PORT, () => {
  console.log('===========================================');
  console.log('  QBTI 家长端独立服务器已启动');
  console.log('  端口: ' + PORT);
  console.log('  数据库: ' + (DATABASE_URL ? '✅ 已配置' : '❌ 未配置'));
  console.log('===========================================');
});