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

/* 会话只存 {id, ts}，完整用户对象由 AUTH 按 id 重新查出（admin 派生，不信 session 字段）。
   AUTH 未加载完成前返回 null —— init 会等 auth.js 就绪后才进入身份闸门。 */
function currentUser(){
  if(typeof window !== 'undefined' && window.AUTH && window.AUTH.currentUser){
    return window.AUTH.currentUser();
  }
  return null;
}
/* auth.js 可能未被 html 引入（bbs.html 不归本文件管），动态注入加载 */
var _authReady = null;
function ensureAuth(){
  if(typeof window !== 'undefined' && window.AUTH) return Promise.resolve();
  if(_authReady) return _authReady;
  _authReady = new Promise(function(res, rej){
    var s = document.createElement('script');
    s.src = 'assets/auth.js';
    s.onload = function(){ res(); };
    s.onerror = function(){ rej(new Error('auth.js 加载失败')); };
    document.head.appendChild(s);
  });
  return _authReady;
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

/* ================= 管理员删帖/置顶 overrides（Wave 2） =================
   生成帖/手写帖的删除与置顶全部走 overrides（运行时套用），不改源数据 POSTS；
   用户帖的删除直接改 msb_user_posts_v1。回复无 id，用 postId#r<index> 定位。
   置顶：pinned 补置顶、unpinned 取消手写帖自带 pin。 */
var MODS_KEY = 'msb_admin_mods_v1';
function normMods(m){
  m = m || {};
  if(!Array.isArray(m.deleted)) m.deleted = [];
  if(!Array.isArray(m.delReplies)) m.delReplies = [];
  if(!Array.isArray(m.pinned)) m.pinned = [];
  if(!Array.isArray(m.unpinned)) m.unpinned = [];
  return m;
}
function loadMods(){ try{ return normMods(JSON.parse(localStorage.getItem(MODS_KEY)) || {}); }catch(e){ return normMods({}); } }
function saveMods(m){ localStorage.setItem(MODS_KEY, JSON.stringify(normMods(m))); }

function isAdmin(){ return !!(state.user && state.user.admin); }
/* 发帖权：先过访问闸门；ro 版块（公告）仅管理员可发 */
function canPost(b, u){ return !!(b && u && canAccess(b, u) && (!b.ro || u.admin === true)); }
function myAuthor(){ var u = state.user; return u ? u.name + ' · ' + u.role : ''; }

/* 有效置顶状态：overrides 优先于帖内 pin 字段 */
function effectivePin(t, mods){
  mods = mods || loadMods();
  if(mods.pinned.indexOf(t.id) >= 0) return true;
  if(mods.unpinned.indexOf(t.id) >= 0) return false;
  return !!t.pin;
}
/* 套用回复级 overrides：delReplies 过滤；
   每条回复带 _ridx（在原数组中的索引，供 postId#r<index> 定位用）。返回新数组，不改源数据 */
function effectiveReplies(t, mods){
  mods = mods || loadMods();
  var out = [];
  var reps = t.replies || [];
  for(var i=0;i<reps.length;i++){
    var key = t.id + '#r' + i;
    if(mods.delReplies.indexOf(key) >= 0) continue;
    var r = reps[i];
    out.push({ author:r.author, lv:r.lv, time:r.time, body:r.body, ai:!!r.ai, _ridx:i });
  }
  return out;
}

function getBoard(boardId){
  for(var i=0;i<BOARDS.length;i++) if(BOARDS[i].id === boardId) return BOARDS[i];
  return null;
}
/* 用户帖 + 种子/生成帖（按 id 去重），运行时套用管理员 overrides（删除 + 置顶）。
   置顶通过浅拷贝覆盖 pin 字段套用，绝不改写源数据。仅在 canAccess 通过后才允许调用 */
function allThreads(boardId){
  var mods = loadMods();
  var deleted = {};
  mods.deleted.forEach(function(id){ deleted[id] = true; });
  function applyPin(t){
    var ep = effectivePin(t, mods);
    if(ep === !!t.pin) return t;
    var c = {};
    for(var k in t) c[k] = t[k];
    c.pin = ep;
    return c;
  }
  var user = (loadUserPosts()[boardId] || [])
    .filter(function(t){ return !deleted[t.id]; })
    .map(applyPin);
  var userIds = {};
  user.forEach(function(t){ userIds[t.id] = true; });
  var seed = (POSTS[boardId] || [])
    .filter(function(t){ return !userIds[t.id] && !deleted[t.id]; })
    .map(applyPin);
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
  /* 管理员专属入口：[ 系统管理 ] → admin.html（只渲染给管理员） */
  var statusEl = document.querySelector('.bbs-status');
  if(u.admin && statusEl && !document.getElementById('adminBtn')){
    var ab = document.createElement('button');
    ab.className = 't-btn admin-entry-btn';
    ab.id = 'adminBtn';
    ab.textContent = '[ 系统管理 ]';
    ab.addEventListener('click', function(){ location.href = 'admin.html'; });
    statusEl.insertBefore(ab, $('logoutBtn'));
  }
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
  newThreadBtn.style.display = canPost(b, state.user) ? '' : 'none';   // 无权限不渲染；管理员可破 ro

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
    var rc = effectiveReplies(t).length;
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

/* 主题帖/回复的操作按钮（终端风小按钮）：
   - 自己发的主题帖（mine:true 且作者串匹配）：[ 删除 ]
   - 自己发的回复（非人格回复、作者串匹配）：[ 删除 ]
   - 管理员：主题帖 [ 置顶/取消置顶 ] + [ 删除 ]；回复 [ 删除 ]（管理员无编辑能力） */
function threadBtns(t){
  var html = '';
  var mine = t.mine && t.author === myAuthor();
  if(isAdmin()){
    html += '<button class="mini-btn" data-act="pin-t" data-tid="' + t.id + '">[ ' + (t.pin ? '取消置顶' : '置顶') + ' ]</button>';
    html += '<button class="mini-btn danger" data-act="del-t" data-tid="' + t.id + '">[ 删除 ]</button>';
  }else if(mine){
    html += '<button class="mini-btn danger" data-act="del-t" data-tid="' + t.id + '">[ 删除 ]</button>';
  }
  return html ? '<div class="post-ops">' + html + '</div>' : '';
}
function replyBtns(t, r){
  var html = '';
  var mine = !r.ai && r.author === myAuthor() && !isAdmin();
  if(isAdmin() || mine) html += '<button class="mini-btn danger" data-act="del-r" data-tid="' + t.id + '" data-r="' + r._ridx + '">[ 删除 ]</button>';
  return html ? '<div class="post-ops">' + html + '</div>' : '';
}

function openThread(boardId, tid, opts){
  opts = opts || {};
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
    '<div class="thread-title-big">' + (t.pin ? '<span class="pin-tag">[置顶]</span> ' : '') + t.title + '</div>' +
    postHTML(t) + threadBtns(t);
  var reps = effectiveReplies(t);
  for(var i=0;i<reps.length;i++){
    var r = reps[i];
    html += postHTML(r) + replyBtns(t, r);
  }
  if(canPost(b, state.user)){
    html += '<div style="margin-top:8px"><button class="t-btn" id="replyBtn">[ 回复本帖 ]</button></div>';
  }
  threadViewEl.innerHTML = html;
  $('backToList').addEventListener('click', function(){ renderThreadList(boardId); });
  var rb = $('replyBtn');
  if(rb) rb.addEventListener('click', function(){ openComposer('reply'); });
  /* 操作按钮统一委托绑定 */
  var btns = threadViewEl.querySelectorAll('.mini-btn');
  for(var j=0;j<btns.length;j++){
    btns[j].addEventListener('click', onOpBtn);
  }
  if(opts.highlightLast){
    var posts = threadViewEl.querySelectorAll('.post');
    if(posts.length) posts[posts.length-1].classList.add('ai-new');
  }
  /* 人格回复兜底调度：打开发帖人自己 90 秒内的新帖时补触发一次。
     覆盖「发帖后刷新/重开页面导致 setTimeout 丢失」的场景；
     triggerPersonas 内部会按已有人格回复去重，落库前再校验，不会重复回复。 */
  if(t.mine && state.user && !state.user.admin && t.author === myAuthor()){
    var age = Date.now() - new Date(String(t.time).replace(' ','T')).getTime();
    if(age >= 0 && age < 90000){
      triggerPersonas(boardId, tid, String(t.title), String(t.body));
    }
  }
  if(!opts.noScroll) threadViewEl.scrollIntoView({behavior:'smooth', block:'start'});
}

/* 终端风确认弹窗（替代原生 confirm——原生弹窗会被自动化环境默认 dismiss，导致删除被静默中止） */
function termConfirm(msg, onOk){
  var old = document.querySelector('.term-confirm-mask');
  if(old) old.parentNode.removeChild(old);
  var mask = document.createElement('div');
  mask.className = 'term-confirm-mask';
  mask.innerHTML =
    '<div class="term-confirm">' +
      '<div class="tc-msg">' + msg + '</div>' +
      '<div class="tc-actions">' +
        '<button class="mini-btn danger" data-tc="ok">[ 确认删除 ]</button>' +
        '<button class="mini-btn" data-tc="no">[ 取消 ]</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode) mask.parentNode.removeChild(mask); }
  mask.querySelector('[data-tc="ok"]').addEventListener('click', function(){ close(); onOk(); });
  mask.querySelector('[data-tc="no"]').addEventListener('click', close);
  mask.addEventListener('click', function(e){ if(e.target === mask) close(); });
}

/* 小按钮点击：删自己帖 / 管理员删除与置顶 */
function onOpBtn(e){
  var el = e.currentTarget;
  var act = el.getAttribute('data-act');
  var tid = el.getAttribute('data-tid');
  var ridx = el.getAttribute('data-r');
  var bid = state.board;
  if(act === 'del-t'){
    termConfirm('确认删除该主题帖？此操作不可撤销。', function(){ deleteThread(bid, tid); });
  }else if(act === 'del-r'){
    termConfirm('确认删除该回复？', function(){ deleteReply(bid, tid, parseInt(ridx,10)); });
  }else if(act === 'pin-t'){
    togglePin(bid, tid);
  }
}

/* 置顶/取消置顶（仅管理员）：数据层 + 清容器重渲染 */
function togglePinData(bid, tid){
  if(!isAdmin()) return;
  var mods = loadMods();
  var t = findThread(bid, tid);
  if(!t) return;
  var cur = effectivePin(t, mods);
  var pi = mods.pinned.indexOf(tid), ui = mods.unpinned.indexOf(tid);
  if(pi >= 0) mods.pinned.splice(pi,1);
  if(ui >= 0) mods.unpinned.splice(ui,1);
  if(cur){ mods.unpinned.push(tid); } else { mods.pinned.push(tid); }
  saveMods(mods);
}
function togglePin(bid, tid){
  togglePinData(bid, tid);
  state.thread = null;
  renderBoards();
  renderThreadList(bid);
}

/* 删除主题帖：用户帖直接改 msb_user_posts_v1；种子/生成帖走 overrides 登记。
   admin 操作后清容器重渲染（铁律）。 */
/* 数据层（不含渲染，node 可测） */
function deleteThreadData(bid, tid){
  var store = loadUserPosts();
  if(store[bid]){
    var before = store[bid].length;
    store[bid] = store[bid].filter(function(t){ return t.id !== tid; });
    if(store[bid].length !== before) saveUserPosts(store);
  }
  if(isAdmin()){
    var mods = loadMods();
    if(mods.deleted.indexOf(tid) < 0){ mods.deleted.push(tid); saveMods(mods); }
  }
}
function deleteThread(bid, tid){
  /* 视图清理放进 finally：无论数据层或后续渲染是否抛错，
     都必须离开「正在查看中的已删帖」（铁律：清容器、state.thread 置空、回列表重渲染） */
  try{
    deleteThreadData(bid, tid);
  }finally{
    state.thread = null;
    threadViewEl.innerHTML = '';
    threadViewEl.style.display = 'none';
    threadListEl.style.display = '';
    crumbEl.textContent = '';
    renderBoards();
    renderThreadList(bid);
  }
}

/* 删除回复：
   - 自己的回复：从 msb_user_posts_v1 移除（含挂在种子帖浅拷贝里的），重渲染；
   - 管理员：登记 delReplies override（postId#r<index>），对种子/生成/用户帖统一生效。 */
/* 数据层（不含渲染，node 可测） */
function deleteReplyData(bid, tid, ridx){
  if(isAdmin()){
    var mods = loadMods();
    var key = tid + '#r' + ridx;
    if(mods.delReplies.indexOf(key) < 0){ mods.delReplies.push(key); saveMods(mods); }
  }else{
    var store = loadUserPosts();
    var list = store[bid] || [];
    for(var i=0;i<list.length;i++){
      if(list[i].id === tid && list[i].replies && list[i].replies[ridx]){
        list[i].replies.splice(ridx,1);
        saveUserPosts(store);
        break;
      }
    }
  }
}
function deleteReply(bid, tid, ridx){
  deleteReplyData(bid, tid, ridx);
  openThread(bid, tid, { noScroll:true });
}

/* ================= 发帖 / 回帖 ================= */
function openComposer(mode){
  var b = getBoard(state.board);
  if(!canPost(b, state.user)) return;   // 铁律2：无权限不可发帖（管理员可破 ro）
  state.composerMode = mode;
  composerEl.style.display = '';
  composerTitleEl.textContent = mode === 'reply' ? '回复本帖' : (b.ro ? '发布公告' : '发布新帖');
  postTitleEl.style.display = mode === 'reply' ? 'none' : '';
  postTitleEl.value = ''; postBodyEl.value = '';
  /* 管理员在公告版（ro）发帖：提供官方署名输入 */
  var signEl = $('postSign');
  if(mode === 'new' && b.ro && state.user.admin === true){
    if(!signEl){
      signEl = document.createElement('input');
      signEl.type = 'text'; signEl.id = 'postSign'; signEl.maxLength = 30;
      signEl.placeholder = '署名（默认：中央总署 · 总务）';
      postTitleEl.parentNode.insertBefore(signEl, postTitleEl.nextSibling);
    }
    signEl.style.display = ''; signEl.value = '';
  }else if(signEl){ signEl.style.display = 'none'; }
  composerEl.scrollIntoView({behavior:'smooth', block:'center'});
  postBodyEl.focus();
}

function nowStr(){
  var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* 将一条回复写入用户帖存储（用户回复与人格回复共用此持久化机制）。
   目标为种子/生成帖时，先取「已套用 overrides 的」副本深拷贝进存储再挂回复。 */
function appendReplyToStore(bid, tid, reply){
  var store = loadUserPosts();
  store[bid] = store[bid] || [];
  var t = null, i;
  for(i=0;i<store[bid].length;i++) if(store[bid][i].id === tid){ t = store[bid][i]; break; }
  if(t){ t.replies = t.replies || []; t.replies.push(reply); }
  else {
    var eff = findThread(bid, tid);      // 有效视图（已套 overrides）；被删帖返回 null
    if(eff){
      var copy = JSON.parse(JSON.stringify(eff));
      copy.replies = copy.replies || [];
      copy.replies.push(reply);
      store[bid].unshift(copy);
    }
  }
  saveUserPosts(store);
}

function submitPost(){
  var u = state.user;
  var b = getBoard(state.board);
  if(!canPost(b, u)) return;   // 铁律2（管理员可破 ro）
  var body = postBodyEl.value.trim();
  if(!body){ postBodyEl.focus(); return; }
  var store = loadUserPosts();
  var bid = state.board;
  var mode = state.composerMode;
  store[bid] = store[bid] || [];
  var newTid = null;
  if(mode === 'new'){
    var title = postTitleEl.value.trim();
    if(!title){ postTitleEl.focus(); return; }
    newTid = 'u' + Date.now();
    /* 管理员在公告版发帖：可用官方署名（默认 中央总署 · 总务），标记 official */
    var author = u.name + ' · ' + u.role, official = false;
    if(b.ro && u.admin === true){
      var signEl = $('postSign');
      var sign = signEl && signEl.value.trim();
      author = (sign || '中央总署 · 总务').replace(/</g,'&lt;');
      official = true;
    }
    store[bid].unshift({
      id:newTid, mine:true, official:official, title:title.replace(/</g,'&lt;'),
      author:author, lv:u.level, time:nowStr(),
      body: body.replace(/</g,'&lt;'), replies: []
    });
    saveUserPosts(store);
  } else {
    var tid = state.thread;
    var reply = { author:u.name + ' · ' + u.role, lv:u.level, time:nowStr(), body: body.replace(/</g,'&lt;') };
    appendReplyToStore(bid, tid, reply);
    newTid = tid;
  }
  composerEl.style.display = 'none';
  if(mode === 'new'){
    state.pages[bid] = 1;                 // 新帖回第 1 页可见
    renderThreadList(bid);
    triggerPersonas(bid, newTid, postTitleEl.value.trim(), body);
  } else {
    var t0 = findThread(bid, newTid);
    openThread(bid, newTid);
    triggerPersonas(bid, newTid, t0 ? String(t0.title) : '', body);
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

/* ============================================================
   人格回复引擎 + BYOK 真 AI（Wave 2 · 原 bbs-ai.js 规划，按约束并入本文件末尾）
   - 触发：非人格账号、非管理员用户发新帖或回复后；notice/vault 不触发
   - 关键词命中 + 各人格概率（0.4–0.7）选 0–2 人，延迟 4–9 秒回复
   - 同一主题帖同一人格只回一次；回复沿用「名字 · 职务」+ lv，写入用户帖存储
   - Mock 模式（默认）：人格片段池组合；有 msb_ai_key 时走 Moonshot（BYOK），失败回退 mock
   ============================================================ */
var AI_PERSONAS = [
  { id:'jiran', name:'纪燃', role:'规则干预官', lv:'L2', prob:0.5,
    triggers:['离谱','凭什么','后勤','配额','违规','吵'],
    sys:'你是万界稳定局内网论坛的纪燃，规则干预官，L2。性格火爆直率，恨流程癌也恨违规，说话带火气但有分寸。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['看到这种帖子我火气就上来了。','我说句直话。','行，我忍不了了，我来说。','又来？'],
    line:[
      '规定是人写的，但违规是事教你的，别把两者搞混了。',
      '要骂后勤可以，先把你上个月的申领单填对了再来。',
      '配额砍你头上你急，ΔR 爆你站上你找谁？省着点用不是口号。',
      '流程癌我第一个骂，但跳过流程的人我第一个抓，这两件事不矛盾。',
      '有火气冲我来，别冲规程，规程不疼了，疼的是你。',
      '离谱的事我见多了，离谱还理直气壮的，见一个记一个。',
      '吵归吵，别把编号吵出来，这是我最后的耐心。',
      '谁违规谁整改，谁定的不合理的规矩谁来找我，别在楼里阴阳怪气。',
      '我这人说话直：这事要按流程走，但流程要是不通，我陪你一起去堵签发厅的门。'
    ] },
  { id:'anhuai', name:'安槐', role:'存在医师', lv:'L2', prob:0.7,
    triggers:['怕','睡不着','梦','累','撑不住','难受'],
    sys:'你是万界稳定局内网论坛的安槐，存在医师，L2。温柔安抚，关心睡眠与情绪，说话轻、慢、具体，会给出可执行的小建议。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['看到了，先抱抱你。','夜班辛苦，我说两句。','先深呼吸，慢慢来。','这条帖子我来回。'],
    line:[
      '睡前把姓名、岗位、今天吃了什么写在纸上放枕边，老办法，管用。',
      '累不是软弱，是身体在替你记账，记多了总要还，今晚早点睡。',
      '梦只是路过你，不是来找你的，醒了就把它留在枕头那边。',
      '撑不住的时候可以来我这坐一会儿，不谈档案，不登记，就喝杯热的。',
      '害怕说明你的锚点还灵，真正要担心的是哪天你不怕了。',
      '今晚把能关的屏幕都关了，嗡鸣声听久了，人会跟着一起振。',
      '你已经做得很好了，这句话不收钱，也不用回。',
      '如果连续三晚睡不好，来找我，别自己扛到第四晚。',
      '把担心的事写在小纸片上，写完撕掉，认知科认证的土办法。'
    ] },
  { id:'wenshi', name:'温拾', role:'认知校验官', lv:'L3', prob:0.6,
    triggers:['流程','规定','权限','编号','报告','格式'],
    sys:'你是万界稳定局内网论坛的温拾，认知校验官，L3。冷静严谨，纠正格式与措辞，语气温和但寸步不让，常引用规程条目。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['例行校验，打扰。','本楼做一次格式巡检。','措辞问题，提一下。','按规程补一条说明。'],
    line:[
      '标题缺少分类前缀，建议楼主编辑补上，格式是给后来者省时间的。',
      '「好像」「大概」这类词不要出现在报告里，出现在茶水间也请节制。',
      '流程不是束缚，是上一个踩坑的人留给你的扶手。',
      '本帖涉及权限表述，提醒一句：权限随调令生效，不随记忆生效。',
      '请勿在正文出现具体编号，哪怕是「大家都知道了」的那种。',
      '措辞建议：把「我觉得」改成「据观测」，被防火墙拦下的概率立减三成。',
      '报告结论先行，过程后置，这是写报告，不是写悬疑小说。',
      '格式已核对，无硬伤。继续保持，这种帖子审起来最省心。',
      '补充一个冷知识：校验退改率最高的不是新人，是觉得自己不是新人的人。'
    ] },
  { id:'miaoyushi', name:'苗雨时', role:'封存书记官·见习', lv:'L1', prob:0.5,
    triggers:['新人','请问','求助','第一次','谢谢'],
    sys:'你是万界稳定局内网论坛的苗雨时，封存书记官见习，L1。认真萌新，爱做笔记，语气恭敬带点雀跃，会说「记下来了」。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['我、我来答！见习书记官报到。','这条我会，让我来。','前辈好，我查过手册。','举手！这个我刚学过。'],
    line:[
      '这个问题手册第三章有写，我抄在笔记上了，需要的话我拍给你。',
      '新人别怕，大家都是从头蒙圈过来的，包括现在最凶的那几位。',
      '谢谢你提出来，我也一直想问但没敢问，记下来了。',
      '第一次都这样，我的第一次更惨，这里就不展开丢人现眼了。',
      '请问如果需要走流程，我可以帮忙查对应的表单编号，我熟这个。',
      '笔记已更新：今天的茶水间又教会我三件事。',
      '前辈们说得都对，我补充一个细节：登记表右上角要签日期。',
      '不用谢！能帮上忙我这个月笔记就没白记。',
      '虽然我是见习的，但这一条我确定，我上周刚被纠错过。'
    ] },
  { id:'shanglu', name:'商陆', role:'秩序裁定官', lv:'L4', prob:0.45, terse:true,
    triggers:['争议','裁定','规矩','投诉','责任','举报'],
    sys:'你是万界稳定局内网论坛的商陆，秩序裁定官，L4。威严寡言，一锤定音，回复永远不超过两句。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:[],
    line:[
      '此事到此为止。',
      '规矩在墙上，也在事上。散了。',
      '责任归属已明，执行，不复议。',
      '投诉收到。裁定：维持原判。',
      '再有争议，来裁定席，带上记录。',
      '规矩不是拿来商量语气的。',
      '此楼已读。谁再越线，记名。',
      '裁定如下：各回各位，各守各的规矩。',
      '话说到这里。下一句就是处分。'
    ] },
  { id:'weishuang', name:'卫霜', role:'最高稳定议会·档案席议员', lv:'L5', prob:0.4,
    triggers:['档案','历史','旧案','记录','编号','当年'],
    sys:'你是万界稳定局内网论坛的卫霜，最高稳定议会档案席议员，L5。高深疏离，爱引档案编号，话说半句留半句，从不说透。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['翻到这一页，停下来说一句。','这档事，我见过。','档案里有影子。'],
    line:[
      '卷宗 A 字头的案子，第三页有类似记载。后半句，我不说了。',
      '当年的处置记录还在，编号的尾数被涂掉了。涂掉的那部分，正是答案。',
      '历史不重演，但押韵。你去翻旧案汇编第几册，我不提醒了。',
      '这个提法，档案里出现过两次。两次的结局，一次比一次安静。',
      '我什么都没说。你听到的，是你自己档案里的回声。',
      '编号的事，问到这里为止。再问，就要登记你的名字了。',
      '旧案不旧。它只是暂时没有人再翻开。',
      '记录会留下，读的人未必。好自为之。',
      '这部分我签了封。哪天你权限到了，自然看得见——但愿你到时候不想看。'
    ] },
  { id:'yanhui', name:'晏回', role:'表象维护处主任', lv:'L4', prob:0.5,
    triggers:['表站','基金会','对外','口径','宣传','新闻'],
    sys:'你是万界稳定局内网论坛的晏回，表象维护处主任，L4。官方发言腔，滴水不漏，擅长「合规地什么都没说」，语气温和得体但信息量为零。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['感谢关注，我处注意到本帖。','这个话题，我讲两句官话。','代表表象维护处回应。'],
    line:[
      '有关情况均在掌握之中，一切按既定口径执行，请以公示信息为准。',
      '表站运转良好，各项工作有序推进，感谢各位同事的关心与支持。',
      '你问的这个细节很有价值，我们会认真研究，适时统一对外说明。',
      '经核实，网传说法与事实存在一定出入，具体以公告为准。没有了。',
      '对外口径三统一，请各位同事不要自行补充细节。本回复本身也未补充任何细节。',
      '我处高度重视，已记录，将按程序办理。程序走到哪一步，恕不展开。',
      '这个问题提得好。好就好在，它提醒我们手册还有可以完善的页面。',
      '可以理解外界的关切。也请各位理解我们不能透露的理解。',
      '新闻口径如有更新，将第一时间同步。目前，没有更新。'
    ] },
  { id:'sangning', name:'桑宁', role:'表象维护处 · 对外联络主管', lv:'L3', prob:0.55,
    triggers:['合作','联系','电话','捐赠','外面','普通人'],
    sys:'你是万界稳定局内网论坛的桑宁，表象维护处对外联络主管，L3。圆滑热心，擅长打圆场递台阶，永远先给双方一个体面的下场。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['我来打个圆场。','这事我熟，听我一句。','都消消气，听我捋一捋。'],
    line:[
      '两边都有道理，这样，台阶我放这儿了，谁先下谁都体面。',
      '外面打来的电话，按手册答，答不了的记下来转给我，别硬接，硬接容易硌着。',
      '合作的事好商量，先把各自的红线摆桌上，摆完发现中间全是能走的路。',
      '人家也是好意，我们这边也确实有难处——把这两句话都说了，事就过去一半了。',
      '联系人那一栏填我，出了问题算我的，办成了算大家的。',
      '捐赠的心意心领了，规矩不能破，但话可以说暖一点，我来教你话术。',
      '别跟普通人讲太多，不是防他们，是心疼他们——知道太多睡不好觉的。',
      '这样，各退一步，退到我这儿来，我请你们喝表站的茶。',
      '邮件我已经回了，措辞你放心：热情、周到、一个字实底没漏。'
    ] },
  { id:'cenjin', name:'岑今', role:'表象维护处 · 内容校验', lv:'L2', prob:0.6,
    triggers:['写','文案','错字','措辞','格式','帖子'],
    sys:'你是万界稳定局内网论坛的岑今，表象维护处内容校验，L2。职业病抠字眼，语气温和但较真，会顺手改楼主的病句和格式，改完才说正事。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['先别忙，我改两个字。','职业病犯了，容我顺手一校。','内容我看完了，先说字。'],
    line:[
      '「的、得、地」第三段用错了一处，已替你脸红过，下次注意。',
      '标题建议加分类前缀，不然检索的时候它会沉底，沉底的帖子等于没写。',
      '这句有歧义：可以理解成两个意思，而这两个意思都不能让外面的人看到。',
      '「基本上没问题」这种措辞不要写，基本到哪儿？问题在哪儿？删了重写。',
      '顺手帮你把病句顺了：主语丢了，我替你找回来了，不用谢。',
      '标点也是口径的一部分。感叹号全文只能有一个，你用了三个。',
      '写得挺好，就是「众所周知」后面跟的内容并不周知，改为「据了解」。',
      '这帖要是发到表站，我会在第三行就拦下。内网就算了，下不为例。',
      '格式提醒：日期用连字符，编号用全角括号，这是手册第几页的事，自己查。'
    ] },
  { id:'qipan', name:'祁盼', role:'表象维护处 · 一线值守', lv:'L1', prob:0.7,
    triggers:['食堂','吃','值班','快递','猫','天气','宿舍'],
    sys:'你是万界稳定局内网论坛的祁盼，表象维护处一线值守，L1。热心肠话多，茶水间食堂话题王者，语气活泼接地气，爱分享值班日常。以内网论坛口吻回复，不超过150字，不泄露任何高危条目与编号，保持人设。',
    open:['来了来了！这题我会！','值班摸鱼刷到，必须回。','哎哟这个我有话说！'],
    line:[
      '食堂的事问我！表站这周的红烧肉一绝，你们内网食堂要是再做土豆泥，我给你们寄菜谱。',
      '值夜班必备三件套：热水、毛毯、以及一个能随时聊天的网友——比如我。',
      '快递放门卫记得写网名别写真名，我上次写真名，阿姨喊我全名的时候我想原地封存。',
      '猫是好文明！我们表站门口也有只橘的，谁喂跟谁好，比我人缘强。',
      '天气一好就想翘班，天气一坏就想请假，这就是我们值守人员的朴素辩证法。',
      '宿舍神器推荐：遮光窗帘。我们这种白天补觉的人，窗帘就是命。',
      '别熬夜发帖了，快去睡！——来自正在熬夜回帖的我。',
      '食堂阿姨今天多给了我一个鸡腿，好运分你一半，楼里接住！',
      '下雨天值守最舒服了，雨声比白噪音 app 好用，还免费。'
    ] }
];
var AI_KEY_STORE = 'msb_ai_key';
function getAiKey(){ try{ return localStorage.getItem(AI_KEY_STORE) || ''; }catch(e){ return ''; } }

/* 纯逻辑：选人。命中触发词 + 各人格概率，至多 2 人；同帖已回复过的人格不再入选 */
function selectPersonas(user, boardId, text, existingReplies, rand){
  rand = rand || Math.random;
  if(!user || user.admin) return [];
  if(boardId === 'notice' || boardId === 'vault') return [];
  for(var i=0;i<AI_PERSONAS.length;i++) if(AI_PERSONAS[i].name === user.name) return [];
  var replied = {};
  (existingReplies || []).forEach(function(r){
    for(var j=0;j<AI_PERSONAS.length;j++) if(r.author === AI_PERSONAS[j].name + ' · ' + AI_PERSONAS[j].role) replied[AI_PERSONAS[j].id] = true;
  });
  var hit = [];
  for(var k=0;k<AI_PERSONAS.length;k++){
    var p = AI_PERSONAS[k];
    if(replied[p.id]) continue;
    var matched = false;
    for(var m=0;m<p.triggers.length;m++) if(text.indexOf(p.triggers[m]) >= 0){ matched = true; break; }
    if(matched && rand() < p.prob) hit.push(p);
  }
  for(var s=hit.length-1;s>0;s--){ var r = Math.floor(rand()*(s+1)), tmp = hit[s]; hit[s]=hit[r]; hit[r]=tmp; }
  return hit.slice(0,2);
}

/* Mock 组合：开场（50%）+ 1–2 条人格片段；terse 人格（商陆）只取一条，保证不超过两句 */
function mockReply(p, rand){
  rand = rand || Math.random;
  if(p.terse) return p.line[Math.floor(rand()*p.line.length)];
  var parts = [];
  if(p.open.length && rand() < 0.5) parts.push(p.open[Math.floor(rand()*p.open.length)]);
  var li1 = Math.floor(rand()*p.line.length);
  parts.push(p.line[li1]);
  if(rand() < 0.45){
    var li2 = Math.floor(rand()*(p.line.length-1));
    if(li2 >= li1) li2++;
    parts.push(p.line[li2]);
  }
  return parts.join('');
}

/* BYOK：调用 Moonshot/Kimi，10s 超时，失败回退 null（调用方走 mock） */
function callMoonshot(apiKey, persona, title, body, cb){
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 10000);
  var userPrompt = '帖子标题：' + title + '\n帖子内容：' + String(body).slice(0, 600) + '\n请以人设写一条回复，不超过150字。';
  fetch('https://api.moonshot.cn/v1/chat/completions', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey },
    body: JSON.stringify({
      model:'moonshot-v1-8k',
      messages:[ { role:'system', content:persona.sys }, { role:'user', content:userPrompt } ],
      temperature:0.8, max_tokens:220
    }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(data){
    clearTimeout(timer);
    var txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    txt = typeof txt === 'string' ? txt.trim() : '';
    cb(txt || null);
  }).catch(function(){ clearTimeout(timer); cb(null); });
}

/* 触发入口：发帖/回帖成功后调用（submitPost 内） */
function triggerPersonas(bid, tid, title, body){
  var u = state.user;
  var t = findThread(bid, tid);
  var chosen = selectPersonas(u, bid, String(title) + '\n' + String(body), t ? t.replies : [], Math.random);
  for(var i=0;i<chosen.length;i++){
    schedulePersona(chosen[i], bid, tid, String(title), String(body), 4000 + Math.random()*4200 + i*700);
  }
}

function schedulePersona(p, bid, tid, title, body, delay){
  setTimeout(function(){
    if(!state.user) return;                       // 已登出
    var t = findThread(bid, tid);
    if(!t){                                       // 帖子已被删
      if(state.thread === tid){                   // 且用户正停在该帖视图：清视图回列表（铁律）
        state.thread = null;
        threadViewEl.innerHTML = '';
        threadViewEl.style.display = 'none';
        threadListEl.style.display = '';
        crumbEl.textContent = '';
        renderThreadList(bid);
      }
      return;
    }
    var author = p.name + ' · ' + p.role;
    var reps = t.replies || [];
    for(var i=0;i<reps.length;i++) if(reps[i].author === author) return;   // 同帖同人格只回一次
    var done = function(text){
      if(!text) text = mockReply(p, Math.random);
      appendReplyToStore(bid, tid, { author:author, lv:p.lv, time:nowStr(), body:String(text).replace(/</g,'&lt;'), ai:true });
      if(state.user && state.board === bid && state.thread === tid){
        openThread(bid, tid, { highlightLast:true, noScroll:true });
      }
    };
    var key = getAiKey();
    if(key) callMoonshot(key, p, title, body, done);
    else done(null);
  }, delay);
}

/* ================= BYOK 设置界面（bbs-head 动态注入 [ AI 设置 ] 按钮） ================= */
function initAiSettings(){
  var statusEl = document.querySelector('.bbs-status');
  if(!statusEl || $('aiSettingsBtn')) return;
  var btn = document.createElement('button');
  btn.className = 't-btn ai-settings-btn';
  btn.id = 'aiSettingsBtn';
  btn.textContent = '[ AI 设置 ]';
  statusEl.insertBefore(btn, $('logoutBtn'));
  var mask = document.createElement('div');
  mask.className = 'ai-mask';
  mask.id = 'aiMask';
  mask.innerHTML =
    '<div class="ai-modal" id="aiModal">' +
      '<div class="ai-title">[ 人格回复引擎 · BYOK 设置 ]</div>' +
      '<div class="ai-desc">默认 Mock 模式：人格回复由本地片段池组合。<br>' +
      '填入 Moonshot / Kimi API Key 后，将调用 <span class="ai-hl">moonshot-v1-8k</span> 生成真实人格回复；请求失败或超时（10s）自动回退 Mock。</div>' +
      '<div class="ai-note">※ 密钥仅存本机浏览器 localStorage（msb_ai_key），不上传、不写入任何文件。</div>' +
      '<input type="password" id="aiKeyInput" autocomplete="off" placeholder="sk-...（留空并保存 = 清除密钥）">' +
      '<div class="ai-status" id="aiStatus"></div>' +
      '<div class="composer-actions">' +
        '<button class="t-btn primary" id="aiSave">[ 保存 ]</button>' +
        '<button class="t-btn" id="aiClear">[ 清除 ]</button>' +
        '<button class="t-btn" id="aiClose">[ 关闭 ]</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(mask);
  function refreshStatus(){
    $('aiStatus').textContent = getAiKey() ? '当前状态：真 AI 模式（已配置 Key）' : '当前状态：Mock 模式（未配置 Key）';
  }
  btn.addEventListener('click', function(){
    $('aiKeyInput').value = getAiKey();
    refreshStatus();
    mask.classList.add('on');
  });
  $('aiSave').addEventListener('click', function(){
    var k = $('aiKeyInput').value.trim();
    try{
      if(k) localStorage.setItem(AI_KEY_STORE, k);
      else localStorage.removeItem(AI_KEY_STORE);
    }catch(e){}
    refreshStatus();
    mask.classList.remove('on');
  });
  $('aiClear').addEventListener('click', function(){
    try{ localStorage.removeItem(AI_KEY_STORE); }catch(e){}
    $('aiKeyInput').value = '';
    refreshStatus();
  });
  $('aiClose').addEventListener('click', function(){ mask.classList.remove('on'); });
  mask.addEventListener('click', function(e){ if(e.target === mask) mask.classList.remove('on'); });
}

function init(){
  cacheEls();
  clearAll();                 // 不信赖任何残留 DOM，从头渲染
  $('logoutBtn').addEventListener('click', logout);
  initAiSettings();
  newThreadBtn.addEventListener('click', function(){ openComposer('new'); });
  $('postCancel').addEventListener('click', function(){ composerEl.style.display = 'none'; });
  $('postSubmit').addEventListener('click', submitPost);

  /* 身份闸门：等 auth.js 就绪后同步校验会话；未登录只显示伪装 404，任何帖子内容不得进入 DOM */
  ensureAuth().then(function(){
    var u = currentUser();
    if(!u){ show404(); return; }
    document.title = 'MSB-BBS';
    bbsEl.classList.add('on');
    enterBBS();
  }).catch(function(){ show404(); });
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
    loadUserPosts:loadUserPosts, saveUserPosts:saveUserPosts,
    loadMods:loadMods, saveMods:saveMods,
    effectivePin:effectivePin, effectiveReplies:effectiveReplies,
    appendReplyToStore:appendReplyToStore,
    deleteThreadData:deleteThreadData, deleteReplyData:deleteReplyData, togglePinData:togglePinData,
    PERSONAS:AI_PERSONAS, AI_PERSONAS:AI_PERSONAS, selectPersonas:selectPersonas, mockReply:mockReply,
    triggerPersonas:triggerPersonas,
    _state:state, _resetState:resetState
  };
}

})();

/* ============================================================
 * OC 免责声明：本文件为原创角色（OC）创作项目的虚构网站组成部分。
 * 恒序基金会、万界稳定局及站内所有数据、人物、组织、事件均为虚构，
 * 不代表任何真实机构，亦不接受任何实际捐赠。仅供创作交流与非商业演示。
 * ============================================================ */
