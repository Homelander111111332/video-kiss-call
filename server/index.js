import { Server } from 'socket.io';

const port = Number(process.env.PORT ?? 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((origin) => origin.trim());
const io = new Server({
  cors: { origin: allowedOrigins.includes('*') ? '*' : allowedOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5,
});
const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', (requestedRoom, acknowledge = () => {}) => {
    const room = String(requestedRoom ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!room) return acknowledge({ ok: false, error: 'Mã phòng không hợp lệ.' });
    const members = rooms.get(room) ?? new Set();
    if (members.size >= 2) return acknowledge({ ok: false, error: 'Phòng đã đủ 2 người.' });
    if (members.has(socket.id)) return acknowledge({ ok: true, peerCount: members.size - 1 });

    const existing = [...members][0] ?? null;
    members.add(socket.id);
    rooms.set(room, members);
    socket.data.room = room;
    socket.join(room);
    acknowledge({ ok: true, peerCount: existing ? 1 : 0 });

    if (existing) {
      socket.emit('room-peer', { peerId: existing });
      io.to(existing).emit('peer-joined', { peerId: socket.id });
    }
  });

  socket.on('signal', (message = {}) => {
    const room = socket.data.room;
    const to = String(message.to ?? '');
    const members = room ? rooms.get(room) : null;
    if (!members || !members.has(to) || !members.has(socket.id)) return;
    const payload = { from: socket.id };
    if (message.description && ['offer', 'answer'].includes(message.description.type)) payload.description = message.description;
    if (message.candidate) payload.candidate = message.candidate;
    socket.to(to).emit('signal', payload);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room) return;
    const members = rooms.get(room);
    if (!members) return;
    members.delete(socket.id);
    if (members.size === 0) rooms.delete(room);
    else for (const member of members) io.to(member).emit('peer-left');
  });
});

io.listen(port);
console.log(`Signaling server listening on port ${port}`);
