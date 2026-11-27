'use strict';
// 친구와 하기. 방장이 경기를 계산해서 상태를 보내고, 손님은 조작만 보낸다.
// Claude 안에서는 room 기능을, 일반 웹에서는 p2p.js의 직접 연결을 쓴다.
// 메시지가 중간에 빠질 수 있으므로, 항상 '지금 상태'를 통째로 보내고 버튼 입력은 누적 횟수로 보낸다.
const Net = (() => {
  const KEY = 'ms';                       // presence 안에서 이 게임이 쓰는 칸
  const SEND_MS = 50, LOST_MS = 6000, STALL_MS = 1500, MAX_BYTES = 3900;
  let room = null, role = null, partner = null, hostPeer = null, code = 0, direct = false, attempt = 0;
  let lastSend = 0, seenAt = 0, seq = 0, eventSeq = 0, events = [], lastEvent = 0;
  let snapSeq = -1, snapAt = 0, targets = null, menu = false, notify = () => {};
  const fresh = () => ({aD:0, bD:0, cD:0, aK:[0, 'ground', 0], bK:[0, 'ground', 0], cU:[0, 0, 0]});
  let out = fresh(), seen = null, pressedAt = {a:0, b:0, c:0}, remote = null, edges = null;
  const now = () => performance.now();
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

  // 쓸 수 있는 연결 방식: 'claude'(방 목록), 'direct'(방 번호), null(불가)
  async function init() {
    if (room && !direct) return 'claude';
    try {
      if (window.claude && window.claude.use) {
        room = await window.claude.use('room');
        return room ? 'claude' : null;
      }
    } catch (err) { room = null; return null; }
    return P2P.available() ? 'direct' : null;
  }
  function closeDirect() {
    attempt++;                               // 진행 중이던 연결 시도는 무시한다.
    if (direct && room) room.close();
    if (direct) { room = null; direct = false; }
  }
  // 직접 연결: 방을 만들고 6자리 번호를 돌려준다.
  async function hostDirect() {
    closeDirect();
    const mine = attempt, made = await P2P.host();
    if (mine !== attempt) { made.room.close(); return null; }
    room = made.room; direct = true;
    hostRoom(made.code);
    return made.code;
  }
  async function joinDirect(number) {
    closeDirect();
    const mine = attempt, made = await P2P.join(number);
    if (mine !== attempt) { made.room.close(); return false; }
    room = made.room; direct = true;
    joinRoom(made.hostId);
    return true;
  }
  const setRoom = r => { room = r; };              // 시험용
  const peers = () => room ? room.peers() : [];
  const me = () => { const p = peers().find(q => q.sameTab); return p ? p.peer : null; };
  const info = p => { const v = p && p.presence ? p.presence[KEY] : null; return v && typeof v === 'object' ? v : null; };
  function publish(value) {
    if (!room) return;
    Promise.resolve(room.presence({[KEY]:value})).catch(() => {});
  }
  // 들어갈 수 있는 방 목록
  const openRooms = () => peers().filter(p => !p.sameTab).map(p => ({peer:p.peer, v:info(p)}))
    .filter(x => x.v && x.v.r === 'h' && !x.v.g && Number.isInteger(x.v.code)).map(x => ({peer:x.peer, code:x.v.code}));

  function hostRoom(number) {
    role = 'host'; partner = null; code = number ? Number(number) : 1000 + Math.floor(Math.random() * 9000);
    publish({r:'h', code, g:null});
    return code;
  }
  function joinRoom(peer) {
    role = 'guest'; hostPeer = peer; out = fresh(); snapSeq = -1; lastEvent = -1; targets = null;
    seenAt = snapAt = now();
    publish({r:'g', h:peer, c:out});
  }
  function leave(reason = '') {
    const was = role;
    role = null; partner = hostPeer = null; remote = seen = edges = null; events = [];
    publish(null);
    closeDirect();
    if (!was) return;
    ME = 0; HUMANS = [true, false]; TEAM_NAME = ['우리 팀', 'AI 팀'];
    newMatch();
    notify('left', reason);
  }

  /* ---------- 방장 ---------- */
  function startOnline() {
    ME = 0; HUMANS = [true, true]; TEAM_NAME = ['파랑(방장)', '빨강(친구)'];
    events = []; eventSeq = 0;
    newMatch();
  }
  // 친구가 보낸 누적 횟수를 이번에 새로 눌린 입력으로 바꾼다.
  function readRemote(c) {
    if (!c || !Array.isArray(c.aK) || !Array.isArray(c.bK) || !Array.isArray(c.cU)) return;
    const num = v => Number.isFinite(v) ? v : 0;
    let mx = num(c.mx), my = num(c.my);
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    remote = {...IDLE, mx, my, sprint:!!c.s, press:!!c.p, curve:!!c.cv, aHeld:!!c.ah, bHeld:!!c.bh, cHeld:!!c.ch};
    if (!seen) { seen = JSON.parse(JSON.stringify(c)); return; }
    edges = edges || {};
    for (const k of ['a', 'b', 'c']) if (num(c[k + 'D']) > num(seen[k + 'D'])) edges[k + 'Down'] = true;
    for (const k of ['a', 'b']) if (c[k + 'K'][0] > seen[k + 'K'][0]) {
      edges[k + 'Kick'] = c[k + 'K'][1] === 'lob' ? 'lob' : 'ground';
      edges[k + 'Hold'] = num(c[k + 'K'][2]);
    }
    if (c.cU[0] > seen.cU[0]) { edges.cUp = true; edges.cHold = num(c.cU[1]); edges.curve = !!c.cU[2]; }
    seen = JSON.parse(JSON.stringify(c));
  }
  // 게임 한 칸마다 부른다. 새로 눌린 입력은 한 번만 전달한다.
  function remoteCommand() {
    if (role !== 'host' || !partner || !remote) return null;
    const cmd = edges ? {...remote, ...edges} : remote;
    edges = null;
    return cmd;
  }

  function snapshot() {
    const ps = S.players, idx = p => p ? ps.indexOf(p) : -1, b = S.ball;
    const states = ['idle', 'tackle', 'slide', 'down', 'stumble', 'dive'];
    return {
      n:++seq, t:r1(S.time), sc:S.score, fz:r2(S.freeze), ov:S.over ? r1(S.overT) + 0.1 : 0,
      m:S.msg, mt:r1(Math.max(0, S.msgT)),
      rs:S.restart && S.restart.taker ? [idx(S.restart.taker), S.restart.label] : 0,
      b:[r1(b.x), r1(b.y), r2(b.z), r1(b.vx), r1(b.vy), r1(b.vz), idx(b.owner), b.last, b.shot ? 1 : 0, b.control === null ? -1 : b.control, idx(b.target)],
      p:ps.map(p => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), Math.round(Math.atan2(p.fyd, p.fxd) * 57.3), states.indexOf(p.state),
        Math.round(Math.max(0, p.kickAnim || 0) * 100), Math.round(Math.max(0, p.diveVis || 0) * 100) * (p.diveDir < 0 ? -1 : 1),
        Math.round(p.stamina * 100) * (p.tired ? -1 : 1)]),
      s:[idx(S.sel[0]), idx(S.sel[1])], pr:[S.pressing[0] ? 1 : 0, S.pressing[1] ? 1 : 0],
    };
  }
  function hostFrame() {
    if (role !== 'host') return;
    const t = now(), list = peers(), mine = me();
    const guest = list.find(p => !p.sameTab && (partner ? p.peer === partner : true) && info(p) && info(p).r === 'g' && info(p).h === mine);
    if (!partner) {
      if (guest) { partner = guest.peer; seenAt = t; remote = seen = edges = null; startOnline(); notify('start'); }
    } else if (guest) { seenAt = t; readRemote(info(guest).c); }
    else if (t - seenAt > LOST_MS) {
      partner = null; remote = seen = edges = null;
      HUMANS = [true, false]; TEAM_NAME = ['우리 팀', 'AI 팀'];
      say('친구가 나갔어요. AI가 이어서 해요', 3);
      publish({r:'h', code, g:null});
      notify('partnerLeft');
    }
    if (partner && t - lastSend >= SEND_MS) {
      lastSend = t;
      const value = {r:'h', code, g:partner, s:snapshot(), e:events.slice()};
      // 한 번에 보낼 수 있는 크기(4KB)를 넘으면 효과부터 뺀다.
      while (value.e.length && new Blob([JSON.stringify({[KEY]:value})]).size > MAX_BYTES) value.e.shift();
      publish(value);
    }
  }
  // 방장에게서 난 효과(슛, 선방, 골 등)를 친구 화면에서도 보여준다.
  const EVENTS = ['kick', 'save', 'post', 'thud', 'goal', 'whistle'];
  for (const name of EVENTS) {
    const original = FX[name];
    FX[name] = (...args) => {
      original(...args);
      if (role === 'host' && partner) {
        events.push([++eventSeq, name, args.map(a => typeof a === 'number' ? r2(a) : a)]);
        if (events.length > 6) events.shift();
      }
    };
  }

  /* ---------- 손님 ---------- */
  function apply(s) {
    const ps = S.players, at = i => i >= 0 && i < ps.length ? ps[i] : null;
    const states = ['idle', 'tackle', 'slide', 'down', 'stumble', 'dive'];
    S.time = s.t; S.score = s.sc.slice(0, 2); S.freeze = s.fz; S.over = s.ov > 0; S.overT = s.ov;
    S.msg = String(s.m); S.msgT = s.mt;
    S.restart = s.rs ? {taker:at(s.rs[0]), label:String(s.rs[1]), t:0} : null;
    const b = S.ball, v = s.b;
    Object.assign(b, {vx:v[3], vy:v[4], vz:v[5], owner:at(v[6]), last:v[7], shot:!!v[8], control:v[9] < 0 ? null : v[9], target:at(v[10])});
    targets = {ball:{x:v[0], y:v[1], z:v[2]}, players:s.p};
    s.p.forEach((d, i) => {
      const p = ps[i];
      if (!p) return;
      p.vx = d[2]; p.vy = d[3];
      p.fxd = Math.cos(d[4] / 57.3); p.fyd = Math.sin(d[4] / 57.3); p.bx = p.fxd; p.by = p.fyd;
      p.state = states[d[5]] || 'idle';
      p.kickAnim = d[6] / 100; p.diveVis = Math.abs(d[7]) / 100; p.diveDir = d[7] < 0 ? -1 : 1;
      p.stamina = Math.abs(d[8]) / 100; p.tired = d[8] < 0;
    });
    S.sel = [at(s.s[0]), at(s.s[1])];
    S.pressing = [!!s.pr[0], !!s.pr[1]];
  }
  // 받은 상태 사이는 속도를 이용해 자연스럽게 이어준다.
  function smooth(dt) {
    if (!targets) return;
    const age = Math.min(0.25, (now() - snapAt) / 1000), k = 1 - Math.exp(-18 * dt);
    const follow = (o, x, y) => {
      if (Math.hypot(x - o.x, y - o.y) > 5) { o.x = x; o.y = y; }
      else { o.x += (x - o.x) * k; o.y += (y - o.y) * k; }
    };
    S.players.forEach((p, i) => {
      const d = targets.players[i];
      if (!d) return;
      follow(p, d[0] + d[2] * age, d[1] + d[3] * age);
      p.walk += Math.hypot(p.vx, p.vy) * dt;
    });
    const b = S.ball, t = targets.ball, vx = b.owner ? b.owner.vx : b.vx, vy = b.owner ? b.owner.vy : b.vy;
    follow(b, t.x + vx * age, t.y + vy * age);
    b.z = Math.max(0, t.z + (b.owner ? 0 : b.vz * age - 4.9 * age * age));
  }
  function guestFrame(cmd, dt) {
    if (role !== 'guest') return;
    const t = now();
    // 1. 내 조작 보내기
    let pressed = false;
    for (const k of ['a', 'b', 'c']) if (cmd[k + 'Down']) { out[k + 'D']++; pressedAt[k] = t; pressed = true; }
    for (const k of ['a', 'b']) if (cmd[k + 'Kick']) { out[k + 'K'] = [out[k + 'K'][0] + 1, cmd[k + 'Kick'], r2((t - pressedAt[k]) / 1000)]; pressed = true; }
    if (cmd.cUp) { out.cU = [out.cU[0] + 1, r2((t - pressedAt.c) / 1000), cmd.curve ? 1 : 0]; pressed = true; }
    if (pressed || t - lastSend >= SEND_MS) {
      lastSend = t;
      publish({r:'g', h:hostPeer, c:{...out, mx:r2(cmd.mx), my:r2(cmd.my), s:cmd.sprint ? 1 : 0, p:cmd.press ? 1 : 0, cv:cmd.curve ? 1 : 0,
        ah:cmd.aHeld ? 1 : 0, bh:cmd.bHeld ? 1 : 0, ch:cmd.cHeld ? 1 : 0}});
    }
    // 2. 방장의 상태 받기
    const host = peers().find(p => p.peer === hostPeer), v = info(host);
    if (!v || v.r !== 'h') { if (t - seenAt > LOST_MS) leave(snapSeq < 0 ? '방에 들어가지 못했어요. 이미 두 명이 하고 있을 수 있어요.' : '방장과 연결이 끊겼어요.'); return; }
    seenAt = t;
    const mine = me();
    if (v.g && v.g !== mine) { leave('이미 다른 친구가 들어간 방이에요.'); return; }
    if (!v.s || !Array.isArray(v.s.p) || !Array.isArray(v.s.b)) return;
    if (v.s.n > snapSeq) {
      const first = snapSeq < 0;
      if (first) { ME = 1; HUMANS = [true, true]; TEAM_NAME = ['파랑(방장)', '빨강(나)']; newMatch(); }
      snapSeq = v.s.n; snapAt = t;
      apply(v.s);
      for (const e of Array.isArray(v.e) ? v.e : []) {
        if (e[0] > lastEvent) {
          if (!first && EVENTS.includes(e[1])) FX[e[1]](...e[2]);
          lastEvent = e[0];
        }
      }
      if (first) notify('start');
    }
    smooth(dt);
    FX.track(S.ball);
    // 게이지는 통신을 기다리지 않고 내 화면에서 바로 보여준다.
    const c = S.ctl[1], attack = hasAttack(1);
    c.charging = attack && cmd.cHeld; c.charge = c.charging ? Math.min(1, (t - pressedAt.c) / 1000 / CHARGE_SEC) : 0;
    c.curveOn = !!cmd.curve;
    const sel = S.sel[1];
    c.aim = sel ? (Math.hypot(cmd.mx, cmd.my) > 0.15 ? {x:cmd.mx, y:cmd.my} : {x:sel.fxd, y:sel.fyd}) : null;
    c.passing = attack && cmd.aHeld ? 'a' : attack && cmd.bHeld ? 'b' : null;
    if (c.passing) c.power[c.passing] = Math.min(1, (t - pressedAt[c.passing]) / 1000 / PASS_CHARGE_SEC);
    if (t - snapAt > STALL_MS) say('상대 화면을 기다리는 중...', 0.3);
  }

  return {init, setRoom, hostDirect, joinDirect, openRooms, hostRoom, joinRoom, leave, hostFrame, guestFrame, remoteCommand,
    onChange:fn => { notify = fn; },
    setMenu:v => { menu = v; }, menuOpen:() => menu && role === 'host' && !!partner,
    role:() => role, isGuest:() => role === 'guest', connected:() => (role === 'host' && !!partner) || (role === 'guest' && snapSeq >= 0)};
})();
