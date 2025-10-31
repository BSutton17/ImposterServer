const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());


const fs = require('fs');
const path = require('path');
const server = http.createServer(app);
//https://majority1.netlify.app
const io = require('socket.io')(server, {
  cors: {
    origin: 'https://impostergame1.netlify.app',  
    methods: ['GET', 'POST']
  }
});


let rooms = {};
// Track imposters per room
let roomImposters = {};
let playerAnswers = {};
let playerNames = {};
let disconnectTimers = {};
// Voting state per room (must be global, not per connection)
let roomVotes = {};
let roomVoters = {};

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("startGame", (room, imposterCount) => {
    io.to(room).emit("gameStarted");
    // Select random imposters based on imposterCount
    if (rooms[room] && rooms[room].players.length > 0) {
      const players = rooms[room].players.map(p => p.name);
      // Shuffle players array
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
      }
      // Select the first imposterCount players as imposters
      const imposters = players.slice(0, Math.min(imposterCount, players.length));
      roomImposters[room] = imposters;
      io.to(room).emit("setImposter", imposters);
    }
    console.log(`Game started in room: ${room}`);
  });

  socket.on("end_round", (room) => {
    io.to(room).emit("end_round_ack");
  });

  socket.on("set_word", (room, word) => {
    io.to(room).emit("display_word", word);
  });
  
  socket.on("reset_game", (room) => {
    playerAnswers = {};
    io.to(room).emit("reset_game");
  });

  socket.on("join_room", (room, name) => {
    socket.join(room);
  
    if (!rooms[room]) {
      rooms[room] = { players: [] };
    }
  
    // Check if player already exists by name
    let playerObj = rooms[room].players.find(p => p.name === name);
    if (!playerObj) {
      playerObj = { name, voteCount: 0 };
      rooms[room].players.push(playerObj);
      playerNames[socket.id] = name;
    }
  
    io.to(room).emit("updatePlayerList", rooms[room].players);
  });
  
  // Voting: handle vote submission
  socket.on("submit_vote", (room, votedName) => {
    console.log(`Vote received in room ${room} for ${votedName} from ${playerNames[socket.id]}`);
    if (!roomVotes[room]) roomVotes[room] = {};
    if (!roomVoters[room]) roomVoters[room] = new Set();
    const playerName = playerNames[socket.id];
    if (!playerName || roomVoters[room].has(playerName)) return; 
    roomVoters[room].add(playerName);
    
    // Find the player object and increment voteCount
    const votedPlayer = rooms[room].players.find(p => p.name === votedName);
    if (votedPlayer) {
      votedPlayer.voteCount += 1;
      console.log(`${votedName} now has ${votedPlayer.voteCount} votes`);
    }
    
    // Also keep the old vote tally for backward compatibility
    if (!roomVotes[room][votedName]) roomVotes[room][votedName] = 0;
    roomVotes[room][votedName] += 1;
    
    io.to(room).emit("vote_update", roomVotes[room]);
    io.to(room).emit("updatePlayerList", rooms[room].players);
  });

  // Voting: end voting and announce result
  socket.on("end_voting", (room) => {
    if (!roomVotes[room]) return;
    // Find player(s) with max votes using the player objects
    let maxVotes = 0;
    let playersWithMaxVotes = [];
    for (const player of rooms[room].players) {
      if (player.voteCount > maxVotes) {
        maxVotes = player.voteCount;
        playersWithMaxVotes = [player.name];
      } else if (player.voteCount === maxVotes && maxVotes > 0) {
        playersWithMaxVotes.push(player.name);
      }
    }
    // If tied or no votes, no one is voted out
    let votedOut = null;
    if (playersWithMaxVotes.length === 1 && maxVotes > 0) {
      votedOut = playersWithMaxVotes[0];
    }
    console.log(`Max votes: ${maxVotes}, Players with max votes: ${playersWithMaxVotes.join(', ')}, Voted out: ${votedOut || 'No one (tie or no votes)'}`);
    rooms[room].players.forEach(p => p.voteCount = 0);
    io.to(room).emit("voting_result", votedOut);
    if (votedOut) {
      // Find the socket id for the voted out player
      for (let [id, playerName] of Object.entries(playerNames)) {
        if (playerName === votedOut) {
          io.to(id).emit("eliminated");
          io.sockets.sockets.get(id)?.leave(room);
        }
      }
      // Remove from player list ONLY if still present
      rooms[room].players = rooms[room].players.filter(p => p.name !== votedOut);
      // Remove from imposters list if present
      if (roomImposters[room]) {
        roomImposters[room] = roomImposters[room].filter(name => name !== votedOut);
        // If all imposters are gone, imposters lose
        if (roomImposters[room].length === 0) {
          io.to(room).emit("imposters_lose");
        }
        // Imposters win if their count is at least half of the remaining players (rounded down)
        else if (roomImposters[room].length >= Math.floor(rooms[room].players.length / 2)) {
          io.to(room).emit("imposters_win");
        }
      }
    }
    io.to(room).emit("updatePlayerList", rooms[room].players);
  });

  socket.on("reset_game_after_voting", (room, votedOut) => { 
    // Do not remove votedOut here; already handled in end_voting
  // Reset for next round
  roomVotes[room] = {};
  roomVoters[room] = new Set();
  // Reset voteCount for all players
  rooms[room].players.forEach(p => p.voteCount = 0);
  io.to(room).emit("updatePlayerList", rooms[room].players);
  });

  socket.on("disconnect", () => {
    const playerName = playerNames[socket.id];
    console.log(`User Disconnected: ${playerName} (${socket.id})`);
  
    if (!playerName) return;
  
    // Find the room this player was in
    let room = null;
    for (let r in rooms) {
      if (rooms[r].players.find(p => p.name === playerName)) {
        room = r;
        break;
      }
    }
  
    // If the player is in a room and still present, remove them
    if (room) {
      const stillPresent = rooms[room].players.some(player => player.name === playerName);
      if (stillPresent) {
        rooms[room].players = rooms[room].players.filter(player => player.name !== playerName);
        io.to(room).emit("updatePlayerList", rooms[room].players);
      }
    }
  
    // Clean up playerNames and disconnectTimers
    delete playerNames[socket.id];
    delete disconnectTimers[playerName];
  });
  
});

server.listen(process.env.PORT || 3001, () => {
  console.log("SERVER RUNNING");
});
