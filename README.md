# video-kiss-call

Two-person peer-to-peer video calling prototype using WebRTC and a Socket.IO signaling server. Media is sent directly between browsers; the signaling server only relays session descriptions and ICE candidates.

## Run locally

Requires Node.js 20+ and a secure context for camera access (localhost is allowed).

```bash
npm install
```

Start the signaling service in one terminal:

```bash
npm run server
```

Start the web app in another:

```bash
npm run dev
```

Open the Vite URL in two browsers/devices, enter the same room name, and join. Allow camera and microphone access. One person can use **Sao chép link** to share the room URL.

## Production deployment

GitHub Pages can host only the static frontend; it cannot run the Socket.IO signaling server. Deploy `server/index.js` as a persistent Node.js service (for example on a Node hosting platform) and set `VITE_SIGNALING_URL` to its HTTPS/WSS public URL when building the frontend. Set `ALLOWED_ORIGINS` on the server to the exact Pages origin, e.g. `https://homelander111111332.github.io`.

The included STUN servers help peers discover network routes, but some restrictive NATs/firewalls require a TURN service. Configure your TURN credentials in `ICE_SERVERS` for reliable production calls. Use HTTPS for the site and WSS for signaling.

## Rooms and privacy

Rooms are ephemeral and limited to two connected users. The signaling server does not store video/audio; WebRTC sends media peer-to-peer. Room names are not authentication—use a hard-to-guess room name and add access control before using this for sensitive calls.

## Features
- Large remote video and small self-view
- Mic/camera controls and leave-room control
- WebRTC offer/answer and ICE candidate signaling
- Click-to-show kiss overlay and local sound effect
