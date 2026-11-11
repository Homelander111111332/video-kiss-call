import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type Kiss = { id: number; x: number; y: number; rotation: number };
type SignalMessage = {
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type JoinAck = { ok: boolean; peerCount?: number; error?: string };

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'http://localhost:3001';
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function App() {
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const kissId = useRef(0);

  const [roomId, setRoomId] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Nhập mã phòng để bắt đầu cuộc gọi');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [kisses, setKisses] = useState<Kiss[]>([]);

  const closePeer = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    peerIdRef.current = null;
    pendingCandidates.current = [];
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
  }, []);

  const hangUp = useCallback(() => {
    closePeer();
    socketRef.current?.disconnect();
    socketRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    setJoined(false);
    setStatus('Cuộc gọi đã kết thúc');
  }, [closePeer]);

  const makePeer = useCallback((socket: Socket, remoteId: string) => {
    if (pcRef.current && peerIdRef.current === remoteId) return pcRef.current;
    closePeer();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    peerIdRef.current = remoteId;

    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    pc.ontrack = (event) => {
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        setStatus('Đang kết nối với đối phương');
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit('signal', { to: remoteId, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Đã kết nối');
      if (pc.connectionState === 'failed') setStatus('Kết nối thất bại — có thể cần cấu hình TURN server');
      if (pc.connectionState === 'disconnected') setStatus('Đối phương đang mất kết nối...');
    };
    return pc;
  }, [closePeer]);

  const createOffer = useCallback(async (socket: Socket, remoteId: string) => {
    const pc = makePeer(socket, remoteId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: remoteId, description: pc.localDescription });
  }, [makePeer]);

  const joinCall = async (event: React.FormEvent) => {
    event.preventDefault();
    const room = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!room) { setError('Hãy nhập mã phòng hợp lệ.'); return; }
    setError('');
    setStatus('Đang xin quyền camera và microphone...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      const socket = io(SIGNALING_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('join-room', room, (ack: JoinAck) => {
          if (!ack.ok) {
            setError(ack.error ?? 'Không thể tham gia phòng.');
            setStatus('Không thể tham gia');
            hangUp();
            return;
          }
          setRoomId(room);
          setJoined(true);
          history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(room)}`);
          setStatus(ack.peerCount === 1 ? 'Đang gọi cho người trong phòng...' : 'Đã vào phòng — đang chờ đối phương');
          if (ack.peerCount === 1) {
            const other = (socket as Socket & { peerId?: string }).peerId;
            // The server provides the existing peer id in the acknowledgement.
            if (other) void createOffer(socket, other);
          }
        });
      });
      socket.on('room-peer', ({ peerId }: { peerId: string }) => {
        // The new arrival receives the existing peer id; only it creates the offer.
        if (peerId) void createOffer(socket, peerId);
      });
      socket.on('peer-joined', ({ peerId }: { peerId: string }) => {
        makePeer(socket, peerId);
        setStatus('Đối phương đã vào phòng — đang kết nối...');
      });
      socket.on('signal', async (message: SignalMessage) => {
        const pc = makePeer(socket, message.from);
        try {
          if (message.description) {
            await pc.setRemoteDescription(message.description);
            for (const candidate of pendingCandidates.current.splice(0)) {
              await pc.addIceCandidate(candidate);
            }
            if (message.description.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('signal', { to: message.from, description: pc.localDescription });
            }
          } else if (message.candidate) {
            if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
            else pendingCandidates.current.push(message.candidate);
          }
        } catch (signalError) {
          console.error('WebRTC signaling error', signalError);
          setError('Không thể thiết lập kết nối WebRTC. Hãy thử rời phòng và vào lại.');
        }
      });
      socket.on('peer-left', () => {
        closePeer();
        setStatus('Đối phương đã rời phòng');
      });
      socket.on('connect_error', () => {
        setError(`Không kết nối được máy chủ signaling tại ${SIGNALING_URL}.`);
        setStatus('Máy chủ signaling không sẵn sàng');
      });
    } catch (mediaError) {
      console.error(mediaError);
      setError('Không truy cập được camera/microphone. Hãy kiểm tra quyền trình duyệt và HTTPS.');
      setStatus('Không thể bật thiết bị');
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  };

  const toggleMic = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setCameraOff(next);
  };

  const kiss = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!joined || !remoteVideo.current?.srcObject) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setKisses((items) => [...items.slice(-7), {
      id: kissId.current++,
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
      rotation: (Math.random() - 0.5) * 0.55,
    }]);
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(190, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(65, audio.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.15);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(); oscillator.stop(audio.currentTime + 0.16);
      window.setTimeout(() => void audio.close(), 200);
    } catch { /* Audio is an optional browser effect. */ }
  };

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    let raf = 0;
    const draw = () => {
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (element.width !== Math.round(rect.width * dpr) || element.height !== Math.round(rect.height * dpr)) {
        element.width = Math.round(rect.width * dpr);
        element.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      kisses.forEach((item) => drawKiss(ctx, item.x * rect.width, item.y * rect.height, item.rotation));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kisses]);

  useEffect(() => () => {
    socketRef.current?.disconnect();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const copyInvite = async () => {
    const room = roomId.trim();
    if (!room) return;
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
    try { await navigator.clipboard.writeText(url); setStatus('Đã sao chép link mời'); }
    catch { setStatus(url); }
  };

  return (
    <main className="page-shell">
      <section className="call-panel">
        {!joined && <form className="join-card" onSubmit={joinCall}>
          <div className="eyebrow">PRIVATE VIDEO ROOM</div>
          <h1>Gọi video cùng nhau</h1>
          <p>Hai người dùng cùng một mã phòng để kết nối trực tiếp.</p>
          <label htmlFor="room">Mã phòng</label>
          <div className="join-row">
            <input id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="ví dụ: phong-cua-minh" maxLength={40} />
            <button type="submit" className="primary-button">Tham gia</button>
          </div>
          {error && <p className="error-text">{error}</p>}
          <small>Camera và microphone chỉ được bật sau khi bạn nhấn Tham gia.</small>
        </form>}

        <div className={`video-stage ${joined ? 'is-joined' : ''}`} onClick={kiss}>
          <video ref={remoteVideo} className="remote-video" autoPlay playsInline />
          <canvas ref={canvas} className="kiss-canvas" />
          {!remoteVideo.current?.srcObject && <div className="waiting-state"><div className="avatar">♡</div><strong>{joined ? 'Đang chờ đối phương' : 'Video đối phương sẽ hiện ở đây'}</strong><span>Chia sẻ cùng mã phòng để bắt đầu</span></div>}
          <div className="video-badge remote-label">ĐỐI PHƯƠNG</div>
          <div className="local-preview-wrap">
            <video ref={localVideo} className="local-video" autoPlay playsInline muted />
            {cameraOff && <div className="camera-off">Camera đang tắt</div>}
            <div className="video-badge local-label">BẠN</div>
          </div>
        </div>

        <div className="call-footer">
          <div className="status"><span className={`status-indicator ${error ? 'error' : 'ok'}`} />{error || status}</div>
          {joined && <div className="controls">
            <button type="button" className={muted ? 'control active' : 'control'} onClick={toggleMic}>{muted ? 'Bật mic' : 'Tắt mic'}</button>
            <button type="button" className={cameraOff ? 'control active' : 'control'} onClick={toggleCamera}>{cameraOff ? 'Bật camera' : 'Tắt camera'}</button>
            <button type="button" className="control" onClick={copyInvite}>Sao chép link</button>
            <button type="button" className="control hangup" onClick={(e) => { e.stopPropagation(); hangUp(); }}>Rời phòng</button>
          </div>}
        </div>
        {joined && <p className="hint">Phòng: <strong>{roomId}</strong> · Nhấn lên video đối phương để gửi hiệu ứng hôn.</p>}
      </section>
    </main>
  );
}

function drawKiss(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
  const size = 25;
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, size * 2.2);
  glow.addColorStop(0, 'rgba(255,230,240,.9)'); glow.addColorStop(.38, 'rgba(255,100,150,.75)'); glow.addColorStop(1, 'rgba(255,50,100,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(0, 0, size * 1.5, size, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(245,55,105,.88)'; ctx.beginPath();
  ctx.moveTo(-size, 0); ctx.bezierCurveTo(-size * .7, -size, -size * .2, -size * .42, 0, -size * .08);
  ctx.bezierCurveTo(size * .2, -size * .42, size * .7, -size, size, 0); ctx.bezierCurveTo(size * .7, size * .8, size * .2, size * .42, 0, size * .18);
  ctx.bezierCurveTo(-size * .2, size * .42, -size * .7, size * .8, -size, 0); ctx.fill(); ctx.restore();
}

export default App;
