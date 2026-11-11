# video-kiss-call

WebRTC video call demo with a large remote video panel, a small self-view in the corner, and a face-aware kiss overlay effect.

## Features
- Local webcam preview in the corner
- Large remote video area
- Face-landmark detection using MediaPipe Face Landmarker
- Click on the face to trigger a kiss effect
- Warp-style kiss overlay rendered in a canvas layer
- Built-in kiss sound using Web Audio API

## Run locally

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Then open http://localhost:5173

## Notes
This project is intended as a frontend prototype for a two-person video call feature. It uses the same webcam stream for demo purposes in the default view so you can test the UX immediately in one browser tab. To connect two real users, you can plug in a WebRTC signaling server and replace the demo stream with the server-provided remote stream.
