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

  function initNav(){
    var page = location.pathname.split('/').pop() || 'index.html';
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

    function tryLogin(){
      var acc = accInput.value.trim().toLowerCase();
      var pwd = pwdInput.value;
      if(ACCOUNTS[acc] && pwd === PASSWORD){
        sessionStorage.setItem('msb_auth', JSON.stringify(ACCOUNTS[acc]));
        sessionStorage.removeItem('msb_booted');
        mask.classList.remove('on');
        location.href = 'bbs.html';
      } else {
        loginErr.classList.add('on');
        modalEl.classList.remove('shake'); void modalEl.offsetWidth; modalEl.classList.add('shake');
      }
    }
    document.getElementById('loginBtn').addEventListener('click', tryLogin);
    [pwdInput, accInput].forEach(function(el){
      el.addEventListener('keydown', function(e){ if(e.key === 'Enter') tryLogin(); });
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    initNav();
    initLogin();
  });
})();
