const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static('public'));

// In-memory storage (use Redis/MongoDB for production)
const users = new Map(); // socketId -> { username, room, joinedAt }
const messages = new Map(); // roomId -> [messages]
const MAX_HISTORY = 100;

// Generate random room ID
function generateRoomId() {
  return 'room_' + Math.random().toString(36).substr(2, 9);
}

io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // User joins
  socket.on('user:join', ({ username, room }) => {
    const roomId = room || 'global';
    socket.join(roomId);

    const user = {
      id: socket.id,
      username: username || `User_${socket.id.substr(0, 4)}`,
      room: roomId,
      joinedAt: new Date()
    };
    users.set(socket.id, user);

    // Send chat history
    const history = messages.get(roomId) || [];
    socket.emit('chat:history', history);

    // Notify room
    io.to(roomId).emit('user:joined', {
      username: user.username,
      timestamp: new Date()
    });

    // Broadcast updated user list
    io.to(roomId).emit('users:update', getUsersInRoom(roomId));

    console.log(`✅ ${user.username} joined ${roomId}`);
  });

  // Receive message
  socket.on('message:send', ({ content }) => {
    const user = users.get(socket.id);
    if (!user || !content.trim()) return;

    const message = {
      id: Date.now() + Math.random(),
      userId: socket.id,
      username: user.username,
      content: content.trim(),
      timestamp: new Date(),
      room: user.room
    };

    // Save to history
    if (!messages.has(user.room)) messages.set(user.room, []);
    const roomHistory = messages.get(user.room);
    roomHistory.push(message);
    if (roomHistory.length > MAX_HISTORY) roomHistory.shift();

    // Broadcast to room
    io.to(user.room).emit('message:new', message);
    console.log(`💬 ${user.username}: ${content}`);
  });

  // Typing indicator
  socket.on('typing:start', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('typing:update', {
        username: user.username,
        isTyping: true
      });
    }
  });

  socket.on('typing:stop', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('typing:update', {
        username: user.username,
        isTyping: false
      });
    }
  });

  // Create private room
  socket.on('room:create', (callback) => {
    const roomId = generateRoomId();
    callback({ roomId });
    console.log(`🏠 Room created: ${roomId}`);
  });

  // Switch room
  socket.on('room:switch', ({ newRoom }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const oldRoom = user.room;
    socket.leave(oldRoom);
    socket.join(newRoom);
    user.room = newRoom;

    // Notify old room
    io.to(oldRoom).emit('user:left', {
      username: user.username,
      timestamp: new Date()
    });
    io.to(oldRoom).emit('users:update', getUsersInRoom(oldRoom));

    // Notify new room
    io.to(newRoom).emit('user:joined', {
      username: user.username,
      timestamp: new Date()
    });
    io.to(newRoom).emit('users:update', getUsersInRoom(newRoom));

    // Send history
    const history = messages.get(newRoom) || [];
    socket.emit('chat:history', history);

    console.log(`🔄 ${user.username} switched to ${newRoom}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      io.to(user.room).emit('user:left', {
        username: user.username,
        timestamp: new Date()
      });
      io.to(user.room).emit('users:update', getUsersInRoom(user.room));
      users.delete(socket.id);
      console.log(`❌ ${user.username} disconnected`);
    }
  });
});

function getUsersInRoom(roomId) {
  return Array.from(users.values())
    .filter(u => u.room === roomId)
    .map(u => ({ id: u.id, username: u.username }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
