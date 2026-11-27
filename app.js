'use strict';
// 앱 껍데기: 시작/일시정지 화면, 친구와 하기 화면, 전체 화면, 가로 고정, 홈 화면 설치 안내
(() => {
  const $ = id => document.getElementById(id);
  const menu = $('menu'), main = $('menuMain'), lobby = $('menuNet'), start = $('bStart'), fresh = $('bNew'),
    friend = $('bFriend'), quit = $('bQuit'), tip = $('installTip'), status = $('netStatus'), rooms = $('roomList'), host = $('bHost');
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pad = $('pad'), typed = $('codeText'), share = $('bShare'), enter = $('bEnter');
  let started = false, listTimer = 0, shownRooms = '', mode = null, number = '', hostCode = '';
  // 초대 링크(주소#room=123456)로 들어오면 방 번호를 미리 채운다.
  const invited = (location.hash.match(/^#room=(\d{6})$/) || location.search.match(/[?&]room=(\d{6})(?:&|$)/) || [])[1] || '';

  if (!standalone) {
    tip.hidden = false;
    tip.textContent = ios ? '아이폰: Safari의 공유 버튼 → "홈 화면에 추가"를 하면 앱처럼 열려요.'
                          : '안드로이드: Chrome 메뉴(⋮) → "홈 화면에 추가"를 하면 앱처럼 열려요.';
  }

  /* ---------- 전체 화면 ---------- */
  // 브라우저마다 방법이 다르다.
  //  - 안드로이드 Chrome, 아이패드 등: 버튼 한 번으로 전체 화면
  //  - 아이폰: 브라우저에서는 지원하지 않아 '홈 화면에 추가'가 필요하다.
  //  - 카톡·구글 앱처럼 앱 속 브라우저: Safari나 Chrome으로 옮겨야 한다.
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const inApp = /KAKAOTALK/i.test(ua) ? 'kakao'
    : /GSA\/|Instagram|FBAN|FBAV|FB_IAB|NAVER\(inapp|DaumApps|\bLine\/|; wv\)/i.test(ua) ? 'other' : '';
  const pageUrl = location.href;                 // 초대 링크의 방 번호까지 기억해 둔다.
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  const fullElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const canFull = !!request && !inApp && !/iPhone|iPod/.test(ua);

  async function lockLandscape() {
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); }
    catch (err) { /* 지원하지 않는 기기에서는 회전 안내 화면이 대신한다. */ }
  }
  async function goFullscreen() {
    if (standalone) return lockLandscape();
    if (!canFull) return false;
    try {
      if (!fullElement()) await request.call(root, {navigationUI:'hide'});
      await lockLandscape();
      return true;
    } catch (err) { return false; }
  }

  function showGuide() {
    const steps = $('guideSteps'), go = $('bOpenOut'), copy = $('bCopyLink');
    go.hidden = true; copy.hidden = false; copy.textContent = '주소 복사';
    if (inApp) {
      const target = ios ? 'Safari' : 'Chrome';
      $('guideTitle').textContent = `${target}에서 열어주세요`;
      const direct = inApp === 'kakao' || android;
      go.hidden = !direct; go.textContent = `${target}로 열기`;
      steps.textContent = '지금은 앱 속 브라우저라서 전체 화면을 쓸 수 없어요.\n' +
        (direct ? `아래 "${target}로 열기"를 누르세요. 안 열리면 주소를 복사해서 ${target}에 붙여넣으세요.`
                : `주소를 복사해서 ${target} 주소창에 붙여넣으세요.`);
    } else if (ios) {
      $('guideTitle').textContent = '아이폰에서 전체 화면으로 하기';
      steps.textContent = '1. Safari 아래(또는 위)의 공유 버튼을 누르세요. 안 보이면 ⋯ 메뉴 안에 있어요.\n2. "홈 화면에 추가" → "추가"를 누르세요.\n3. 홈 화면에 생긴 "미니축구" 아이콘으로 실행하세요.\n친구 방에 들어갈 때는 아이콘으로 연 뒤 방 번호를 입력하세요.';
    } else {
      $('guideTitle').textContent = '전체 화면으로 하기';
      steps.textContent = '브라우저 메뉴(⋮)에서 "홈 화면에 추가" 또는 "앱 설치"를 누른 뒤,\n홈 화면의 아이콘으로 실행하세요.';
    }
    $('guide').hidden = false;
  }
  $('bGuideClose').addEventListener('click', () => { $('guide').hidden = true; });
  $('bOpenOut').addEventListener('click', () => {
    if (inApp === 'kakao') location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(pageUrl);
    else {
      const u = new URL(pageUrl);
      // 안드로이드의 앱 속 브라우저에서 Chrome을 여는 주소. #방번호는 주소 형식과 겹쳐서 ?room= 으로 바꿔 보낸다.
      const room = (u.hash.match(/^#room=(\d{6})$/) || [])[1];
      location.href = `intent://${u.host}${u.pathname}${room ? '?room=' + room : ''}#Intent;scheme=https;package=com.android.chrome;end`;
    }
  });
  $('bCopyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pageUrl); $('bCopyLink').textContent = '복사했어요'; }
    catch (err) { $('guideSteps').textContent = `아래 주소를 길게 눌러 복사하세요.\n${pageUrl}`; }
  });

  async function toggleFullscreen() {
    FX.unlock();
    if (fullElement()) {
      try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (err) {}
      return;
    }
    if (!canFull) return showGuide();
    goFullscreen();
    // 요청에 아무 반응이 없는 브라우저도 있어서, 잠시 뒤에도 그대로면 방법을 안내한다.
    setTimeout(() => { if (!fullElement()) showGuide(); }, 1200);
  }
  // 이미 앱처럼 열었으면 버튼이 필요 없다.
  function updateFullButtons() {
    const on = !!fullElement();
    $('bFull').hidden = standalone;
    $('bFullGame').hidden = standalone || on;
    $('bFull').textContent = on ? '전체 화면 끄기' : '⛶ 전체 화면';
    setTimeout(() => dispatchEvent(new Event('resize')), 250);
  }
  for (const id of ['bFull', 'bFullGame']) $(id).addEventListener('click', toggleFullscreen);
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, updateFullButtons);
  updateFullButtons();
  if (inApp) showGuide();                          // 앱 속 브라우저로 들어오면 바로 알려준다.

  // 메뉴를 지금 상황(혼자/친구와)에 맞게 보여준다.
  function showMain() {
    stopList();
    const online = Net.connected();
    lobby.hidden = true; main.hidden = false;
    start.textContent = started ? '계속하기' : 'AI와 경기 시작';
    friend.hidden = online;
    fresh.hidden = !started || Net.isGuest();
    quit.hidden = !online;
    menu.hidden = false;
  }
  function pause() {
    if (!menu.hidden) return;
    Input.reset();
    // 친구와 하는 중에는 한 사람이 메뉴를 열어도 경기는 계속된다.
    if (Net.connected()) Net.setMenu(true); else setPaused(true);
    showMain();
  }
  function play() {
    FX.unlock();
    goFullscreen();
    Input.reset();
    stopList();
    started = true;
    menu.hidden = true;
    Net.setMenu(false);
    setPaused(false);
  }

  /* ---------- 친구와 하기 ---------- */
  function stopList() { clearInterval(listTimer); listTimer = 0; }
  function listRooms() {
    const list = Net.openRooms(), key = list.map(r => r.peer + r.code).join();
    if (key === shownRooms) return;
    shownRooms = key;
    rooms.textContent = '';
    for (const r of list) {
      const b = document.createElement('button');
      b.textContent = `방 ${r.code} 들어가기`;
      b.addEventListener('click', () => {
        stopList(); host.hidden = true; rooms.textContent = '';
        status.textContent = `방 ${r.code}에 들어가는 중...`;
        FX.unlock(); goFullscreen(); setPaused(false);
        Net.joinRoom(r.peer);
      });
      rooms.appendChild(b);
    }
  }
  function hideLobbyParts() {
    stopList();
    host.hidden = true; share.hidden = true; pad.hidden = true; rooms.textContent = ''; shownRooms = '-';
  }
  function showNumber() {
    typed.textContent = (number + '······').slice(0, 6);
    enter.disabled = number.length !== 6;
  }
  async function openLobby(message = '') {
    FX.unlock();
    main.hidden = true; lobby.hidden = false; menu.hidden = false;
    hideLobbyParts();
    status.textContent = '연결 중...';
    mode = await Net.init();
    if (!mode) {
      status.textContent = '이 브라우저에서는 친구와 하기를 쓸 수 없어요. Safari나 Chrome에서 열어주세요.';
      return;
    }
    host.hidden = false;
    if (mode === 'claude') {
      status.textContent = message || '한 사람은 "방 만들기", 다른 사람은 아래에 뜨는 방에 들어가세요.';
      shownRooms = '-'; listRooms();
      listTimer = setInterval(listRooms, 700);
    } else {
      status.textContent = message || '"방 만들기"를 누르거나, 친구에게 받은 방 번호 6자리를 입력하세요.';
      pad.hidden = false; showNumber();
    }
  }
  friend.addEventListener('click', () => openLobby());
  host.addEventListener('click', async () => {
    hideLobbyParts();
    setPaused(true);
    if (mode === 'claude') {
      const code = Net.hostRoom();
      status.textContent = `방 번호 ${code} · 친구를 기다리는 중...\n이 화면을 켜 둔 채로 기다려주세요.`;
      return;
    }
    status.textContent = '방을 만드는 중...';
    try {
      const code = await Net.hostDirect();
      if (!code) return;                                   // 그사이에 '뒤로'를 눌렀다.
      hostCode = code;
      status.textContent = `방 번호  ${code}\n초대 링크를 보낸 뒤 이 화면으로 돌아와서 기다려주세요.`;
      share.hidden = false; share.textContent = '초대 링크 보내기';
    } catch (err) { openLobby(P2P.explain(err)); }
  });
  share.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#room=${hostCode}`;
    try {
      if (navigator.share) await navigator.share({title:'미니 11 축구', text:`같이 축구하자! 방 번호 ${hostCode}`, url});
      else { await navigator.clipboard.writeText(url); share.textContent = '링크를 복사했어요'; }
    } catch (err) {
      if (err && err.name !== 'AbortError') status.textContent = `이 주소를 친구에게 보내주세요.\n${url}`;
    }
  });
  // 방 번호 입력: 휴대폰 키보드가 화면을 가리지 않도록 숫자 버튼을 직접 만든다.
  for (const key of ['1','2','3','4','5','6','7','8','9','0','지우기']) {
    const b = document.createElement('button');
    b.textContent = key; b.className = 'key';
    b.addEventListener('click', () => {
      number = key === '지우기' ? number.slice(0, -1) : (number + key).slice(0, 6);
      showNumber();
    });
    $('keys').appendChild(b);
  }
  enter.addEventListener('click', async () => {
    if (number.length !== 6) return;
    const target = number;
    hideLobbyParts();
    status.textContent = `방 ${target}에 연결하는 중...`;
    goFullscreen(); setPaused(false);
    try { await Net.joinDirect(target); }
    catch (err) { setPaused(true); openLobby(P2P.explain(err)); }
  });
  $('bBack').addEventListener('click', () => { stopList(); Net.leave(); setPaused(true); showMain(); });
  quit.addEventListener('click', () => { Net.leave(); });
  Net.onChange((event, reason) => {
    if (event === 'start') play();
    else if (event === 'partnerLeft') showMainIfOpen();
    else if (event === 'left') {
      started = false; setPaused(true); Input.reset(); Net.setMenu(false);
      if (reason) openLobby(reason); else showMain();
    }
  });
  function showMainIfOpen() { if (!menu.hidden && lobby.hidden) showMain(); }

  start.addEventListener('click', () => { if (Net.role() === 'host' && !Net.connected()) Net.leave(); play(); });
  $('bSound').addEventListener('click', () => { FX.unlock(); $('bSound').textContent = FX.toggleMute() ? '효과음 꺼짐' : '효과음 켜짐'; });
  addEventListener('pointerdown', () => FX.unlock(), {capture:true});
  fresh.addEventListener('click', () => { newMatch(); play(); });
  $('bPause').addEventListener('click', pause);
  const interrupt = () => { if (lobby.hidden) pause(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
  addEventListener('pagehide', interrupt);
  const portrait = matchMedia('(orientation: portrait)');
  portrait.addEventListener('change', e => { if (e.matches && !Net.connected()) interrupt(); });

  if (invited) {
    number = invited;
    history.replaceState(null, '', location.pathname);
    openLobby('초대받은 방이에요. "들어가기"를 눌러주세요.');
  }

  // 오프라인 실행은 https 주소(또는 localhost)에서만 켜진다.
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
