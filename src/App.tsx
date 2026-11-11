import { useCallback, useEffect, useRef, useState } from 'react';

type KissEffect = {
  id: number;
  x: number;
  y: number;
  radius: number;
  rotation: number;
};

type FaceBox = {
  width: number;
  height: number;
  x: number;
  y: number;
};

const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const REMOTE_LABEL = 'BẠN THÂN';
const LOCAL_LABEL = 'BẢN THÂN';

function App() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const kissIdRef = useRef(0);

  const [kisses, setKisses] = useState<KissEffect[]>([]);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [status, setStatus] = useState('Đang khởi tạo camera...');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const playKissSound = useCallback(() => {
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtor) {
      return;
    }

    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(170, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(62, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.16);

    setTimeout(() => ctx.close(), 170);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        const localStream = mediaStream;
        const remoteStream = localStream.clone();

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }

        setStatus('Camera sẵn sàng');
        setCameraError(null);
      } catch (error) {
        console.error(error);
        setCameraError('Không thể truy cập camera. Hãy cấp quyền camera cho trình duyệt.');
        setStatus('Camera bị từ chối');
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      const local = localVideoRef.current?.srcObject as MediaStream | null;
      const remote = remoteVideoRef.current?.srcObject as MediaStream | null;
      local?.getTracks().forEach((track) => track.stop());
      remote?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let animationFrameId = 0;

    const enableFaceTracking = async () => {
      if (!remoteVideoRef.current) {
        return;
      }

      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm',
      );

      const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_MODEL_URL,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      const tick = () => {
        const video = remoteVideoRef.current;
        if (!video) {
          return;
        }

        if (video.readyState >= 2) {
          const results = faceLandmarker.detectForVideo(video, performance.now());
          const face = results.faceLandmarks?.[0];

          if (face && face.length > 0) {
            const xs = face.map((point) => point.x);
            const ys = face.map((point) => point.y);

            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);

            setFaceBox({
              width: maxX - minX,
              height: maxY - minY,
              x: minX,
              y: minY,
            });
          } else {
            setFaceBox(null);
          }
        }

        animationFrameId = requestAnimationFrame(tick);
      };

      tick();
    };

    enableFaceTracking();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return;
    }

    const render = () => {
      const width = 1280;
      const height = 720;

      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);

      if (faceBox) {
        const px = faceBox.x * width;
        const py = faceBox.y * height;
        const pw = faceBox.width * width;
        const ph = faceBox.height * height;

        context.strokeStyle = 'rgba(0, 255, 180, 0.9)';
        context.lineWidth = 2;
        context.strokeRect(px, py, pw, ph);
      }

      kisses.forEach((kiss) => {
        drawWarpedKiss(context, (kiss.x / 100) * width, (kiss.y / 100) * height, kiss.radius, kiss.rotation);
      });

      requestAnimationFrame(render);
    };

    const frameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(frameId);
  }, [faceBox, kisses]);

  const handleRemoteClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    const nextKiss: KissEffect = {
      id: kissIdRef.current++,
      x,
      y,
      radius: 24 + Math.random() * 10,
      rotation: (Math.random() - 0.5) * 1.3,
    };

    setKisses((previous) => [...previous.slice(-9), nextKiss]);
    playKissSound();
  };

  return (
    <div className="page-shell">
      <div className="call-panel">
        <div className="video-stage" onClick={handleRemoteClick}>
          <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline muted />
          <canvas ref={canvasRef} className="kiss-canvas" />

          <div className="video-badge remote-label">{REMOTE_LABEL}</div>

          <div className="local-preview-wrap">
            <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
            <div className="video-badge local-label">{LOCAL_LABEL}</div>
          </div>
        </div>

        <div className="toolbar">
          <span className={`status-indicator ${cameraError ? 'error' : 'ok'}`} />
          <span>{cameraError ?? status}</span>
        </div>
      </div>
    </div>
  );
}

function drawWarpedKiss(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);

  const glow = context.createRadialGradient(0, 0, 3, 0, 0, radius * 2.5);
  glow.addColorStop(0, 'rgba(255, 245, 248, 0.95)');
  glow.addColorStop(0.3, 'rgba(255, 175, 200, 0.85)');
  glow.addColorStop(1, 'rgba(255, 96, 132, 0.08)');

  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(0, 0, radius * 1.4, radius * 1.05, 0, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 1.5;
  context.strokeStyle = 'rgba(255, 255, 255, 0.66)';
  context.beginPath();
  context.moveTo(-radius * 0.8, -radius * 0.06);
  context.quadraticCurveTo(0, -radius * 1.3, radius * 0.8, -radius * 0.06);
  context.quadraticCurveTo(0, radius * 0.9, -radius * 0.8, -radius * 0.06);
  context.stroke();

  context.fillStyle = 'rgba(255, 255, 255, 0.35)';
  context.beginPath();
  context.ellipse(-radius * 0.32, -radius * 0.18, radius * 0.28, radius * 0.16, 0, 0, Math.PI * 2);
  context.ellipse(radius * 0.32, -radius * 0.18, radius * 0.28, radius * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

export default App;
