const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store active game rooms
// rooms[roomId] = { id, players: [{id, name, role}], gameState }
const rooms = {};

// Helper to broadcast list of open rooms waiting for Player 2
function broadcastLobbyRooms() {
  const openRooms = Object.values(rooms)
    .filter(r => r.players.length === 1)
    .map(r => ({
      id: r.id,
      hostName: r.players[0].name,
      waiting: true
    }));
  io.emit('open_rooms_list', openRooms);
}

io.on('connection', (socket) => {
  // Send current open rooms immediately when someone visits
  const openRooms = Object.values(rooms)
    .filter(r => r.players.length === 1)
    .map(r => ({
      id: r.id,
      hostName: r.players[0].name,
      waiting: true
    }));
  socket.emit('open_rooms_list', openRooms);

  // 1. Create or Join Room
  socket.on('join_room', ({ roomId, playerName }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    if (!cleanRoomId) return;

    socket.join(cleanRoomId);

    if (!rooms[cleanRoomId]) {
      // First player creates the room as Player 1 (Hunters)
      rooms[cleanRoomId] = {
        id: cleanRoomId,
        players: [{ id: socket.id, name: playerName || 'Player 1', role: 'P1' }],
        gameState: null
      };
      socket.emit('player_assigned', { role: 'P1', name: rooms[cleanRoomId].players[0].name, room: cleanRoomId });
      broadcastLobbyRooms();
    } else if (rooms[cleanRoomId].players.length === 1) {
      // Second player joins room as Player 2 (Defenders)
      const p1 = rooms[cleanRoomId].players[0];
      const p2 = { id: socket.id, name: playerName || 'Player 2', role: 'P2' };
      rooms[cleanRoomId].players.push(p2);

      socket.emit('player_assigned', { role: 'P2', name: p2.name, room: cleanRoomId });

      // Notify both players that game can start
      io.to(cleanRoomId).emit('game_ready', {
        player1: p1.name,
        player2: p2.name,
        room: cleanRoomId
      });
      broadcastLobbyRooms();
    } else {
      // Room already has 2 players
      socket.emit('room_full', { room: cleanRoomId });
    }
  });

  // 2. Broadcast Moves within specific room
  socket.on('make_move', ({ roomId, moveData }) => {
    socket.to(roomId).emit('opponent_moved', moveData);
  });

  // 3. Reset Game Sync within specific room
  socket.on('reset_game', ({ roomId }) => {
    io.to(roomId).emit('game_reset_sync');
  });

  // 4. Leave room intentionally
  socket.on('leave_room', ({ roomId }) => {
    socket.leave(roomId);
    if (rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
      socket.to(roomId).emit('player_disconnected');
      if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
      }
      broadcastLobbyRooms();
    }
  });

  // 5. Handle Disconnect
  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        socket.to(roomId).emit('player_disconnected');
        if (room.players.length === 0) {
          delete rooms[roomId];
        }
        broadcastLobbyRooms();
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Coin to Win Server running on http://localhost:${PORT}`);
});
