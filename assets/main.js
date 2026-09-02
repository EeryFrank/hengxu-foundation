/* ============ 表页面公共 JS：恒序基金会 ============
 * 职责：注入登录弹窗（markup 逐字沿用旧版）、backdoor 绑定、登录校验、nav 当前页高亮。
 * 依赖：assets/bbs-data.js 提供的全局量 ACCOUNTS / PASSWORD（须先于本文件引入）。
 */
(function(){
  'use strict';

  /* 登录弹窗 markup（逐字复制自旧单文件 414–430 行） */
  var MODAL_HTML = `
<div class="modal-mask" id="loginMask">
  <div class="modal" id="loginModal">
    <button class="m-close" id="loginClose">×</button>
    <h3><span class="dot"></span>工作人员登录</h3>
    <div class="m-sub">STAFF ACCESS ONLY · 非公开系统</div>
    <div class="m-field">
      <label>工号 / 账号</label>
      <input type="text" id="accInput" autocomplete="off" spellcheck="false" placeholder="请输入账号">
    </div>
    <div class="m-field">
      <label>密码</label>
      <input type="password" id="pwdInput" placeholder="请输入密码">
    </div>
    <div class="m-err" id="loginErr">账号或密码错误，请核对后重试。</div>
    <button class="m-btn" id="loginBtn">登 录</button>
  </div>
</div>
`;

  /* 详情页归入对应导航项 */
  var NAV_ALIAS = { 'project.html':'programs.html', 'article.html':'news.html', 'report.html':'disclosure.html' };

  function initNav(){
    var page = location.pathname.split('/').pop() || 'index.html';
    page = NAV_ALIAS[page] || page;
    document.querySelectorAll('.nav a').forEach(function(a){
      if(a.getAttribute('href') === page) a.classList.add('on');
    });
  }

  function initLogin(){
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

    var mask     = document.getElementById('loginMask');
    var modalEl  = document.getElementById('loginModal');
    var accInput = document.getElementById('accInput');
    var pwdInput = document.getElementById('pwdInput');
    var loginErr = document.getElementById('loginErr');

    document.getElementById('backdoor').addEventListener('click', function(){
      mask.classList.add('on'); loginErr.classList.remove('on');
      accInput.value=''; pwdInput.value=''; accInput.focus();
    });
    document.getElementById('loginClose').addEventListener('click', function(){ mask.classList.remove('on'); });
    mask.addEventListener('click', function(e){ if(e.target === mask) mask.classList.remove('on'); });

    /* Wave 2：统一走 assets/auth.js 的 AUTH.login（PBKDF2 管理员哈希 / 覆盖层 / 失败锁定）。
       auth.js 未在 html 中引入，这里动态注入加载。 */
    var _authReady = null;
    function ensureAuth(){
      if(window.AUTH) return Promise.resolve();
      if(_authReady) return _authReady;
      _authReady = new Promise(function(res, rej){
        var s = document.createElement('script');
        s.src = 'assets/auth.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      return _authReady;
    }
    var _lockIv = null;
    function showLock(){
      if(_lockIv) return;
      _lockIv = setInterval(function(){
        var r = window.AUTH ? AUTH.lockRemainSec() : 0;
        if(r > 0){ loginErr.textContent = '尝试次数过多，账号已临时锁定，请 ' + r + ' 秒后再试。'; }
        else {
          clearInterval(_lockIv); _lockIv = null;
          loginErr.textContent = '账号或密码错误，请核对后重试。';
          loginErr.classList.remove('on');
        }
      }, 500);
    }
    function tryLogin(){
      var acc = accInput.value.trim().toLowerCase();
      var pwd = pwdInput.value;
      loginErr.classList.remove('on');
      ensureAuth()
        .then(function(){ return AUTH.login(acc, pwd); })
        .then(function(){
          sessionStorage.removeItem('msb_booted');
          mask.classList.remove('on');
          location.href = 'bbs.html';
        })
        .catch(function(err){
          if(err && err.locked){
            loginErr.textContent = '尝试次数过多，账号已临时锁定，请 ' + err.remain + ' 秒后再试。';
            showLock();
          } else {
            loginErr.textContent = '账号或密码错误，请核对后重试。';
          }
          loginErr.classList.add('on');
          modalEl.classList.remove('shake'); void modalEl.offsetWidth; modalEl.classList.add('shake');
        });
    }
    document.getElementById('loginBtn').addEventListener('click', tryLogin);
    [pwdInput, accInput].forEach(function(el){
      el.addEventListener('keydown', function(e){ if(e.key === 'Enter') tryLogin(); });
    });
  }

  /* ================= 表页面内容渲染（依赖 assets/site-data.js） ================= */
  function qs(k){ return new URLSearchParams(location.search).get(k); }
  function esc(s){ return String(s).replace(/</g,'&lt;'); }

  function renderProject(){
    var nameEl = document.getElementById('pdName'); if(!nameEl) return;
    var p = (typeof SITE_DATA !== 'undefined') && SITE_DATA.projects[qs('id')];
    if(!p){
      document.getElementById('pdMeta').textContent = '404';
      nameEl.textContent = '页面不存在';
      document.getElementById('pdSlogan').textContent = '该项目可能已被移动或从未存在过。';
      document.title = '404 · 恒序基金会'; return;
    }
    document.title = p.name + ' · 恒序基金会';
    document.getElementById('pdMeta').textContent = p.idx + ' · ' + p.tag;
    nameEl.innerHTML = esc(p.name) + '<small>' + esc(p.en) + '</small>';
    document.getElementById('pdSlogan').textContent = p.slogan;
    document.getElementById('pdBody').innerHTML = p.body.map(function(t){ return '<p>' + esc(t) + '</p>'; }).join('');
    document.getElementById('pdFacts').innerHTML = p.facts.map(function(f){
      return '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>'; }).join('');
    document.getElementById('pdFactsSec').style.display = '';
    var a = SITE_DATA.articles[p.news];
    if(a){
      var n = document.getElementById('pdNews');
      n.href = 'article.html?id=' + p.news;
      n.innerHTML = '<time>' + esc(a.date) + '</time><h4>' + esc(a.title) + '</h4>';
      document.getElementById('pdNewsSec').style.display = '';
    }
  }

  function renderArticle(){
    var tEl = document.getElementById('adTitle'); if(!tEl) return;
    var a = (typeof SITE_DATA !== 'undefined') && SITE_DATA.articles[qs('id')];
    if(!a){
      document.getElementById('adDate').textContent = '404';
      tEl.textContent = '页面不存在';
      document.title = '404 · 恒序基金会'; return;
    }
    document.title = a.title + ' · 恒序基金会';
    document.getElementById('adDate').textContent = a.date + ' · 基金会动态';
    tEl.textContent = a.title;
    document.getElementById('adBody').innerHTML = a.body.map(function(t){ return '<p>' + esc(t) + '</p>'; }).join('');
    if(a.report && SITE_DATA.reports[a.report]){
      document.getElementById('adReport').href = 'report.html?year=' + a.report;
      document.getElementById('adReportSec').style.display = '';
    }
  }

  function renderReport(){
    var tEl = document.getElementById('rdTitle'); if(!tEl) return;
    var year = qs('year');
    var r = (typeof SITE_DATA !== 'undefined') && SITE_DATA.reports[year];
    if(!r){
      tEl.textContent = '页面不存在';
      document.title = '404 · 恒序基金会'; return;
    }
    document.title = year + ' 年度报告摘要 · 恒序基金会';
    tEl.textContent = year + ' 年度报告（摘要）';
    document.getElementById('rdKv').innerHTML =
      '<tr><td>年度总收入</td><td>' + esc(r.income) + '</td></tr>' +
      '<tr><td>年度总支出</td><td>' + esc(r.spend) + '</td></tr>' +
      '<tr><td>项目支出占比</td><td>' + esc(r.ratio) + '</td></tr>' +
      '<tr><td>审计意见</td><td>' + esc(r.audit) + '</td></tr>';
    document.getElementById('rdAlloc').innerHTML = r.alloc.map(function(x){
      return '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join('');
    document.getElementById('rdAllocSec').style.display = '';
    document.getElementById('rdNotes').innerHTML = r.notes.map(function(t){
      return '<li>' + esc(t) + '</li>'; }).join('');
    document.getElementById('rdNotesSec').style.display = '';
  }

  function renderReportRows(){
    var tb = document.getElementById('rpRows'); if(!tb || typeof SITE_DATA === 'undefined') return;
    tb.innerHTML = Object.keys(SITE_DATA.reports).sort().reverse().map(function(y){
      var r = SITE_DATA.reports[y];
      return '<tr><td>' + y + '</td><td>' + esc(r.income) + '</td><td>' + esc(r.spend) + '</td><td>' +
        esc(r.ratio) + '</td><td><a class="dl" href="report.html?year=' + y + '">查看摘要 →</a></td></tr>';
    }).join('');
  }

  function renderTimeline(){
    var box = document.getElementById('tlBox'); if(!box || typeof SITE_DATA === 'undefined') return;
    box.innerHTML = SITE_DATA.timeline.map(function(t){
      return '<div class="tl-item"><span class="yr">' + esc(t[0]) + '</span><h4>' + esc(t[1]) +
        '</h4><p>' + esc(t[2]) + '</p></div>'; }).join('');
  }

  /* 捐赠查询：编号 → 确定性生成去向摘要（格式 HX-2024-01827） */
  function wireDonation(){
    var btn = document.getElementById('donBtn'); if(!btn) return;
    var input = document.getElementById('donInput');
    var out = document.getElementById('donResult');
    function query(){
      var v = input.value.trim().toUpperCase();
      if(!/^HX-(20\d{2})-\d{5}$/.test(v)){
        out.innerHTML = '<p class="don-err">编号格式有误，请核对捐赠回执（格式：HX-2024-01827）。</p>'; return;
      }
      var h = 0; for(var i = 0; i < v.length; i++){ h = (h * 31 + v.charCodeAt(i)) >>> 0; }
      var projNames = ['恒灯计划', '拾光档案', '韧性社区'];
      var proj = projNames[h % 3];
      var amount = (h % 4990 + 10) * 100; /* 1,000 – 500,000 元 */
      out.innerHTML =
        '<table class="tbl don-result"><tbody>' +
        '<tr><td>捐赠编号</td><td>' + esc(v) + '</td></tr>' +
        '<tr><td>捐赠年度</td><td>' + v.slice(3, 7) + ' 年</td></tr>' +
        '<tr><td>支持项目</td><td>' + proj + '</td></tr>' +
        '<tr><td>捐赠金额</td><td>¥ ' + amount.toLocaleString('zh-CN') + '</td></tr>' +
        '<tr><td>款项状态</td><td>已按捐赠意愿拨付，去向随年度报告公示</td></tr>' +
        '</tbody></table>';
    }
    btn.addEventListener('click', query);
    input.addEventListener('keydown', function(e){ if(e.key === 'Enter') query(); });
  }

  document.addEventListener('DOMContentLoaded', function(){
    initNav();
    initLogin();
    renderProject();
    renderArticle();
    renderReport();
    renderReportRows();
    renderTimeline();
    wireDonation();
  });
})();

/* ============================================================
 * OC 免责声明：本文件为原创角色（OC）创作项目的虚构网站组成部分。
 * 恒序基金会、万界稳定局及站内所有数据、人物、组织、事件均为虚构，
 * 不代表任何真实机构，亦不接受任何实际捐赠。仅供创作交流与非商业演示。
 * ============================================================ */
