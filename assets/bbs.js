/* ============================================================
   里页面：万界稳定局内网 BBS —— 渲染层重写
   数据来源：assets/bbs-data.js 全局量 ACCOUNTS / PASSWORD / BOARDS / POSTS
   铁律：
     1. 渲染前清空容器（boardList / threadList / threadView / pager / crumb）
     2. 先校验再赋值：canAccess 通过前不取数据、不生成节点
   ============================================================ */
(function(){
'use strict';

/* ================= 身份与权限 ================= */
var LEVELS = ['L1','L2','L3','L4','L5'];   // L1<L2<L3<L4<L5
function lvRank(l){ return LEVELS.indexOf(l); }

function currentUser(){
  try{
    var raw = sessionStorage.getItem('msb_auth');
    if(!raw) return null;
    var u = JSON.parse(raw);
    if(!u || typeof u.name !== 'string' || lvRank(u.level) < 0) return null;
    return u;
  }catch(e){ return null; }
}

/* 纯函数：先校验再取数。board 元信息（名称/锁定标记）可展示，帖子数据不行 */
function canAccess(board, user){
  if(!board) return false;
  if(!board.lock) return true;
  if(!user) return false;
  return lvRank(user.level) >= lvRank(board.lock);
}

/* ================= 状态与存储 ================= */
var STORE_KEY = 'msb_user_posts_v1';
var PAGE_SIZE = 15;
var state = { board:'notice', thread:null, composerMode:null, pages:{}, user:null };
function resetState(){
  state.board = 'notice'; state.thread = null; state.composerMode = null;
  state.pages = {}; state.user = null;
}

function loadUserPosts(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }catch(e){ return {}; } }
function saveUserPosts(d){ localStorage.setItem(STORE_KEY, JSON.stringify(d)); }

function getBoard(boardId){
  for(var i=0;i<BOARDS.length;i++) if(BOARDS[i].id === boardId) return BOARDS[i];
  return null;
}
/* 用户帖 + 种子/生成帖（按 id 去重）。仅在 canAccess 通过后才允许调用 */
function allThreads(boardId){
  var user = (loadUserPosts()[boardId] || []);
  var userIds = {};
  user.forEach(function(t){ userIds[t.id] = true; });
  var seed = (POSTS[boardId] || []).filter(function(t){ return !userIds[t.id]; });
  return user.concat(seed);
}
/* pin 帖排在最前，其余按时间倒序 */
function sortThreads(arr){
  return arr.slice().sort(function(x,y){
    return ((y.pin?1:0)-(x.pin?1:0)) || String(y.time).localeCompare(String(x.time));
  });
}
function findThread(boardId, tid){
  var list = allThreads(boardId);
  for(var i=0;i<list.length;i++) if(list[i].id === tid) return list[i];
  return null;
}

/* ================= 分页（纯函数） ================= */
function paginate(list, page, per){
  var totalPages = Math.max(1, Math.ceil(list.length / per));
  var p = Math.min(Math.max(1, page|0), totalPages);
  return { items:list.slice((p-1)*per, p*per), page:p, totalPages:totalPages, total:list.length };
}

/* ================= DOM 引用（init 时缓存） ================= */
var bbsEl, page404El, bootEl, bootTextEl, bbsMainEl, whoLineEl, dRTickerEl,
    boardListEl, threadListEl, threadViewEl, pagerEl, crumbEl, composerEl,
    newThreadBtn, postTitleEl, postBodyEl, composerTitleEl;
function $(id){ return document.getElementById(id); }
function cacheEls(){
  bbsEl = $('bbs'); page404El = $('page404');
  bootEl = $('boot'); bootTextEl = $('bootText'); bbsMainEl = $('bbsMain');
  whoLineEl = $('whoLine'); dRTickerEl = $('dRTicker');
  boardListEl = $('boardList'); threadListEl = $('threadList');
  threadViewEl = $('threadView'); pagerEl = $('pager'); crumbEl = $('crumb');
  composerEl = $('composer'); newThreadBtn = $('newThreadBtn');
  postTitleEl = $('postTitle'); postBodyEl = $('postBody'); composerTitleEl = $('composerTitle');
}

/* 铁律1：渲染前清空容器 —— 所有动态容器一次性清场 */
function clearContainers(){
  boardListEl.innerHTML = '';
  threadListEl.innerHTML = '';
  threadViewEl.innerHTML = '';
  pagerEl.innerHTML = '';
  crumbEl.textContent = '';
}
function clearAll(){
  clearContainers();
  bootTextEl.innerHTML = '';
  threadViewEl.style.display = 'none';
  composerEl.style.display = 'none';
  newThreadBtn.style.display = 'none';
  whoLineEl.textContent = '—';
}

/* ================= 启动序列（逐字台本 + 打字机，msb_booted 只播一次） ================= */
var booted = false;
function enterBBS(){
  var u = currentUser();
  if(!u){ show404(); return; }
  state.user = u;
  whoLineEl.textContent = u.name + ' · ' + u.role + ' · 权限 ' + u.level;
  if(sessionStorage.getItem('msb_booted')){ showForum(); return; }
  if(booted){ showForum(); return; }
  booted = true;
  runBoot(u);
}
function runBoot(u){
  bbsMainEl.style.display = 'none';
  bootEl.style.display = '';
  bootTextEl.innerHTML = '';
  var lines = [
    ['> 建立加密链路 ………………………… 完成','ok'],
    ['> 认知防火墙 v4.2 校验中 ………… 通过','ok'],
    ['> 检测阅读者认知污染指数 ……… 0.03（安全）','ok'],
    ['> 身份核验：' + u.name + ' · ' + u.role,'ok'],
    ['> 权限等级：' + u.level + ' —— 超出权限的内容将不予渲染','warn'],
    ['> 正在接入 万界稳定局内部通讯网络 …','ok'],
    ['','ok'],
    ['  欢迎回来。','ok'],
    ['  请记住：你看到的一切，以你能承受为限。','warn']
  ];
  var li = 0;
  function nextLine(){
    if(li >= lines.length){
      setTimeout(function(){
        bootEl.style.display = 'none';
        sessionStorage.setItem('msb_booted','1');
        showForum();
      }, 900);
      return;
    }
    var pair = lines[li++], text = pair[0], cls = pair[1];
    var span = document.createElement('span');
    span.className = cls;
    bootTextEl.appendChild(span);
    var ci = 0;
    var iv = setInterval(function(){
      span.textContent = text.slice(0, ++ci);
      if(ci >= text.length){
        clearInterval(iv);
        bootTextEl.appendChild(document.createTextNode('\n'));
        setTimeout(nextLine, 160);
      }
    }, 14);
  }
  nextLine();
}

/* ================= ΔR ticker ================= */
var drIv = null;
function startTicker(){
  stopTicker();
  drIv = setInterval(function(){
    var v = (0.31 + (Math.random()-.5)*0.02).toFixed(3);
    var arrow = Math.random() > .45 ? '▲' : '▼';
    dRTickerEl.textContent = '全域 ΔR 均值 ' + v + ' ' + arrow + ' 缓升中';
  }, 2600);
}
function stopTicker(){ if(drIv !== null){ clearInterval(drIv); drIv = null; } }

function showForum(){
  bootEl.style.display = 'none';
  bbsMainEl.style.display = '';
  renderBoards();
  renderThreadList(state.board);
  startTicker();
}

/* ================= 渲染：版块列表 ================= */
function renderBoards(){
  boardListEl.innerHTML = '';   // 铁律1
  BOARDS.forEach(function(b){
    var locked = !!b.lock && !canAccess(b, state.user);   // 铁律2：只读元信息，不取帖子数据
    var div = document.createElement('div');
    div.className = 'board' + (state.board === b.id ? ' active' : '') + (locked ? ' locked' : '');
    var head = '<div class="board-head">' + b.name +
      (b.lock ? '<span class="lock-tag">[' + b.lock + ']</span>' : '');
    if(!locked) head += '<span class="cnt">' + allThreads(b.id).length + ' 帖</span>';  // 帖数（仅有权时统计）
    head += '</div>';
    div.innerHTML = head + '<div class="board-desc">' + (locked ? '权限不足，内容不予渲染。' : b.desc) + '</div>';
    div.addEventListener('click', function(){
      state.board = b.id; state.thread = null;
      state.pages[b.id] = 1;            // 切版块回到第 1 页
      renderBoards();
      if(locked){ showDenied(b); return; }   // 只在内容区提示，帖子内容永不进入 DOM
      renderThreadList(b.id);
    });
    boardListEl.appendChild(div);
  });
}

/* ================= 渲染：无权限提示（内容区） ================= */
function showDenied(b){
  state.thread = null;
  threadListEl.innerHTML = '';            // 铁律1
  threadViewEl.innerHTML = '';
  threadViewEl.style.display = 'none';
  pagerEl.innerHTML = '';
  composerEl.style.display = 'none';
  newThreadBtn.style.display = 'none';    // 无权限版块不渲染发帖按钮
  crumbEl.textContent = '> /' + b.id + ' — 访问被拒绝';
  threadListEl.style.display = '';
  var lv = state.user ? state.user.level : '—';
  threadListEl.innerHTML =
    '<div class="fw-block">⚠ 认知防火墙拦截 ⚠<br><br>权限不足，条目不予渲染。<br>' +
    '访问 [' + b.name + '] 需要 ' + b.lock + ' 及以上权限。<br>' +
    '你当前的权限为 ' + lv + '。<br><br>本次访问尝试已被记录。</div>';
}

/* ================= 渲染：帖子列表 + 分页 ================= */
function renderThreadList(boardId){
  var b = getBoard(boardId);
  // 铁律1：渲染前清空容器
  state.thread = null;
  threadListEl.innerHTML = '';
  threadViewEl.innerHTML = '';
  threadViewEl.style.display = 'none';
  pagerEl.innerHTML = '';
  composerEl.style.display = 'none';
  crumbEl.textContent = '';
  // 铁律2：先校验再取数据
  if(!b || !canAccess(b, state.user)){ if(b) showDenied(b); return; }

  threadListEl.style.display = '';
  crumbEl.textContent = '> /' + b.id + ' ' + b.name;
  newThreadBtn.style.display = b.ro ? 'none' : '';   // ro 版块不渲染发帖按钮

  var threads = sortThreads(allThreads(boardId));    // pin 帖排在最前
  if(!threads.length){
    threadListEl.innerHTML = '<div class="empty-tip">— 本版块暂无帖子，等你来发第一帖 —</div>';
    return;
  }
  var pg = paginate(threads, state.pages[boardId] || 1, PAGE_SIZE);
  state.pages[boardId] = pg.page;
  pg.items.forEach(function(t){
    var row = document.createElement('div');
    row.className = 'thread-row';
    var rc = (t.replies ? t.replies.length : 0);
    row.innerHTML = '<div class="thread-title">' + (t.pin ? '<span class="pin">[置顶]</span>' : '') + t.title + '</div>' +
      '<div class="thread-count">回复 ' + rc + '</div>' +
      '<div class="thread-meta">' + t.author + ' · [' + t.lv + '] · ' + t.time + (t.mine ? ' · （我发的）' : '') + '</div>';
    row.addEventListener('click', function(){ openThread(boardId, t.id); });
    threadListEl.appendChild(row);
  });
  renderPager(b, pg);
}

/* 终端风分页条：[ 上一页 ] 1/3 [ 下一页 ] */
function renderPager(b, pg){
  pagerEl.innerHTML = '';                 // 铁律1
  if(pg.totalPages <= 1) return;
  var prev = document.createElement('span');
  prev.className = 'pg-btn' + (pg.page <= 1 ? ' off' : '');
  prev.textContent = '[ 上一页 ]';
  prev.addEventListener('click', function(){
    if(state.pages[b.id] > 1){ state.pages[b.id]--; renderThreadList(b.id); }
  });
  var info = document.createElement('span');
  info.textContent = pg.page + '/' + pg.totalPages;
  var next = document.createElement('span');
  next.className = 'pg-btn' + (pg.page >= pg.totalPages ? ' off' : '');
  next.textContent = '[ 下一页 ]';
  next.addEventListener('click', function(){
    if(state.pages[b.id] < pg.totalPages){ state.pages[b.id]++; renderThreadList(b.id); }
  });
  pagerEl.appendChild(prev);
  pagerEl.appendChild(info);
  pagerEl.appendChild(next);
}

/* ================= 渲染：帖子正文 ================= */
function postHTML(p){
  return '<div class="post">' +
    '<div class="post-head"><span>' + p.author + ' <span class="lv">[' + p.lv + ']</span></span><span>' + p.time + '</span></div>' +
    '<div class="post-body">' + p.body + '</div>' +
  '</div>';
}

function openThread(boardId, tid){
  var b = getBoard(boardId);
  if(!b || !canAccess(b, state.user)){ if(b) showDenied(b); return; }  // 铁律2：先校验
  var t = findThread(boardId, tid);
  if(!t) return;
  state.thread = tid;
  threadListEl.style.display = 'none';
  pagerEl.innerHTML = '';                 // 铁律1
  threadViewEl.innerHTML = '';
  composerEl.style.display = 'none';
  threadViewEl.style.display = '';
  crumbEl.textContent = '> /' + b.id + ' / 帖 #' + tid;
  var html = '<span class="back-link" id="backToList">&lt;&lt; 返回帖子列表</span>' +
    '<div class="thread-title-big">' + t.title + '</div>' +
    postHTML(t);
  (t.replies || []).forEach(function(r){ html += postHTML(r); });
  if(!b.ro){
    html += '<div style="margin-top:8px"><button class="t-btn" id="replyBtn">[ 回复本帖 ]</button></div>';
  }
  threadViewEl.innerHTML = html;
  $('backToList').addEventListener('click', function(){ renderThreadList(boardId); });
  var rb = $('replyBtn');
  if(rb) rb.addEventListener('click', function(){ openComposer('reply'); });
  threadViewEl.scrollIntoView({behavior:'smooth', block:'start'});
}

/* ================= 发帖 / 回帖 ================= */
function openComposer(mode){
  var b = getBoard(state.board);
  if(!b || b.ro || !canAccess(b, state.user)) return;   // 铁律2：ro / 无权限不可发帖
  state.composerMode = mode;
  composerEl.style.display = '';
  composerTitleEl.textContent = mode === 'reply' ? '回复本帖' : '发布新帖';
  postTitleEl.style.display = mode === 'reply' ? 'none' : '';
  postTitleEl.value = ''; postBodyEl.value = '';
  composerEl.scrollIntoView({behavior:'smooth', block:'center'});
  postBodyEl.focus();
}

function nowStr(){
  var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function submitPost(){
  var u = state.user;
  var b = getBoard(state.board);
  if(!u || !b || b.ro || !canAccess(b, state.user)) return;   // 铁律2
  var body = postBodyEl.value.trim();
  if(!body){ postBodyEl.focus(); return; }
  var store = loadUserPosts();
  var bid = state.board;
  store[bid] = store[bid] || [];
  if(state.composerMode === 'new'){
    var title = postTitleEl.value.trim();
    if(!title){ postTitleEl.focus(); return; }
    store[bid].unshift({
      id:'u' + Date.now(), mine:true, title:title,
      author:u.name + ' · ' + u.role, lv:u.level, time:nowStr(),
      body: body.replace(/</g,'&lt;'), replies: []
    });
  } else {
    var tid = state.thread;
    var reply = { author:u.name + ' · ' + u.role, lv:u.level, time:nowStr(), body: body.replace(/</g,'&lt;') };
    var t = null;
    for(var i=0;i<store[bid].length;i++) if(store[bid][i].id === tid){ t = store[bid][i]; break; }
    if(t){ t.replies = t.replies || []; t.replies.push(reply); }
    else {
      // 回复种子帖：把种子帖浅拷贝进用户存储以挂回复
      var seedList = POSTS[bid] || [], seedT = null;
      for(var j=0;j<seedList.length;j++) if(seedList[j].id === tid){ seedT = seedList[j]; break; }
      if(seedT){
        var copy = JSON.parse(JSON.stringify(seedT));
        copy.replies = copy.replies || []; copy.replies.push(reply);
        store[bid].unshift(copy);
      }
    }
  }
  saveUserPosts(store);
  composerEl.style.display = 'none';
  if(state.composerMode === 'new'){
    state.pages[bid] = 1;                 // 新帖回第 1 页可见
    renderThreadList(bid);
  } else {
    openThread(bid, state.thread);
  }
}

/* ================= 登出：停 ticker、清容器、重置 state、清 session、回表站 ================= */
function logout(){
  stopTicker();
  clearAll();
  resetState();
  booted = false;
  sessionStorage.removeItem('msb_auth');
  sessionStorage.removeItem('msb_booted');
  location.href = 'index.html';
}

/* ================= 入口：同步身份闸门 ================= */
function show404(){
  document.title = '404 · 恒序基金会';
  bbsEl.classList.remove('on');
  bbsMainEl.style.display = 'none';
  bootEl.style.display = 'none';
  page404El.classList.add('on');
}

function init(){
  cacheEls();
  clearAll();                 // 不信赖任何残留 DOM，从头渲染
  $('logoutBtn').addEventListener('click', logout);
  newThreadBtn.addEventListener('click', function(){ openComposer('new'); });
  $('postCancel').addEventListener('click', function(){ composerEl.style.display = 'none'; });
  $('postSubmit').addEventListener('click', submitPost);

  var u = currentUser();      // 未登录直接访问：只显示伪装 404，任何帖子内容不得进入 DOM
  if(!u){ show404(); return; }
  document.title = 'MSB-BBS';
  bbsEl.classList.add('on');
  enterBBS();
}

if(typeof document !== 'undefined'){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

/* 供 node 自测使用的纯逻辑导出（浏览器中无 module，不影响） */
if(typeof module !== 'undefined' && module.exports){
  module.exports = {
    lvRank:lvRank, canAccess:canAccess, paginate:paginate, sortThreads:sortThreads,
    allThreads:allThreads, PAGE_SIZE:PAGE_SIZE,
    _state:state, _resetState:resetState
  };
}

})();
