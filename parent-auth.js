/* ============================================================
   QParent —— 独立家长端逻辑（包含忘记密码 + 二次确认 + 真实性展示）
   ============================================================ */
(function(){
  'use strict';

  const Q = window.QBTI;
  const SESSION_KEY = 'qparent_session_v1';
  const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
  const CODE_COOLDOWN = 60 * 1000;
  const API_BASE = '';

  /* ============================================================
     报告语言（家长端）
     只影响报告页与 AI 分析；登录/绑定等操作界面保持中文
     ============================================================ */
  const LANG_KEY = 'qparent_report_lang_v1';
  const LANGS = ['zh-CN', 'zh-TW', 'en', 'es', 'pt', 'ko', 'ja', 'fr'];
  const LANG_NAMES = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', es: 'Español',
    pt: 'Português', ko: '한국어', ja: '日本語', fr: 'Français'
  };
  const PT = {
    'zh-CN': {
      back: '← 返回', typeLabel: '量子学习类型', authenticity: '作答真实度', scoreLabel: '真实度评分',
      notAssessed: '未评估', noIssues: '未发现明显疑点',
      reasonsNote: '系统检测到一些作答特征，具体解读见下方 AI 分析。',
      advice: '给家长的建议', dims: '四维倾向', ai: 'AI 引导报告',
      generate: '✨ 直接生成 AI 报告', regen: '用当前语言重新生成', generating: '生成中…',
      noAI: '孩子尚未生成 AI 报告，家长可在此直接生成',
      localNote: '当前显示的是本地模板报告，点击下方按钮可由 AI 生成个性化分析。',
      langNote: '当前报告为 %s；点击下方按钮可用当前语言重新生成。',
      cached: '已读取已保存的报告', error: '生成失败，请稍后再试',
      limit: '今日生成次数已达上限，请明天再试。', cooldown: '请等待 %s 秒后再生成。',
      inFlight: '正在生成，请稍候。', notBound: '未绑定该学生。', noReport: '该学生尚未提交报告。',
      levels: { high: '高可信', medium: '基本可信', low: '可信度偏低', very_low: '可信度存疑' },
      adviceByLevel: {
        high: '孩子的作答状态自然真实，可以放心参考。',
        medium: '整体可信，建议以开放的心态和孩子交流。',
        low: '可信度偏低，建议换一个孩子放松的时机重新测评。',
        very_low: '存在明显疑点，建议先了解孩子最近的状态，不要直接使用这份报告。'
      },
      dims: { PO: '潜能开放度', II: '内在驱动力', LA: '学习自主性', UR: '未知应对方式' },
      suffix: { E: '探索型', D: '深耕型', I: '融合型', A: '实践型' }
    },
    'zh-TW': {
      back: '← 返回', typeLabel: '量子學習類型', authenticity: '作答真實度', scoreLabel: '真實度評分',
      notAssessed: '未評估', noIssues: '未發現明顯疑點',
      reasonsNote: '系統檢測到一些作答特徵，具體解讀見下方 AI 分析。',
      advice: '給家長的建議', dims: '四維傾向', ai: 'AI 引導報告',
      generate: '✨ 直接生成 AI 報告', regen: '用當前語言重新生成', generating: '生成中…',
      noAI: '孩子尚未生成 AI 報告，家長可在此直接生成',
      localNote: '目前顯示的是本地模板報告，點擊下方按鈕可由 AI 生成個人化分析。',
      langNote: '目前報告為 %s；點擊下方按鈕可用當前語言重新生成。',
      cached: '已讀取已保存的報告', error: '生成失敗，請稍後再試',
      limit: '今日生成次數已達上限，請明天再試。', cooldown: '請等待 %s 秒後再生成。',
      inFlight: '正在生成，請稍候。', notBound: '未綁定該學生。', noReport: '該學生尚未提交報告。',
      levels: { high: '高可信', medium: '基本可信', low: '可信度偏低', very_low: '可信度存疑' },
      adviceByLevel: {
        high: '孩子的作答狀態自然真實，可以放心參考。',
        medium: '整體可信，建議以開放的心態和孩子交流。',
        low: '可信度偏低，建議換一個孩子放鬆的時機重新測評。',
        very_low: '存在明顯疑點，建議先了解孩子最近的狀態，不要直接使用這份報告。'
      },
      dims: { PO: '潛能開放度', II: '內在驅動力', LA: '學習自主性', UR: '未知應對方式' },
      suffix: { E: '探索型', D: '深耕型', I: '融合型', A: '實踐型' }
    },
    en: {
      back: '← Back', typeLabel: 'Quantum learning type', authenticity: 'Response authenticity', scoreLabel: 'Authenticity score',
      notAssessed: 'Not assessed', noIssues: 'No obvious issues detected',
      reasonsNote: 'Some response patterns were detected. See the AI analysis below for details.',
      advice: 'Advice for parents', dims: 'Four dimensions', ai: 'AI guidance report',
      generate: '✨ Generate AI report', regen: 'Regenerate in current language', generating: 'Generating…',
      noAI: 'The student has not generated an AI report yet. You can generate one here.',
      localNote: 'This is a local template report. Use the button below to generate a personalized AI analysis.',
      langNote: 'This report is in %s. Use the button below to regenerate it in the current language.',
      cached: 'Loaded from the saved report', error: 'Generation failed. Please try again later.',
      limit: 'Daily generation limit reached. Please try again tomorrow.', cooldown: 'Please wait %s seconds before generating again.',
      inFlight: 'A report is already being generated. Please wait.', notBound: 'This student is not bound to your account.', noReport: 'The student has not submitted a report yet.',
      levels: { high: 'High confidence', medium: 'Mostly reliable', low: 'Low confidence', very_low: 'Questionable' },
      adviceByLevel: {
        high: 'The responses look natural and authentic. You can rely on this report with confidence.',
        medium: 'Overall reliable, with a few details worth discussing openly with your child.',
        low: 'Confidence is low. Consider retaking the assessment when your child is relaxed.',
        very_low: 'There are clear signs of careless or rushed answers. Talk with your child before using this report.'
      },
      dims: { PO: 'Potential openness', II: 'Intrinsic drive', LA: 'Learning agency', UR: 'Response to uncertainty' },
      suffix: { E: 'Explorer', D: 'Deepener', I: 'Integrator', A: 'Practitioner' }
    },
    es: {
      back: '← Volver', typeLabel: 'Tipo de aprendizaje cuántico', authenticity: 'Autenticidad de las respuestas', scoreLabel: 'Puntuación de autenticidad',
      notAssessed: 'No evaluado', noIssues: 'No se detectaron problemas evidentes',
      reasonsNote: 'Se detectaron algunos patrones de respuesta. Consulta el análisis de IA a continuación.',
      advice: 'Consejos para las familias', dims: 'Cuatro dimensiones', ai: 'Informe de orientación con IA',
      generate: '✨ Generar informe con IA', regen: 'Regenerar en el idioma actual', generating: 'Generando…',
      noAI: 'El estudiante aún no ha generado un informe con IA. Puedes generarlo aquí.',
      localNote: 'Este es un informe de plantilla local. Usa el botón de abajo para generar un análisis personalizado con IA.',
      langNote: 'Este informe está en %s. Usa el botón de abajo para regenerarlo en el idioma actual.',
      cached: 'Informe guardado cargado', error: 'No se pudo generar. Inténtalo más tarde.',
      limit: 'Se alcanzó el límite diario. Inténtalo mañana.', cooldown: 'Espera %s segundos antes de volver a generar.',
      inFlight: 'Ya se está generando un informe. Espera un momento.', notBound: 'Este estudiante no está vinculado a tu cuenta.', noReport: 'El estudiante aún no ha enviado un informe.',
      levels: { high: 'Alta confianza', medium: 'Bastante fiable', low: 'Confianza baja', very_low: 'Cuestionable' },
      adviceByLevel: {
        high: 'Las respuestas parecen naturales y auténticas. Puedes confiar en este informe.',
        medium: 'En general es fiable; conviene hablar con calma de algunos detalles.',
        low: 'La confianza es baja. Considera repetir la evaluación cuando el niño esté relajado.',
        very_low: 'Hay señales claras de respuestas apresuradas. Habla con el niño antes de usar el informe.'
      },
      dims: { PO: 'Apertura al potencial', II: 'Motivación intrínseca', LA: 'Autonomía de aprendizaje', UR: 'Respuesta a la incertidumbre' },
      suffix: { E: 'Explorador', D: 'Profundizador', I: 'Integrador', A: 'Practicante' }
    },
    pt: {
      back: '← Voltar', typeLabel: 'Tipo de aprendizagem quântica', authenticity: 'Autenticidade das respostas', scoreLabel: 'Pontuação de autenticidade',
      notAssessed: 'Não avaliado', noIssues: 'Nenhum problema evidente detectado',
      reasonsNote: 'Alguns padrões de resposta foram detectados. Veja a análise de IA abaixo.',
      advice: 'Conselhos para as famílias', dims: 'Quatro dimensões', ai: 'Relatório de orientação com IA',
      generate: '✨ Gerar relatório com IA', regen: 'Regerar no idioma atual', generating: 'Gerando…',
      noAI: 'O estudante ainda não gerou um relatório com IA. Você pode gerar aqui.',
      localNote: 'Este é um relatório modelo local. Use o botão abaixo para gerar uma análise personalizada com IA.',
      langNote: 'Este relatório está em %s. Use o botão abaixo para regerá-lo no idioma atual.',
      cached: 'Relatório salvo carregado', error: 'Falha ao gerar. Tente novamente mais tarde.',
      limit: 'Limite diário atingido. Tente novamente amanhã.', cooldown: 'Aguarde %s segundos antes de gerar novamente.',
      inFlight: 'Um relatório já está sendo gerado. Aguarde.', notBound: 'Este estudante não está vinculado à sua conta.', noReport: 'O estudante ainda não enviou um relatório.',
      levels: { high: 'Alta confiança', medium: 'Bastante confiável', low: 'Baixa confiança', very_low: 'Questionável' },
      adviceByLevel: {
        high: 'As respostas parecem naturais e autênticas. Você pode confiar neste relatório.',
        medium: 'No geral é confiável; vale conversar com calma sobre alguns detalhes.',
        low: 'A confiança é baixa. Considere refazer a avaliação quando a criança estiver relaxada.',
        very_low: 'Há sinais claros de respostas apressadas. Converse com a criança antes de usar o relatório.'
      },
      dims: { PO: 'Abertura ao potencial', II: 'Motivação intrínseca', LA: 'Autonomia de aprendizagem', UR: 'Resposta à incerteza' },
      suffix: { E: 'Explorador', D: 'Aprofundador', I: 'Integrador', A: 'Praticante' }
    },
    ko: {
      back: '← 뒤로', typeLabel: '양자 학습 유형', authenticity: '응답 진정성', scoreLabel: '진정성 점수',
      notAssessed: '평가되지 않음', noIssues: '뚜렷한 문제가 발견되지 않았습니다',
      reasonsNote: '일부 응답 패턴이 감지되었습니다. 아래 AI 분석을 참고하세요.',
      advice: '부모님께 드리는 조언', dims: '네 가지 차원', ai: 'AI 안내 보고서',
      generate: '✨ AI 보고서 생성', regen: '현재 언어로 다시 생성', generating: '생성 중…',
      noAI: '학생이 아직 AI 보고서를 생성하지 않았습니다. 여기에서 생성할 수 있습니다.',
      localNote: '현재 로컬 템플릿 보고서입니다. 아래 버튼으로 AI 맞춤 분석을 생성할 수 있습니다.',
      langNote: '현재 보고서는 %s로 작성되었습니다. 아래 버튼으로 현재 언어로 다시 생성할 수 있습니다.',
      cached: '저장된 보고서를 불러왔습니다', error: '생성에 실패했습니다. 잠시 후 다시 시도하세요.',
      limit: '오늘의 생성 한도에 도달했습니다. 내일 다시 시도하세요.', cooldown: '%s초 후에 다시 생성하세요.',
      inFlight: '이미 보고서를 생성 중입니다. 잠시 기다려 주세요.', notBound: '이 학생은 계정에 연결되어 있지 않습니다.', noReport: '학생이 아직 보고서를 제출하지 않았습니다.',
      levels: { high: '높은 신뢰도', medium: '대체로 신뢰할 수 있음', low: '낮은 신뢰도', very_low: '의심스러움' },
      adviceByLevel: {
        high: '응답이 자연스럽고 진정성 있습니다. 이 보고서를 신뢰해도 좋습니다.',
        medium: '전반적으로 신뢰할 수 있지만 몇 가지 세부 사항은 열린 마음으로 대화해 보세요.',
        low: '신뢰도가 낮습니다. 아이가 편안할 때 다시 평가해 보세요.',
        very_low: '성급하거나 대충한 응답의 흔적이 뚜렷합니다. 보고서를 사용하기 전에 아이와 대화해 보세요.'
      },
      dims: { PO: '잠재력 개방성', II: '내적 동기', LA: '학습 주도성', UR: '불확실성 대응' },
      suffix: { E: '탐구자', D: '심화자', I: '통합자', A: '실행자' }
    },
    ja: {
      back: '← 戻る', typeLabel: '量子学習タイプ', authenticity: '回答の信頼度', scoreLabel: '信頼度スコア',
      notAssessed: '未評価', noIssues: '明らかな問題は見つかりませんでした',
      reasonsNote: 'いくつかの回答パターンが検出されました。下のAI分析をご覧ください。',
      advice: '保護者の方へ', dims: '4つの次元', ai: 'AIガイダンスレポート',
      generate: '✨ AIレポートを生成', regen: '現在の言語で再生成', generating: '生成中…',
      noAI: '生徒はまだAIレポートを生成していません。ここで生成できます。',
      localNote: '現在表示されているのはローカルテンプレートです。下のボタンでAIによる個別分析を生成できます。',
      langNote: 'このレポートは%sで作成されています。下のボタンで現在の言語に再生成できます。',
      cached: '保存済みレポートを読み込みました', error: '生成に失敗しました。しばらくしてからお試しください。',
      limit: '本日の生成上限に達しました。明日もう一度お試しください。', cooldown: '%s秒後に再度生成してください。',
      inFlight: 'すでにレポートを生成中です。お待ちください。', notBound: 'この生徒はアカウントに紐付いていません。', noReport: '生徒はまだレポートを提出していません。',
      levels: { high: '高い信頼度', medium: 'ほぼ信頼できる', low: '信頼度が低い', very_low: '疑わしい' },
      adviceByLevel: {
        high: '回答は自然で正直です。このレポートを安心して参考にできます。',
        medium: '全体としては信頼できますが、いくつかの点はオープンな気持ちで話し合ってみてください。',
        low: '信頼度が低めです。子どもがリラックスしている時に再評価することを検討してください。',
        very_low: '雑な回答や早押しの痕跡が明らかです。レポートを使う前に子どもと話してみてください。'
      },
      dims: { PO: '可能性への開放性', II: '内発的動機', LA: '学習の主体性', UR: '不確実性への対応' },
      suffix: { E: '探索者', D: '深耕者', I: '統合者', A: '実践者' }
    },
    fr: {
      back: '← Retour', typeLabel: 'Type d’apprentissage quantique', authenticity: 'Authenticité des réponses', scoreLabel: 'Score d’authenticité',
      notAssessed: 'Non évalué', noIssues: 'Aucun problème évident détecté',
      reasonsNote: 'Certains schémas de réponse ont été détectés. Voir l’analyse IA ci-dessous.',
      advice: 'Conseils aux parents', dims: 'Quatre dimensions', ai: 'Rapport d’orientation IA',
      generate: '✨ Générer le rapport IA', regen: 'Régénérer dans la langue actuelle', generating: 'Génération…',
      noAI: 'L’élève n’a pas encore généré de rapport IA. Vous pouvez le faire ici.',
      localNote: 'Il s’agit d’un modèle local. Utilisez le bouton ci-dessous pour générer une analyse personnalisée par IA.',
      langNote: 'Ce rapport est en %s. Utilisez le bouton ci-dessous pour le régénérer dans la langue actuelle.',
      cached: 'Rapport enregistré chargé', error: 'Échec de la génération. Réessayez plus tard.',
      limit: 'Limite quotidienne atteinte. Réessayez demain.', cooldown: 'Veuillez attendre %s secondes avant de régénérer.',
      inFlight: 'Un rapport est déjà en cours de génération. Veuillez patienter.', notBound: 'Cet élève n’est pas lié à votre compte.', noReport: 'L’élève n’a pas encore soumis de rapport.',
      levels: { high: 'Confiance élevée', medium: 'Plutôt fiable', low: 'Faible confiance', very_low: 'Douteux' },
      adviceByLevel: {
        high: 'Les réponses semblent naturelles et authentiques. Vous pouvez vous fier à ce rapport.',
        medium: 'Globalement fiable, mais quelques points méritent une discussion ouverte avec votre enfant.',
        low: 'La confiance est faible. Envisagez de refaire l’évaluation lorsque votre enfant est détendu.',
        very_low: 'Des signes de réponses précipitées sont évidents. Parlez avec votre enfant avant d’utiliser ce rapport.'
      },
      dims: { PO: 'Ouverture au potentiel', II: 'Motivation intrinsèque', LA: 'Autonomie d’apprentissage', UR: 'Réaction à l’incertitude' },
      suffix: { E: 'Explorateur', D: 'Approfondisseur', I: 'Intégrateur', A: 'Praticien' }
    }
  };

  function currentLangName(){ return LANG_NAMES[currentLang] || currentLang; }
  function T(key){
    const d = PT[currentLang] || PT['zh-CN'];
    return d[key] != null ? d[key] : (PT['zh-CN'][key] != null ? PT['zh-CN'][key] : key);
  }
  function loadLang(){
    try {
      const v = localStorage.getItem(LANG_KEY);
      if(LANGS.includes(v)) return v;
    } catch(e){}
    return 'zh-CN';
  }
  let currentLang = loadLang();
  let currentView = 'gate';
  let lastReport = null;

  function initLangSelect(){
    const sel = $('reportLang');
    if(!sel) return;
    sel.innerHTML = LANGS.map(l => '<option value="' + l + '">' + LANG_NAMES[l] + '</option>').join('');
    sel.value = currentLang;
    if(!sel._langBound){
      sel._langBound = true;
      sel.addEventListener('change', () => setLang(sel.value));
    }
  }

  function setLang(l){
    if(!LANGS.includes(l)) l = 'zh-CN';
    currentLang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch(e){}
    const sel = $('reportLang');
    if(sel) sel.value = l;
    /* 只重绘，不触发生成；已有报告保留，用户可显式选择“用当前语言重新生成” */
    if(currentView === 'report' && lastReport){
      renderReportView(lastReport.res, lastReport.validity, lastReport.aiReport, lastReport.updatedAt, lastReport.extra);
    } else if(currentView === 'admin' && currentParent && currentParent.role === 'admin'){
      renderAdminDashboard();
    } else if(currentView === 'dashboard' && currentParent){
      renderDashboard();
    } else {
      renderGate();
    }
  }

  let isGenerating = false;

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
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
              <input name="identifier" type="text" placeholder="your@email.com" autocomplete="username" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="password">
              <label>密码</label>
              <input name="password" type="password" placeholder="输入密码" autocomplete="current-password" />
              <div class="auth-err"></div>
            </div>
            <button type="submit" class="auth-submit">登录</button>
          </form>
          <div class="auth-switch"><a data-switch="forgot">忘记密码？</a> · 还没有家长账户？<a data-switch="register">立即注册</a></div>
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

        <div class="auth-view" data-view="forgot" style="display:none;">
          <h2 class="auth-title">重置密码</h2>
          <p class="auth-subtitle">通过注册邮箱验证身份</p>
          <form data-form="forgot" autocomplete="on">
            <div class="auth-field" data-name="email">
              <label>注册邮箱</label>
              <input name="email" type="email" placeholder="your@email.com" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="code">
              <label>验证码</label>
              <div class="auth-code-row">
                <input name="code" type="text" placeholder="6 位验证码" inputmode="numeric" maxlength="6" />
                <button type="button" class="auth-send-code" data-action="send-forgot-code">发送验证码</button>
              </div>
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="password">
              <label>新密码</label>
              <input name="password" type="password" placeholder="至少 6 位" />
              <div class="auth-err"></div>
            </div>
            <div class="auth-field" data-name="confirm">
              <label>确认新密码</label>
              <input name="confirm" type="password" placeholder="再次输入新密码" />
              <div class="auth-err"></div>
            </div>
            <button type="submit" class="auth-submit">重置密码</button>
          </form>
          <div class="auth-switch"><a data-switch="login">返回登录</a></div>
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
    mask.querySelector('[data-action="send-forgot-code"]').addEventListener('click', handleSendForgotCode);
    mask.querySelector('[data-form="login"]').addEventListener('submit', handleLoginSubmit);
    mask.querySelector('[data-form="register"]').addEventListener('submit', handleRegisterSubmit);
    mask.querySelector('[data-form="forgot"]').addEventListener('submit', handleForgotSubmit);
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
    const btn2 = document.querySelector('[data-action="send-forgot-code"]');
    if(btn2){ btn2.disabled = false; btn2.textContent = '发送验证码'; }
  }
  function switchAuthView(name){
    document.querySelectorAll('#authMask .auth-view').forEach(v => v.style.display = v.dataset.view === name ? '' : 'none');
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

  async function handleSendForgotCode(){
    const form = document.querySelector('#authMask [data-form="forgot"]');
    const data = getFormData(form);
    const btn = document.querySelector('#authMask [data-action="send-forgot-code"]');
    clearFormErrors(form);

    if(!RE_EMAIL.test(data.email)){ setFieldError(form, 'email', '请先填写正确的邮箱'); return; }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '发送中…';

    try {
      const res = await fetch(API_BASE + '/api/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email })
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
      toast('无法连接服务器', 'err');
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

  async function handleForgotSubmit(e){
    e.preventDefault();
    const form = e.target;
    const data = getFormData(form);
    const btn = form.querySelector('.auth-submit');
    clearFormErrors(form);

    const errs = {};
    if(!RE_EMAIL.test(data.email)) errs.email = '邮箱格式不正确';
    if(!data.code || data.code.length !== 6) errs.code = '请输入 6 位验证码';
    if(!data.password || data.password.length < 6) errs.password = '密码至少 6 位';
    if(data.password !== data.confirm) errs.confirm = '两次密码不一致';
    
    if(Object.keys(errs).length > 0){
      Object.keys(errs).forEach(k => setFieldError(form, k, errs[k]));
      return;
    }

    btn.disabled = true;
    btn.textContent = '验证中…';

    try {
      const res = await fetch(API_BASE + '/api/parent/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, code: data.code, newPassword: data.password })
      });
      const r = await res.json();
      if(!res.ok || !r.success){
        setFieldError(form, 'code', r.error || '重置失败');
        toast(r.error || '重置失败', 'err');
        btn.disabled = false;
        btn.textContent = '重置密码';
        return;
      }
      toast('密码重置成功，请使用新密码登录', 'ok');
      setTimeout(() => { switchAuthView('login'); }, 1000);
    } catch(err){
      toast('无法连接服务器', 'err');
      btn.disabled = false;
      btn.textContent = '重置密码';
    }
  }

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
      toast('无法连接服务器', 'err');
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

    const idLower = String(data.identifier || '').trim().toLowerCase();
    if(idLower === 'administrator' || idLower === 'administrator@qbti.local'){
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        const res = await fetch(API_BASE + '/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: data.password })
        });
        const r = await res.json();
        if(!res.ok || !r.success){
          setFieldError(form, 'password', r.error || '管理员密码不正确');
          btn.disabled = false;
          btn.textContent = '登录';
          return;
        }
        const admin = Object.assign({}, r.user, { adminToken: r.token });
        saveSession(admin);
        currentParent = admin;
        toast('管理员已登录', 'ok');
        setTimeout(() => { closeAuth(); renderHome(); }, 300);
      } catch(err){
        toast('无法连接服务器', 'err');
        btn.disabled = false;
        btn.textContent = '登录';
      }
      return;
    }

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

  function renderHome(){
    if(!currentParent){ navTag.textContent = '未登录'; renderGate(); return; }
    if(currentParent.role === 'admin'){
      if(!currentParent.adminToken){
        clearSession();
        currentParent = null;
        renderGate();
        return;
      }
      navTag.textContent = 'ADMIN';
      renderAdminDashboard();
      return;
    }
    navTag.textContent = currentParent.username;
    renderDashboard();
  }

  function renderGate(){
    currentView = 'gate';
    lastReport = null;
    app.innerHTML = `
      <div class="card gate">
        <h1>QBTI 家长端</h1>
        <p>登录家长账户后，即可查看孩子的量子态报告。</p>
        <button id="btnShowLogin" style="max-width:200px;margin:0 auto 12px;display:block;">登录家长账户</button>
        <button id="btnShowRegister" style="max-width:200px;margin:0 auto;display:block;background:transparent;border:1px solid rgba(255,255,255,.14);color:#fff;">注册家长账户</button>
      </div>
    `;
    $('btnShowLogin').addEventListener('click', () => openAuth('login'));
    $('btnShowRegister').addEventListener('click', () => openAuth('register'));
  }

  /* ---------- 管理员控制台（家长端最高权限） ---------- */
  function adminHeaders(){
    return (currentParent && currentParent.adminToken) ? { 'Authorization': 'Bearer ' + currentParent.adminToken } : {};
  }
  function adminExpired(){
    clearSession();
    currentParent = null;
    currentView = 'gate';
    toast('管理员登录已过期，请重新登录', 'err');
    renderHome();
  }
  async function adminFetch(path, opts){
    if(!currentParent || !currentParent.adminToken) throw new Error('NO_ADMIN');
    const headers = Object.assign({}, (opts && opts.headers) || {}, adminHeaders());
    const res = await fetch(API_BASE + path, Object.assign({}, opts || {}, { headers }));
    if(res.status === 401){ adminExpired(); return null; }
    return res;
  }
  async function adminHealthCheck(){
    const out = $('adminHealthOut');
    if(out) out.textContent = '检查中…';
    try {
      const r = await fetch(API_BASE + '/api/health');
      const d = await r.json();
      if(out) out.textContent = 'HTTP OK · 邮件 ' + (d.mailer ? '已配置' : '未配置') + ' · 数据库 ' + (d.database || '未知');
    } catch(e){ if(out) out.textContent = '健康检查失败'; }
  }
  async function renderAdminDashboard(){
    if(!currentParent || currentParent.role !== 'admin'){ renderHome(); return; }
    currentView = 'admin';
    lastReport = null;
    navTag.textContent = 'ADMIN';
    app.innerHTML = `
      <div class="topbar">
        <div class="user-chip"><span class="avatar">A</span><span>Administrator</span><span class="admin-badge">ADMIN</span></div>
        <button class="logout-btn" id="btnLogout">退出登录</button>
      </div>
      <div class="admin-stat-grid" id="adminStats"><div class="empty-state">加载中…</div></div>
      <div class="admin-policy">
        <div class="admin-policy-head"><span>学生端管理员 · Administrator</span><span class="admin-policy-status" id="adminPolicyStatus">加载中…</span></div>
        <div class="admin-policy-row">
          <label><input type="checkbox" id="adminPolicyEnabled" /> 启用学生端管理员</label>
          <button class="unbind-btn" id="adminPolicySave">保存状态</button>
        </div>
        <div class="admin-policy-row">
          <input id="adminPolicyPwd" type="password" class="admin-search" placeholder="重置学生端管理员密码（至少 6 位）" />
          <button class="unbind-btn" id="adminPolicyPwdBtn">重置密码</button>
        </div>
        <div class="admin-policy-note" id="adminPolicyNote">学生端 Administrator 的登录与权限由此处控制；停用后学生端管理员无法登录，已登录会话会在下一次校验时失效。</div>
      </div>
      <div class="admin-policy">
        <div class="admin-policy-head"><span>学生端管理员 · 全部问卷记录</span><span class="admin-policy-status" id="adminStudentReportStatus">加载中…</span></div>
        <div class="admin-policy-note" id="adminStudentReportInfo">学生端管理员每次完成问卷都会同步一条记录；家长端管理员可逐条查看或代生成 AI 报告。</div>
        <div class="admin-record-list" id="adminStudentRecordList"><div class="empty-state">加载中…</div></div>
      </div>
      <div class="admin-toolbar">
        <input id="adminSearch" class="admin-search" placeholder="搜索学生邮箱 / 用户名" />
        <button class="add-student-btn" id="adminRefresh">刷新</button>
        <button class="unbind-btn" id="adminHealth">服务器健康</button>
      </div>
      <div id="adminHealthOut" class="admin-health"></div>
      <div id="adminList" class="student-list"><div class="empty-state">加载中…</div></div>
      <div class="empty-state" style="padding-top:8px;font-size:12px;line-height:1.8;">最高权限：查看任意学生报告、代生成 AI 报告、清除 AI 缓存。</div>
    `;
    $('btnLogout').addEventListener('click', () => {
      if(!confirm('退出管理员登录？')) return;
      clearSession();
      currentParent = null;
      renderHome();
    });
    $('adminRefresh').addEventListener('click', () => loadAdminData($('adminSearch').value));
    $('adminHealth').addEventListener('click', adminHealthCheck);
    $('adminPolicySave').addEventListener('click', saveStudentAdminPolicy);
    $('adminPolicyPwdBtn').addEventListener('click', resetStudentAdminPassword);
    let timer = null;
    $('adminSearch').addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => loadAdminData(e.target.value), 250);
    });
    loadAdminData('');
    loadStudentAdminPolicy();
    loadStudentAdminRecords();
  }
  async function loadStudentAdminPolicy(){
    const status = $('adminPolicyStatus');
    const note = $('adminPolicyNote');
    try {
      const res = await adminFetch('/api/admin/student-admin');
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '读取失败');
      const p = data.policy || {};
      if($('adminPolicyEnabled')) $('adminPolicyEnabled').checked = !!p.enabled;
      if(status){
        status.textContent = p.enabled ? '已启用' : '已停用';
        status.className = 'admin-policy-status ' + (p.enabled ? 'on' : 'off');
      }
      if(note) note.textContent = '最近更新：' + (p.updatedAt ? formatTime(p.updatedAt) : '—') + ' · 操作人：' + (p.updatedBy || '—');
    } catch(err){
      if(status) status.textContent = '读取失败';
      if(note) note.textContent = err.message || '读取失败';
    }
  }
  async function saveStudentAdminPolicy(){
    const enabled = !!($('adminPolicyEnabled') && $('adminPolicyEnabled').checked);
    try {
      const res = await adminFetch('/api/admin/student-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '保存失败');
      toast(enabled ? '学生端管理员已启用' : '学生端管理员已停用', 'ok');
      loadStudentAdminPolicy();
    } catch(err){ toast(err.message || '保存失败', 'err'); }
  }
  async function resetStudentAdminPassword(){
    const inp = $('adminPolicyPwd');
    const pwd = inp ? inp.value.trim() : '';
    if(pwd.length < 6){ toast('密码至少 6 位', 'err'); return; }
    if(!confirm('重置学生端管理员密码？已登录的学生端管理员会被强制下线。')) return;
    try {
      const res = await adminFetch('/api/admin/student-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '重置失败');
      if(inp) inp.value = '';
      toast('学生端管理员密码已重置', 'ok');
      loadStudentAdminPolicy();
    } catch(err){ toast(err.message || '重置失败', 'err'); }
  }
  async function loadStudentAdminRecords(){
    const status = $('adminStudentReportStatus');
    const info = $('adminStudentReportInfo');
    const listEl = $('adminStudentRecordList');
    try {
      const res = await adminFetch('/api/admin/student-admin-records');
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '读取失败');
      const rows = data.list || [];
      if(status){
        status.textContent = rows.length ? (rows.length + ' 条') : '暂无记录';
        status.className = 'admin-policy-status ' + (rows.length ? 'on' : 'off');
      }
      if(info) info.textContent = '学生端管理员每次完成问卷都会同步一条记录；可逐条查看或代生成 AI 报告。';
      if(!listEl) return;
      if(rows.length === 0){
        listEl.innerHTML = '<div class="empty-state">还没有同步记录。学生端管理员完成一次问卷后会自动出现。</div>';
        return;
      }
      listEl.innerHTML = rows.map(r => {
        const code = r.code || '—';
        const date = r.quizTs ? formatTime(r.quizTs) : (r.createdAt ? formatTime(r.createdAt) : '—');
        const ai = r.hasAI ? ((r.aiSource === 'local') ? '本地模板' : ('AI ' + (r.aiLang || 'zh-CN'))) : 'AI 未生成';
        return '<div class="admin-record">'
          + '<div class="admin-record-main"><b>' + escapeHTML(code) + '</b><span>' + escapeHTML(date) + ' · ' + escapeHTML(ai) + '</span></div>'
          + '<div class="admin-student-actions">'
          + '<button data-record-act="view" data-id="' + r.id + '">查看</button>'
          + '<button data-record-act="gen" data-id="' + r.id + '">代生成 AI</button>'
          + '</div></div>';
      }).join('');
      listEl.querySelectorAll('button[data-record-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if(btn.dataset.recordAct === 'view') showAdminRecord(id);
          if(btn.dataset.recordAct === 'gen') adminGenerateRecord(id, btn);
        });
      });
    } catch(err){
      if(status){ status.textContent = '读取失败'; status.className = 'admin-policy-status off'; }
      if(info) info.textContent = err.message || '读取失败';
      if(listEl) listEl.innerHTML = '<div class="empty-state" style="color:#FF8FA0;">' + escapeHTML(err.message || '读取失败') + '</div>';
    }
  }

  async function adminGenerateRecord(id, btn){
    if(btn){ btn.disabled = true; btn.textContent = '生成中…'; }
    try {
      const res = await fetch(API_BASE + '/api/admin/student-admin-record/' + encodeURIComponent(id) + '/generate', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, adminHeaders()),
        body: JSON.stringify({ lang: currentLang })
      });
      if(res.status === 401){ adminExpired(); return; }
      const data = await res.json().catch(() => ({}));
      if(!res.ok || !data.success) throw new Error(aiErrorText(data));
      toast(data.cached ? '已读取现有 AI 报告' : 'AI 报告已生成', 'ok');
      loadStudentAdminRecords();
    } catch(err){
      toast(err.message || '生成失败', 'err');
      if(btn){ btn.disabled = false; btn.textContent = '代生成 AI'; }
    }
  }

  async function showAdminRecord(id){
    currentView = 'adminReport';
    app.innerHTML = '<div class="empty-state">正在加载记录…</div>';
    try {
      const res = await adminFetch('/api/admin/student-admin-record/' + encodeURIComponent(id));
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '加载失败');
      const p = data.record.payload || {};
      const fullResult = p.fullResult || {
        letters: p.baseCode ? p.baseCode.split('') : [],
        suffix: { letter: p.suffixLetter || 'E', name: p.suffixName || '' },
        dimGroupRatio: p.dimGroupRatio || {}, dimLeadInfo: p.dimLeadInfo || {},
        suffixRatio: p.suffixRatio || {}, suffixGap: p.suffixGap || 0, dominanceScore: {}
      };
      const extra = Object.assign({}, p, {
        studentEmail: 'administrator@qbti.local',
        aiReportLang: p.aiReportLang || null,
        aiReportSource: p.aiReportSource || 'ai',
        adminView: true,
        recordId: Number(id)
      });
      renderReportView(fullResult, p.validity, p.aiReport, data.record.quizTs || data.record.createdAt, extra);
    } catch(err){
      app.innerHTML = '<button class="back-btn" id="btnBack">← 返回</button><div class="card" style="text-align:center;color:#FF8FA0;">加载失败：' + escapeHTML(err.message) + '</div>';
      $('btnBack').addEventListener('click', renderAdminDashboard);
    }
  }

  async function loadAdminData(q){
    try {
      const [ovRes, listRes] = await Promise.all([
        adminFetch('/api/admin/overview'),
        adminFetch('/api/admin/students?q=' + encodeURIComponent(q || ''))
      ]);
      if(!ovRes || !listRes) return;
      const ov = await ovRes.json();
      const ls = await listRes.json();
      if(!ov.success || !ls.success) throw new Error(ov.error || ls.error || '加载失败');
      const o = ov.overview || {};
      const stats = [
        ['家长', o.parents], ['学生', o.students], ['绑定', o.bindings],
        ['报告', o.reports], ['AI 报告', o.aiReports], ['今日 AI', o.todayAI]
      ];
      const statEl = $('adminStats');
      if(statEl) statEl.innerHTML = stats.map(([k, v]) =>
        '<div class="admin-stat"><b>' + (Number(v) || 0) + '</b><span>' + k + '</span></div>'
      ).join('');
      const el = $('adminList');
      if(!el) return;
      const rows = ls.list || [];
      if(rows.length === 0){ el.innerHTML = '<div class="empty-state">没有匹配的学生。</div>'; return; }
      el.innerHTML = rows.map(s => {
        const name = s.username || s.email;
        const init = String(name).slice(0, 1).toUpperCase();
        const report = s.reportUpdatedAt ? ('报告更新：' + formatTime(s.reportUpdatedAt)) : '暂无报告';
        const ai = s.hasAI ? ('AI：' + (s.aiLang || 'zh-CN')) : 'AI：未生成';
        return '<div class="student-card">'
          + '<div class="sc-head">'
          +   '<div class="sc-avatar">' + escapeHTML(init) + '</div>'
          +   '<div class="sc-info"><div class="sc-name">' + escapeHTML(name) + '</div><div class="sc-meta">' + escapeHTML(s.email) + ' · 绑定 ' + (Number(s.boundCount) || 0) + ' 位家长</div></div>'
          +   '<span class="sc-badge ' + (s.hasAI ? '' : 'empty') + '">' + (s.hasAI ? 'AI 已生成' : '无 AI') + '</span>'
          + '</div>'
          + '<div class="sc-meta" style="margin-top:8px;">' + escapeHTML(report) + ' · ' + escapeHTML(ai) + '</div>'
          + '<div class="admin-student-actions">'
          +   (s.reportUpdatedAt ? '<button data-act="view" data-email="' + escapeHTML(s.email) + '">查看报告</button>' : '')
          +   (s.hasAI ? '<button data-act="clear" data-email="' + escapeHTML(s.email) + '">清除 AI 缓存</button>' : '')
          + '</div>'
          + '</div>';
      }).join('');
      el.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.dataset.email;
          if(btn.dataset.act === 'view') showAdminReport(email);
          if(btn.dataset.act === 'clear') adminClearAI(email);
        });
      });
    } catch(err){
      const el = $('adminList');
      if(el) el.innerHTML = '<div class="empty-state" style="color:#FF8FA0;">' + escapeHTML(err.message || '加载失败') + '</div>';
    }
  }
  async function adminClearAI(email){
    if(!confirm('清除 ' + email + ' 的 AI 报告缓存？')) return;
    try {
      const res = await adminFetch('/api/admin/clear-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentEmail: email })
      });
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '清除失败');
      toast('已清除 AI 缓存', 'ok');
      loadAdminData($('adminSearch') ? $('adminSearch').value : '');
    } catch(err){ toast(err.message || '清除失败', 'err'); }
  }
  async function showAdminReport(email){
    currentView = 'adminReport';
    app.innerHTML = '<div class="empty-state">正在加载报告…</div>';
    try {
      const res = await adminFetch('/api/admin/report/' + encodeURIComponent(email));
      if(!res) return;
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '加载失败');
      const p = data.report.payload || {};
      const fullResult = p.fullResult || {
        letters: p.baseCode ? p.baseCode.split('') : [],
        suffix: { letter: p.suffixLetter || 'E', name: p.suffixName || '' },
        dimGroupRatio: p.dimGroupRatio || {}, dimLeadInfo: p.dimLeadInfo || {},
        suffixRatio: p.suffixRatio || {}, suffixGap: p.suffixGap || 0, dominanceScore: {}
      };
      const extra = Object.assign({}, p, {
        studentEmail: data.report.studentEmail || email,
        aiReportLang: p.aiReportLang || null,
        aiReportSource: p.aiReportSource || 'ai',
        adminView: true
      });
      renderReportView(fullResult, p.validity, p.aiReport, data.report.updatedAt, extra);
    } catch(err){
      app.innerHTML = '<button class="back-btn" id="btnBack">← 返回</button><div class="card" style="text-align:center;color:#FF8FA0;">加载失败：' + escapeHTML(err.message) + '</div>';
      $('btnBack').addEventListener('click', renderAdminDashboard);
    }
  }

  async function renderDashboard(){
    currentView = 'dashboard';
    lastReport = null;
    app.innerHTML = `
      <div class="topbar">
        <div class="user-chip">
          <span class="avatar">${escapeHTML((currentParent.username||'?').slice(0,1).toUpperCase())}</span>
          <span>${escapeHTML(currentParent.username)}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="unbind-btn" id="btnAccountInfo">账户信息</button>
          <button class="logout-btn" id="btnLogout">退出登录</button>
        </div>
      </div>
      <div class="topbar" style="margin-bottom:24px;">
        <div style="font-size:13px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;">已绑定的孩子</div>
        <button class="add-student-btn" id="btnAddStudent">+ 绑定孩子</button>
      </div>
      <div class="student-list" id="studentList">
        <div class="empty-state">正在加载…</div>
      </div>
    `;
    
    $('btnLogout').addEventListener('click', () => {
      if(!confirm('确定要退出登录吗？')) return;
      clearSession(); 
      renderHome(); 
    });
    $('btnAccountInfo').addEventListener('click', openAccountInfo);
    
    $('btnAddStudent').addEventListener('click', openBindDialog);

    loadBoundStudents();
  }

  function openAccountInfo(){
    if(!currentParent || currentParent.role === 'admin') return;
    const old = document.getElementById('accountMask');
    if(old) old.remove();
    const mask = document.createElement('div');
    mask.className = 'auth-mask show';
    mask.id = 'accountMask';
    mask.innerHTML = `
      <div class="auth-modal">
        <button class="auth-close" type="button" aria-label="关闭">×</button>
        <h2 class="auth-title">账户信息</h2>
        <p class="auth-subtitle">管理你的家长账户</p>
        <div class="account-info">
          <div class="account-row"><span>邮箱</span><b>${escapeHTML(currentParent.email)}</b></div>
          <div class="account-row"><span>用户名</span><b>${escapeHTML(currentParent.username || '—')}</b></div>
          <div class="account-row"><span>手机号</span><b>${escapeHTML(currentParent.phone || '—')}</b></div>
        </div>
        <button type="button" class="account-delete-btn" id="accountDeleteBtn">注销账户</button>
      </div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector('.auth-close').addEventListener('click', close);
    mask.addEventListener('click', e => { if(e.target === mask) close(); });
    mask.querySelector('#accountDeleteBtn').addEventListener('click', () => showParentDeleteForm(mask));
  }

  function showParentDeleteForm(mask){
    const email = currentParent.email;
    const modal = mask.querySelector('.auth-modal');
    modal.innerHTML = `
      <button class="auth-close" type="button" aria-label="关闭">×</button>
      <h2 class="auth-title">注销账户</h2>
      <p class="auth-subtitle">将永久删除该家长账户的注册信息、绑定关系与 AI 用量；该邮箱之后可以重新注册。</p>
      <div class="auth-field"><label>输入账户邮箱确认</label><input id="pDelEmail" type="text" placeholder="${escapeHTML(email)}" autocomplete="off" /></div>
      <div class="auth-field"><label>密码</label><input id="pDelPwd" type="password" placeholder="输入当前密码" autocomplete="current-password" /></div>
      <label class="account-check"><input type="checkbox" id="pDelCheck" /> 我已知晓：注销后不可恢复</label>
      <button type="button" class="account-delete-btn" id="pDelConfirm" disabled>永久注销</button>
      <div class="account-err" id="pDelErr"></div>`;
    const close = () => mask.remove();
    modal.querySelector('.auth-close').addEventListener('click', close);
    const check = modal.querySelector('#pDelCheck');
    const btn = modal.querySelector('#pDelConfirm');
    const err = modal.querySelector('#pDelErr');
    check.addEventListener('change', () => { btn.disabled = !check.checked; });
    btn.addEventListener('click', async () => {
      const typed = String(modal.querySelector('#pDelEmail').value || '').trim();
      const pwd = String(modal.querySelector('#pDelPwd').value || '');
      err.textContent = '';
      if(typed.toLowerCase() !== email.toLowerCase()){ err.textContent = '邮箱与当前账户不一致'; return; }
      if(!pwd){ err.textContent = '请输入密码'; return; }
      if(!confirm('最后一次确认：永久注销该家长账户？此操作不可恢复。')) return;
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/api/parent/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pwd })
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok || !data.success){
          err.textContent = data.error || '注销失败';
          btn.disabled = false;
          return;
        }
        mask.remove();
        try { localStorage.removeItem('qparent_report_lang_v1'); } catch(e){}
        currentLang = 'zh-CN';
        const sel = document.getElementById('reportLang');
        if(sel) sel.value = 'zh-CN';
        clearSession();
        currentParent = null;
        lastReport = null;
        currentView = 'gate';
        toast('账户已注销', 'ok');
        renderHome();
      } catch(e){
        err.textContent = '无法连接服务器';
        btn.disabled = false;
      }
    });
  }

  async function loadBoundStudents(){
    try {
      const res = await fetch(API_BASE + '/api/parent/students?email=' + encodeURIComponent(currentParent.email));
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.error || '加载失败');
      
      const el = $('studentList');
      const list = data.list || [];
      if(list.length === 0){
        el.innerHTML = '<div class="empty-state">还没有绑定任何孩子。</div>';
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
    if(!confirm('确定要解除与该孩子的绑定吗？')) return;
    
    try {
      await fetch(API_BASE + '/api/bind/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentEmail, parentEmail: currentParent.email })
      });
      toast('已解除绑定', 'ok');
      renderDashboard();
    } catch(err){ toast('解绑失败', 'err'); }
  }

  function openBindDialog(prefillCode){
    const old = document.getElementById('bindMask');
    if(old) old.remove();
    if(html5QrcodeScanner) { try { html5QrcodeScanner.clear(); } catch(e){} html5QrcodeScanner = null; }

    const mask = document.createElement('div');
    mask.id = 'bindMask';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(3,4,12,.86);backdrop-filter:blur(10px);z-index:300;display:grid;place-items:center;padding:20px;';
    mask.innerHTML = `
      <div style="width:100%;max-width:400px;padding:30px 26px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:#0B0D1C;text-align:center;">
        <div style="font-size:11px;letter-spacing:.22em;color:var(--muted);text-transform:uppercase;margin-bottom:14px;">Bind Child · 绑定孩子</div>
        <button id="btnStartScan" class="scan-btn" style="width:100%;padding:12px;border-radius:11px;border:1px dashed var(--q-color);background:rgba(var(--q-r),var(--q-g),var(--q-b),.08);color:var(--q-color);font-size:14px;font-weight:600;cursor:pointer;margin-bottom:16px;">📷 打开摄像头扫码</button>
        <div id="reader-container" style="display:none;"><div id="reader"></div><button id="btnStopScan" style="width:100%;padding:10px;background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer;">取消扫码</button></div>
        <input id="bindCodeInput" type="text" maxlength="6" placeholder="ABC123" style="width:100%;padding:14px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#fff;font-size:20px;font-weight:700;letter-spacing:.24em;text-align:center;text-transform:uppercase;margin-bottom:14px;" />
        <div id="bindErr" style="color:#FF8FA0;font-size:13px;min-height:18px;margin-bottom:10px;"></div>
        <div style="display:flex;gap:10px;">
          <button id="bindCancel" style="flex:1;padding:11px;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:transparent;color:var(--muted);">取消</button>
          <button id="bindSubmit" style="flex:1;padding:11px;border-radius:11px;border:0;background:var(--q-color);color:#fff;">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const input = $('bindCodeInput');
    const err = $('bindErr');
    if(prefillCode) input.value = prefillCode; else input.focus();

    $('btnStartScan').addEventListener('click', () => { 
      if (!window.Html5Qrcode) return err.textContent = '扫码库未加载';
      $('btnStartScan').style.display = 'none';
      $('reader-container').style.display = 'block';
      html5QrcodeScanner = new Html5Qrcode("reader");
      html5QrcodeScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (txt) => {
        stopScan();
        let c = txt;
        if (txt.includes('code=')) { try { c = new URL(txt).searchParams.get('code') || txt; } catch(e){} }
        if(/^[A-Z0-9]{6}$/i.test(c)) { input.value = c.toUpperCase(); submit(); } else { err.textContent = '二维码无效'; }
      }, ()=>{});
    });
    
    function stopScan(){
      if(html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(()=>{ html5QrcodeScanner.clear(); html5QrcodeScanner = null; $('btnStartScan').style.display = 'flex'; $('reader-container').style.display = 'none'; });
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
      $('bindSubmit').disabled = true; $('bindSubmit').textContent = '...';
      try {
        const res = await fetch(API_BASE + '/api/bind/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentEmail: currentParent.email, code })
        });
        const r = await res.json();
        if(!res.ok || !r.success) throw new Error(r.error || '绑定失败');
        stopScan(); mask.remove(); toast('绑定成功', 'ok'); renderDashboard();
      } catch(e){
        err.textContent = e.message;
        $('bindSubmit').disabled = false; $('bindSubmit').textContent = '确认';
      }
    }
  }

  function setAccent(quantumState){
    const map = { good:[80,220,140], danger:[235,65,75], superposition:[90,140,245] };
    const c = map[quantumState] || [255,138,72];
    document.documentElement.style.setProperty('--q-r', c[0]);
    document.documentElement.style.setProperty('--q-g', c[1]);
    document.documentElement.style.setProperty('--q-b', c[2]);
    document.documentElement.style.setProperty('--q-color', 'rgb(' + c.join(',') + ')');
  }

  const DIM_COLORS = { PO:{X:'#7C5CFF',C:'#4A9EFF',A:'#00E5FF'}, II:{U:'#FF6B9D',P:'#FFA94D',M:'#FFD93D'}, LA:{I:'#6BCB77',D:'#4ECDC4',E:'#45B7D1'}, UR:{T:'#FF6B6B',H:'#C77DFF',R:'#F7B801'} };
  const DIM_LETTERS = { PO:['X','C','A'], II:['U','P','M'], LA:['I','D','E'], UR:['T','H','R'] };
  const DIM_NAMES = { PO:'潜能开放度', II:'内在驱动力', LA:'学习自主性', UR:'未知应对方式' };

  async function showSyncedReport(studentEmail){
    app.innerHTML = '<div class="empty-state">正在加载报告…</div>';
    try {
      const res = await fetch(API_BASE + '/api/parent/report/' + encodeURIComponent(studentEmail) + '?parentEmail=' + encodeURIComponent(currentParent.email));
      if(!res.ok) { const d = await res.json(); throw new Error(d.error || '加载失败'); }
      const data = await res.json();

      const p = data.report.payload || {};
      const fullResult = p.fullResult || {
        letters: p.baseCode ? p.baseCode.split('') : [],
        suffix: { letter: p.suffixLetter || 'E', name: p.suffixName || '' },
        dimGroupRatio: p.dimGroupRatio || {}, dimLeadInfo: p.dimLeadInfo || {},
        suffixRatio: p.suffixRatio || {}, suffixGap: p.suffixGap || 0, dominanceScore: {}
      };
      const extra = Object.assign({}, p, {
        studentEmail: data.report.studentEmail || studentEmail,
        aiReportLang: p.aiReportLang || null
      });
      renderReportView(fullResult, p.validity, p.aiReport, data.report.updatedAt, extra);
    } catch(err){
      currentView = 'dashboard';
      app.innerHTML = `<button class="back-btn" id="btnBack">${escapeHTML(T('back'))}</button><div class="card" style="text-align:center;color:#FF8FA0;">${escapeHTML(T('error'))}: ${escapeHTML(err.message)}</div>`;
      $('btnBack').addEventListener('click', renderDashboard);
    }
  }

  function renderMD(text){
    let h = escapeHTML(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/^#{1,3}\s*(.+)$/gm,'<h4>$1</h4>').replace(/(?:^[-•▸]\s+.+$\n?)+/gm, m => '<ul>' + m.replace(/^[-•▸]\s+(.+)$/gm,'<li>$1</li>') + '</ul>');
    return h.split(/\n{2,}/).map(p => { const t = p.trim(); if(!t) return ''; if(/^<(h4|ul|li)/.test(t)) return t; return '<p>' + t.replace(/\n/g,'<br>') + '</p>'; }).join('');
  }

  function localizedReasons(validity){
    if(!validity) return '▸ ' + escapeHTML(T('noIssues'));
    if(currentLang === 'zh-CN' || currentLang === 'zh-TW'){
      const arr = (validity.parentReasons && validity.parentReasons.length) ? validity.parentReasons : [T('noIssues')];
      return arr.map(r => '▸ ' + escapeHTML(r)).join('<br>');
    }
    return '▸ ' + escapeHTML(T('reasonsNote'));
  }

  function aiErrorText(data){
    const code = data && data.code;
    if(code === 'COOLDOWN') return T('cooldown').replace('%s', data.wait || 60);
    if(code === 'DAILY_LIMIT') return T('limit');
    if(code === 'IN_FLIGHT') return T('inFlight');
    if(code === 'NOT_BOUND') return T('notBound');
    if(code === 'NO_REPORT') return T('noReport');
    return (data && data.error) || T('error');
  }

  async function generateAIReport(studentEmail, btn, adminView, recordId){
    if(isGenerating) return;
    if(!studentEmail){ toast(T('noReport'), 'err'); return; }
    const wasRegen = !!(lastReport && lastReport.aiReport && (lastReport.extra.aiReportSource || 'ai') === 'ai');
    isGenerating = true;
    if(btn){
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + escapeHTML(T('generating'));
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if(adminView) Object.assign(headers, adminHeaders());
      let apiUrl = API_BASE + '/api/generate-ai-report';
      let requestBody;
      if(recordId){
        apiUrl = API_BASE + '/api/admin/student-admin-record/' + encodeURIComponent(recordId) + '/generate';
        requestBody = { lang: currentLang };
      } else if(adminView){
        requestBody = { studentEmail, lang: currentLang };
      } else {
        requestBody = { parentEmail: currentParent.email, studentEmail, lang: currentLang };
      }
      const apiRes = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
      if((adminView || recordId) && apiRes.status === 401){ adminExpired(); return; }
      const apiData = await apiRes.json().catch(() => ({}));
      if(!apiRes.ok || !apiData.success) throw new Error(aiErrorText(apiData));
      if(apiData.cached) toast(T('cached'), 'info');

      if(lastReport){
        lastReport.aiReport = apiData.text;
        lastReport.aiReportLang = apiData.lang || currentLang;
        lastReport.aiReportSource = 'ai';
        lastReport.extra.aiReportLang = lastReport.aiReportLang;
        lastReport.extra.aiReportSource = 'ai';
        lastReport.extra.studentEmail = studentEmail;
        lastReport.updatedAt = Date.now();
        renderReportView(lastReport.res, lastReport.validity, apiData.text, lastReport.updatedAt, lastReport.extra);
      } else {
        await showSyncedReport(studentEmail);
      }
    } catch(err){
      toast(err.message || T('error'), 'err');
      if(btn){
        btn.disabled = false;
        btn.textContent = wasRegen ? T('regen') : T('generate');
      }
    } finally {
      isGenerating = false;
    }
  }

  function renderReportView(res, validity, aiReportText, updatedAt, extraData){
    const lang = currentLang;
    const adminView = !!(extraData && extraData.adminView);
    const recordId = (extraData && extraData.recordId) || null;
    const pack = PT[lang] || PT['zh-CN'];
    const baseCode = res.letters.join('');
    const typeName = (lang === 'zh-CN' || lang === 'zh-TW') ? (Q.TYPE_NAMES[baseCode] || '') : '';
    const suffixLetter = (res.suffix && res.suffix.letter) || '';
    const suffixName = (pack.suffix && pack.suffix[suffixLetter]) || (res.suffix && res.suffix.name) || '';
    const safeStudentEmail = (extraData && extraData.studentEmail) || '';
    /* 旧报告没有 aiReportLang 时按中文处理，避免英文界面误以为语言已一致 */
    const reportLang = (extraData && extraData.aiReportLang) || (aiReportText ? 'zh-CN' : null);
    const reportSource = (extraData && extraData.aiReportSource) || 'ai';

    currentView = 'report';
    lastReport = {
      res: res, validity: validity, aiReport: aiReportText || null,
      updatedAt: updatedAt,
      extra: Object.assign({}, extraData || {}, { studentEmail: safeStudentEmail, aiReportLang: reportLang, aiReportSource: reportSource })
    };

    setAccent(res.dominanceScore && Object.keys(res.dominanceScore).length > 0 ? Q.analyzeQuantumState(res).type : ((extraData && extraData.quantumState) || 'superposition'));

    const vColorMap = { high:'#50DC8C', medium:'#FFD98A', low:'#FF8A48', very_low:'#EB414B' };
    const vColor = validity ? (vColorMap[validity.level] || '#8B90B8') : '#8B90B8';
    const levelText = validity ? (pack.levels[validity.level] || validity.levelText || pack.notAssessed) : pack.notAssessed;
    const reasons = localizedReasons(validity);
    const advice = validity ? (pack.adviceByLevel[validity.level] || '') : '';
    const dimsHTML = Q.DIMS.map(d => {
      const ratio = res.dimGroupRatio[d.id] || {}; const info = res.dimLeadInfo[d.id] || { lead: '-' };
      const dimName = (pack.dims && pack.dims[d.id]) || d.name;
      return `<div class="dim-row"><div class="dim-name">${escapeHTML(dimName)}</div><div class="dim-bar">${d.letters.map(l => `<div class="seg" style="width:${ratio[l]||0}%;background:${DIM_COLORS[d.id][l]};">${ratio[l]>=10?l:''}</div>`).join('')}</div><div class="dim-lead">${info.lead}</div></div>`;
    }).join('');

    const hasText = !!aiReportText;
    const isRealAI = hasText && reportSource === 'ai';
    const langMismatch = isRealAI && reportLang && reportLang !== lang;
    let aiHTML = '';
    if(hasText) aiHTML += renderMD(aiReportText);
    if(!isRealAI){
      aiHTML += `<div style="text-align:center;padding:20px 0;">
        <div style="color:var(--muted);font-size:13px;margin-bottom:14px;">${escapeHTML(hasText ? pack.localNote : pack.noAI)}</div>
        <button class="ai-gen-btn" id="btnGenAI" data-student="${escapeHTML(safeStudentEmail)}">${escapeHTML(pack.generate)}</button>
      </div>`;
    } else if(langMismatch){
      aiHTML += `<div class="ai-lang-note">${escapeHTML(pack.langNote.replace('%s', LANG_NAMES[reportLang] || reportLang))}</div>
        <div style="text-align:center;padding:8px 0 0;"><button class="ai-gen-btn" id="btnGenAI" data-student="${escapeHTML(safeStudentEmail)}">${escapeHTML(pack.regen)}</button></div>`;
    }

    app.innerHTML = `
      <button class="back-btn" id="btnBack">${escapeHTML(pack.back)}</button>
      <div class="hero">
        <div class="code">${baseCode}<span style="font-size:0.7em;color:var(--q-color)">-${suffixLetter}</span></div>
        <div class="name">${typeName ? escapeHTML(typeName) + ' · ' : ''}${escapeHTML(suffixName)}</div>
        <div class="sub">${escapeHTML(pack.typeLabel)}</div>
      </div>
      <div class="title">${escapeHTML(pack.authenticity)}</div>
      <div class="card" style="border-color:${vColor}55;background:${vColor}0F;">
        <div class="authenticity">
          <div><div class="label">${escapeHTML(pack.scoreLabel)}</div><div class="level" style="color:${vColor};">● ${escapeHTML(levelText)}</div></div>
          <div class="score" style="color:${vColor};">${validity?validity.authenticity:'--'}<small> / 100</small></div>
        </div>
        <div class="reason">${reasons}</div>
        ${validity?`<div class="advice">${escapeHTML(pack.advice)} — ${escapeHTML(advice)}</div>`:''}
      </div>
      <div class="title">${escapeHTML(pack.dims)}</div>
      <div class="card">${dimsHTML}</div>
      <div class="title">${escapeHTML(pack.ai)}</div>
      <div class="card ai-body" id="aiBody">${aiHTML}</div>
      <div style="text-align:center;margin-top:24px;"><button class="btn" id="btnBackBottom">${escapeHTML(pack.back)}</button></div>
    `;

    const goBack = adminView ? renderAdminDashboard : renderDashboard;
    $('btnBack').addEventListener('click', goBack);
    $('btnBackBottom').addEventListener('click', goBack);
    const genBtn = $('btnGenAI');
    if(genBtn) genBtn.addEventListener('click', () => generateAIReport(genBtn.dataset.student, genBtn, adminView, recordId));
  }

  function init(){
    initLangSelect();
    const session = loadSession();
    if(session) currentParent = { email: session.email, phone: session.phone, username: session.username, role: session.role || 'parent', adminToken: session.adminToken || null };
    renderHome();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();