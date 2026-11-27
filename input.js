'use strict';
// 사람의 조작을 '명령'으로 바꾼다. 게임은 이 명령만 보므로,
// 나중에 2인용을 만들 때는 두 번째 팀에 명령을 하나 더 연결하면 된다.
const Input = (() => {
  const keys = {};                       // 키보드는 PC에서 개발·시험할 때만 쓴다.
  const held = {a:false, b:false, c:false};
  let downQ = {}, upQ = {};
  let kickQ = {};                        // 패스 버튼을 뗄 때: 'ground' 또는 'lob'(위로 끈 상태)
  const stick = {x:0, y:0};
  let flick = null, samples = [], touchedAt = 0, lastFlick = 0;
  // 튕김: 짧은 시간(FLICK_MS) 안에 바깥쪽으로 FLICK_RISE px 넘게 나가고, 테두리 밖에서 끝난 움직임.
  // 방향만 돌리는 움직임은 중심에서의 거리가 거의 그대로라서 걸리지 않는다.
  const FLICK_MS = 130, FLICK_RISE = 20, FLICK_EDGE = 56, FOLLOW = 62;
  let curve = false;                     // 감아차기. 다음 슛 버튼을 누를 때까지 마지막 값을 유지한다.
  const CURVE_DRAG = 24;
  const LOB_DRAG = 26;                   // 이만큼(px) 위로 끌면 로빙
  let touchSprint = false, touchPress = false, restart = false;
  const resets = [];

  function setBtn(k, on) {
    if (held[k] === on) return;
    held[k] = on;
    (on ? downQ : upQ)[k] = true;
  }

  const ACTION = {KeyJ:'a', KeyK:'b', KeyL:'c'};
  const LOB_KEY = {KeyU:'a', KeyI:'b'};
  addEventListener('keydown', e => {
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (ACTION[e.code]) setBtn(ACTION[e.code], true);
    if (e.code === 'KeyR') restart = true;
    if (e.code === 'KeyF') flick = 'keys';
    if (LOB_KEY[e.code]) { downQ[LOB_KEY[e.code]] = true; kickQ[LOB_KEY[e.code]] = 'lob'; }
  });
  addEventListener('keyup', e => {
    keys[e.code] = false;
    const k = ACTION[e.code];
    if (k) { setBtn(k, false); if (k !== 'c') kickQ[k] = 'ground'; }
  });

  // 손가락이 화면에서 떨어졌다는 신호를 모두 처리해야 버튼이 눌린 채 남지 않는다.
  function bind(el, down, move, up) {
    let id = null;
    const end = type => { id = null; up(type); };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (err) { /* 캡처를 못 해도 입력은 계속 받는다. */ }
      down(e);
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    for (const type of ['pointerup','pointercancel','lostpointercapture'])
      el.addEventListener(type, e => { if (e.pointerId === id) end(type); });
    resets.push(end);
  }

  // 조이스틱: 손가락을 댄 곳이 중심이 된다.
  const zone = document.getElementById('zone'), pad = document.getElementById('stick'), knob = document.getElementById('knob');
  let cx = 0, cy = 0;
  function moveStick(e) {
    const dx = e.clientX - cx, dy = e.clientY - cy, r = Math.hypot(dx, dy);
    const t = performance.now();
    samples = samples.filter(s => t - s.t <= FLICK_MS);
    if (samples.length && t - touchedAt > 160 && t - lastFlick > 450
        && r >= FLICK_EDGE && r - Math.min(...samples.map(s => s.r)) >= FLICK_RISE) {
      flick = {x:dx / r, y:dy / r};
      lastFlick = t; samples = [];
    }
    // 손가락이 멀리 나가면 중심이 따라와서, 계속 밀고 있어도 다시 튕길 수 있다.
    let kept = r;
    if (r > FOLLOW) { const k = (r - FOLLOW) / r; cx += dx * k; cy += dy * k; kept = FOLLOW; }
    samples.push({t, r:kept});
    let x = (e.clientX - cx) / 48, y = (e.clientY - cy) / 48;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    stick.x = x; stick.y = y;
    knob.style.transform = `translate(${x*36}px,${y*36}px)`;
  }
  bind(zone, e => {
    const r = zone.getBoundingClientRect();
    const px = Math.max(r.left + 64, e.clientX), py = Math.min(r.bottom - 64, e.clientY);
    pad.style.left = `${px - r.left - 60}px`;
    pad.style.bottom = `${r.bottom - py - 60}px`;
    cx = px; cy = py;
    touchedAt = performance.now(); samples = [];
    moveStick(e);
  }, moveStick, () => {
    stick.x = stick.y = 0; samples = [];
    knob.style.transform = pad.style.left = pad.style.bottom = '';
  });

  // 행동 버튼: 누르는 순간 바로 입력된다. (태클, 선수 변경, 슛 모으기)
  // 패스 두 버튼은 떼는 순간 땅볼, 위로 끌어올리는 순간 로빙이 나간다.
  for (const [elId, k] of [['bA','a'], ['bB','b'], ['bC','c']]) {
    const el = document.getElementById(elId);
    let startY = 0, lobbed = false;
    bind(el,
      e => { startY = e.clientY; lobbed = false; el.classList.add('on'); if (k === 'c') { curve = false; shownCurve(el, false); } setBtn(k, true); },
      e => {
        if (k === 'c') {                  // 다시 위로 올리면 일반 슛으로 돌아온다.
          const next = e.clientY - startY > CURVE_DRAG;
          if (next !== curve) { curve = next; shownCurve(el, next); if (next && navigator.vibrate) navigator.vibrate(18); }
          return;
        }
        const up = startY - e.clientY > LOB_DRAG;              // 다시 내리면 땅볼로 돌아온다.
        if (up !== lobbed) { lobbed = up; el.classList.toggle('lob', up); if (up && navigator.vibrate) navigator.vibrate(12); }
      },
      type => {
        if (k !== 'c' && type === 'pointerup') kickQ[k] = lobbed ? 'lob' : 'ground';   // 취소된 터치는 패스하지 않는다.
        el.classList.remove('on', 'lob', 'curve'); if (k === 'c') delete el.dataset.curve; setBtn(k, false);
      });
  }

  function shownCurve(el, on) {
    el.classList.toggle('curve', on);
    if (on) el.dataset.curve = '1'; else delete el.dataset.curve;
  }

  // 달리기 버튼: 누르면 달리기, 누른 채 위로 끌어올리면 압박
  const sb = document.getElementById('bS');
  let sbY = 0, shownPress = false;
  bind(sb,
    e => { sbY = e.clientY; touchSprint = true; sb.classList.add('on'); },
    e => { touchPress = sbY - e.clientY > 32; },
    () => { touchSprint = touchPress = false; sb.classList.remove('on'); });

  // 길게 누르기 메뉴, 확대, 화면 끌림을 막는다.
  for (const type of ['contextmenu','gesturestart','dblclick','selectstart'])
    document.addEventListener(type, e => e.preventDefault());
  document.addEventListener('touchmove', e => e.preventDefault(), {passive:false});

  // 전화, 알림, 화면 전환 뒤에 입력이 남지 않게 모두 지운다.
  function reset() {
    for (const k in keys) keys[k] = false;
    for (const end of resets) end();
    held.a = held.b = held.c = false;
    downQ = {}; upQ = {}; kickQ = {};
    flick = null; samples = [];
  }
  addEventListener('blur', reset);

  return {
    reset,
    read() {
      let mx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
      let my = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
      if (!mx && !my && Math.hypot(stick.x, stick.y) > 0.2) { mx = stick.x; my = stick.y; }
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const press = !!keys.KeyE || touchPress;
      const cmd = {mx, my, press, sprint: !!(keys.ShiftLeft || keys.ShiftRight || keys.Space) || touchSprint,
        aDown:!!downQ.a, bDown:!!downQ.b, cDown:!!downQ.c, cUp:!!upQ.c, cHeld:held.c, aHeld:held.a, bHeld:held.b, restart,
        aKick:kickQ.a || null, bKick:kickQ.b || null, curve:curve || !!keys.KeyO,
        flick:flick === 'keys' ? (mx || my ? {x:mx, y:my} : null) : flick};
      flick = null;
      downQ = {}; upQ = {}; kickQ = {}; restart = false;
      if (press !== shownPress) {
        shownPress = press;
        sb.classList.toggle('press', press);
        sb.textContent = press ? '압박!' : '달리기';
        if (press && navigator.vibrate) navigator.vibrate(25);   // 아이폰은 진동을 지원하지 않는다.
      }
      return cmd;
    }
  };
})();
