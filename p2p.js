'use strict';
// 계정 없이 두 휴대폰을 직접 연결한다. (WebRTC, 공개 라이브러리 PeerJS 사용)
// PeerJS의 무료 서버로 서로를 찾은 뒤 경기 데이터를 주고받는다. 보통은 두 기기 사이로 바로 오가고,
// 네트워크 환경에 따라 중계 서버를 거치거나 연결이 안 될 수 있다.
// net.js가 쓰는 room과 같은 모양(presence, peers)으로 만들어서 게임 코드는 그대로 쓴다.
const P2P = (() => {
  const LIB = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PREFIX = 'mini11soccer-v1-';
  const CONNECT_MS = 20000, SILENT_MS = 5000, BEAT_MS = 400, MAX_CHARS = 6000;
  // 파일 내용이 하나라도 바뀌면 브라우저가 실행하지 않는다.
  const LIB_HASH = 'sha384-nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR';
  let Lib = null, loading = null;

  const available = () => typeof RTCPeerConnection === 'function';
  function load() {
    if (Lib) return Promise.resolve(Lib);
    if (window.Peer) return Promise.resolve(Lib = window.Peer);
    loading = loading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB; s.integrity = LIB_HASH; s.crossOrigin = 'anonymous';
      s.onload = () => window.Peer ? resolve(Lib = window.Peer) : reject(new Error('library'));
      s.onerror = () => { loading = null; s.remove(); reject(new Error('library')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  // 방 번호는 6자리. 짐작해서 들어오기 어렵게 안전한 난수를 쓴다.
  const newCode = () => {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return String(100000 + n[0] % 900000);
  };
  const idOf = code => PREFIX + code;

  function makeRoom(peer, myId) {
    let conn = null, mine = {}, theirs = null, heardAt = 0, sent = 0, got = -1, beat = 0, closed = false;
    const send = () => {
      if (!conn || !conn.open) return;
      try { conn.send(JSON.stringify({i:++sent, v:mine})); } catch (err) { /* 끊기면 아래의 시간 검사로 처리한다. */ }
    };
    function drop(c) {
      if (conn !== c) return;
      conn = null; theirs = null;
      try { c.close(); } catch (err) {}
    }
    function attach(c) {
      conn = c; got = -1; heardAt = Date.now();
      c.on('data', raw => {
        if (conn !== c || typeof raw !== 'string' || raw.length > MAX_CHARS) return;
        let m;
        try { m = JSON.parse(raw); } catch (err) { return; }
        // 순서가 뒤바뀌어 늦게 온 옛 메시지는 버린다.
        if (!m || !Number.isFinite(m.i) || m.i <= got || !m.v || typeof m.v !== 'object') return;
        got = m.i; theirs = {peer:c.peer, v:m.v}; heardAt = Date.now();
      });
      c.on('open', () => { heardAt = Date.now(); send(); });
      c.on('close', () => drop(c));
      c.on('error', () => drop(c));
    }
    beat = setInterval(() => {
      send();
      if (conn && Date.now() - heardAt > (conn.open ? SILENT_MS : CONNECT_MS)) drop(conn);
    }, BEAT_MS);
    // 방장이 초대 링크를 보내려고 다른 앱에 다녀오면 중계 서버 연결이 끊길 수 있어 다시 붙는다.
    const revive = () => { if (!closed && !document.hidden && peer.disconnected && !peer.destroyed) peer.reconnect(); };
    document.addEventListener('visibilitychange', revive);
    peer.on('disconnected', () => setTimeout(revive, 1000));

    return {
      attach,
      busy:() => !!conn,
      presence(patch) {
        for (const k in patch) patch[k] === null ? delete mine[k] : mine[k] = patch[k];
        send();
        return Promise.resolve();
      },
      peers() {
        const list = [{peer:myId, sameTab:true, presence:mine}];
        if (conn && theirs) list.push({peer:theirs.peer, sameTab:false, presence:theirs.v});
        return list;
      },
      close() {
        if (closed) return;
        send();                                            // 나간다는 상태를 먼저 알린다.
        closed = true; clearInterval(beat);
        document.removeEventListener('visibilitychange', revive);
        setTimeout(() => peer.destroy(), 300);
      },
    };
  }

  function open(id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Lib(id, {debug:0}) : new Lib({debug:0});
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('timeout')); }, CONNECT_MS);
      peer.once('open', myId => { clearTimeout(timer); resolve({peer, myId}); });
      peer.once('error', err => { clearTimeout(timer); peer.destroy(); reject(new Error(err.type || 'network')); });
    });
  }

  // 방 만들기: 번호가 이미 쓰이고 있으면 다른 번호로 다시 시도한다.
  async function host() {
    await load();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newCode();
      try {
        const {peer, myId} = await open(idOf(code));
        const room = makeRoom(peer, myId);
        peer.on('connection', c => {
          if (room.busy()) { c.on('open', () => c.close()); return; }       // 두 명까지만 받는다.
          room.attach(c);
        });
        return {room, code};
      } catch (err) {
        if (err.message !== 'unavailable-id') throw err;
      }
    }
    throw new Error('unavailable-id');
  }

  async function join(code) {
    await load();
    const {peer, myId} = await open();
    const room = makeRoom(peer, myId), hostId = idOf(code);
    const c = peer.connect(hostId, {reliable:false, serialization:'raw'});
    room.attach(c);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('blocked')), CONNECT_MS);
        const fail = err => { clearTimeout(timer); reject(new Error(err.type || 'network')); };
        c.once('open', () => { clearTimeout(timer); peer.off('error', fail); resolve(); });
        peer.once('error', fail);
      });
    } catch (err) { room.close(); throw err; }
    return {room, hostId};
  }

  const explain = err => ({
    'library':'연결에 필요한 파일을 받지 못했어요. 인터넷을 확인해주세요.',
    'peer-unavailable':'그 번호의 방이 없어요. 번호를 확인하고, 방장이 게임 화면을 켜 두었는지 확인해주세요.',
    'blocked':'두 휴대폰이 직접 연결되지 않았어요. 둘 다 같은 Wi-Fi를 쓰거나, 한쪽의 네트워크를 바꿔서 다시 해보세요.',
    'timeout':'연결 서버가 응답하지 않아요. 잠시 뒤에 다시 해보세요.',
  })[err && err.message] || '연결하지 못했어요. 잠시 뒤에 다시 해보세요.';

  return {available, host, join, explain};
})();
