/* الرامي المغربي — محرك اللعب (يخدم فالمتصفح وفNode) */
(function (root) {
  'use strict';
  const LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const OPEN_MIN = 51, UNOPENED_PEN = 100;

  function mk(id) {
    const k = id % 54;
    if (k >= 52) return { id, s: -1, r: 0 };
    return { id, s: Math.floor(k / 13), r: (k % 13) + 1 };
  }
  function newDeck() { const a = []; for (let i = 0; i < 108; i++) a.push(mk(i)); return a; }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const isJ = (c) => c.r === 0;
  const rv = (r) => (r === 1 ? 11 : r >= 10 ? 10 : r);           // قيمة الكارطة فالسلسلة/المجموعة/اليد
  const posVal = (p) => (p === 14 ? 11 : p === 1 ? 1 : p >= 10 ? 10 : p);
  const handVal = (c) => (isJ(c) ? 15 : rv(c.r));
  const cellOf = (c) => (c.r === 0 ? 52 : c.s * 13 + c.r - 1);
  const raw = (c) => (c.j ? { id: c.id, s: -1, r: 0 } : { id: c.id, s: c.s, r: c.r });

  /* تحليل تشكيلة: مجموعة (نفس الرقم) ولا سلسلة (نفس النوع متتالية). جوكر واحد كاع */
  function analyze(cards) {
    const n = cards.length;
    if (n < 3 || n > 14) return null;
    const js = cards.filter(isJ), ns = cards.filter((c) => !isJ(c));
    if (js.length > 1 || ns.length < 2) return null;
    const r0 = ns[0].r;
    if (ns.every((c) => c.r === r0)) {
      const suits = new Set(ns.map((c) => c.s));
      if (suits.size !== ns.length || n > 4) return null;
      const out = ns.slice().sort((a, b) => a.s - b.s).map((c) => ({ id: c.id, s: c.s, r: c.r, j: false }));
      js.forEach((c) => out.push({ id: c.id, s: -1, r: r0, j: true }));
      return { type: 'set', cards: out, pts: rv(r0) * n };
    }
    const s0 = ns[0].s;
    if (!ns.every((c) => c.s === s0)) return null;
    const ranks = ns.map((c) => c.r);
    if (new Set(ranks).size !== ranks.length) return null;
    for (const hi of [false, true]) {
      const pos = ranks.map((r) => (r === 1 && hi ? 14 : r));
      const mn = Math.min(...pos), mx = Math.max(...pos);
      const gaps = mx - mn + 1 - ns.length;
      if (gaps > js.length) continue;
      let lo = mn, up = mx;
      if (js.length - gaps > 0) { if (up < 14) up++; else if (lo > 1) lo--; else continue; }
      if (up - lo + 1 !== n) continue;
      const out = []; let pts = 0;
      for (let p = lo; p <= up; p++) {
        const k = pos.indexOf(p);
        if (k >= 0) { const c = ns[k]; out.push({ id: c.id, s: c.s, r: c.r, j: false, pos: p }); }
        else out.push({ id: js[0].id, s: s0, r: p === 14 ? 1 : p, j: true, pos: p });
        pts += posVal(p);
      }
      return { type: 'run', cards: out, pts };
    }
    return null;
  }

  /* ---------- حلّال: يلقى أحسن تشكيلات ممكنة من اليد ---------- */
  let CANDS = null;
  function genCands() {
    if (CANDS) return CANDS;
    const out = [];
    for (let r = 1; r <= 13; r++) {
      for (let m = 0; m < 16; m++) {
        const ss = []; for (let s = 0; s < 4; s++) if ((m >> s) & 1) ss.push(s);
        const cells = ss.map((s) => s * 13 + r - 1);
        if (ss.length >= 3) out.push({ cells, j: 0, pts: rv(r) * ss.length });
        if (ss.length === 2 || ss.length === 3) out.push({ cells, j: 1, pts: rv(r) * (ss.length + 1) });
      }
    }
    for (let s = 0; s < 4; s++) {
      for (let a = 1; a <= 14; a++) {
        for (let b = a + 2; b <= 14; b++) {
          if (a === 1 && b === 14) continue;
          const pos = []; for (let p = a; p <= b; p++) pos.push(p);
          const full = pos.map((p) => s * 13 + (p === 14 ? 1 : p) - 1);
          const pts = pos.reduce((x, p) => x + posVal(p), 0);
          out.push({ cells: full, j: 0, pts });
          for (let k = 0; k < pos.length; k++) out.push({ cells: full.filter((_, i) => i !== k), j: 1, pts });
        }
      }
    }
    CANDS = out; return out;
  }
  function countCells(cards) { const cnt = new Array(53).fill(0); for (const c of cards) cnt[cellOf(c)]++; return cnt; }

  function solve(cards, opt) {
    opt = opt || {};
    const cnt = countCells(cards);
    const need = opt.need;
    const cands = genCands().filter((c) => {
      const t = {}; for (const x of c.cells) t[x] = (t[x] || 0) + 1;
      for (const k in t) if (cnt[k] < t[k]) return false;
      return c.j <= cnt[52];
    });
    cands.sort((a, b) => b.pts - a.pts);
    let best = null, nodes = 0; const cap = opt.cap || 100000; const chosen = [];
    const ok = (c) => { for (const x of c.cells) if (cnt[x] <= 0) return false; return cnt[52] >= c.j; };
    const ap = (c, d) => { for (const x of c.cells) cnt[x] -= d; cnt[52] -= d * c.j; };
    (function rec(i, pts) {
      if (++nodes > cap) return;
      if (chosen.length && (need === undefined || cnt[need] === 0)) { if (!best || pts > best.pts) best = { pts, groups: chosen.slice() }; }
      for (let k = i; k < cands.length; k++) {
        const c = cands[k]; if (!ok(c)) continue;
        ap(c, 1); chosen.push(c); rec(k, pts + c.pts); chosen.pop(); ap(c, -1);
        if (nodes > cap) return;
      }
    })(0, 0);
    return best;
  }
  function assignGroups(best, cards) {
    const pool = {}; for (const c of cards) (pool[cellOf(c)] = pool[cellOf(c)] || []).push(c);
    const res = [];
    for (const g of best.groups) {
      const arr = g.cells.map((x) => pool[x].pop());
      if (g.j) arr.push(pool[52].pop());
      const a = analyze(arr); if (a) res.push({ cards: arr, pts: a.pts });
    }
    return res;
  }
  /* اقتراح تلقائي (للواجهة) */
  function suggest(hand) {
    const b = solve(hand, { cap: 60000 });
    if (!b) return { groups: [], pts: 0 };
    const gs = assignGroups(b, hand);
    return { groups: gs.map((g) => g.cards.map((c) => c.id)), pts: gs.reduce((x, g) => x + g.pts, 0) };
  }

  /* ---------- اللعبة ---------- */
  function newGame(o) {
    return {
      n: o.n, teams: !!o.teams && o.n === 4, target: o.target || 200,
      seats: o.seats.map((s) => ({ name: s.name, bot: !!s.bot })),
      scores: new Array(o.n).fill(0), round: 0, phase: 'lobby', turn: 0,
      hands: [], stock: [], discard: [], melds: [], opened: [], took: null, laid: [],
      result: null, log: [], meldSeq: 0, winnerSeat: null,
    };
  }
  const teamOf = (g, s) => (g.teams ? s % 2 : s);
  function isOpen(g, s) { return g.opened[s] || (g.teams && g.opened[(s + 2) % 4]); }
  function log(g, m) { g.log.push(m); if (g.log.length > 30) g.log.shift(); }

  function startRound(g) {
    g.round++;
    const deck = shuffle(newDeck());
    g.hands = []; for (let i = 0; i < g.n; i++) g.hands.push(deck.splice(0, 14));
    g.discard = [deck.pop()]; g.stock = deck; g.melds = [];
    g.opened = new Array(g.n).fill(false); g.turn = (g.round - 1) % g.n;
    g.phase = 'draw'; g.took = null; g.laid = []; g.result = null;
    log(g, 'جولة ' + g.round + ' بدات — الدور ل ' + g.seats[g.turn].name);
  }
  function totals(g) {
    if (g.teams) return [0, 1].map((t) => ({ seats: [t, t + 2], score: g.scores[t] + g.scores[t + 2] }));
    return g.scores.map((sc, i) => ({ seats: [i], score: sc }));
  }
  function endRound(g, winner) {
    const pen = [];
    for (let s = 0; s < g.n; s++) {
      if (s === winner) pen.push(0);
      else pen.push(isOpen(g, s) ? g.hands[s].reduce((x, c) => x + handVal(c), 0) : UNOPENED_PEN);
      g.scores[s] += pen[s];
    }
    g.result = { winner, pen };
    g.phase = 'roundEnd';
    const tt = totals(g);
    if (tt.some((t) => t.score >= g.target)) {
      let bi = 0; tt.forEach((t, i) => { if (t.score < tt[bi].score) bi = i; });
      g.winnerSeat = tt[bi].seats; g.phase = 'gameEnd';
    }
    log(g, winner >= 0 ? g.seats[winner].name + ' سالا الجولة!' : 'الجولة سالات بلا غالب');
  }
  function refill(g) {
    if (g.stock.length || g.discard.length <= 1) return;
    const top = g.discard.pop(); g.stock = shuffle(g.discard); g.discard = [top];
  }

  function canTake(g, seat, card) {
    const hand = g.hands[seat], open = isOpen(g, seat);
    if (open) {
      for (const m of g.melds) {
        const a = analyze(m.cards.map(raw).concat([card]));
        if (a && a.type === m.type) return true;
      }
    }
    const all = hand.concat([card]);
    const b = solve(all, { need: cellOf(card), cap: 50000 });
    if (!b) return false;
    if (open) return true;
    const gs = assignGroups(b, all);
    return gs.reduce((x, y) => x + y.pts, 0) >= OPEN_MIN;
  }

  const ERR = (m) => ({ ok: false, err: m });
  function act(g, seat, a) {
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd') {
      if (a.type === 'next' && seat === g.hostSeat) {
        if (g.phase === 'gameEnd') { g.scores.fill(0); g.round = 0; g.winnerSeat = null; }
        startRound(g); return { ok: true };
      }
      return ERR('تسنّى المضيف يبدا الجولة الجاية');
    }
    if (g.turn !== seat) return ERR('ماشي دورك');
    const hand = g.hands[seat];
    switch (a.type) {
      case 'draw': {
        if (g.phase !== 'draw') return ERR('سحبتي ديجا');
        if (a.from === 'discard') {
          const top = g.discard[g.discard.length - 1];
          if (!top) return ERR('المرمى خاوي');
          if (!canTake(g, seat, top)) return ERR('ما تقدرش تاخد هاد الكارطة: خاصك تنزّلها دغيا فتشكيلة' + (isOpen(g, seat) ? '' : ' (وتفتح ب 51 نقطة)'));
          g.discard.pop(); hand.push(top); g.took = top;
          log(g, g.seats[seat].name + ' خد من المرمى');
        } else {
          refill(g);
          if (!g.stock.length) { endRound(g, -1); return { ok: true }; }
          hand.push(g.stock.pop()); g.took = null;
        }
        g.phase = 'play'; g.laid = []; return { ok: true };
      }
      case 'meld': {
        if (g.phase !== 'play') return ERR('سحب قبل');
        const ids = [].concat(...a.groups);
        if (new Set(ids).size !== ids.length) return ERR('كارطة مكررة');
        const groups = [];
        for (const gr of a.groups) {
          const cs = gr.map((id) => hand.find((c) => c.id === id));
          if (cs.some((c) => !c)) return ERR('كارطة ماشي فيدك');
          const an = analyze(cs);
          if (!an) return ERR('فيه تشكيلة ماشي صحيحة');
          groups.push(an);
        }
        if (!groups.length) return ERR('ما اخترتي والو');
        const total = groups.reduce((x, y) => x + y.pts, 0);
        if (!isOpen(g, seat) && total < OPEN_MIN) return ERR('باش تفتح خاصك 51 نقطة (عندك ' + total + ')');
        for (const an of groups) {
          g.melds.push({ id: ++g.meldSeq, owner: seat, type: an.type, cards: an.cards, pts: an.pts });
          for (const c of an.cards) { g.laid.push(c.id); const k = hand.findIndex((x) => x.id === c.id); hand.splice(k, 1); }
        }
        g.opened[seat] = true;
        log(g, g.seats[seat].name + ' نزّل ' + total + ' نقطة');
        if (!hand.length) endRound(g, seat);
        return { ok: true };
      }
      case 'add': {
        if (g.phase !== 'play') return ERR('سحب قبل');
        if (!isOpen(g, seat)) return ERR('خاصك تفتح قبل');
        const m = g.melds.find((x) => x.id === a.meldId);
        if (!m) return ERR('التشكيلة ما بقاتش');
        const cs = a.ids.map((id) => hand.find((c) => c.id === id));
        if (!cs.length || cs.some((c) => !c)) return ERR('كارطة ماشي فيدك');
        const an = analyze(m.cards.map(raw).concat(cs));
        if (!an || an.type !== m.type) return ERR('ما تقدرش تزيدها هنا');
        m.cards = an.cards; m.pts = an.pts;
        for (const c of cs) { g.laid.push(c.id); hand.splice(hand.findIndex((x) => x.id === c.id), 1); }
        if (!hand.length) endRound(g, seat);
        return { ok: true };
      }
      case 'discard': {
        if (g.phase !== 'play') return ERR('سحب قبل');
        const k = hand.findIndex((c) => c.id === a.id);
        if (k < 0) return ERR('كارطة ماشي فيدك');
        if (g.took && hand.some((c) => c.id === g.took.id)) {
          const cell = cellOf(g.took);
          if (!g.laid.some((id) => cellOf(mk(id)) === cell)) return ERR('خاصك تنزّل الكارطة لي خديتي من المرمى قبل ما ترمي');
        }
        const c = hand.splice(k, 1)[0];
        g.discard.push(c);
        if (!hand.length) { endRound(g, seat); return { ok: true }; }
        g.turn = (g.turn + 1) % g.n; g.phase = 'draw'; g.took = null; g.laid = [];
        return { ok: true };
      }
    }
    return ERR('حركة ما معروفاش');
  }

  /* ---------- الكمبيوتر ---------- */
  function botTurn(g, seat) {
    const top = g.discard[g.discard.length - 1];
    let r = { ok: false };
    if (top && canTake(g, seat, top)) r = act(g, seat, { type: 'draw', from: 'discard' });
    if (!r.ok) r = act(g, seat, { type: 'draw', from: 'stock' });
    if (g.phase !== 'play') return;
    const hand = g.hands[seat];
    const b = solve(hand, { cap: 50000, need: g.took ? cellOf(g.took) : undefined });
    if (b) {
      const gs = assignGroups(b, hand);
      const pts = gs.reduce((x, y) => x + y.pts, 0);
      if (gs.length && (isOpen(g, seat) || pts >= OPEN_MIN)) act(g, seat, { type: 'meld', groups: gs.map((x) => x.cards.map((c) => c.id)) });
    }
    if (g.phase !== 'play') return;
    if (isOpen(g, seat)) {
      let again = true;
      while (again && g.phase === 'play' && g.hands[seat].length > 0) {
        again = false;
        const tk = g.took ? g.took.id : -1;
        for (const c of g.hands[seat].slice().sort((a, b) => (b.id === tk) - (a.id === tk))) {
          if (g.hands[seat].length <= 1 && c.id !== tk) break;
          for (const m of g.melds) {
            const an = analyze(m.cards.map(raw).concat([c]));
            if (an && an.type === m.type) { if (act(g, seat, { type: 'add', meldId: m.id, ids: [c.id] }).ok) { again = true; } break; }
          }
          if (again) break;
        }
      }
    }
    if (g.phase !== 'play') return;
    const h = g.hands[seat];
    const score = (c) => {
      if (isJ(c)) return 99;
      let s = 0;
      for (const d of h) {
        if (d.id === c.id || isJ(d)) continue;
        if (d.r === c.r && d.s !== c.s) s += 2;
        else if (d.s === c.s && Math.abs(d.r - c.r) <= 2) s += d.r === c.r ? 0 : 2 - Math.abs(d.r - c.r) + 1;
      }
      return s;
    };
    const order = h.slice().sort((a, b) => score(a) - score(b) || handVal(b) - handVal(a));
    for (const c of order) if (act(g, seat, { type: 'discard', id: c.id }).ok) break;
  }

  function view(g, seat) {
    return {
      n: g.n, teams: g.teams, target: g.target, phase: g.phase, round: g.round, turn: g.turn,
      scores: g.scores, seats: g.seats, counts: g.hands.map((h) => h.length),
      opened: g.seats.map((_, i) => isOpen(g, i)), hand: g.hands[seat] || [],
      stock: g.stock.length, discardTop: g.discard[g.discard.length - 1] || null, discardCount: g.discard.length,
      melds: g.melds, took: g.took ? g.took.id : null, seat, result: g.result, log: g.log.slice(-4),
      winnerSeat: g.winnerSeat, hostSeat: g.hostSeat,
    };
  }

  const API = { LABEL, SUITS, OPEN_MIN, mk, newDeck, analyze, solve, suggest, newGame, startRound, act, botTurn, view, totals, canTake, handVal, isJ, raw, cellOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Rami = API;
})(typeof self !== 'undefined' ? self : this);
