'use strict';
const E = window.Rami;
const $ = (s) => document.querySelector(s);
const app = $('#app');
const ls = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

let role = null;            // 'host' | 'client' | 'local'
let H = null;               // حالة المضيف
let peer = null, conn = null;
let V = null, LB = null, mySeat = 0, code = '';
let sel = new Set(), pend = [], sortMode = 'suit', botTimer = null, screenName = 'home';
let cfg = { n: 2, teams: false, target: 200 };
let myName = ls.get('rami_name', '');

/* ---------- أدوات ---------- */
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function cardHtml(c, o) {
  o = o || {};
  const jk = c.r === 0, red = c.s === 1 || c.s === 2;
  if (o.back) return '<div class="card back"></div>';
  const cls = ['card', red ? 'red' : '', jk ? 'jk' : '', c.j ? 'jv' : '', o.sel ? 'sel' : '', o.took ? 'took' : ''].join(' ');
  const rk = jk ? '★' : E.LABEL[c.r];
  const su = jk ? 'JOKER' : E.SUITS[c.s < 0 ? 0 : c.s];
  const suit = c.j ? '★' : su;
  return '<div class="' + cls + '" data-id="' + c.id + '">' + rk + '<i>' + suit + '</i></div>';
}
function sortHand(h) {
  const a = h.slice();
  const key = (c) => (c.r === 0 ? 999 : sortMode === 'suit' ? c.s * 20 + c.r : c.r * 5 + c.s);
  return a.sort((x, y) => key(x) - key(y));
}

/* ---------- الشبكة ---------- */
function loadPeer(cb) {
  if (window.Peer) return cb();
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  s.onload = cb; s.onerror = () => toast('ما قدرناش نتّصلو بالأنترنت — تأكد من الشبكة');
  document.head.appendChild(s);
}
const rcode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };

function newHost(n, teams) {
  H = { n, teams, seats: new Array(n).fill(null), g: null, target: cfg.target };
  H.seats[0] = { name: myName || 'أنا', local: true };
  role = 'host';
}
function hostRoom() {
  if (!myName) return toast('كتب سميتك أولا');
  newHost(cfg.n, cfg.teams);
  code = rcode();
  loadPeer(() => {
    const open = () => {
      peer = new Peer('rami-' + code);
      peer.on('open', () => { screenName = 'lobby'; renderLobby(); });
      peer.on('connection', (c) => {
        c.on('data', (m) => hostMsg(c, m));
        c.on('close', () => hostLeft(c)); c.on('error', () => hostLeft(c));
      });
      peer.on('error', (e) => { if (e.type === 'unavailable-id') { code = rcode(); open(); } else toast('مشكل فالشبكة: ' + e.type); });
    };
    open();
  });
}
function localSolo() {
  if (!myName) return toast('كتب سميتك أولا');
  newHost(cfg.n, cfg.teams); role = 'local';
  hostStart();
}
function hostMsg(c, m) {
  if (m.t === 'join') {
    if (H.g) return c.send({ t: 'err', m: 'اللعبة بدات ديجا' });
    const free = H.seats.indexOf(null);
    if (free < 0) return c.send({ t: 'err', m: 'الغرفة عامرة' });
    H.seats[free] = { name: String(m.name || 'لاعب').slice(0, 14), conn: c };
    hostBroadcast();
  } else if (m.t === 'act') {
    const seat = H.seats.findIndex((s) => s && s.conn === c);
    if (seat < 0 || !H.g) return;
    const r = E.act(H.g, seat, m.a);
    if (!r.ok) c.send({ t: 'err', m: r.err }); else hostBroadcast();
  }
}
function hostLeft(c) {
  const i = H.seats.findIndex((s) => s && s.conn === c);
  if (i < 0) return;
  if (H.g) { H.seats[i].conn = null; H.seats[i].bot = true; H.g.seats[i].bot = true; H.g.seats[i].name += ' (خرج)'; }
  else H.seats[i] = null;
  hostBroadcast();
}
function lobbyData() { return { n: H.n, teams: H.teams, seats: H.seats.map((s) => (s ? { name: s.name } : null)) }; }
function hostBroadcast() {
  if (!H.g) {
    LB = lobbyData();
    H.seats.forEach((s, i) => { if (s && s.conn) s.conn.send({ t: 'lobby', lb: LB, you: i }); });
    mySeat = H.seats.findIndex((s) => s && s.local);
    if (screenName === 'lobby') renderLobby();
    return;
  }
  const g = H.g;
  H.seats.forEach((s, i) => { if (s && s.conn) s.conn.send({ t: 'view', v: E.view(g, i) }); });
  mySeat = H.hostSeatIdx; V = E.view(g, mySeat); onView();
  if ((g.phase === 'draw' || g.phase === 'play') && g.seats[g.turn].bot && !botTimer) {
    botTimer = setTimeout(() => { botTimer = null; if (!H || !H.g) return; E.botTurn(H.g, H.g.turn); hostBroadcast(); }, 1300);
  }
}
function hostStart() {
  const seats = [];
  let b = 0;
  for (let i = 0; i < H.n; i++) {
    const s = H.seats[i];
    if (s) seats.push({ name: s.name, bot: false }); else { b++; seats.push({ name: 'كمبيوتر ' + b, bot: true }); H.seats[i] = { name: 'كمبيوتر ' + b, bot: true }; }
  }
  H.g = E.newGame({ n: H.n, teams: H.teams, target: H.target, seats });
  H.hostSeatIdx = H.seats.findIndex((s) => s.local);
  H.g.hostSeat = H.hostSeatIdx;
  E.startRound(H.g);
  screenName = 'game'; sel.clear(); pend = [];
  hostBroadcast();
}
function joinRoom(c) {
  if (!myName) return toast('كتب سميتك أولا');
  c = c.trim().toUpperCase(); if (c.length < 4) return toast('كتب الكود');
  code = c; role = 'client';
  loadPeer(() => {
    peer = new Peer();
    peer.on('open', () => {
      conn = peer.connect('rami-' + code, { reliable: true });
      const to = setTimeout(() => { toast('ما لقينا الغرفة — تأكد من الكود'); }, 8000);
      conn.on('open', () => { clearTimeout(to); conn.send({ t: 'join', name: myName }); });
      conn.on('data', (m) => {
        if (m.t === 'lobby') { LB = m.lb; mySeat = m.you; screenName = 'lobby'; renderLobby(); }
        else if (m.t === 'view') { V = m.v; mySeat = V.seat; screenName = 'game'; onView(); }
        else if (m.t === 'err') toast(m.m);
      });
      conn.on('close', () => { toast('تقطع الاتصال'); screenName = 'home'; role = null; renderHome(); });
    });
    peer.on('error', (e) => toast('مشكل فالشبكة: ' + e.type));
  });
}
function doAct(a) {
  if (role === 'client') { conn.send({ t: 'act', a }); return; }
  const r = E.act(H.g, H.hostSeatIdx, a);
  if (!r.ok) toast(r.err); else hostBroadcast();
}
function leave() {
  try { if (peer) peer.destroy(); } catch (e) {}
  clearTimeout(botTimer); botTimer = null;
  peer = null; conn = null; H = null; V = null; role = null; screenName = 'home'; renderHome();
}

/* ---------- الصفحة الرئيسية ---------- */
function seg(id, opts, cur) {
  return '<div class="row seg" id="' + id + '">' + opts.map((o) => '<button data-v="' + o[0] + '" class="' + (String(o[0]) === String(cur) ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div>';
}
function renderHome() {
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = '<div class="screen"><div class="logo">🃏 الرامي</div><div class="sub">لعبة الورق مع الأصحاب</div>' +
    '<div class="box"><input id="nm" placeholder="سميتك" maxlength="14" value="' + esc(myName) + '">' +
    '<div>عدد اللاعبين</div>' + seg('sn', [[2, '2 لاعبين'], [4, '4 لاعبين']], cfg.n) +
    '<div id="tm" style="' + (cfg.n === 4 ? '' : 'display:none') + '">نمط 4 لاعبين</div>' +
    '<div id="tmb" style="' + (cfg.n === 4 ? '' : 'display:none') + '">' + seg('st', [[0, 'كل واحد لوحدو'], [1, 'فرق 2 ضد 2']], cfg.teams ? 1 : 0) + '</div>' +
    '<div>تسالى اللعبة فاش واحد يوصل ل</div>' + seg('sg', [[100, '100'], [200, '200'], [300, '300']], cfg.target) +
    '<button id="bSolo">🤖 العب ضد الكمبيوتر</button>' +
    '<button id="bHost" class="sec">👥 دير غرفة مع الأصحاب</button></div>' +
    '<div class="box"><div>عندك كود ديال غرفة؟</div><input id="cd" placeholder="الكود" maxlength="6" style="direction:ltr;text-transform:uppercase" value="' + esc(urlRoom) + '">' +
    '<button id="bJoin" class="sec">دخل للغرفة</button></div>' +
    '<button class="sec" id="bRules" style="max-width:440px;width:100%">📖 القوانين</button></div>';
  const rd = () => { myName = $('#nm').value.trim(); ls.set('rami_name', myName); };
  $('#nm').oninput = rd;
  $('#sn').onclick = (e) => { const v = e.target.dataset.v; if (v) { cfg.n = +v; if (cfg.n === 2) cfg.teams = false; renderHome(); } };
  const st = $('#st'); if (st) st.onclick = (e) => { const v = e.target.dataset.v; if (v !== undefined) { cfg.teams = v === '1'; renderHome(); } };
  $('#sg').onclick = (e) => { const v = e.target.dataset.v; if (v) { cfg.target = +v; renderHome(); } };
  $('#bSolo').onclick = () => { rd(); localSolo(); };
  $('#bHost').onclick = () => { rd(); hostRoom(); };
  $('#bJoin').onclick = () => { rd(); joinRoom($('#cd').value); };
  $('#bRules').onclick = showRules;
}
function showRules() {
  const d = document.createElement('div'); d.className = 'ov';
  d.innerHTML = '<div class="box" style="max-height:90%;overflow:auto;line-height:1.7;font-size:14px"><b style="font-size:18px">قوانين الرامي</b>' +
    '<div>• 108 كارطة (2 ديال الجيو + 4 جوكر). كل لاعب كياخد 14 كارطة.</div>' +
    '<div>• فدورك: <b>سحب</b> كارطة من الكومة (ولا خد آخر كارطة مرمية) ← نزّل تشكيلات ← <b>رمي</b> كارطة.</div>' +
    '<div>• التشكيلة: <b>سلسلة</b> (3+ كارطات متتابعين من نفس النوع، A كتجي قبل 2 ولا بعد K) ولا <b>مجموعة</b> (3 ولا 4 بنفس الرقم وأنواع مختلفة). جوكر واحد فكل تشكيلة.</div>' +
    '<div>• أول مرة كتنزّل خاص مجموع التشكيلات يكون <b>51 نقطة</b> فأكثر. (A=11 ولا 1 فبداية السلسلة، J/Q/K=10)</div>' +
    '<div>• من بعد ما تفتح تقدر تزيد كارطات على أي تشكيلة فالطابلة (حدد الكارطات وكبس على التشكيلة).</div>' +
    '<div>• إلا خديتي من المرمى خاصك تنزّل هاد الكارطة دغيا. وما تقدرش تاخدها إلا كنتي قادر تنزّلها (ولا تفتح ب51).</div>' +
    '<div>• اللي يسالي الكارطات ديالو كيغلب الجولة. الباقيين كيتحسبو عليهم نقاط الكارطات لي بقات فيدهم (جوكر 15) — ولي ما فتحش 100.</div>' +
    '<div>• اللي يوصل ل ' + (cfg.target) + ' نقطة كيخسر؛ الغالب هو اللي عندو أقل نقاط.</div>' +
    '<button id="x">فهمت</button></div>';
  document.body.appendChild(d); d.querySelector('#x').onclick = () => d.remove();
}

/* ---------- اللوبي ---------- */
function renderLobby() {
  const lb = LB || lobbyData();
  const link = location.origin + location.pathname + '?room=' + code;
  const isHost = role === 'host';
  let h = '<div class="screen"><div class="logo" style="font-size:36px">الغرفة</div>';
  if (isHost) h += '<div class="box"><div>كود الغرفة (عطيه لصحابك)</div><div class="code">' + code + '</div><button id="bShare" class="sec">📤 شارك الرابط</button></div>';
  h += '<div class="box"><div>اللاعبين (' + lb.n + ')' + (lb.teams ? ' — فرق: 1+3 ضد 2+4' : '') + '</div>';
  lb.seats.forEach((s, i) => {
    h += '<div class="seat ' + (lb.teams ? 't' + (i % 2) : '') + '"><span>' + (i + 1) + '. ' + (s ? esc(s.name) + (i === mySeat ? ' (أنا)' : '') : '<i style="opacity:.6">🤖 كمبيوتر (إلا ما جا حد)</i>') + '</span>' +
      (isHost && i < lb.n - 1 ? '<button class="sec" data-sw="' + i + '" style="padding:4px 10px">⇅</button>' : '') + '</div>';
  });
  h += '</div>';
  if (isHost) {
    h += '<div class="box">' + seg('sn', [[2, '2 لاعبين'], [4, '4 لاعبين']], lb.n) +
      (lb.n === 4 ? seg('st', [[0, 'كل واحد لوحدو'], [1, 'فرق 2 ضد 2']], lb.teams ? 1 : 0) : '') +
      '<button id="bGo">▶ بدا اللعب</button></div>';
  } else h += '<div class="hint">تسنّى المضيف يبدا اللعب…</div>';
  h += '<button class="sec" id="bLeave">خروج</button></div>';
  app.innerHTML = h;
  $('#bLeave').onclick = leave;
  if (!isHost) return;
  $('#bShare').onclick = () => { if (navigator.share) navigator.share({ title: 'الرامي', text: 'تعال نلعبو الرامي! الكود: ' + code, url: link }).catch(() => {}); else { try { navigator.clipboard.writeText(link); toast('تنسخ الرابط'); } catch (e) { toast(link); } } };
  app.querySelectorAll('[data-sw]').forEach((b) => (b.onclick = () => { const i = +b.dataset.sw; [H.seats[i], H.seats[i + 1]] = [H.seats[i + 1], H.seats[i]]; hostBroadcast(); }));
  $('#sn').onclick = (e) => {
    const v = +e.target.dataset.v; if (!v) return;
    if (H.seats.filter(Boolean).length > v) return toast('بزاف ديال اللاعبين لهاد العدد');
    const cur = H.seats.filter(Boolean); H.n = v; H.seats = cur.concat(new Array(v - cur.length).fill(null)); if (v === 2) H.teams = false; hostBroadcast();
  };
  const st = $('#st'); if (st) st.onclick = (e) => { const v = e.target.dataset.v; if (v !== undefined) { H.teams = v === '1'; hostBroadcast(); } };
  $('#bGo').onclick = hostStart;
}

/* ---------- اللعبة ---------- */
function onView() {
  const ids = new Set(V.hand.map((c) => c.id));
  sel = new Set([...sel].filter((i) => ids.has(i)));
  pend = pend.map((g) => g.filter((i) => ids.has(i))).filter((g) => g.length);
  if (V.turn !== V.seat || V.phase !== 'play') { /* احتفظ بالمجموعات */ }
  screenName = 'game'; renderGame();
}
const handById = (id) => V.hand.find((c) => c.id === id);
function teamLabel(t) { const a = V.seats[t].name, b = V.seats[t + 2].name; return a + ' + ' + b; }

function renderGame() {
  const v = V, me = v.seat, myTurn = v.turn === me && (v.phase === 'draw' || v.phase === 'play');
  const pendIds = new Set([].concat(...pend));
  let h = '<div id="top"><b>جولة ' + v.round + '</b>';
  if (v.teams) [0, 1].forEach((t) => { h += '<span class="sc ' + (t === me % 2 ? 'me' : '') + '">' + esc(teamLabel(t)) + ': ' + (v.scores[t] + v.scores[t + 2]) + '</span>'; });
  else v.seats.forEach((s, i) => { h += '<span class="sc ' + (i === me ? 'me' : '') + '">' + esc(s.name) + ': ' + v.scores[i] + '</span>'; });
  h += '<span style="margin-inline-start:auto;opacity:.7">🎯 ' + v.target + '</span><button class="sec" id="bOut" style="padding:2px 8px;font-size:12px">خروج</button></div>';
  h += '<div class="opps">';
  for (let k = 1; k < v.n; k++) {
    const i = (me + k) % v.n;
    h += '<div class="opp ' + (v.turn === i && v.phase !== 'roundEnd' ? 'turn' : '') + '">' + (v.seats[i].bot ? '🤖 ' : '') + esc(v.seats[i].name) + '<small>🂠 ' + v.counts[i] + (v.opened[i] ? ' ✓فاتح' : '') + '</small></div>';
  }
  h += '</div><div id="table">';
  for (let k = 0; k < v.n; k++) {
    const i = (me + k) % v.n, ms = v.melds.filter((m) => m.owner === i);
    if (!ms.length) continue;
    h += '<div><div class="owner">' + (i === me ? 'تشكيلاتي' : esc(v.seats[i].name)) + '</div><div class="melds">' +
      ms.map((m) => '<div class="meld ' + (myTurn && v.phase === 'play' && sel.size ? 'tgt' : '') + '" data-m="' + m.id + '">' + m.cards.map((c) => cardHtml(c)).join('') + '</div>').join('') + '</div></div>';
  }
  if (!v.melds.length) h += '<div class="hint" style="margin-top:20px">ما كاين حتى تشكيلة بعد</div>';
  h += '</div>';
  const canDraw = myTurn && v.phase === 'draw';
  h += '<div class="mid"><div class="pile ' + (canDraw ? 'tap' : '') + '" id="pStock">' + cardHtml({}, { back: 1 }) + 'الكومة (' + v.stock + ')</div>' +
    '<div class="pile ' + (canDraw ? 'tap' : '') + '" id="pDisc">' + (v.discardTop ? cardHtml(v.discardTop) : '<div class="card"></div>') + 'المرمى</div></div>';
  h += '<div id="me" class="me-t ' + (myTurn ? 'turn' : '') + '">';
  const pg = pend.map((g) => g.map(handById).filter(Boolean));
  const pendPts = pend.reduce((s, g) => { const a = E.analyze(g.map(handById).filter(Boolean)); return s + (a ? a.pts : 0); }, 0);
  if (pg.length) h += '<div id="pend"><span>مجموعات واجدة (' + pendPts + ' نقطة):</span>' + pg.map((g, gi) => '<div class="meld" data-pg="' + gi + '">' + g.map((c) => cardHtml(c)).join('') + '</div>').join('') + '</div>';
  if (v.phase === 'draw' && myTurn) h += '<div class="hint">دورك! اسحب من الكومة ولا خد المرمى 👆</div>';
  else if (v.phase === 'play' && myTurn) {
    h += '<div id="acts"><button id="bGrp" class="sec">➕ جمّع</button><button id="bAuto" class="sec">✨ اقتراح</button>' +
      '<button id="bLay" ' + (pend.length ? '' : 'disabled') + '>⬇ نزّل</button><button id="bDis" class="red">🗑 رمي</button></div>';
  } else if (v.phase === 'draw' || v.phase === 'play') h += '<div class="hint">الدور ديال ' + esc(v.seats[v.turn].name) + '…</div>';
  h += '<div id="hand">' + sortHand(v.hand.filter((c) => !pendIds.has(c.id))).map((c) => cardHtml(c, { sel: sel.has(c.id), took: v.took === c.id })).join('') + '</div>';
  h += '<div style="text-align:center;margin-top:4px"><button class="sec" id="bSort" style="padding:3px 10px;font-size:12px">رتب: ' + (sortMode === 'suit' ? 'بالنوع' : 'بالرقم') + '</button></div></div>';
  if (v.phase === 'roundEnd' || v.phase === 'gameEnd') h += resultHtml();
  app.innerHTML = h;
  bindGame(myTurn);
}
function resultHtml() {
  const v = V, r = v.result || { winner: -1, pen: [] };
  let h = '<div class="ov"><div class="box"><b style="font-size:20px;text-align:center">' + (v.phase === 'gameEnd' ? '🏆 سالات اللعبة' : 'سالات الجولة') + '</b>';
  if (r.winner >= 0) h += '<div style="text-align:center">' + (r.winner === v.seat ? '🎉 ربحتي الجولة!' : esc(v.seats[r.winner].name) + ' سالا الكارطات') + '</div>';
  h += '<table><tr><th></th><th>هاد الجولة</th><th>المجموع</th></tr>';
  v.seats.forEach((s, i) => { h += '<tr><td>' + esc(s.name) + '</td><td>+' + r.pen[i] + '</td><td>' + v.scores[i] + '</td></tr>'; });
  h += '</table>';
  if (v.teams) h += '<div>' + [0, 1].map((t) => esc(teamLabel(t)) + ': <b>' + (v.scores[t] + v.scores[t + 2]) + '</b>').join(' &nbsp;|&nbsp; ') + '</div>';
  if (v.phase === 'gameEnd') {
    const w = v.winnerSeat || [];
    h += '<div style="text-align:center;font-size:18px">الغالب: <b>' + w.map((i) => esc(v.seats[i].name)).join(' + ') + '</b> ' + (w.includes(v.seat) ? '🎉' : '') + '</div>';
  }
  if (v.seat === v.hostSeat) h += '<button id="bNext">' + (v.phase === 'gameEnd' ? 'لعبة جديدة' : 'الجولة الجاية ▶') + '</button>';
  else h += '<div class="hint">تسنّى المضيف…</div>';
  return h + '</div></div>';
}
function bindGame(myTurn) {
  const v = V;
  $('#bOut').onclick = () => { if (confirm('تخرج من اللعبة؟')) leave(); };
  const nx = $('#bNext'); if (nx) nx.onclick = () => { sel.clear(); pend = []; doAct({ type: 'next' }); };
  $('#bSort').onclick = () => { sortMode = sortMode === 'suit' ? 'rank' : 'suit'; renderGame(); };
  $('#pStock').onclick = () => { if (myTurn && v.phase === 'draw') doAct({ type: 'draw', from: 'stock' }); };
  $('#pDisc').onclick = () => { if (myTurn && v.phase === 'draw') doAct({ type: 'draw', from: 'discard' }); };
  $('#hand').onclick = (e) => {
    const el = e.target.closest('.card'); if (!el) return; const id = +el.dataset.id;
    if (sel.has(id)) sel.delete(id); else sel.add(id); renderGame();
  };
  app.querySelectorAll('[data-pg]').forEach((el) => (el.onclick = () => { pend.splice(+el.dataset.pg, 1); renderGame(); }));
  app.querySelectorAll('.meld[data-m]').forEach((el) => (el.onclick = () => {
    if (!myTurn || v.phase !== 'play') return;
    if (!sel.size) return toast('حدد الكارطات لي بغيتي تزيد أول');
    const ids = [...sel]; sel.clear(); doAct({ type: 'add', meldId: +el.dataset.m, ids });
  }));
  const g = $('#bGrp'); if (!g) return;
  g.onclick = () => {
    const cs = [...sel].map(handById).filter(Boolean);
    const a = E.analyze(cs); if (!a) return toast('هاد الكارطات ماشي تشكيلة صحيحة');
    pend.push(cs.map((c) => c.id)); sel.clear(); toast(a.pts + ' نقطة'); renderGame();
  };
  $('#bAuto').onclick = () => {
    const s = E.suggest(v.hand);
    if (!s.groups.length) return toast('ما لقيت حتى تشكيلة');
    pend = s.groups; sel.clear();
    toast(s.pts + ' نقطة' + (!v.opened[v.seat] && s.pts < E.OPEN_MIN ? ' — ما كافياش باش تفتح (51)' : '')); renderGame();
  };
  $('#bLay').onclick = () => { const gs = pend; pend = []; sel.clear(); doAct({ type: 'meld', groups: gs }); };
  $('#bDis').onclick = () => {
    if (sel.size !== 1) return toast('حدد كارطة وحدة باش ترميها');
    const id = [...sel][0]; sel.clear(); doAct({ type: 'discard', id });
  };
}

renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
