/* ============================================================
   QParent —— 独立家长端逻辑（解绑 + 真实发信 + 直接生成AI）
   ============================================================ */
(function(){
  'use strict';

  const Q = window.QBTI;
  const SESSION_KEY = 'qparent_session_v1';
  const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
  const CODE_COOLDOWN = 60 * 1000;
  
  // 👈 因为家长端自己的 server.js 已经包含所有接口，这里留空
  const API_BASE = ''; 

  const $ = id => document.getElementById(id);
  const app = $('app');
  const navTag = $('navTag');

  let currentParent = null;
  let codeTimer = null;
  let html5QrcodeScanner = null;

  function escapeHTML(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatTime(ts){
    const d = new Date(ts);
    const pad = n => n < 10 ? '0'+n : ''+n;
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function toast(msg, type){
    type = type || 'info';
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  /* ---------- Session ---------- */
  function loadSession(){
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(!s || !s.email || !s.expiresAt) return null;
      if(Date.now() > s.expiresAt){ localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch(e){ return null; }
  }
  function saveSession(user){
    const s = { ...user, expiresAt: Date.now() + SESSION_DURATION };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e){}
    return s;
  }
  function clearSession(){
    try { localStorage.removeItem(SESSION_KEY); } catch(e){}
    currentParent = null;
  }

  /* ---------- Auth Modal ---------- */
  function buildAuthModal(){
    const mask = document.createElement('div');
    mask.className = 'auth-mask';
    mask.id = 'authMask';
    mask.innerHTML = `
      <div class="auth-modal">
        <button class="auth-close" type="button" aria-label="关闭">×</button>

        <div class="auth-view" data-view="login" style="display:none;">
          <div class="auth-tabs">
            <button type="button" data-tab="login" class="active">登录</button>
            <button type="button" data-tab="register">注册</button>
          </div>
          <h2 class="auth-title">家长登录</h2>
          <p class="auth-subtitle">用注册邮箱登录，查看孩子的量子态报告</p>
          <form data-form="login" autocomplete="on">
            <div class="auth-field" data-name="identifier">
              <label>邮箱</label>
              <input name="identifier" type="email" placeholder="your@email.com" autocomplete="username" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="password">
              <label>密码</label>
              <input name="password" type="password" placeholder="输入密码" autocomplete="current-password" />
              <div class="auth-err"></div>
            </div>
            <button type="submit" class="auth-submit">登录</button>
          </form>
          <div class="auth-switch">还没有家长账户？<a data-switch="register">立即注册</a></div>
        </div>

        <div class="auth-view" data-view="register" style="display:none;">
          <div class="auth-tabs">
            <button type="button" data-tab="login">登录</button>
            <button type="button" data-tab="register" class="active">注册</button>
          </div>
          <h2 class="auth-title">家长注册</h2>
          <p class="auth-subtitle">填写信息完成验证，随后即可绑定孩子</p>
          <form data-form="register" autocomplete="on">
            <div class="auth-field" data-name="email">
              <label>邮箱</label>
              <input name="email" type="email" placeholder="your@email.com" autocomplete="email" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="phone">
              <label>手机号</label>
              <input name="phone" type="tel" placeholder="11 位中国大陆手机号" autocomplete="tel" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="code">
              <label>验证码</label>
              <div class="auth-code-row">
                <input name="code" type="text" placeholder="6 位验证码" inputmode="numeric" maxlength="6" />
                <button type="button" class="auth-send-code" data-action="send-code">发送验证码</button>
              </div>
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="username">
              <label>用户名</label>
              <input name="username" type="text" placeholder="2-20 位" autocomplete="nickname" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="password">
              <label>密码</label>
              <input name="password" type="password" placeholder="至少 6 位" autocomplete="new-password" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="confirm">
              <label>确认密码</label>
              <input name="confirm" type="password" placeholder="再次输入密码" autocomplete="new-password" />
              <div class="auth-err"></div>
            </div>
            <button type="submit" class="auth-submit">创建家长账户</button>
          </form>
          <div class="auth-switch">已有账户？<a data-switch="login">去登录</a></div>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    bindAuthEvents();
  }

  function bindAuthEvents(){
    const mask = $('authMask');
    mask.querySelector('.auth-close').addEventListener('click', closeAuth);
    mask.addEventListener('click', e => { if(e.target === mask) closeAuth(); });
    mask.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchAuthView(btn.dataset.tab));
    });
    mask.querySelectorAll('[data-switch]').forEach(a => {
      a.addEventListener('click', () => switchAuthView(a.dataset.switch));
    });
    mask.querySelector('[data-action="send-code"]').addEventListener('click', handleSendCode);
    mask.querySelector('[data-form="login"]').addEventListener('submit', handleLoginSubmit);
    mask.querySelector('[data-form="register"]').addEventListener('submit', handleRegisterSubmit);
  }

  function openAuth(view){
    if(!document.getElementById('authMask')) buildAuthModal();
    switchAuthView(view || 'login');
    $('authMask').classList.add('show');
  }
  function closeAuth(){
    const mask = $('authMask');
    if(mask) mask.classList.remove('show');
    if(codeTimer){ clearInterval(codeTimer); codeTimer = null; }
    const btn = document.querySelector('[data-action="send-code"]');
    if(btn){ btn.disabled = false; btn.textContent = '发送验证码'; }
  }
  function switchAuthView(name){
    document.querySelectorAll('#authMask .auth-view').forEach(v => {
      v.style.display = v.dataset.view === name ? '' : 'none';
    });
    document.querySelectorAll('#authMask .auth-field').forEach(f => {
      f.classList.remove('has-err');
      const inp = f.querySelector('input');
      if(inp) inp.classList.remove('err');
      const err = f.querySelector('.auth-err');
      if(err) err.textContent = '';
    });
  }

  function setFieldError(form, name, msg){
    const f = form.querySelector('.auth-field[data-name="' + name + '"]');
    if(!f) return;
    const inp = f.querySelector('input');
    const err = f.querySelector('.auth-err');
    if(msg){ f.classList.add('has-err'); if(inp) inp.classList.add('err'); if(err) err.textContent = msg; }
    else { f.classList.remove('has-err'); if(inp) inp.classList.remove('err'); if(err) err.textContent = ''; }
  }
  function clearFormErrors(form){
    form.querySelectorAll('.auth-field').forEach(f => {
      f.classList.remove('has-err');
      const inp = f.querySelector('input');
      if(inp) inp.classList.remove('err');
      const err = f.querySelector('.auth-err');
      if(err) err.textContent = '';
    });
  }
  function getFormData(form){
    const data = {};
    form.querySelectorAll('input').forEach(inp => { data[inp.name] = inp.value.trim(); });
    return data;
  }

  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_PHONE = /^1[3-9]\d{9}$/;

  async function handleSendCode(){
    const form = document.querySelector('#authMask [data-form="register"]');
    const data = getFormData(form);
    const btn = document.querySelector('#authMask [data-action="send-code"]');
    clearFormErrors(form);

    if(!RE_EMAIL.test(data.email)){ setFieldError(form, 'email', '请先填写正确的邮箱'); return; }
    if(!RE_PHONE.test(data.phone)){ setFieldError(form, 'phone', '请先填写正确的手机号'); return; }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '发送中…';

    try {
      const checkRes = await fetch(API_BASE + '/api/check-email?email=' + encodeURIComponent(data.email) + '&role=parent');
      const checkData = await checkRes.json();
      if (!checkData.available) {
         setFieldError(form, 'email', checkData.msg || '该邮箱已被占用');
         toast(checkData.msg || '该邮箱已被占用', 'err');
         btn.disabled = false;
         btn.textContent = oldText;
         return;
      }

      const res = await fetch(API_BASE + '/api/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, phone: data.phone })
      });
      const r = await res.json();
      if(!res.ok || !r.success){
        setFieldError(form, 'code', r.error || '发送失败');
        toast(r.error || '发送失败', 'err');
        btn.disabled = false;
        btn.textContent = oldText;
        return;
      }
      toast(r.message || '验证码已发送', 'ok');
    } catch(err){
      setFieldError(form, 'code', '无法连接服务器');
      toast('无法连接服务器，请检查服务器是否正常', 'err');
      btn.disabled = false;
      btn.textContent = oldText;
      return;
    }

    let remaining = Math.floor(CODE_COOLDOWN / 1000);
    btn.textContent = remaining + 's';
    if(codeTimer) clearInterval(codeTimer);
    codeTimer = setInterval(() => {
      remaining--;
      if(remaining <= 0){
        clearInterval(codeTimer);
        codeTimer = null;
        btn.disabled = false;
        btn.textContent = '发送验证码';
      } else {
        btn.textContent = remaining + 's';
      }
    }, 1000);
  }

  async function handleRegisterSubmit(e){
    e.preventDefault();
    const form = e.target;
    const data = getFormData(form);
    const btn = form.querySelector('.auth-submit');
    clearFormErrors(form);

    const errs = {};
    if(!RE_EMAIL.test(data.email)) errs.email = '邮箱格式不正确';
    if(!RE_PHONE.test(data.phone)) errs.phone = '请输入 11 位中国大陆手机号';
    if(!data.code || data.code.length !== 6) errs.code = '请输入 6 位验证码';
    if(!data.username || data.username.length < 2 || data.username.length > 20) errs.username = '用户名 2-20 位';
    if(!data.password || data.password.length < 6) errs.password = '密码至少 6 位';
    if(data.password !== data.confirm) errs.confirm = '两次密码不一致';
    if(Object.keys(errs).length > 0){
      Object.keys(errs).forEach(k => setFieldError(form, k, errs[k]));
      toast('请检查表单填写', 'err');
      return;
    }

    btn.disabled = true;
    btn.textContent = '创建中…';

    try {
      const res = await fetch(API_BASE + '/api/parent/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email, phone: data.phone, code: data.code,
          username: data.username, password: data.password
        })
      });
      const r = await res.json();
      if(!res.ok || !r.success){
        setFieldError(form, 'code', r.error || '注册失败');
        toast(r.error || '注册失败', 'err');
        btn.disabled = false;
        btn.textContent = '创建家长账户';
        return;
      }
      saveSession(r.user);
      currentParent = r.user;
      toast('注册成功，已自动登录', 'ok');
      setTimeout(() => { closeAuth(); renderHome(); }, 500);
    } catch(err){
      toast('无法连接服务器', 'err');
      btn.disabled = false;
      btn.textContent = '创建家长账户';
    }
  }

  async function handleLoginSubmit(e){
    e.preventDefault();
    const form = e.target;
    const data = getFormData(form);
    const btn = form.querySelector('.auth-submit');
    clearFormErrors(form);

    if(!data.identifier){ setFieldError(form, 'identifier', '请输入邮箱'); return; }
    if(!data.password){ setFieldError(form, 'password', '请输入密码'); return; }

    btn.disabled = true;
    btn.textContent = '登录中…';

    try {
      const res = await fetch(API_BASE + '/api/parent/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: data.identifier, password: data.password })
      });
      const r = await res.json();
      if(!res.ok || !r.success){
        setFieldError(form, 'password', r.error || '登录失败');
        btn.disabled = false;
        btn.textContent = '登录';
        return;
      }
      saveSession(r.user);
      currentParent = r.user;
      toast('欢迎回来，' + r.user.username, 'ok');
      setTimeout(() => { closeAuth(); renderHome(); }, 500);
    } catch(err){
      toast('无法连接服务器', 'err');
      btn.disabled = false;
      btn.textContent = '登录';
    }
  }

  /* ---------- 首页渲染 ---------- */
  function renderHome(){
    if(!currentParent){
      navTag.textContent = '未登录';
      renderGate();
      return;
    }
    navTag.textContent = currentParent.username;
    renderDashboard();
  }

  function renderGate(){
    app.innerHTML = `
      <div class="card gate">
        <h1>QBTI 家长端</h1>
        <p>登录家长账户后，即可绑定孩子、查看孩子的量子态报告。<br>还没有账户？点击下方按钮注册。</p>
        <button id="btnShowLogin" style="max-width:200px;margin:0 auto 12px;display:block;">登录家长账户</button>
        <button id="btnShowRegister" style="max-width:200px;margin:0 auto;display:block;background:transparent;border:1px solid rgba(255,255,255,.14);color:#fff;">注册家长账户</button>
      </div>
    `;
    $('btnShowLogin').addEventListener('click', () => openAuth('login'));
    $('btnShowRegister').addEventListener('click', () => openAuth('register'));
  }

  async function renderDashboard(){
    app.innerHTML = `
      <div class="topbar">
        <div class="user-chip">
          <span class="avatar">${escapeHTML((currentParent.username||'?').slice(0,1).toUpperCase())}</span>
          <span>${escapeHTML(currentParent.username)}</span>
        </div>
        <button class="logout-btn" id="btnLogout">退出登录</button>
      </div>

      <div class="topbar" style="margin-bottom:24px;">
        <div style="font-size:13px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;">已绑定的孩子</div>
        <button class="add-student-btn" id="btnAddStudent">+ 绑定孩子</button>
      </div>
      <div class="student-list" id="studentList">
        <div class="empty-state">正在加载…</div>
      </div>
    `;
    
    $('btnLogout').addEventListener('click', () => { clearSession(); renderHome(); });
    $('btnAddStudent').addEventListener('click', openBindDialog);

    loadBoundStudents();

    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('code');
    if(codeParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => {
        openBindDialog(codeParam);
      }, 500);
    }
  }

  async function loadBoundStudents(){
    try {
      const res = await fetch(API_BASE + '/api/parent/students?email=' + encodeURIComponent(currentParent.email));
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '加载失败');
      
      const el = $('studentList');
      const list = data.list || [];
      if(list.length === 0){
        el.innerHTML = '<div class="empty-state">还没有绑定任何孩子。请点击右上角「+ 绑定孩子」。</div>';
        return;
      }
      
      el.innerHTML = list.map(s => {
        const name = s.studentUsername || s.studentEmail;
        const init = name.slice(0,1).toUpperCase();
        const badge = s.hasReport ? '<span class="sc-badge">有报告</span>' : '<span class="sc-badge empty">暂无报告</span>';
        const meta = s.hasReport ? ('最近更新：' + formatTime(s.reportUpdatedAt)) : ('绑定于 ' + formatTime(s.boundAt));
        
        return `<div class="student-card" data-type="sync" data-email="${escapeHTML(s.studentEmail)}">
          <div class="sc-head">
            <div class="sc-avatar">${escapeHTML(init)}</div>
            <div class="sc-info">
              <div class="sc-name">${escapeHTML(name)}</div>
              <div class="sc-meta">${escapeHTML(meta)}</div>
            </div>
            ${badge}
            <button class="unbind-btn" data-email="${escapeHTML(s.studentEmail)}" title="解除绑定">解除</button>
          </div>
        </div>`;
      }).join('');
      
      el.querySelectorAll('.student-card').forEach(card => {
        card.addEventListener('click', () => showSyncedReport(card.dataset.email));
      });

      el.querySelectorAll('.unbind-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleUnbind(btn.dataset.email);
        });
      });

    } catch(err){
      $('studentList').innerHTML = '<div class="empty-state" style="color:#FF8FA0;">加载失败：' + escapeHTML(err.message) + '</div>';
    }
  }

  async function handleUnbind(studentEmail){
    if(!confirm('确定要解除与该孩子的绑定吗？解除后您将无法再查看他的报告。')) return;
    
    try {
      const res = await fetch(API_BASE + '/api/bind/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          studentEmail: studentEmail, 
          parentEmail: currentParent.email 
        })
      });
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '解绑失败');
      
      toast('已解除绑定', 'ok');
      renderDashboard();
    } catch(err){
      toast('解绑失败：' + err.message, 'err');
    }
  }

  /* ---------- 绑定弹窗 ---------- */
  function openBindDialog(prefillCode){
    const old = document.getElementById('bindMask');
    if(old) old.remove();
    
    if(html5QrcodeScanner) {
      try { html5QrcodeScanner.clear(); } catch(e){}
      html5QrcodeScanner = null;
    }

    const mask = document.createElement('div');
    mask.id = 'bindMask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(3,4,12,.86);backdrop-filter:blur(10px);z-index:300;display:grid;place-items:center;padding:20px;';
    mask.innerHTML = `
      <div style="width:100%;max-width:400px;padding:30px 26px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:#0B0D1C;text-align:center;">
        <div style="font-size:11px;letter-spacing:.22em;color:var(--muted);text-transform:uppercase;margin-bottom:14px;">Bind Child · 绑定孩子</div>
        <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:8px;">扫描二维码或输入邀请码</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.7;">请让孩子在学生端生成邀请二维码</div>
        
        <button id="btnStartScan" class="scan-btn" style="width:100%;padding:12px;border-radius:11px;border:1px dashed var(--q-color);background:rgba(var(--q-r),var(--q-g),var(--q-b),.08);color:var(--q-color);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px;transition:.2s;">
          📷 打开摄像头扫码
        </button>
        
        <div id="reader-container">
          <div id="reader"></div>
          <button id="btnStopScan" style="width:100%;padding:10px;background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer;">取消扫码</button>
        </div>

        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">或手动输入 6 位码</div>
        <input id="bindCodeInput" type="text" maxlength="6" placeholder="ABC123"
          style="width:100%;padding:14px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#fff;font-size:20px;font-weight:700;letter-spacing:.24em;text-align:center;text-transform:uppercase;font-family:inherit;outline:none;margin-bottom:14px;" />
        <div id="bindErr" style="color:#FF8FA0;font-size:13px;min-height:18px;margin-bottom:10px;"></div>
        <div style="display:flex;gap:10px;">
          <button id="bindCancel" style="flex:1;padding:11px;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:transparent;color:var(--muted);font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;">取消</button>
          <button id="bindSubmit" style="flex:1;padding:11px;border-radius:11px;border:0;background:var(--q-color);color:#fff;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;">确认绑定</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const input = $('bindCodeInput');
    const err = $('bindErr');
    
    if(prefillCode) {
      input.value = prefillCode;
    } else {
      input.focus();
    }

    $('btnStartScan').addEventListener('click', () => { startScan(); });
    $('btnStopScan').addEventListener('click', () => { stopScan(); });

    function startScan() {
      if (!window.Html5Qrcode) {
        err.textContent = '扫码库未加载，请刷新页面重试';
        return;
      }
      $('btnStartScan').style.display = 'none';
      $('reader-container').style.display = 'block';
      
      html5QrcodeScanner = new Html5Qrcode("reader");
      html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          stopScan();
          let code = decodedText;
          if (decodedText.includes('code=')) {
            try {
              const url = new URL(decodedText);
              code = url.searchParams.get('code') || decodedText;
            } catch(e) {}
          }
          
          if(/^[A-Z0-9]{6}$/i.test(code)) {
            input.value = code.toUpperCase();
            toast('识别成功，正在绑定…', 'ok');
            submit();
          } else {
            err.textContent = '二维码无效，请确保扫的是邀请码';
            $('btnStartScan').style.display = 'flex';
            $('reader-container').style.display = 'none';
          }
        },
        (errorMessage) => {}
      ).catch(err => {
        console.error('摄像头启动失败', err);
        err.textContent = '无法启动摄像头。请确保使用 HTTPS 访问，并允许浏览器获取权限';
        $('btnStartScan').style.display = 'flex';
        $('reader-container').style.display = 'none';
      });
    }

    function stopScan() {
      if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
          html5QrcodeScanner.clear();
          html5QrcodeScanner = null;
          $('btnStartScan').style.display = 'flex';
          $('reader-container').style.display = 'none';
        }).catch(e => {
          console.warn('关闭摄像头异常', e);
          $('btnStartScan').style.display = 'flex';
          $('reader-container').style.display = 'none';
        });
      }
    }

    input.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); });
    $('bindCancel').addEventListener('click', () => { stopScan(); mask.remove(); });
    mask.addEventListener('click', e => { if(e.target === mask) { stopScan(); mask.remove(); } });
    $('bindSubmit').addEventListener('click', submit);

    async function submit(){
      const code = (input.value || '').trim().toUpperCase();
      if(!/^[A-Z0-9]{6}$/.test(code)){ err.textContent = '请输入 6 位邀请码'; return; }
      err.textContent = '';
      const btn = $('bindSubmit');
      btn.disabled = true;
      btn.textContent = '绑定中…';
      try {
        const res = await fetch(API_BASE + '/api/bind/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentEmail: currentParent.email, code })
        });
        const r = await res.json();
        if(!res.ok || !r.success){
          err.textContent = r.error || '绑定失败';
          btn.disabled = false;
          btn.textContent = '确认绑定';
          return;
        }
        stopScan();
        mask.remove();
        toast('绑定成功：' + (r.studentUsername || r.studentEmail), 'ok');
        renderDashboard();
      } catch(e){
        err.textContent = '无法连接服务器';
        btn.disabled = false;
        btn.textContent = '确认绑定';
      }
    }
  }

  /* ============================================================
     报告展示 & AI 直接生成
     ============================================================ */
  function setAccent(quantumState){
    const map = { good:[80,220,140], danger:[235,65,75], superposition:[90,140,245] };
    const c = map[quantumState] || [255,138,72];
    document.documentElement.style.setProperty('--q-r', c[0]);
    document.documentElement.style.setProperty('--q-g', c[1]);
    document.documentElement.style.setProperty('--q-b', c[2]);
    document.documentElement.style.setProperty('--q-color', 'rgb(' + c.join(',') + ')');
  }

  const DIM_COLORS = {
    PO:{X:'#7C5CFF',C:'#4A9EFF',A:'#00E5FF'},
    II:{U:'#FF6B9D',P:'#FFA94D',M:'#FFD93D'},
    LA:{I:'#6BCB77',D:'#4ECDC4',E:'#45B7D1'},
    UR:{T:'#FF6B6B',H:'#C77DFF',R:'#F7B801'}
  };
  const DIM_LETTERS = { PO:['X','C','A'], II:['U','P','M'], LA:['I','D','E'], UR:['T','H','R'] };
  const DIM_NAMES = { PO:'潜能开放度', II:'内在驱动力', LA:'学习自主性', UR:'未知应对方式' };

  async function showSyncedReport(studentEmail){
    app.innerHTML = '<div class="empty-state">正在加载报告…</div>';
    try {
      const res = await fetch(API_BASE + '/api/parent/report/' + encodeURIComponent(studentEmail) +
        '?parentEmail=' + encodeURIComponent(currentParent.email));
      
      if(!res.ok) {
        let errMsg = '加载失败';
        try { const d = await res.json(); errMsg = d.error || errMsg; } catch(e){}
        renderReportError(errMsg);
        return;
      }
      
      const data = await res.json();
      if(!data.success) {
        renderReportError(data.error || '加载失败');
        return;
      }
      
      const p = data.report.payload;
      let fullResult = p.fullResult;
      if (!fullResult) {
        fullResult = {
          letters: p.baseCode ? p.baseCode.split('') : [],
          suffix: { letter: p.suffixLetter || 'E', name: p.suffixName || '探索型' },
          dimGroupRatio: p.dimGroupRatio || {},
          dimLeadInfo: p.dimLeadInfo || {},
          suffixRatio: p.suffixRatio || {},
          suffixGap: p.suffixGap || 0,
          dominanceScore: {}
        };
      }
      
      renderReportView(fullResult, p.validity, p.aiReport, data.report.updatedAt, p);
    } catch(err){
      console.error('[报告加载错误]', err);
      renderReportError('请求异常：' + err.message);
    }
  }

  function renderReportError(msg){
    app.innerHTML = `
      <button class="back-btn" id="btnBack">← 返回</button>
      <div class="card" style="text-align:center;padding:40px;">
        <div style="font-size:15px;color:#FF8FA0;margin-bottom:10px;">加载失败</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.8;">${escapeHTML(msg)}</div>
      </div>
    `;
    $('btnBack').addEventListener('click', renderDashboard);
  }

  function renderMD(text){
    let h = escapeHTML(text);
    h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    h = h.replace(/^#{1,3}\s*(.+)$/gm,'<h4>$1</h4>');
    h = h.replace(/(?:^[-•▸]\s+.+$\n?)+/gm, m =>
      '<ul>' + m.replace(/^[-•▸]\s+(.+)$/gm,'<li>$1</li>') + '</ul>');
    return h.split(/\n{2,}/).map(p => {
      const t = p.trim(); if(!t) return '';
      if(/^<(h4|ul|li)/.test(t)) return t;
      return '<p>' + t.replace(/\n/g,'<br>') + '</p>';
    }).join('');
  }

  function renderReportView(res, validity, aiReportText, updatedAt, extraData){
    if(!res || !res.letters) {
       app.innerHTML = '<div class="empty-state">报告数据格式错误</div>';
       return;
    }

    const baseCode = res.letters.join('');
    const typeName = Q.TYPE_NAMES[baseCode] || (extraData ? extraData.typeName : '') || '未知类型';
    
    let qStateType = 'superposition';
    if (res.dominanceScore && Object.keys(res.dominanceScore).length > 0) {
       const qs = Q.analyzeQuantumState(res);
       qStateType = qs.type;
    } else if (extraData && extraData.quantumState) {
       qStateType = extraData.quantumState;
    }
    setAccent(qStateType);

    const vColorMap = { high:'#50DC8C', medium:'#FFD98A', low:'#FF8A48', very_low:'#EB414B' };
    const vColor = validity ? (vColorMap[validity.level] || '#8B90B8') : '#8B90B8';
    const reasons = (validity && validity.parentReasons && validity.parentReasons.length)
      ? validity.parentReasons.map(r => '▸ ' + escapeHTML(r)).join('<br>')
      : '▸ 未发现明显疑点';
    const timeLine = (validity && validity.totalTime != null)
      ? '作答用时约 ' + Math.round(validity.totalTime) + ' 秒' : '';

    const dimsHTML = Q.DIMS.map(d => {
      const ratio = res.dimGroupRatio[d.id] || {};
      const info = res.dimLeadInfo[d.id] || { lead: '-' };
      const segs = d.letters.map(l => {
        const pct = ratio[l] || 0;
        return `<div class="seg" style="width:${pct}%;background:${DIM_COLORS[d.id][l]};">${pct >= 10 ? l : ''}</div>`;
      }).join('');
      return `<div class="dim-row">
        <div class="dim-name">${d.name}</div>
        <div class="dim-bar">${segs}</div>
        <div class="dim-lead">${info.lead}</div>
      </div>`;
    }).join('');

    // 判断是否需要家长端直接生成
    const needGenerate = !aiReportText;
    const aiActionHTML = needGenerate ? `
      <div style="text-align:center;padding:20px 0;">
        <div style="color:var(--muted);font-size:13px;margin-bottom:14px;">孩子尚未生成 AI 报告，家长可在此直接生成</div>
        <button class="btn primary sm" id="btnGenAI" data-student="${escapeHTML(extraData.studentEmail)}">✨ 直接生成 AI 报告</button>
      </div>
    ` : renderMD(aiReportText);

    app.innerHTML = `
      <button class="back-btn" id="btnBack">← 返回列表</button>
      
      <div class="hero">
        <div class="code">${baseCode}<span style="font-size:0.7em;color:var(--q-color)">-${res.suffix ? res.suffix.letter : ''}</span></div>
        <div class="name">${escapeHTML(typeName)} · ${res.suffix ? escapeHTML(res.suffix.name) : ''}</div>
        <div class="sub">量子学习类型</div>
        ${updatedAt ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px;">最近更新：${formatTime(updatedAt)}</div>` : ''}
      </div>

      <div class="title">作答真实度 · 面向家长</div>
      <div class="card" style="border-color:${vColor}55;background:${vColor}0F;">
        <div class="authenticity">
          <div>
            <div class="label">Authenticity Score</div>
            <div class="level" style="color:${vColor};">● ${validity ? escapeHTML(validity.levelText) : '未评估'}</div>
            ${timeLine ? `<div style="font-size:12px;color:#8B90B8;margin-top:4px;">${escapeHTML(timeLine)}</div>` : ''}
          </div>
          <div class="score" style="color:${vColor};">${validity ? validity.authenticity : '--'}<small> / 100</small></div>
        </div>
        <div class="reason">${reasons}</div>
        ${validity ? `<div class="advice">给家长的建议：${escapeHTML(validity.advice)}</div>` : ''}
      </div>

      <div class="title">四维倾向</div>
      <div class="card">${dimsHTML}</div>

      <div class="title">AI 引导报告</div>
      <div class="card ai-body" id="aiBody">
        ${aiActionHTML}
      </div>
      
      <div class="result-actions">
        <button class="btn" id="btnBackBottom">返回</button>
      </div>
    `;
    
    $('btnBack').addEventListener('click', renderDashboard);
    $('btnBackBottom').addEventListener('click', renderDashboard);

    if(needGenerate && $('btnGenAI')){
      $('btnGenAI').addEventListener('click', async () => {
        const btn = $('btnGenAI');
        const studentEmail = btn.dataset.student;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>生成中…';
        $('aiBody').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);"><span class="spinner"></span>正在解析孩子的波函数与作答真实性…</div>';
        
        try {
          // 生成 Prompt（复用了学生端的核心算法）
          const prompt = Q.buildPrompt(res, validity);
          
          // 请求家长端自己的后端
          const apiRes = await fetch(API_BASE + '/api/generate-ai-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
          });
          
          const apiData = await apiRes.json();
          if(!apiRes.ok || !apiData.success) {
            throw new Error(apiData.error || '生成失败');
          }

          const text = apiData.text;
          
          // 更新到数据库
          await fetch(API_BASE + '/api/parent/report/update-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentEmail, aiReport: text })
          });
          
          $('aiBody').innerHTML = renderMD(text);
        } catch(err){
          console.error('AI 生成异常:', err);
          const msg = String(err.message || err);
          $('aiBody').innerHTML = `<div style="color:#FFD98A;font-size:13px;padding:20px;text-align:center;">生成失败：${escapeHTML(msg)}</div>`;
        } finally {
          if(btn) { btn.disabled = false; btn.textContent = '重新生成'; }
        }
      });
    }
  }

  function init(){
    const session = loadSession();
    if(session) currentParent = { email: session.email, phone: session.phone, username: session.username };
    renderHome();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();