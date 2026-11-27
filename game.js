'use strict';
const cv = document.getElementById('c');
const g = cv.getContext('2d');

// 960x540 장면을 휴대폰 화면 비율에 맞춰 가운데에 놓고, 남는 곳은 배경으로 채운다.
const view = {scale:1, x:0, y:0, w:960, h:540};
function resize() {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);      // 배터리와 발열을 위해 최대 2배
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const k = Math.min(w / 960, h / 540);
  view.scale = k * dpr;
  view.x = (w - 960 * k) / 2 * dpr; view.y = (h - 540 * k) / 2 * dpr;
  view.w = w / k; view.h = h / k;
}
addEventListener('resize', resize);
if (window.visualViewport) visualViewport.addEventListener('resize', resize);
const fullRect = () => g.fillRect(-(view.w - 960) / 2 - 1, -(view.h - 540) / 2 - 1, view.w + 2, view.h + 2);

/* ---------- 설정 (미터 단위) ---------- */
const PW = 105, PH = 68, CY = PH/2, GOAL_HALF = 4, BAR = 2.5;
const DT = 1/60, MATCH_SEC = 180;
const RUN = 5.2, SPRINT = 9.8;
const WITH_BALL = 0.94;
// 슛: 게이지 0~1에 따른 속도(m/s)와 골문 앞에서의 높이(m). SWEET_MAX를 넘기면 공이 뜬다.
const SHOT_MIN = 15, SHOT_MAX = 41, SWEET_MIN = 0.55, SWEET_MAX = 0.80, CHARGE_SEC = 1.0;
const shotSpeed = p => SHOT_MIN + (SHOT_MAX - SHOT_MIN) * p;
const shotHeight = p => p <= SWEET_MAX ? 0.15 + Math.pow(p / SWEET_MAX, 1.6) * 1.9
                                       : 2.05 + (p - SWEET_MAX) / (1 - SWEET_MAX) * 3.0;               // 드리블 중에는 조금 느리다.
// 골키퍼 세기: 반응 시간(초), 슛을 막으러 가는 속도, 막는 범위
// 골키퍼 세기. save: 막을 수 있는 슛일 때, beaten: 골키퍼를 뚫은 슛일 때
const GK = {save:{react:0.10, speed:10.5, reach:2.3}, beaten:{react:0.30, speed:5.8, reach:0.7}};
const PERFECT_MIN = 0.68;
// 패스: 게이지가 속도를 정한다. 살짝 누르면 느리고 짧게, 오래 누르면 빠르고 길게.
const PASS_MIN = 13, PASS_MAX = 34, PASS_CHARGE_SEC = 0.75, PASS_TAP = 0.12;
const passSpeed = p => PASS_MIN + (PASS_MAX - PASS_MIN) * p;
// 달리기 체력(0~1): DRAIN초를 달리면 바닥나고, RECOVER초 쉬면 가득 찬다. 바닥나면 TIRED_UNTIL까지 못 뛴다.
const STAMINA_DRAIN = 4.5, STAMINA_RECOVER = 10, TIRED_UNTIL = 0.35, TIRED_SPEED = 5.0, SPRINT_FROM = 7.5;             // PERFECT_MIN ~ SWEET_MAX가 퍼펙트 구간
// 골키퍼를 뚫을 확률(0~1). 방향이 가장 중요하고 타이밍·거리·자세가 더해진다.
function beatChance(power, aim, distance, curve, wobble) {
  const corner = clamp((Math.abs(aim) - 0.3) / 0.6, 0, 1);       // 구석을 겨냥한 정도
  const timing = power > SWEET_MAX + 0.02 ? 0.5 : power >= PERFECT_MIN ? 0.92
    : power >= 0.2 ? 0.72 : 0.35;                                 // 낮고 약한 슛도 방향이 좋으면 통한다.
  const far = clamp((distance - 15) / 13, 0, 1);                  // 15m부터 어려워진다.
  const range = 1 - far * (curve ? 0.62 : 0.72);
  return clamp((0.03 + corner * (timing + (curve ? 0.05 : 0))) * range * (1 - wobble * 0.7), 0, 0.95);
}
// 0: 파랑(오른쪽으로 공격), 1: 빨강(왼쪽으로 공격)
let ME = 0;                           // 이 기기에서 조작하는 팀
let HUMANS = [true, false];           // 사람이 조작하는 팀. 친구와 하면 둘 다 true
const isHuman = t => HUMANS[t];
const newControl = () => ({charging:false, charge:0, curveOn:false, aim:null, armed:{a:false, b:false},
  power:{a:0, b:0}, passing:null, queued:null, switchT:0, switchSeen:new Set()});
const IDLE = {mx:0, my:0, press:false, sprint:false, aDown:false, bDown:false, cDown:false, cUp:false,
  cHeld:false, aHeld:false, bHeld:false, restart:false, aKick:null, bKick:null, curve:false};
let TEAM_NAME = ['우리 팀', 'AI 팀'];
// 4-4-2: [자기 골라인에서의 거리, 세로 위치]
const FORMATION = [[3,34],
  [24,10],[21,25],[21,43],[24,58],
  [48,10],[44,26],[44,42],[48,58],
  [65,27],[65,41]];

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dirOf = t => t === 0 ? 1 : -1;                 // 공격 방향
const goalX = t => t === 0 ? PW : 0;                 // 공격하는 골의 x
const ownX = t => t === 0 ? 0 : PW;
const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return [x/m, y/m]; };

let S;

/* ---------- 경기 준비 ---------- */
function newMatch() {
  FX.reset();
  const players = [];
  for (let t = 0; t < 2; t++) FORMATION.forEach(([fx, fy], i) => {
    players.push({team:t, num:i+1, gk:i === 0, fx, fy, x:0, y:0, vx:0, vy:0, fxd:dirOf(t), fyd:0,
      state:'idle', timer:0, cool:0, kickCool:0, think:rand(0, .5), walk:0, won:false,
      stamina:1, tired:false, bx:dirOf(t), by:0, turnShock:0});
  });
  S = {players, ball:{x:PW/2, y:CY, z:0, vx:0, vy:0, vz:0, owner:null, last:0, target:null, shot:false, shotAge:0, held:0, control:null, ox:0, oy:0, minRun:0, cax:0, cay:0, curveT:0, beaten:false, guess:0},
    sel:[null, null], score:[0,0], time:0, freeze:0, restart:null, msg:'', msgT:0, over:false,
    overT:0, ctl:[newControl(), newControl()], pressing:[false,false]};
  kickoff(0);
}

function say(m, t = 1.8) { S.msg = m; S.msgT = t; }

function kickoff(team) {
  FX.whistle();
  for (const p of S.players) {
    const d = Math.min(p.fx * 0.72, 49);
    p.x = p.team === 0 ? d : PW - d;
    p.y = p.fy; p.vx = p.vy = 0; p.state = 'idle'; p.timer = p.cool = p.kickCool = 0;
    p.fxd = dirOf(p.team); p.fyd = 0; p.bx = p.fxd; p.by = 0; p.turnShock = 0;
    p.stamina = Math.min(1, p.stamina + 0.4); p.tired = false;
  }
  const mine = S.players.filter(p => p.team === team);
  const a = mine[9], b = mine[10];
  a.x = PW/2 - dirOf(team) * 0.8; a.y = CY;
  b.x = PW/2 - dirOf(team) * 2; b.y = CY + 8;
  for (const p of S.players) if (p.team !== team && Math.hypot(p.x - PW/2, p.y - CY) < 9.5) p.x = PW/2 - dirOf(p.team) * 10;
  setRestart(a, PW/2, CY, '킥오프');
  S.sel[1 - team] = nearest(1 - team, S.ball, p => !p.gk);
}

// 정지 상황: 한 선수가 공을 가지고, 패스하면 경기가 다시 시작된다.
function setRestart(p, x, y, label) {
  const b = S.ball;
  Object.assign(b, {x, y, z:0, vx:0, vy:0, vz:0, owner:p, last:p.team, target:null, shot:false, held:0, control:p.team, minRun:0, cax:0, cay:0, curveT:0});
  p.x = clamp(x - dirOf(p.team) * 0.7, -1, PW + 1); p.y = y;
  p.vx = p.vy = 0; p.state = 'idle'; p.timer = 0;
  const [fx, fy] = label === '킥오프' ? [dirOf(p.team), 0] : norm(PW/2 - x, CY - y);
  p.fxd = fx; p.fyd = fy; p.bx = fx; p.by = fy; p.turnShock = 0;
  for (const q of S.players) {
    if (q.team !== p.team && !q.gk && dist(q, b) < 7) {
      const [ux, uy] = norm(PW/2 - x || dirOf(p.team), CY - y);
      q.x = x + ux * 7.5; q.y = y + uy * 7.5;
    }
  }
  S.restart = {taker:p, label, t:0};
  const c = S.ctl[p.team];
  c.queued = null; c.armed.a = c.armed.b = false;
  S.sel[p.team] = p;
  c.charging = false;
  say(label, 1.2);
}

function nearest(team, pt, filter = () => true) {
  let best = null, bd = 1e9;
  for (const p of S.players) if (p.team === team && filter(p)) {
    const d = dist(p, pt);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

const busy = p => p.state !== 'idle';

/* ---------- 자세(밸런스) ---------- */
// 0이면 안정, 1이면 아주 불안정. (dx, dy)는 공을 보내려는 방향이다.
function imbalance(p, dx, dy, oneTouch = false) {
  if (S.restart && S.restart.taker === p) return 0;            // 정지 상황에서는 자세를 잡고 찬다.
  const [ux, uy] = norm(dx, dy);
  const speed = Math.hypot(p.vx, p.vy);
  const [mx, my] = norm(p.bx, p.by);
  const turned = clamp((0.5 - (mx * ux + my * uy)) / 1.5, 0, 1);  // 몸이 60도 넘게 틀어진 정도
  let v = turned * 0.55;
  v += clamp((speed - 6) / 4, 0, 1) * 0.28;                    // 전력 질주 중
  v += p.turnShock * 0.3;                                      // 방금 급하게 방향을 바꿈
  let near = 9;
  for (const o of S.players) if (o.team !== p.team && !busy(o)) near = Math.min(near, dist(p, o));
  v += clamp((2.6 - near) / 1.4, 0, 1) * 0.22;                 // 상대의 압박
  if (oneTouch) v += 0.16;                                     // 원터치
  if (p.tired) v += 0.15;                                      // 지친 상태
  return clamp(isHuman(p.team) ? v : v * 0.5, 0, 1);
}

function updateBody(p) {
  // 몸은 방향 입력보다 천천히 돌아간다.
  const k = 1 - Math.exp(-7 * DT);
  const before = Math.atan2(p.by, p.bx);
  p.bx += (p.fxd - p.bx) * k; p.by += (p.fyd - p.by) * k;
  [p.bx, p.by] = norm(p.bx || p.fxd, p.by || p.fyd);
  let turn = Math.atan2(p.by, p.bx) - before;
  turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) / DT;
  const shock = Math.hypot(p.vx, p.vy) > 3.5 ? clamp((turn - 3) / 6, 0, 1) : 0;
  p.turnShock = Math.max(shock, p.turnShock - DT * 2.2);
}

// 체력: 빠르게 뛰면 줄고, 천천히 움직이면 찬다.
function updateStamina(p) {
  if (p.gk) return;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > SPRINT_FROM && p.state === 'idle') p.stamina -= DT / STAMINA_DRAIN;
  else p.stamina += DT / STAMINA_RECOVER * (speed < 2 ? 1.5 : 1);
  p.stamina = clamp(p.stamina, 0, 1);
  if (p.stamina <= 0) p.tired = true;
  else if (p.tired && p.stamina >= TIRED_UNTIL) p.tired = false;
}

/* ---------- 공 차기 ---------- */
function release(p) {
  const b = S.ball;
  b.owner = null; b.last = p.team; b.held = 0; p.kickCool = 0.35;
  if (S.restart && S.restart.taker === p) S.restart = null;
}

// 조작 방향과 가장 가까운 동료를 고른다.
function pickTarget(p, ax, ay, ideal, through) {
  let best = null, bs = -1e9;
  for (const q of S.players) {
    if (q.team !== p.team || q === p) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d < 3) continue;
    const align = (dx * ax + dy * ay) / d;
    let open = 8;
    for (const o of S.players) if (o.team !== p.team) open = Math.min(open, dist(o, q));
    // 스루패스는 앞에 있는 동료를 더 우선한다.
    const ahead = through ? clamp((q.x - p.x) * dirOf(p.team), -20, 20) * 0.8 : 0;
    const sc = align * 60 - Math.abs(d - ideal) * 0.7 + open * 1.5 + ahead - (q.gk ? 20 : 0);
    if (sc > bs) { bs = sc; best = q; }
  }
  return best;
}

// power가 없으면(AI, 자동 패스) 거리에 맞는 세기를 고른다.
function pass(p, ax, ay, lob, err = 0, through = false, power = null, oneTouch = false) {
  const ideal = power === null ? (lob ? 30 : 14) : 7 + power * (lob ? 45 : 35);
  const q = pickTarget(p, ax, ay, ideal, through);
  if (!q) return;
  const b = S.ball;
  let tx = q.x + q.vx * 0.5, ty = q.y + q.vy * 0.5;
  if (through) {                                          // 동료가 달려갈 앞 공간으로 보낸다.
    const [rx, ry] = norm(dirOf(p.team) + q.vx * 0.04, q.vy * 0.06 + ay * 0.35);
    const lead = clamp(4 + dist(p, q) * 0.22, 6, 13);
    tx = clamp(q.x + rx * lead, 3, PW - 3); ty = clamp(q.y + ry * lead, 3, PH - 3);
  }
  tx += rand(-err, err); ty += rand(-err, err);
  let d = Math.hypot(tx - b.x, ty - b.y), [ux, uy] = norm(tx - b.x, ty - b.y);
  if (power === null) {
    const need = lob ? (d - 7) / 46 : (0.8 * d + (through ? 6 : 8) - PASS_MIN) / (PASS_MAX - PASS_MIN);
    power = clamp(need, PASS_TAP, 1);
  }
  // 자세가 불안정하면 방향과 세기가 흔들린다.
  const wobble = imbalance(p, ux, uy, oneTouch);
  const angle = rand(-1, 1) * wobble * wobble * 0.55 + rand(-1, 1) * wobble * 0.2;
  [ux, uy] = [ux * Math.cos(angle) - uy * Math.sin(angle), ux * Math.sin(angle) + uy * Math.cos(angle)];
  power = clamp(power * (1 + rand(-0.22, 0.22) * wobble), 0.05, 1);
  release(p);
  p.fxd = ux; p.fyd = uy; p.bx = ux; p.by = uy;
  b.cax = b.cay = b.curveT = 0;
  let aimDist = d;
  if (lob) {
    // 로빙은 게이지가 날아가는 거리를 크게 좌우한다.
    aimDist = d * 0.35 + (7 + power * 46) * 0.65;
    const T = 0.72 + aimDist / 43;
    b.vx = ux * aimDist / T * 0.97; b.vy = uy * aimDist / T * 0.97; b.vz = 9.8 * T / 2; b.z = 0.15;
  } else {
    const v = passSpeed(power);
    b.vx = ux * v; b.vy = uy * v; b.vz = 0;
    aimDist = Math.min(d, v / 0.8 - 3);                    // 약하게 차면 공이 그만큼 짧게 간다.
  }
  b.target = q; b.targetT = 0; b.shot = false; b.through = through;
  b.ox = b.x; b.oy = b.y; b.minRun = through ? Math.max(0, aimDist - 3) : 0;
  if (wobble > 0.5 && isHuman(p.team)) say('자세 불안정!', 0.8);
  if (S.sel[p.team] === p || p.gk) S.sel[p.team] = q;
}

// 슛 방향 보정: 골대를 이 각도 이내로 살짝 벗어나게 겨냥하면 골대 안쪽으로 맞춰 준다.
const AIM_ASSIST = 25 * Math.PI / 180;
// aim이 숫자면(AI, 시험) 골문 안의 위치(-1~1), {x, y}면 조이스틱 방향이다.
function shotTarget(p, aim) {
  const b = S.ball, gx = goalX(p.team), dir = dirOf(p.team), half = GOAL_HALF - 0.9;
  if (typeof aim === 'number') return {x:gx, y:CY + clamp(aim, -1, 1) * half, onGoal:true};
  const [ux, uy] = norm(aim.x, aim.y);
  const ahead = (gx - b.x) * dir;
  if (ux * dir > 0.05 && ahead > 0.5) {
    // 골대 방향을 기준으로 한 각도로 비교한다.
    const angle = Math.atan2(uy, ux * dir);
    const low = Math.atan2(CY - half - b.y, ahead), high = Math.atan2(CY + half - b.y, ahead);
    if (angle >= low - AIM_ASSIST && angle <= high + AIM_ASSIST) {
      const y = b.y + Math.tan(clamp(angle, low, high)) * ahead;
      return {x:gx, y, onGoal:true};
    }
    const y = b.y + Math.tan(angle) * ahead;
    if (Math.abs(y - b.y) < 60) return {x:gx, y, onGoal:false};
  }
  return {x:b.x + ux * 25, y:b.y + uy * 25, onGoal:false};      // 골대와 먼 방향은 그대로 찬다.
}

function shoot(p, power, aimInput, err, curve = false, oneTouch = false) {
  const b = S.ball;
  let target = shotTarget(p, aimInput);
  // 감아차기를 방향 입력 없이 차면 먼 쪽 골대를 노린다.
  if (curve && typeof aimInput === 'number' && Math.abs(aimInput) < 0.35) target = shotTarget(p, (p.y < CY ? 1 : -1) * 0.85);
  const aim = target.onGoal ? clamp((target.y - CY) / (GOAL_HALF - 0.9), -1, 1) : 0;
  const wobble = imbalance(p, target.x - b.x, target.y - b.y, oneTouch);
  const perfect = target.onGoal && power >= PERFECT_MIN && power <= SWEET_MAX && Math.abs(aim) > 0.55 && wobble < 0.35;
  const spread = rand(-err, err) * (perfect ? 0.45 : 0.75) + rand(-1, 1) * wobble * wobble * 5.5;
  const tx = target.x, ty = target.y + spread;
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
  const [ux, uy] = norm(dx, dy);
  const v = shotSpeed(power) * (curve ? 0.88 : 1) * (1 - wobble * 0.18);
  // 골라인에 닿을 때 원하는 높이가 되도록 띄우는 힘을 계산한다.
  const T = d / v;
  const h = Math.max(0.1, shotHeight(power) + rand(-0.12, 0.12) * err + rand(-0.6, 1.3) * wobble * wobble * 2);
  release(p);
  p.fxd = ux; p.fyd = uy; p.kickAnim = 0.32;
  b.z = 0.2;
  b.vx = ux * v; b.vy = uy * v; b.vz = clamp((h - b.z + 4.9 * T * T) / T, 0.4, 18);
  b.cax = b.cay = b.curveT = 0;
  if (curve) {
    // 골대 바깥쪽으로 출발했다가 안으로 휘어 들어온다. T초 뒤에는 겨냥한 곳에 도착한다.
    let nx = -uy, ny = ux;
    if (ny * (aim || 1) < 0) { nx = -nx; ny = -ny; }
    const bulge = clamp(d * 0.15, 1.8, 4.2), acc = 8 * bulge / (T * T);
    b.vx += nx * acc * T / 2; b.vy += ny * acc * T / 2;
    b.cax = -nx * acc; b.cay = -ny * acc; b.curveT = T * 1.15;
  }
  b.target = null; b.shot = true; b.shotAge = 0; b.control = null; b.minRun = 0; b.bent = curve;
  b.beaten = target.onGoal && Math.random() < beatChance(power, aim, d, curve, wobble) * (isHuman(p.team) ? 1 : 0.65);   // AI 슛은 조금 약하게
  b.guess = rand(-0.2, 0.2);
  const [lx, ly] = norm(b.vx, b.vy);
  FX.kick(p.x + p.fxd * 0.8, p.y + p.fyd * 0.8, lx, ly, power, perfect, curve);
  p.bx = p.fxd; p.by = p.fyd;
  if (wobble > 0.5 && isHuman(p.team)) say('자세 불안정!', 0.8);
}

/* ---------- 수비 ---------- */
function standTackle(p, ax, ay) {
  if (busy(p) || p.cool > 0) return;
  if (!ax && !ay) [ax, ay] = norm(S.ball.x - p.x, S.ball.y - p.y);
  [p.fxd, p.fyd] = norm(ax, ay);
  p.state = 'tackle'; p.timer = 0.24; p.cool = 0.65; p.won = false;
}

function slideTackle(p, ax, ay) {
  if (busy(p) || p.cool > 0 || p.gk) return;
  if (!ax && !ay) [ax, ay] = norm(S.ball.x - p.x, S.ball.y - p.y);
  [p.fxd, p.fyd] = norm(ax, ay);
  p.state = 'slide'; p.timer = 0.48; p.cool = 1.5; p.won = false;
}

// 태클 중인 선수가 공에 닿았는지 확인한다.
function checkTackle(p) {
  const b = S.ball, o = b.owner;
  if (p.won || b.z > 1 || (S.restart) || (o && (o.team === p.team || o.gk))) return;
  const slide = p.state === 'slide';
  const fx = p.x + p.fxd * 0.8, fy = p.y + p.fyd * 0.8;
  if (Math.hypot(b.x - fx, b.y - fy) > (slide ? 1.35 : 1.25)) return;
  p.won = true;                                         // 한 번의 태클에 한 번만 판정
  const ai = !isHuman(p.team) || S.sel[p.team] !== p;
  const chance = o ? (slide ? 0.82 : 0.68) - (ai ? 0.18 : 0) : 1;
  if (Math.random() > chance) return;
  if (o) { o.kickCool = 0.8; o.state = 'stumble'; o.timer = slide ? 0.8 : 0.4; }
  b.last = p.team; b.target = null; b.shot = false; b.control = p.team; b.minRun = 0;
  if (slide) {
    // 공이 멀리 흘러가지 않게 해서 바로 다시 잡을 수 있게 한다.
    b.owner = null; b.vx = p.fxd * 5 + rand(-1.5, 1.5); b.vy = p.fyd * 5 + rand(-1.5, 1.5); b.vz = 0.8; p.kickCool = 0.2;
    S.sel[p.team] = p;
  } else gain(p);
}

// 공격 버튼(패스/스루/슛)을 쓸 수 있는 상태인지 판단한다.
// 공을 가졌을 때, 패스를 받는 중일 때, 흘러나온 공을 우리가 먼저 잡을 수 있을 때다.
function hasAttack(team) {
  const b = S.ball;
  if (b.owner) return b.owner.team === team;
  if (b.target) return b.target.team === team;
  if (b.control !== team) return false;
  const mine = nearest(team, b, p => !p.gk), foe = nearest(1 - team, b);
  return dist(mine, b) < 8 && dist(mine, b) <= dist(foe, b) + 1.2;
}

function gain(p) {
  const b = S.ball;
  b.control = p.team; b.minRun = 0; b.cax = b.cay = b.curveT = 0;
  b.owner = p; b.last = p.team; b.target = null; b.shot = false; b.z = 0; b.vz = 0; b.held = 0;
  S.sel[p.team] = p;
  p.think = rand(0.25, 0.55);
}

// 공이 앞으로 지나갈 길을 계산해서, 선수가 가장 먼저 닿을 수 있는 지점을 찾는다.
function meetPoint(p, speed) {
  const b = S.ball;
  let {x, y, z, vx, vy, vz} = b;
  const step = DT * 3;
  for (let t = step; t < 3.2; t += step) {
    x += vx * step; y += vy * step;
    if (z > 0 || vz > 0) {
      vz -= 9.8 * step; z += vz * step;
      if (z <= 0) { z = 0; vz = vz < -2 ? -vz * 0.5 : 0; vx *= 0.82; vy *= 0.82; }
    } else { const f = Math.exp(-0.8 * step); vx *= f; vy *= f; }
    if (Math.hypot(x - b.ox, y - b.oy) < b.minRun && Math.hypot(vx, vy) > 3) continue;
    if (z < 1.6 && Math.hypot(x - p.x, y - p.y) <= speed * t * 0.85 + 0.8) break;
  }
  return {x:clamp(x, 0.4, PW - 0.4), y:clamp(y, 0.4, PH - 0.4)};
}

// 패스를 받는 선수는 만나는 지점으로 곧장 달려간다.
function runToPass(p, speed) {
  const pt = meetPoint(p, speed);
  const dx = pt.x - p.x, dy = pt.y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.3) {
    steer(p, 0, 0, 0);
    [p.fxd, p.fyd] = norm(S.ball.x - p.x, S.ball.y - p.y);
  } else steer(p, dx / d, dy / d, speed * Math.min(1, d / 1.2 + 0.35));
}

function kickAction(p, act, ax, ay, oneTouch = false) {
  if (act.type === 'shot') return shoot(p, act.power, act.aim, 0.6, act.curve, oneTouch);
  pass(p, ax, ay, act.lob, 0, act.type === 'through', act.power, oneTouch);
}

function switchPlayer(team, ax = 0, ay = 0) {
  const cur = S.sel[team], c = S.ctl[team];
  // 조이스틱을 밀고 있으면, 지금 선수에서 그 방향(좌우 65도 안)에 있는 선수를 고른다.
  if (cur && Math.hypot(ax, ay) > 0.3) {
    const [ux, uy] = norm(ax, ay);
    let best = null, bs = 1e9;
    for (const q of S.players) {
      if (q.team !== team || q === cur || q.gk) continue;
      const d = dist(cur, q);
      const align = ((q.x - cur.x) * ux + (q.y - cur.y) * uy) / (d || 1);
      if (align < 0.42) continue;
      const sc = d * (1 + (1 - align) * 3);        // 방향이 정확할수록, 가까울수록 먼저
      if (sc < bs) { bs = sc; best = q; }
    }
    if (best) { S.sel[team] = best; c.switchT = 0; return; }
  }
  // 방향 입력이 없거나 그쪽에 선수가 없으면 공에서 가까운 순서로 바꾼다.
  if (c.switchT <= 0) c.switchSeen.clear();
  if (cur) c.switchSeen.add(cur);
  let next = nearest(team, S.ball, p => !p.gk && !c.switchSeen.has(p));
  if (!next) { c.switchSeen.clear(); next = nearest(team, S.ball, p => !p.gk && p !== cur); }
  S.sel[team] = next;
  c.switchT = 1;
}

/* ---------- 선수 이동 ---------- */
function steer(p, dx, dy, speed) {
  // 지친 선수는 느려진다. (패스를 받으러 갈 때는 예외)
  if (p.tired && !p.gk && S.ball.target !== p) speed = Math.min(speed, TIRED_SPEED);
  const k = 1 - Math.exp(-11 * DT);
  p.vx += (dx * speed - p.vx) * k;
  p.vy += (dy * speed - p.vy) * k;
  if (Math.hypot(dx, dy) > 0.2) [p.fxd, p.fyd] = norm(dx, dy);
}

function goTo(p, x, y, speed) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d < 0.35) return steer(p, 0, 0, 0);
  steer(p, dx / d, dy / d, speed * Math.min(1, d / 2 + 0.25));
}

// 공을 잡으러 갈 때는 공이 갈 위치를 미리 본다.
function intercept(p) {
  const b = S.ball;
  const lead = b.owner ? 0.2 : clamp(dist(p, b) / 16, 0, 0.9);
  const o = b.owner || b;
  return {x:clamp(b.x + o.vx * lead, 0, PW), y:clamp(b.y + o.vy * lead, 0, PH)};
}

function aiOnBall(p) {
  const b = S.ball;
  const dir = dirOf(p.team), gx = goalX(p.team);
  p.think -= DT;
  let foe = null, fd = 99;
  for (const o of S.players) if (o.team !== p.team) { const d = dist(o, p); if (d < fd) { fd = d; foe = o; } }
  if (p.gk) {
    steer(p, 0, 0, 0);
    if (b.held > 1.3) pass(p, dir, rand(-.7, .7), Math.random() < 0.35, 1.5);
    return;
  }
  const toGoal = Math.hypot(gx - p.x, CY - p.y);
  if (p.think <= 0) {
    p.think = rand(0.2, 0.45);
    if (toGoal < 22 && Math.abs(p.y - CY) < 17 && (toGoal < 17 || Math.random() < 0.4)) {
      return shoot(p, Math.random() < 0.55 ? rand(PERFECT_MIN, SWEET_MAX) : rand(0.56, 0.86), (Math.random() < 0.5 ? -1 : 1) * rand(0.7, 1), 0.8, Math.random() < 0.2);
    }
    if ((fd < 3.2 && Math.random() < 0.6) || Math.random() < 0.08) {
      const [ux, uy] = norm(dir, rand(-0.8, 0.8));
      return pass(p, ux, uy, Math.random() < 0.15, 1.8);
    }
  }
  let [ux, uy] = norm(gx - p.x, (CY - p.y) * (toGoal < 35 ? 1 : 0.2));
  if (foe && fd < 5 && (foe.x - p.x) * dir > 0) uy += (p.y >= foe.y ? 1 : -1) * (5 - fd) / 3;
  if (p.y < 4) uy += 1; if (p.y > PH - 4) uy -= 1;
  [ux, uy] = norm(ux, uy);
  steer(p, ux, uy, fd < 6 ? 6.8 : 5.4);
}

function aiKeeper(p) {
  const b = S.ball, gx = ownX(p.team), dir = dirOf(p.team);
  // 날아오는 슛은 골라인에 도착할 위치로 몸을 던진다.
  const keep = b.shot && b.beaten ? GK.beaten : GK.save;
  if (!b.owner && b.vx * dir < -9 && !(b.shot && b.shotAge < keep.react)) {
    const T = (gx + dir * 1.2 - b.x) / b.vx;
    if (T > 0 && T < 1.4) {
      const bend = Math.min(T, b.curveT);
      let y = clamp(b.y + b.vy * T + 0.5 * b.cay * bend * bend + (b.shot ? b.guess : 0), CY - GOAL_HALF - 0.5, CY + GOAL_HALF + 0.5);
      // 뚫린 슛은 몸을 날려도 손이 닿지 않는다.
      if (b.shot && b.beaten) y -= Math.sign(y - CY) * Math.min(Math.abs(y - CY), 2.1);
      // 슛이 가까이 오면 몸을 날리는 자세
      if (b.shot && T < 0.3 && Math.abs(y - p.y) > 0.7 && !(p.diveVis > 0)) { p.diveVis = 0.55; p.diveDir = Math.sign(y - p.y); }
      return goTo(p, gx + dir * 1.2, y, b.shot ? keep.speed : 7.4);
    }
  }
  const inBox = Math.abs(b.x - gx) < 14 && Math.abs(b.y - CY) < 17;
  if (!b.owner && inBox && Math.hypot(b.vx, b.vy) < 9) return goTo(p, b.x, b.y, 7);
  const out = clamp(Math.abs(b.x - gx) * 0.09, 1, 5);
  goTo(p, gx + dir * out, CY + clamp((b.y - CY) * 0.28, -3.2, 3.2), 5.5);
}

function aiMove(p, role) {
  const b = S.ball, o = b.owner, t = p.team, dir = dirOf(t);
  const slow = isHuman(t) ? 1 : 0.95;
  if (p === role.chaser || p === role.presser) {
    const fast = p === role.presser || S.pressing[t] || dist(p, b) < 12;
    const pt = intercept(p);
    goTo(p, pt.x + (p === role.chaser ? 0 : -dir * 1.2), pt.y, (fast ? 8.1 : 5.4) * slow);
    if (o && o.team !== t && !o.gk && !S.restart && p.cool <= 0 && dist(p, o) < 1.7 && Math.random() < (isHuman(t) ? 0.012 : 0.022)) standTackle(p, 0, 0);
    return;
  }
  if (!o && b.target === p) return runToPass(p, SPRINT * 0.9 * slow);
  const mine = o ? o.team === t : b.last === t;
  let d = (t === 0 ? p.fx : p.fx) + (dir === 1 ? b.x - PW/2 : PW/2 - b.x) * 0.55 + (mine ? 9 : -5);
  const line = p.fx < 30 ? [8, 66] : p.fx < 55 ? [16, 84] : [32, 94];
  d = clamp(d, line[0], line[1]);
  const tx = t === 0 ? d : PW - d;
  const ty = clamp(p.fy + (b.y - CY) * (mine ? 0.18 : 0.4), 3, PH - 3);
  goTo(p, tx, ty, (dist(p, {x:tx, y:ty}) > 9 ? 7.2 : 4.4) * slow);
}

function rolesFor(t) {
  const b = S.ball, o = b.owner, human = isHuman(t);
  const free = p => !p.gk && !busy(p) && !(human && p === S.sel[t]);
  const role = {chaser:null, presser:null};
  if (o && o.team === t) return role;
  const aim = o || b;
  // 내 팀은 압박할 때만 동료가 공 가진 선수에게 달려든다.
  if (!human || !o || S.pressing[t]) role.chaser = nearest(t, aim, free);
  if (human && S.pressing[t]) role.presser = nearest(t, aim, p => free(p) && p !== role.chaser);
  return role;
}

/* ---------- 업데이트 (1초에 60번) ---------- */
function controlHuman(p, cmd) {
  const c = S.ctl[p.team];                       // 이 팀의 조작 상태
  const b = S.ball, own = b.owner === p;
  const ax = cmd.mx, ay = cmd.my, moving = Math.hypot(ax, ay) > 0.15;
  const fx = moving ? ax : p.fxd, fy = moving ? ay : p.fyd;
  const incoming = !b.owner && b.target === p;            // 나에게 패스가 오는 중
  const attacking = hasAttack(p.team);

  // 받기 전에 눌러 둔 패스나 슛은 공이 닿는 즉시 나간다.
  if (own && c.queued && !busy(p)) {
    const act = c.queued.act;
    c.queued = null;
    return kickAction(p, act, ...norm(fx, fy), true);
  }
  const play = act => {
    if (own) return kickAction(p, act, ...norm(fx, fy));
    c.queued = {act, player:p, t:1.8};
  };

  if (attacking) {
    // 이 상황에서 누르기 시작한 버튼만 패스가 된다. (태클하던 손을 떼도 패스되지 않는다.)
    if (cmd.aDown) { c.armed.a = true; c.power.a = 0; }
    if (cmd.bDown) { c.armed.b = true; c.power.b = 0; }
    c.passing = null;
    for (const [k, type] of [['a', 'pass'], ['b', 'through']]) {
      if (!c.armed[k]) continue;
      if (cmd[k + 'Held']) { c.power[k] = Math.min(1, c.power[k] + DT / PASS_CHARGE_SEC); c.passing = k; }
      const kick = cmd[k + 'Kick'];
      if (kick) {
        // 친구의 기기에서는 누른 시간을 재서 보내준다.
        if (cmd[k + 'Hold'] != null) c.power[k] = clamp(cmd[k + 'Hold'] / PASS_CHARGE_SEC, 0, 1);
        c.armed[k] = false; c.passing = null;
        play({type, lob:kick === 'lob', power:Math.max(PASS_TAP, c.power[k])});
        if (own) return;
      } else if (!cmd[k + 'Held'] && !cmd[k + 'Down']) c.armed[k] = false;      // 취소된 터치
    }
    if (cmd.cDown && !p.gk) { c.charging = true; c.charge = 0; }
    if (c.charging) {
      const before = c.charge;
      c.charge = Math.min(1, c.charge + DT / CHARGE_SEC);
      if (before < PERFECT_MIN && c.charge >= PERFECT_MIN && p.team === ME) FX.perfectCue();
      c.curveOn = !!cmd.curve;
      c.aim = {x:fx, y:fy};
      if (cmd.cUp || !cmd.cHeld) {
        c.charging = false;
        if (cmd.cHold != null) c.charge = clamp(cmd.cHold / CHARGE_SEC, 0, 1);
        // 조이스틱이 향한 방향으로 찬다. 놓고 있으면 몸이 향한 방향이다.
        play({type:'shot', power:c.charge, aim:{x:fx, y:fy}, curve:!!cmd.curve});
        if (own) return;
      }
    }
  } else {
    c.charging = false; c.passing = null;
    c.armed.a = c.armed.b = false;
    if (cmd.aDown) { switchPlayer(p.team, moving ? ax : 0, moving ? ay : 0); return; }
    if (cmd.bDown) standTackle(p, moving ? ax : 0, moving ? ay : 0);
    if (cmd.cDown) slideTackle(p, moving ? ax : 0, moving ? ay : 0);
  }
  if (busy(p)) return;
  if (S.restart && S.restart.taker === p) {             // 정지 상황에서는 방향만 바꾼다.
    if (moving) [p.fxd, p.fyd] = norm(ax, ay);
    return steer(p, 0, 0, 0);
  }
  // 패스 받기 보정: 공이 오는 동안에는 조이스틱과 상관없이 받는 위치로 달린다.
  // 조이스틱 방향은 받은 뒤의 진행 방향과 다음 패스 방향이 된다.
  if (incoming) return runToPass(p, b.through || cmd.sprint ? SPRINT : SPRINT * 0.88);
  // 슛을 모으는 동안은 느리게 움직여서, 방향키로 골문 구석을 조준할 수 있다.
  const pace = ((cmd.sprint || cmd.press) && !p.tired ? SPRINT : p.tired ? TIRED_SPEED : RUN) * (own ? WITH_BALL : 1);
  if (moving) steer(p, ax, ay, c.charging ? 1.2 : pace);
  else if (attacking && !b.owner) runToPass(p, SPRINT * 0.9);      // 흘러나온 공은 알아서 잡으러 간다.
  else if (cmd.press && !attacking) { const pt = intercept(p); goTo(p, pt.x, pt.y, p.tired ? TIRED_SPEED : SPRINT * 0.96); }
  else steer(p, 0, 0, 0);
}

function movePlayer(p) {
  if (p.cool > 0) p.cool -= DT;
  if (p.kickCool > 0) p.kickCool -= DT;
  if (p.kickAnim > 0) p.kickAnim -= DT;
  if (p.diveVis > 0) p.diveVis -= DT;
  if (p.state === 'tackle') { p.vx = p.fxd * 7.5; p.vy = p.fyd * 7.5; checkTackle(p); }
  else if (p.state === 'slide') {
    const k = clamp(p.timer / 0.48, 0, 1);
    p.vx = p.fxd * (5 + 8 * k); p.vy = p.fyd * (5 + 8 * k); checkTackle(p);
  } else if (p.state === 'down' || p.state === 'stumble' || p.state === 'dive') { p.vx *= 0.85; p.vy *= 0.85; }
  if (busy(p)) {
    p.timer -= DT;
    if (p.timer <= 0) {
      if (p.state === 'slide') { p.state = 'down'; p.timer = p.won ? 0.18 : 0.55; }
      else if (p.state === 'tackle' && !p.won) { p.state = 'stumble'; p.timer = 0.18; }
      else p.state = 'idle';
    }
  }
  p.x = clamp(p.x + p.vx * DT, -2, PW + 2);
  p.y = clamp(p.y + p.vy * DT, -1.5, PH + 1.5);
  p.walk += Math.hypot(p.vx, p.vy) * DT;
  updateBody(p);
  updateStamina(p);
}

function separate() {
  const ps = S.players;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0.001 && d < 1.1) {
      const m = (1.1 - d) / 2 / d;
      a.x -= dx * m; a.y -= dy * m; b.x += dx * m; b.y += dy * m;
    }
  }
}

function moveBall() {
  const b = S.ball, o = b.owner;
  if (!o && b.target) {                                   // 너무 오래 못 받은 패스는 보정을 끝낸다.
    b.targetT += DT;
    if (b.targetT > 3.2) b.target = null;
  }
  if (o) {
    const sp = Math.hypot(o.vx, o.vy);
    const reach = S.restart ? 0.7 : 0.75 + (sp > 7.5 ? 0.45 : 0) + Math.sin(o.walk * 3) * 0.12 * Math.min(1, sp / 4);
    const k = S.restart ? 1 : 0.4;
    b.x += (o.x + o.fxd * reach - b.x) * k;
    b.y += (o.y + o.fyd * reach - b.y) * k;
    b.z = 0; b.held += DT;
    if (!S.restart) checkOut();
    return;
  }
  const px = b.x;
  b.shotAge += DT;
  if (b.curveT > 0) { b.curveT -= DT; b.vx += b.cax * DT; b.vy += b.cay * DT; }
  else b.cax = b.cay = 0;
  b.x += b.vx * DT; b.y += b.vy * DT;
  if (b.z > 0 || b.vz > 0) {
    b.vz -= 9.8 * DT; b.z += b.vz * DT;
    if (b.z <= 0) { b.z = 0; b.vz = b.vz < -2 ? -b.vz * 0.5 : 0; b.vx *= 0.82; b.vy *= 0.82; }
  } else {
    const f = Math.exp(-0.8 * DT);
    b.vx *= f; b.vy *= f;
  }
  // 골대에 맞으면 튕긴다.
  for (const gx of [0, PW]) {
    if ((px - gx) * (b.x - gx) <= 0 && px !== b.x && b.z < BAR + 0.3) {
      const off = Math.abs(Math.abs(b.y - CY) - GOAL_HALF);
      const onBar = Math.abs(b.z - BAR) < 0.22 && Math.abs(b.y - CY) < GOAL_HALF;
      if ((off < 0.28 && b.z < BAR) || onBar) { FX.post(gx, b.y, b.z + 0.3); b.vx *= -0.55; b.x = px; b.shot = false; b.cax = b.cay = b.curveT = 0; say('골대!', 1); }
    }
  }
  touchBall();
  if (!b.owner) checkOut();
}

function touchBall() {
  const b = S.ball;
  const speed = Math.hypot(b.vx, b.vy);
  const order = S.players.slice().sort((p, q) => dist(p, b) - dist(q, b));
  for (const p of order) {
    const d = dist(p, b);
    if (d > 2.2) break;
    if (p.kickCool > 0) continue;
    const inBox = Math.abs(p.x - ownX(p.team)) < 16.5 && Math.abs(p.y - CY) < 20;
    if (p.gk && inBox) {
      const reach = !b.shot ? (speed > 12 ? 1.6 : 1.4) : b.beaten ? GK.beaten.reach : speed > 12 ? GK.save.reach : 1.4;
      if (d > reach || b.z > 2.55) continue;
      const catchP = speed < 20 ? 1 : clamp(1.45 - speed / 38, 0.3, 0.9);
      const caught = Math.random() < catchP;
      if (b.shot) FX.save(b.x, b.y, b.z + 0.4, caught);
      if (caught) return gain(p);
      // 쳐내기
      b.vx = dirOf(p.team) * rand(5, 11); b.vy = (b.y >= p.y ? 1 : -1) * rand(5, 12); b.vz = rand(2, 5);
      b.last = p.team; b.shot = false; b.target = null; b.control = null; p.kickCool = 0.5; p.state = 'dive'; p.timer = 0.5;
      b.cax = b.cay = b.curveT = 0;
      return;
    }
    // 스루패스를 받는 선수는 공이 목표 공간 근처에 온 뒤에 잡는다.
    const receiving = b.target === p && Math.hypot(b.x - b.ox, b.y - b.oy) >= b.minRun - 2;
    if (b.target === p && !receiving) continue;
    if (busy(p) || d > (receiving ? 1.9 : 1.05) || b.z > (receiving ? 1.9 : 1.5)) continue;
    if (b.shot && speed > 17) {                         // 강한 슛은 몸에 맞고 튕긴다.
      FX.thud(b.x, b.y, b.z + 0.5); b.cax = b.cay = b.curveT = 0;
      b.vx *= -0.2; b.vy = b.vy * 0.3 + rand(-5, 5); b.vz = rand(1, 3); b.shot = false; b.last = p.team; b.control = null; b.target = null; p.kickCool = 0.4;
      return;
    }
    return gain(p);
  }
}

function checkOut() {
  const b = S.ball;
  if (b.x >= 0 && b.x <= PW && b.y >= 0 && b.y <= PH) return;
  if ((b.x < 0 || b.x > PW) && Math.abs(b.y - CY) < GOAL_HALF && b.z < BAR) {
    const scorer = b.x > PW ? 0 : 1;
    S.score[scorer]++;
    FX.goal(b.x, b.y, b.z + 0.4);
    b.cax = b.cay = b.curveT = 0; b.shot = false;
    if (b.owner) b.owner.kickCool = 1;
    b.owner = null;
    S.freeze = 2.6; S.restart = {kick:1 - scorer};
    say(`${TEAM_NAME[scorer]} 득점`, 2.6);
    return;
  }
  const other = 1 - b.last;
  const overBar = b.shot && !b.owner && (b.x < 0 || b.x > PW) && b.z >= BAR && Math.abs(b.y - CY) < GOAL_HALF + 2;
  if (b.y < 0 || b.y > PH) {
    const x = clamp(b.x, 1, PW - 1), y = b.y < 0 ? 0 : PH;
    setRestart(nearest(other, {x, y}, p => !p.gk), x, y, '스로인');
    return;
  }
  const line = b.x < 0 ? 0 : PW, defender = line === 0 ? 0 : 1;
  if (other === defender) {
    const gk = S.players.find(p => p.team === defender && p.gk);
    for (const p of S.players) if (!p.gk && Math.abs(p.x - line) < 20) p.x = line + dirOf(defender) * 20;
    setRestart(gk, line + dirOf(defender) * 5.5, CY, '골킥');
    if (overBar) say('골대 위로!', 1.6);
  } else {
    const y = b.y < CY ? 0.4 : PH - 0.4, x = line + (line === 0 ? 0.4 : -0.4);
    const taker = nearest(other, {x, y}, p => !p.gk);
    // 크로스를 받을 선수들을 골문 앞으로 보낸다.
    S.players.filter(p => !p.gk && p !== taker && p.fx > 40).forEach((p, i) => {
      p.x = line + dirOf(defender) * rand(6, 16); p.y = CY + ((i % 5) - 2) * 4;
    });
    setRestart(taker, x, y, '코너킥');
  }
}

// cmd는 이 기기(팀 0), remote는 친구(팀 1)의 명령이다.
function update(cmd, remote) {
  const cmds = [cmd, remote || IDLE];
  if (S.over) S.overT += DT;
  if (cmd.restart || (S.over && S.overT > 1.5 && (cmd.aDown || cmd.bDown || cmd.cDown))) { newMatch(); return; }
  if (S.msgT > 0) S.msgT -= DT;
  if (S.over) return;
  for (const c of S.ctl) {
    if (c.switchT > 0) c.switchT -= DT;
    if (c.queued) {
      c.queued.t -= DT;
      const o = S.ball.owner;
      if (c.queued.t <= 0 || (o && o !== c.queued.player)) c.queued = null;
    }
  }
  if (S.freeze > 0) {                                   // 골 세리머니
    S.freeze -= DT;
    const n = S.ball, back = n.x > PW / 2 ? PW + 2.3 : -2.3;
    n.x += n.vx * DT; n.y += n.vy * DT;
    if ((back > 0 && n.x > back) || (back < 0 && n.x < back)) { n.x = back; n.vx *= -0.12; n.vy *= 0.3; n.vz *= 0.3; }
    n.y = clamp(n.y, CY - GOAL_HALF + 0.3, CY + GOAL_HALF - 0.3);
    n.vz -= 9.8 * DT; n.z = Math.max(0, n.z + n.vz * DT);
    if (n.z === 0) { n.vz = 0; n.vx *= 0.9; n.vy *= 0.9; }
    if (S.freeze <= 0) kickoff(S.restart.kick);
    return;
  }
  const b = S.ball;
  if (S.restart) {
    const r = S.restart;
    r.t += DT;
    const auto = isHuman(r.taker.team) ? 6 : 1.4;
    if (r.t > auto) {
      const p = r.taker;
      if (r.label === '코너킥') pass(p, ...norm(goalX(p.team) - dirOf(p.team) * 9 - p.x, CY - p.y), true, 1.5);
      else pass(p, p.fxd, p.fyd, r.label === '골킥', 1);
    }
  } else {
    S.time += DT;
    if (S.time >= MATCH_SEC) { S.over = true; return; }
  }

  for (const side of [0, 1]) {
    if (!isHuman(side)) { S.pressing[side] = false; continue; }
    // 흘러나온 공을 우리가 잡을 수 있으면 가장 가까운 선수를 바로 조작한다.
    if (!b.owner && !b.target && hasAttack(side)) {
      const near = nearest(side, b, p => !p.gk);
      const cur = S.sel[side], queued = S.ctl[side].queued;
      if (near && cur !== near && (!cur || dist(cur, b) > dist(near, b) + 1.5)) {
        if (queued && queued.player === cur) queued.player = near;
        S.sel[side] = near;
      }
    }
    S.pressing[side] = cmds[side].press && !hasAttack(side);
    if (!S.sel[side]) S.sel[side] = nearest(side, b, p => !p.gk);
  }
  const roles = [rolesFor(0), rolesFor(1)];
  const mine = [0, 1].map(side => isHuman(side) ? S.sel[side] : null);
  for (const p of S.players) {
    if (p === mine[p.team]) controlHuman(p, cmds[p.team]);
    else if (busy(p)) continue;
    else if (S.restart && S.restart.taker === p) steer(p, 0, 0, 0);
    else if (b.owner === p) aiOnBall(p);
    else if (p.gk) aiKeeper(p);
    else if (S.restart) steer(p, 0, 0, 0);
    else aiMove(p, roles[p.team]);
  }
  for (const p of S.players) movePlayer(p);
  separate();
  moveBall();
}

/* ---------- 화면: 위에서 비스듬히 내려다보는 3D 느낌 ---------- */
const depth = y => 0.78 + 0.22 * clamp(y / PH, -0.2, 1.2);
function proj(x, y, z = 0) {
  const s = depth(y), t = y / PH;
  return [480 + (x - PW/2) * 8.35 * s, 82 + t * (0.9 + 0.1 * t) * 410 - z * 10 * s, s];
}
function poly(pts, color) {
  g.beginPath();
  pts.forEach((p, i) => { const [x, y] = proj(...p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.fillStyle = color; g.fill();
}
function path(pts, color = '#fffc', w = 1.6) {
  g.beginPath();
  pts.forEach((p, i) => { const [x, y] = proj(...p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.strokeStyle = color; g.lineWidth = w; g.stroke();
}
const circle = (cx, cy, r, a0 = 0, a1 = Math.PI * 2) =>
  Array.from({length:41}, (_, i) => { const a = a0 + (a1 - a0) * i / 40; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });

function drawPitch() {
  const sky = g.createLinearGradient(0, 0, 0, 540);
  sky.addColorStop(0, '#111a26'); sky.addColorStop(1, '#1d3a2a');
  g.fillStyle = sky; fullRect();
  // 관중석
  for (let i = 0; i < 520; i++) { g.fillStyle = ['#46556b','#6b5560','#556b62','#7a7466'][i % 4]; g.fillRect((i * 97) % 940 + 10, 40 + (i * 53) % 26, 3, 4); }
  poly([[-4,-3],[PW+4,-3],[PW+4,PH+3],[-4,PH+3]], '#266b34');
  for (let i = 0; i < 12; i++) { const a = i * PW/12, w = PW/12; poly([[a,0],[a+w,0],[a+w,PH],[a,PH]], i % 2 ? '#2f8a41' : '#35974a'); }
  path([[0,0],[PW,0],[PW,PH],[0,PH],[0,0]]);
  path([[PW/2,0],[PW/2,PH]]);
  path(circle(PW/2, CY, 9.15));
  for (const [x, d] of [[0, 1], [PW, -1]]) {
    path([[x,CY-20.2],[x+d*16.5,CY-20.2],[x+d*16.5,CY+20.2],[x,CY+20.2]]);
    path([[x,CY-9.2],[x+d*5.5,CY-9.2],[x+d*5.5,CY+9.2],[x,CY+9.2]]);
    path(circle(x + d*11, CY, 9.15, d > 0 ? -0.93 : Math.PI - 0.93, d > 0 ? 0.93 : Math.PI + 0.93));
    path(circle(x + d*11, CY, 0.25));
  }
}

function drawGoal(x, d) {
  const a = CY - GOAL_HALF, b = CY + GOAL_HALF;
  const bulge = FX.net(d > 0 ? 'left' : 'right');
  const back = x - d * (2.6 + bulge * (1.3 + Math.sin(performance.now() / 38) * 0.9));
  poly([[back,a],[back,b],[back,b,1.8],[back,a,1.8]], '#fff2');
  poly([[x,a,BAR],[back,a,1.8],[back,b,1.8],[x,b,BAR]], '#fff2');
  for (const y of [a, b]) path([[x,y],[x,y,BAR],[back,y,1.8],[back,y]], '#fffb', 2);
  path([[x,a,BAR],[x,b,BAR]], '#fff', 3);
  path([[back,a,1.8],[back,b,1.8]], '#fff9', 1.5);
}

function drawPlayer(p) {
  const [x, y, s] = proj(p.x, p.y);
  const sel = S.sel[ME] === p;
  const friend = isHuman(1 - ME) && S.sel[1 - ME] === p;
  const kit = p.gk ? ['#f4c430', '#8e44ad'][p.team] : ['#2d6cff', '#e8413c'][p.team];
  const shorts = ['#eaf0ff', '#30121a'][p.team];
  g.fillStyle = '#0005';
  g.beginPath(); g.ellipse(x, y, 8 * s, 3.8 * s, 0, 0, 7); g.fill();
  if (friend) { g.strokeStyle = '#ffffffcc'; g.lineWidth = 1.8; g.beginPath(); g.ellipse(x, y, 11 * s, 5.5 * s, 0, 0, 7); g.stroke(); }
  if (sel) { g.strokeStyle = '#ffee33'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y, 12 * s, 6 * s, 0, 0, 7); g.stroke(); }
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 7 && p.state === 'idle') {
    const [bx, by] = proj(p.x - p.vx * 0.2, p.y - p.vy * 0.2);
    g.strokeStyle = sel ? '#ffffffcc' : '#ffffff55'; g.lineWidth = sel ? 2 : 1.2;
    g.beginPath();
    for (const h of [3, 10, 17]) { g.moveTo(bx, by - h * s); g.lineTo(x + (bx - x) * 0.4, y + (by - y) * 0.4 - h * s); }
    g.stroke();
  }
  g.save();
  g.translate(x, y); g.scale(s, s);
  const keeperDive = p.gk && p.diveVis > 0 && p.state === 'idle';
  const ctl = S.ctl[p.team], winding = ctl.charging && S.sel[p.team] === p, kicking = p.kickAnim > 0;
  if (keeperDive) {
    g.translate(0, -9 - Math.sin((0.55 - p.diveVis) / 0.55 * Math.PI) * 6); g.rotate(p.diveDir * 1.25);
    g.fillStyle = shorts; g.fillRect(-3, 1, 6, 10);
    g.fillStyle = kit; g.fillRect(-5, -9, 10, 11);
    g.strokeStyle = kit; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-3, -8); g.lineTo(-4, -20); g.moveTo(3, -8); g.lineTo(4, -20); g.stroke();
    g.fillStyle = '#f0c29a'; g.beginPath(); g.arc(0, -13, 4.3, 0, 7); g.fill();
  } else if (winding || kicking) {
    const f = (p.fxd >= 0 ? 1 : -1);
    const swing = kicking ? Math.min(1, (0.32 - p.kickAnim) / 0.08) : -(0.4 + ctl.charge * 0.6);   // -1 뒤로 젖힘, 1 앞으로 뻗음
    const lean = kicking ? -f * 3 * swing : f * 3.5 * -swing;
    g.strokeStyle = shorts; g.lineWidth = 3.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-1, -8); g.lineTo(-f * 3, 0);
    g.moveTo(1, -8); g.lineTo(f * swing * 13, swing < 0 ? -5 + swing * 6 : -2 - swing * 9); g.stroke(); g.lineCap = 'butt';
    g.fillStyle = kit; g.beginPath(); g.moveTo(-5, -8); g.lineTo(5, -8); g.lineTo(5 + lean, -19); g.lineTo(-5 + lean, -19); g.fill();
    g.strokeStyle = kit; g.lineWidth = 2.4; g.beginPath(); g.moveTo(lean - 4, -17); g.lineTo(lean - 11, -13 - Math.abs(swing) * 6); g.moveTo(lean + 4, -17); g.lineTo(lean + 11, -13 - Math.abs(swing) * 6); g.stroke();
    g.fillStyle = '#f0c29a'; g.beginPath(); g.arc(lean * 1.2, -23, 4.3, 0, 7); g.fill();
    g.fillStyle = '#3a2a20'; g.beginPath(); g.arc(lean * 1.2, -24, 4.4, Math.PI, 0); g.fill();
  } else if (p.state === 'slide' || p.state === 'down' || p.state === 'dive') {
    const a = Math.atan2(p.fyd * 0.75, p.fxd);
    g.translate(0, -4); g.rotate(p.state === 'dive' ? 0.9 * (p.team ? -1 : 1) : a);
    g.fillStyle = shorts; g.fillRect(1, -3, 10, 6);
    g.fillStyle = kit; g.fillRect(-9, -4, 11, 8);
    g.fillStyle = '#f0c29a'; g.beginPath(); g.arc(-12, 0, 3.8, 0, 7); g.fill();
  } else {
    const sp = speed, step = Math.sin(p.walk * (sp > 7 ? 3 : 4)) * Math.min(sp > 7 ? 5.5 : 3, sp * 0.6);
    const lean = p.state === 'tackle' ? p.fxd * 4 : sp > 7 ? clamp(p.vx * 0.4, -3.5, 3.5) : 0;
    g.strokeStyle = shorts; g.lineWidth = 2.8;
    g.beginPath(); g.moveTo(-2, -8); g.lineTo(-2 + step + lean, 0); g.moveTo(2, -8); g.lineTo(2 - step, 0); g.stroke();
    g.fillStyle = kit; g.fillRect(-5 + lean * 0.3, -19, 10, 12);
    g.fillStyle = '#f0c29a'; g.beginPath(); g.arc(lean * 0.6, -23, 4.3, 0, 7); g.fill();
    g.fillStyle = '#3a2a20'; g.beginPath(); g.arc(lean * 0.6, -24, 4.4, Math.PI, 0); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center';
    if (p.team === 0 || !p.gk) g.fillText(p.num, lean * 0.3, -10.5);
  }
  g.restore();
  if (sel) {
    g.fillStyle = S.pressing[ME] ? '#ff8a1f' : '#ffee33';
    g.beginPath(); g.moveTo(x - 6, y - 41 * s); g.lineTo(x + 6, y - 41 * s); g.lineTo(x, y - 32 * s); g.fill();
  }
}

function drawBall() {
  const b = S.ball;
  FX.drawTrail();
  const [sx, sy, s] = proj(b.x, b.y);
  g.fillStyle = '#0006'; g.beginPath(); g.ellipse(sx, sy, 4 * s, 2 * s, 0, 0, 7); g.fill();
  const [x, y] = proj(b.x, b.y, b.z);
  const r = (3.6 + b.z * 0.25) * s * (b.shot && !b.owner && Math.hypot(b.vx, b.vy) > 22 ? 1.4 : 1);
  g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 1.2;
  g.beginPath(); g.arc(x, y - r, r, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#222'; g.beginPath(); g.arc(x + Math.sin(b.x * 2) * r * 0.35, y - r + Math.cos(b.y * 2) * r * 0.3, r * 0.32, 0, 7); g.fill();
}

function text(s, x, y, size, color = '#fff', align = 'center') {
  g.font = `bold ${size}px sans-serif`; g.textAlign = align;
  g.fillStyle = '#000a'; g.fillText(s, x + 1.5, y + 1.5);
  g.fillStyle = color; g.fillText(s, x, y);
}

function draw() {
  g.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
  g.fillStyle = '#111a26'; fullRect();
  g.save();
  FX.camera();
  drawPitch();
  drawGoal(0, 1); drawGoal(PW, -1);
  const items = S.players.map(p => ({y:p.y, f:() => drawPlayer(p)}));
  items.push({y:S.ball.y + 0.05, f:drawBall});
  if (S.ctl[ME].charging) {
    const p = S.sel[ME];
    const perfect = S.ctl[ME].charge >= PERFECT_MIN && S.ctl[ME].charge <= SWEET_MAX;
    FX.drawCharge(p.x, p.y, S.ctl[ME].charge, perfect, S.ctl[ME].curveOn, performance.now() / 1000);
    // 조준 표시: 골대를 향하면 골라인에, 아니면 그 방향으로 화살표를 보여준다.
    const t = shotTarget(p, S.ctl[ME].aim || {x:p.fxd, y:p.fyd});
    const color = !t.onGoal ? '#ffffffaa' : S.ctl[ME].curveOn ? '#c999ff' : '#ffe95c';
    const [ax, ay] = norm(t.x - p.x, t.y - p.y);
    path([[p.x + ax * 2.2, p.y + ay * 2.2], [p.x + ax * 7, p.y + ay * 7]], color, 3);
    path([[p.x + ax * 5.6 - ay, p.y + ay * 5.6 + ax], [p.x + ax * 7, p.y + ay * 7], [p.x + ax * 5.6 + ay, p.y + ay * 5.6 - ax]], color, 3);
    if (t.onGoal) {
      path(circle(t.x, t.y, 0.9), color, 2);
      path([[t.x, t.y], [t.x, t.y, 2.1]], color, 2);
    }
  }
  items.sort((a, b) => a.y - b.y).forEach(i => i.f());
  FX.drawWorld();
  if (S.ctl[ME].charging) {
    const [x, y] = proj(S.sel[ME].x, S.sel[ME].y);
    const w = 90, left = x - w / 2, top = y + 10;
    g.fillStyle = '#000c'; g.fillRect(left - 2, top - 2, w + 4, 14);
    g.fillStyle = '#ffffff22'; g.fillRect(left, top, w, 10);
    g.fillStyle = '#1f9d55'; g.fillRect(left + w * SWEET_MIN, top, w * (SWEET_MAX - SWEET_MIN), 10);
    g.fillStyle = '#e0a800'; g.fillRect(left + w * PERFECT_MIN, top, w * (SWEET_MAX - PERFECT_MIN), 10);
    g.fillStyle = '#b3261e'; g.fillRect(left + w * SWEET_MAX, top, w * (1 - SWEET_MAX), 10);
    g.fillStyle = S.ctl[ME].charge > SWEET_MAX ? '#ff5a4a' : S.ctl[ME].charge >= SWEET_MIN ? '#7dffb0' : '#ffd23c';
    g.fillRect(left, top + 2.5, w * S.ctl[ME].charge, 5);
    g.fillStyle = '#fff'; g.fillRect(left + w * S.ctl[ME].charge - 1, top - 3, 2.5, 16);
    if (S.ctl[ME].curveOn) text('감아차기', x, top + 27, 14, '#d9b3ff');
  }
  const me = S.sel[ME];
  if (me) {
    const [x, y, s] = proj(me.x, me.y);
    if (me.stamina < 0.995) {                                  // 머리 위 체력 막대
      const top = y - 52 * s;
      g.fillStyle = '#000b'; g.fillRect(x - 17, top, 34, 6);
      g.fillStyle = me.tired ? '#ff4a3d' : me.stamina < 0.3 ? '#ffb02e' : '#4de07a';
      g.fillRect(x - 16, top + 1, 32 * me.stamina, 4);
    }
    const k = S.ctl[ME].passing;
    if (k) {
      const pw = S.ctl[ME].power[k], w = 70, left = x - w / 2, top = y + 10;
      g.fillStyle = '#000c'; g.fillRect(left - 2, top - 2, w + 4, 12);
      g.fillStyle = k === 'a' ? '#4aa8ff' : '#35e0c0'; g.fillRect(left, top, w * pw, 8);
    }
    if ((S.ctl[ME].charging || k) && S.ball.owner === me) {            // 지금 차면 흔들리는 정도
      const at = S.ctl[ME].charging ? shotTarget(me, S.ctl[ME].aim || {x:me.fxd, y:me.fyd}) : null;
      const wob = imbalance(me, at ? at.x - me.x : me.fxd, at ? at.y - me.y : me.fyd);
      if (wob > 0.25) text(wob > 0.5 ? '자세 불안정' : '자세 흔들림', x, y - 62 * s, 12, wob > 0.5 ? '#ff6a5a' : '#ffc04a');
    }
  }
  g.restore();
  FX.drawScreen();
  g.fillStyle = '#000a'; g.fillRect(330, 6, 300, 30);
  text(TEAM_NAME[0], 395, 27, 15, '#7fa8ff');
  text(`${S.score[0]} : ${S.score[1]}`, 480, 28, 20);
  text(TEAM_NAME[1], 565, 27, 15, '#ff8a85');
  const min = Math.min(90, Math.floor(S.time / MATCH_SEC * 90));
  text(`${min}'`, 662, 27, 16);
  if (S.msgT > 0) text(S.msg, 480, S.freeze > 0 ? 305 : 112, S.freeze > 0 ? 30 : 22, '#ffe95c');
  if (S.over) {
    g.fillStyle = '#000b'; fullRect();
    const a = S.score[ME], c = S.score[1 - ME];
    text(a > c ? '승리!' : a < c ? '패배' : '무승부', 480, 240, 52, '#ffe95c');
    text(`${S.score[0]} : ${S.score[1]}`, 480, 295, 32);
    if (S.overT > 1.5) text('아무 행동 버튼이나 누르면 새 경기', 480, 340, 18, '#ccd');
  }
}

const btns = ['bA','bB','bC'].map(id => document.getElementById(id));
const sprintBtn = document.getElementById('bS');
let shownStamina = '';
// 달리기 버튼 테두리에 지금 선수의 체력을 보여준다.
function updateStaminaButton() {
  const p = S.sel[ME];
  if (!p) return;
  const key = Math.round(p.stamina * 40) + (p.tired ? 't' : '');
  if (key === shownStamina) return;
  shownStamina = key;
  const color = p.tired ? '#ff4a3d' : p.stamina < 0.3 ? '#ffb02e' : '#4de07a';
  sprintBtn.style.boxShadow = 'inset 0 -' + Math.round(p.stamina * 14) + 'px 0 ' + color + 'aa, 0 0 0 2px ' + color;
}
let labelMode = '';
function updateLabels() {
  updateStaminaButton();
  const attack = hasAttack(ME);
  const mode = attack ? 'a' : 'd';
  if (mode === labelMode) return;
  labelMode = mode;
  (attack ? ['패스\n▲로빙','스루\n▲로빙','슛'] : ['선수\n변경','태클','슬라\n이딩']).forEach((t, i) => { btns[i].textContent = t; });
}

/* ---------- 게임 루프 ---------- */
let last = performance.now(), acc = 0, pending = null, paused = true;
function setPaused(v) { paused = v; pending = null; acc = 0; }
function loop(now) {
  const elapsed = clamp(now - last, 0, 100);
  last = now;
  if (Net.isGuest()) {
    acc = 0; pending = null;
    FX.frame(elapsed / 1000);
    Net.guestFrame(paused ? IDLE : Input.read(), elapsed / 1000);
    updateLabels(); draw(); requestAnimationFrame(loop); return;
  }
  // 방장은 친구를 기다리며 멈춰 있는 동안에도 접속을 확인해야 한다.
  if (paused) { acc = 0; Net.hostFrame(); updateLabels(); draw(); requestAnimationFrame(loop); return; }
  // 화면 주사율이 높아 업데이트가 없는 프레임에서도 눌림 입력을 보관한다.
  acc += elapsed * FX.frame(elapsed / 1000);
  const cmd = Net.menuOpen() ? {...IDLE} : Input.read();
  if (pending) for (const k of ['aDown','bDown','cDown','cUp','restart','aKick','bKick']) cmd[k] = cmd[k] || pending[k];
  pending = cmd;
  while (acc >= 1000/60) {
    update(pending, Net.remoteCommand());
    FX.track(S.ball);
    pending = {...pending, aDown:false, bDown:false, cDown:false, cUp:false, restart:false, aKick:null, bKick:null};
    acc -= 1000/60;
  }
  Net.hostFrame();
  updateLabels();
  draw();
  requestAnimationFrame(loop);
}
resize();
newMatch();
requestAnimationFrame(loop);
