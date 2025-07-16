// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "https://neverhaveievergame.netlify.app", methods: ["GET", "POST"] },
});

let players = [];
let currentTurnIndex = 0;

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("newPlayer", ({ id, positionArray, name }) => {
    players.push({ id, positionArray, name });

    // Send full player list and current turn index to new player
    socket.emit("allPlayers", players);
    socket.emit("turnUpdate", currentTurnIndex);

    // Notify others about new player
    socket.broadcast.emit("playerJoined", { id, positionArray, name });
  });

  socket.on("updatePosition", ({ id, positionArray, hasMovedForward }) => {
    players = players.map((p) => (p.id === id ? { ...p, positionArray } : p));
    socket.broadcast.emit("updatePosition", { id, positionArray,hasMovedForward });
  });

  // New: handle passing turn
  socket.on("passTurn", () => {
    // Only allow passing turn if this socket is current player
    if (players[currentTurnIndex]?.id === socket.id) {
      currentTurnIndex = (currentTurnIndex + 1) % players.length;
      io.emit("turnUpdate", currentTurnIndex); // broadcast new turn
    }
  });

    socket.on("resetMovedForward", () => {
        players = players.map((p) => ({ ...p, hasMovedForward: false }));
        io.emit("allPlayers", players);  // broadcast updated players to all clients
    });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const index = players.findIndex((p) => p.id === socket.id);
    players = players.filter((p) => p.id !== socket.id);

    // Adjust currentTurnIndex if needed
    if (index !== -1) {
      if (currentTurnIndex >= players.length) {
        currentTurnIndex = 0;
      } else if (index < currentTurnIndex) {
        currentTurnIndex--;
      }
    }
    io.emit("playerLeft", socket.id);
    io.emit("turnUpdate", currentTurnIndex);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING on port ${PORT}`);
});

