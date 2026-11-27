'use strict';
// 타격감 담당: 순간 정지, 카메라 흔들림과 확대, 파편, 공 꼬리, 골망, 효과음.
// 외부 이미지나 소리 파일 없이 모두 코드로 만든다. (proj, g, view는 game.js의 것을 쓴다.)
const FX = (() => {
  let parts, rings, trail, banner, stop, slow, shake, zoom, flash, lines, focus, nets, fire, curveTrail, impact;
  function reset() {
    parts = []; rings = []; trail = []; banner = null; impact = null;
    stop = slow = shake = zoom = flash = lines = fire = 0; curveTrail = false;
    focus = {x:480, y:280}; nets = {left:0, right:0};
  }
  reset();
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------- 소리 ---------- */
  let ac = null, noiseBuf = null, muted = false;
  function unlock() {                        // 휴대폰은 화면을 누른 뒤에만 소리를 낼 수 있다.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      if (!ac) {
        ac = new Ctx();
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state !== 'running') ac.resume();
    } catch (err) { ac = null; }
  }
  function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
    if (!ac || muted || ac.state !== 'running') return;
    const o = ac.createOscillator(), a = ac.createGain(), t = ac.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    a.gain.setValueAtTime(vol, t); a.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(a).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, f0, f1, kind = 'bandpass', attack = 0.005, delay = 0) {
    if (!ac || muted || ac.state !== 'running') return;
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), a = ac.createGain(), t = ac.currentTime + delay;
    s.buffer = noiseBuf; s.loop = true;
    fl.type = kind; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    a.gain.setValueAtTime(0.001, t); a.gain.linearRampToValueAtTime(vol, t + attack);
    a.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl).connect(a).connect(ac.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  const buzz = p => { try { if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(p); } catch (err) {} };

  /* ---------- 파편 ---------- */
  function spray(x, y, z, n, colors, spd, dirx = 0, diry = 0, up = 6, size = 3, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.283), v = rnd(spd * 0.3, spd);
      parts.push({x, y, z, vx:Math.cos(a) * v + dirx, vy:Math.sin(a) * v + diry, vz:rnd(0.5, up),
        life:rnd(life * 0.5, life), max:life, c:colors[i % colors.length], s:rnd(size * 0.6, size * 1.5)});
    }
    if (parts.length > 320) parts.splice(0, parts.length - 320);
  }
  const ring = (x, y, z, r1, dur, color, w = 4, flat = true) => {
    rings.push({x, y, z, r1, t:0, dur, color, w, flat});
    if (rings.length > 30) rings.shift();
  };
  const toScreen = (x, y, z = 0) => { const [sx, sy] = proj(x, y, z); return {x:sx, y:sy}; };

  /* ---------- 게임에서 부르는 사건 ---------- */
  function kick(x, y, dx, dy, power, perfect, curve) {
    const k = 0.25 + power * 0.75;
    trail = []; curveTrail = curve; fire = perfect ? 2 : power > 0.55 ? 1 : 0;
    stop = 0.045 + 0.085 * power + (perfect ? 0.06 : 0);   // 차는 순간 멈칫해서 힘이 실리는 느낌
    slow = perfect ? 0.34 : 0;
    shake = 3 + 11 * k + (perfect ? 4 : 0);
    zoom = 0.04 + 0.13 * k * k + (perfect ? 0.1 : 0);   // 세게 찰수록 카메라가 확 당겨진다.
    flash = perfect ? 0.55 : 0.22 * k;
    lines = power > 0.5 ? 0.28 + (perfect ? 0.14 : 0) : 0;
    focus = toScreen(x, y, 0.6);
    impact = {x, y, t:0, dur:0.22, size:22 + 38 * k + (perfect ? 16 : 0), turn:rnd(0, 6), color:perfect ? '#ffd23c' : curve ? '#c999ff' : '#fff3b0'};
    const hot = perfect ? ['#fff7c2','#ffd23c','#ff7a1a'] : curve ? ['#e9ccff','#b47bff','#ffffff'] : ['#ffffff','#ffe9a8'];
    ring(x, y, 0.4, 3 + 4 * k, 0.28, hot[1], 7 * k, false);
    ring(x, y, 0, 4 + 6 * k, 0.4, '#ffffff', 3);
    spray(x, y, 0.3, Math.round(10 + 22 * k), hot, 9 * k, -dx * 5, -dy * 5, 7, 3.2, 0.45);      // 불꽃
    spray(x, y, 0.05, Math.round(8 + 14 * k), ['#7ccf5a','#3d7a35','#8a6a42'], 5 * k, -dx * 6, -dy * 6, 5, 3, 0.7); // 잔디와 흙
    // 소리: 발등에 맞는 '뻥' + 가죽 타격 + 바람 가르는 소리
    tone(190 + 60 * k, 42, 0.16 + 0.1 * k, 0.28 + 0.3 * k, 'sine');
    noise(0.07, 0.25 + 0.3 * k, 2600, 600, 'bandpass', 0.002);
    noise(0.22 + 0.25 * k, 0.05 + 0.1 * k, 600, curve ? 3800 : 2400, 'bandpass', 0.05, 0.03);
    if (perfect) { tone(880, 880, 0.12, 0.08, 'triangle', 0.02); tone(1320, 1320, 0.2, 0.08, 'triangle', 0.1); }
    buzz(perfect ? [30, 30, 55] : Math.round(15 + 35 * k));
    if (perfect) banner = {text:curve ? '환상의 감아차기!' : '퍼펙트 슛!', color:'#ffd23c', t:0, dur:1.0, size:34};
    else if (curve) banner = {text:'감아차기!', color:'#d9b3ff', t:0, dur:0.8, size:28};
  }
  function save(x, y, z, caught) {
    stop = Math.max(stop, 0.09); shake = Math.max(shake, 8); zoom = Math.max(zoom, 0.045);
    focus = toScreen(x, y, z); fire = 0;
    ring(x, y, z, 4, 0.3, '#ffffff', 5, false);
    spray(x, y, z, 20, ['#ffffff','#bfe3ff','#ffd23c'], 7, 0, 0, 6, 2.8, 0.4);
    tone(130, 55, 0.14, 0.35); noise(0.09, 0.3, 1400, 400);
    if (!caught) noise(0.5, 0.08, 500, 900, 'bandpass', 0.12, 0.05);     // 관중의 탄성
    banner = {text:'선방!', color:'#9fd4ff', t:0, dur:0.8, size:30};
    buzz(30);
  }
  function post(x, y, z) {
    stop = Math.max(stop, 0.08); shake = Math.max(shake, 10); focus = toScreen(x, y, z); fire = 0;
    ring(x, y, z, 3.5, 0.3, '#ffe95c', 4, false);
    spray(x, y, z, 18, ['#fff','#ffe95c'], 8, 0, 0, 5, 2.5, 0.35);
    tone(1250, 1180, 0.55, 0.2, 'triangle'); tone(1870, 1790, 0.4, 0.09, 'triangle');
    buzz(40);
  }
  function thud(x, y, z) {
    shake = Math.max(shake, 4); spray(x, y, z, 8, ['#fff','#ddd'], 5, 0, 0, 4, 2.4, 0.3);
    tone(150, 70, 0.09, 0.2);
  }
  function goal(x, y, z) {
    const side = x > 52 ? 'right' : 'left';
    nets[side] = 1; stop = 0.12; slow = 0.5; shake = 16; zoom = 0.1; flash = 0.65; lines = 0.35; fire = 0;
    focus = toScreen(x, y, z);
    ring(x, y, z, 9, 0.5, '#ffffff', 6, false);
    for (let i = 0; i < 4; i++) spray(x + (side === 'right' ? -6 : 6), y + (i - 1.5) * 5, 3, 36,
      ['#ffd23c','#ff5a4a','#4ad2ff','#7dffb0','#ffffff'], 9, 0, 0, 13, 3.4, 1.8);
    tone(95, 40, 0.35, 0.5);
    noise(2.4, 0.3, 700, 1300, 'bandpass', 0.18); noise(2.2, 0.16, 1800, 2600, 'bandpass', 0.3, 0.1);   // 함성
    tone(660, 660, 0.16, 0.1, 'square', 0.12); tone(880, 880, 0.3, 0.1, 'square', 0.3);
    banner = {text:'GOAL!', color:'#ffe95c', t:0, dur:2.2, size:96};
    buzz([60, 40, 60, 40, 120]);
  }
  function whistle() { tone(2300, 2250, 0.22, 0.07, 'square'); }
  const perfectCue = () => { tone(1500, 1500, 0.05, 0.07, 'triangle'); buzz(12); };

  /* ---------- 시간 ---------- */
  // 한 프레임의 실제 시간(초)을 받아, 게임이 진행할 시간의 비율을 돌려준다.
  function frame(dt) {
    let scale = 1;
    if (stop > 0) { stop -= dt; scale = 0; }
    else if (slow > 0) { slow -= dt; scale = 0.4; }
    const k = stop > 0 ? 0.25 : 1;                // 멈춘 순간에는 효과도 천천히
    shake *= Math.exp(-7 * dt * k); zoom *= Math.exp(-3.4 * dt * k); flash *= Math.exp(-9 * dt);
    lines = Math.max(0, lines - dt * k);
    for (const n in nets) nets[n] *= Math.exp(-1.8 * dt);
    for (const p of parts) {
      p.life -= dt * k; p.vz -= 18 * dt * k;
      p.x += p.vx * dt * k; p.y += p.vy * dt * k; p.z += p.vz * dt * k;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.7; p.vy *= 0.7; }
    }
    parts = parts.filter(p => p.life > 0);
    for (const r of rings) r.t += dt * k;
    rings = rings.filter(r => r.t < r.dur);
    if (impact) { impact.t += dt * (stop > 0 ? 0.3 : 1); if (impact.t > impact.dur) impact = null; }
    if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
    return scale;
  }
  // 공의 지나온 길을 기록한다. (게임이 한 칸 진행할 때마다)
  function track(b) {
    if (b.shot && !b.owner && Math.hypot(b.vx, b.vy) > 12) {
      trail.push({x:b.x, y:b.y, z:b.z});
      if (trail.length > 22) trail.shift();
      if (fire === 2) spray(b.x, b.y, b.z + 0.3, 4, ['#ffd23c','#ff7a1a','#fff7c2'], 2.6, 0, 0, 2, 4.2, 0.38);
      else if (curveTrail && trail.length % 2) spray(b.x, b.y, b.z + 0.3, 1, ['#c999ff','#ffffff'], 1.2, 0, 0, 1, 2.2, 0.35);
    } else if (trail.length) trail.shift();
  }

  /* ---------- 그리기 ---------- */
  function camera() {
    const sx = shake > 0.3 ? rnd(-shake, shake) : 0, sy = shake > 0.3 ? rnd(-shake, shake) * 0.7 : 0;
    const z = 1 + zoom;
    g.translate(focus.x + sx, focus.y + sy); g.scale(z, z); g.translate(-focus.x, -focus.y);
  }
  function drawTrail() {
    if (trail.length < 2) return;
    const layers = fire === 2 ? [['#ff3d1f', 30, .5], ['#ff9a1f', 19, .85], ['#fff3a8', 9, 1]]
      : curveTrail ? [['#7b2cff', 23, .45], ['#c999ff', 14, .85], ['#ffffff', 5, 1]]
      : fire === 1 ? [['#ffb13b', 18, .4], ['#ffe9a8', 10, .8], ['#ffffff', 4, 1]]
      : [['#ffffff', 7, .5]];
    g.lineCap = 'round';
    for (const [color, width, alpha] of layers) {
      for (let i = 1; i < trail.length; i++) {
        const f = i / (trail.length - 1);                   // 공에 가까울수록 굵고 진하다.
        const a = proj(trail[i-1].x, trail[i-1].y, trail[i-1].z + 0.35), c = proj(trail[i].x, trail[i].y, trail[i].z + 0.35);
        g.globalAlpha = alpha * f; g.strokeStyle = color; g.lineWidth = Math.max(0.5, width * f);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke();
      }
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
  }
  function drawWorld() {
    if (impact) {
      const f = impact.t / impact.dur, [x, y] = proj(impact.x, impact.y, 0.5);
      for (const [color, scale] of [[impact.color, 1], ['#ffffff', 0.55]]) {
        const R = impact.size * scale * (0.7 + f * 0.8) * (1 - f * f * 0.6);
        g.beginPath();
        for (let i = 0; i < 20; i++) {
          const a = impact.turn + i * Math.PI / 10, r = i % 2 ? R * 0.3 : R * (i % 4 ? 0.72 : 1);
          g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
        }
        g.closePath(); g.globalAlpha = 1 - f; g.fillStyle = color; g.fill();
      }
      g.globalAlpha = 1;
    }
    for (const r of rings) {
      const f = r.t / r.dur, e = 1 - (1 - f) * (1 - f);
      const [x, y, s] = proj(r.x, r.y, r.z);
      const rad = Math.max(1, r.r1 * 8.35 * s * e);
      g.globalAlpha = 1 - f; g.strokeStyle = r.color; g.lineWidth = Math.max(0.5, r.w * (1 - f));
      g.beginPath(); g.ellipse(x, y, rad, rad * (r.flat ? 0.48 : 1), 0, 0, 6.2832); g.stroke();
    }
    for (const p of parts) {
      const [x, y, s] = proj(p.x, p.y, p.z);
      g.globalAlpha = Math.min(1, p.life / (p.max * 0.4)); g.fillStyle = p.c;
      g.fillRect(x - p.s * s / 2, y - p.s * s / 2, p.s * s, p.s * s);
    }
    g.globalAlpha = 1;
  }
  // 힘을 모으는 동안 발밑의 원과 빨려 들어오는 빛
  function drawCharge(px, py, charge, perfect, curve, time) {
    const [x, y, s] = proj(px, py);
    const color = curve ? '#c999ff' : perfect ? '#ffd23c' : charge > 0.8 ? '#ff5a4a' : '#ffffff';
    g.strokeStyle = color;
    g.globalAlpha = 0.35 + charge * 0.55; g.lineWidth = 2 + charge * 3;
    const r = (13 + charge * 13 + Math.sin(time * 28) * 2 * charge) * s;
    g.beginPath(); g.ellipse(x, y, r, r * 0.48, 0, 0, 6.2832); g.stroke();
    g.lineWidth = 1.8;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = i * 0.628 + time * (curve ? 7 : 1.5), t = 1 - ((time * 2.4 + i * 0.37) % 1);
      const r0 = (10 + t * 34) * s, r1 = r0 + (4 + charge * 9) * s, bend = curve ? 0.45 : 0;
      g.moveTo(x + Math.cos(a) * r0, y - 11 * s + Math.sin(a) * r0 * 0.75);
      g.lineTo(x + Math.cos(a + bend) * r1, y - 11 * s + Math.sin(a + bend) * r1 * 0.75);
    }
    g.stroke(); g.globalAlpha = 1;
  }
  function drawScreen() {
    if (lines > 0) {                                        // 집중선
      g.strokeStyle = '#ffffff'; g.globalAlpha = Math.min(0.5, lines * 1.8);
      g.beginPath();
      for (let i = 0; i < 38; i++) {
        const a = i / 38 * 6.2832 + rnd(-0.05, 0.05), r0 = rnd(250, 360);
        g.moveTo(focus.x + Math.cos(a) * r0, focus.y + Math.sin(a) * r0 * 0.6);
        g.lineTo(focus.x + Math.cos(a) * 760, focus.y + Math.sin(a) * 760 * 0.6);
      }
      g.lineWidth = 2.5; g.stroke(); g.globalAlpha = 1;
    }
    if (flash > 0.02) {
      g.globalAlpha = Math.min(0.7, flash); g.fillStyle = '#fff';
      g.fillRect(view.l - 1, view.t - 1, view.w + 2, view.h + 2);
      g.globalAlpha = 1;
    }
    if (banner) {
      const pop = 1 + Math.max(0, 0.18 - banner.t) * 4;      // 크게 튀어나왔다가 제자리로
      g.save();
      g.translate(480, banner.size > 60 ? 250 : 170); g.rotate(-0.05); g.scale(pop, pop);
      g.globalAlpha = Math.min(1, (banner.dur - banner.t) * 4);
      g.font = `italic 900 ${banner.size}px sans-serif`; g.textAlign = 'center';
      g.lineJoin = 'round'; g.lineWidth = banner.size * 0.16; g.strokeStyle = '#101018'; g.strokeText(banner.text, 0, 0);
      g.fillStyle = banner.color; g.fillText(banner.text, 0, 0);
      g.restore();
    }
  }

  return {reset, unlock, kick, save, post, thud, goal, whistle, perfectCue, frame, track, camera,
    drawTrail, drawWorld, drawCharge, drawScreen,
    net: side => nets[side],
    toggleMute() { muted = !muted; return muted; }};
})();
