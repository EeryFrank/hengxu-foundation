/* ============================================================
   统一登录校验 AUTH（Wave 2 安全加固）
   依赖：assets/bbs-data.js 全局量 ACCOUNTS / PASSWORD / ADMIN（须先于本文件引入）
   契约：
     - 管理员密码 PBKDF2 加盐哈希比对（SHA-256 · 200,000 次 · 固定盐），源码只存哈希 hex
     - 会话 msb_auth 只存 {id, ts}；读取时按 id 重新查出完整用户对象，
       admin 标记由「id === ADMIN.id」派生，不信 session 里存的任何 role/level/admin 字段
     - 账号覆盖层 localStorage「msb_accounts_v1」：{ added:{}, removed:[] }，所有账号查询统一套用
     - 登录失败锁定：连续失败 5 次锁 5 分钟
   ============================================================ */
(function(){
'use strict';

var _crypto = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : null;

var PBKDF2_ITER = 200000;
var SALT = 'msb-bbs-auth-salt:v1';
/* ADMIN.id 的口令哈希（明文不落源码） */
var ADMIN_PASS_HASH = '8afcdbfcc5aec5b5a08ff75ac70139f38025cd00c2c052072329335b7f89acb4';

var OVERLAY_KEY = 'msb_accounts_v1';
var LOCK_KEY = 'msb_login_lock_v1';
var LOCK_THRESHOLD = 5;
var LOCK_MS = 5 * 60 * 1000;

/* ---------------- PBKDF2 → hex ---------------- */
function pbkdf2Hex(pwd){
  if(!_crypto) return Promise.reject(new Error('SubtleCrypto 不可用'));
  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : { encode:function(s){ return unescape(encodeURIComponent(s)).split('').map(function(c){ return c.charCodeAt(0); }); } };
  return _crypto.subtle.importKey('raw', enc.encode(String(pwd)), 'PBKDF2', false, ['deriveBits'])
    .then(function(key){
      return _crypto.subtle.deriveBits(
        { name:'PBKDF2', hash:'SHA-256', salt:enc.encode(SALT), iterations:PBKDF2_ITER },
        key, 256);
    })
    .then(function(bits){
      var b = new Uint8Array(bits), out = '';
      for(var i=0;i<b.length;i++) out += (b[i]<16?'0':'') + b[i].toString(16);
      return out;
    });
}

/* ---------------- 账号覆盖层 ---------------- */
function normOverlay(o){
  o = o || {};
  if(!o.added || typeof o.added !== 'object') o.added = {};
  if(!Array.isArray(o.removed)) o.removed = [];
  return o;
}
function loadOverlay(){
  try{ return normOverlay(JSON.parse(localStorage.getItem(OVERLAY_KEY)) || {}); }
  catch(e){ return normOverlay({}); }
}
function saveOverlay(o){ localStorage.setItem(OVERLAY_KEY, JSON.stringify(normOverlay(o))); }

/* ---------------- 账号查询（统一套覆盖层） ---------------- */
/* 按 id 查账号 → {id,name,role,level,admin} 或 null。覆盖层 removed 的内置账号视为不存在。 */
function getAccount(id){
  if(!id || typeof id !== 'string') return null;
  id = id.toLowerCase();
  if(id === ADMIN.id) return { id:ADMIN.id, name:ADMIN.name, role:ADMIN.role, level:ADMIN.level, admin:true };
  var ov = loadOverlay();
  if(ov.added[id]){
    var a = ov.added[id];
    return { id:id, name:a.name, role:a.role, level:a.level, admin:false };
  }
  if(ov.removed.indexOf(id) >= 0) return null;
  if(ACCOUNTS[id]){
    var b = ACCOUNTS[id];
    return { id:id, name:b.name, role:b.role, level:b.level, admin:false };
  }
  return null;
}

/* 全量账号表（管理员后台用）：内置（除 removed） + 覆盖层新增；ADMIN 单列、source 标「内置·管理员」 */
function listAccounts(){
  var out = [];
  out.push({ id:ADMIN.id, name:ADMIN.name, role:ADMIN.role, level:ADMIN.level, source:'内置 · 管理员', admin:true });
  var ov = loadOverlay();
  Object.keys(ACCOUNTS).forEach(function(id){
    if(ov.removed.indexOf(id) >= 0) return;
    out.push({ id:id, name:ACCOUNTS[id].name, role:ACCOUNTS[id].role, level:ACCOUNTS[id].level, source:'内置', admin:false });
  });
  Object.keys(ov.added).forEach(function(id){
    var a = ov.added[id];
    out.push({ id:id, name:a.name, role:a.role, level:a.level, source:'新增', admin:false });
  });
  return out;
}

/* ---------------- 会话 ---------------- */
/* msb_auth 只存 {id, ts}；读取时重新查完整对象，admin 派生自 id，不信 session 里的任何权限字段 */
function currentUser(){
  try{
    var raw = sessionStorage.getItem('msb_auth');
    if(!raw) return null;
    var s = JSON.parse(raw);
    if(!s || typeof s.id !== 'string' || typeof s.ts !== 'number') return null;
    return getAccount(s.id);
  }catch(e){ return null; }
}

/* ---------------- 登录失败锁定 ---------------- */
function loadLock(){
  try{ return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails:0, until:0 }; }
  catch(e){ return { fails:0, until:0 }; }
}
function saveLock(l){ localStorage.setItem(LOCK_KEY, JSON.stringify(l)); }
function lockRemainSec(){
  var l = loadLock();
  var r = Math.ceil((l.until - Date.now()) / 1000);
  return r > 0 ? r : 0;
}

/* ---------------- 登录 ---------------- */
/* AUTH.login(acc, pwd) → Promise<user>；失败 reject({locked?, remain?, message}) */
function login(acc, pwd){
  acc = String(acc || '').trim().toLowerCase();
  pwd = String(pwd || '');
  var remain = lockRemainSec();
  if(remain > 0){
    return Promise.reject({ locked:true, remain:remain, message:'locked' });
  }
  function fail(){
    var l = loadLock();
    l.fails = (l.fails || 0) + 1;
    if(l.fails >= LOCK_THRESHOLD){ l.until = Date.now() + LOCK_MS; l.fails = 0; }
    saveLock(l);
    var r = lockRemainSec();
    return Promise.reject(r > 0 ? { locked:true, remain:r, message:'locked' } : { locked:false, message:'bad-credentials' });
  }
  function succeed(id){
    saveLock({ fails:0, until:0 });
    var u = getAccount(id);
    if(!u) return fail();
    try{ sessionStorage.setItem('msb_auth', JSON.stringify({ id:u.id, ts:Date.now() })); }catch(e){}
    return Promise.resolve(u);
  }
  /* 1) 管理员：哈希比对（先于一切普通账号校验） */
  if(acc === ADMIN.id){
    return pbkdf2Hex(pwd).then(function(h){
      return h === ADMIN_PASS_HASH ? succeed(ADMIN.id) : fail();
    });
  }
  /* 2) 覆盖层新增账号：PBKDF2 哈希比对 */
  var ov = loadOverlay();
  if(ov.removed.indexOf(acc) >= 0) return fail();
  if(ov.added[acc]){
    return pbkdf2Hex(pwd).then(function(h){
      return h === ov.added[acc].passHash ? succeed(acc) : fail();
    });
  }
  /* 3) 内置普通账号：沿用 ACCOUNTS + 统一 PASSWORD */
  if(ACCOUNTS[acc] && pwd === PASSWORD) return succeed(acc);
  return fail();
}

/* ---------------- 账号管理（仅管理员后台调用；调用方负责门禁） ---------------- */
function addAccount(id, fields){
  id = String(id || '').trim();
  if(!/^[a-z][a-z0-9_]{1,15}$/.test(id)) return Promise.reject(new Error('用户名须为小写字母开头的小写字母/数字/下划线（2–16 位）'));
  if(id === ADMIN.id || ACCOUNTS[id]) return Promise.reject(new Error('该用户名已存在（内置）'));
  var ov = loadOverlay();
  if(ov.added[id]) return Promise.reject(new Error('该用户名已存在（新增）'));
  if(!fields.name || !fields.role) return Promise.reject(new Error('姓名与职务必填'));
  if(['L1','L2','L3','L4','L5'].indexOf(fields.level) < 0) return Promise.reject(new Error('权限等级须为 L1–L5'));
  if(!fields.pass || String(fields.pass).length < 6) return Promise.reject(new Error('初始密码至少 6 位'));
  return pbkdf2Hex(fields.pass).then(function(h){
    var ov2 = loadOverlay();
    ov2.added[id] = { name:fields.name, role:fields.role, level:fields.level, passHash:h };
    saveOverlay(ov2);
    return getAccount(id);
  });
}

function removeAccount(id){
  id = String(id || '').toLowerCase();
  if(id === ADMIN.id) return Promise.reject(new Error('禁止删除管理员账号'));
  var ov = loadOverlay();
  if(ov.added[id]){ delete ov.added[id]; saveOverlay(ov); return Promise.resolve(); }
  if(ACCOUNTS[id]){
    if(ov.removed.indexOf(id) < 0) ov.removed.push(id);
    saveOverlay(ov);
    return Promise.resolve();
  }
  return Promise.reject(new Error('账号不存在'));
}

var AUTH = {
  login:login, currentUser:currentUser, getAccount:getAccount, listAccounts:listAccounts,
  addAccount:addAccount, removeAccount:removeAccount,
  lockRemainSec:lockRemainSec,
  ADMIN_PASS_HASH:ADMIN_PASS_HASH, pbkdf2Hex:pbkdf2Hex,   // 自测用
  _loadOverlay:loadOverlay
};

if(typeof window !== 'undefined') window.AUTH = AUTH;
if(typeof module !== 'undefined' && module.exports) module.exports = AUTH;

})();

/* ============================================================
 * OC 免责声明：本文件为原创角色（OC）创作项目的虚构网站组成部分。
 * 恒序基金会、万界稳定局及站内所有数据、人物、组织、事件均为虚构，
 * 不代表任何真实机构，亦不接受任何实际捐赠。仅供创作交流与非商业演示。
 * ============================================================ */
