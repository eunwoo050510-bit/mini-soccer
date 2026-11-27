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
  const invited = (location.hash.match(/^#room=(\d{6})$/) || [])[1] || '';

  if (!standalone) {
    tip.hidden = false;
    tip.textContent = ios ? '아이폰: Safari의 공유 버튼 → "홈 화면에 추가"를 하면 앱처럼 열려요.'
                          : '안드로이드: Chrome 메뉴(⋮) → "홈 화면에 추가"를 하면 앱처럼 열려요.';
  }

  // 안드로이드는 전체 화면과 가로 고정이 가능하다. 아이폰 Safari는 지원하지 않아 조용히 넘어간다.
  async function goFullscreen() {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen && !ios) await el.requestFullscreen({navigationUI:'hide'});
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (err) { /* 지원하지 않는 기기에서는 회전 안내 화면이 대신한다. */ }
  }

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
    history.replaceState(null, '', location.pathname + location.search);
    openLobby('초대받은 방이에요. "들어가기"를 눌러주세요.');
  }

  // 오프라인 실행은 https 주소(또는 localhost)에서만 켜진다.
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
