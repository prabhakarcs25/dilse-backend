import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import Chat from "./models/Chat.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

mongoose
  .connect(
    "mongodb+srv://prabhakarsingh63915:LVarp18@cluster0.5olyu2h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

app.use(cors());
app.use(express.json());

let waitingUsers = []; // { socketId, name, gender, lookingFor, age, city }

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  socket.on("register", async ({ name, gender, lookingFor, age, city }) => {
    socket.userData = { name, gender, lookingFor, age, city };

    const match = waitingUsers.find(
      (user) =>
        user.lookingFor === gender &&
        user.gender === lookingFor &&
        Math.abs(user.age - age) <= 5 && // 🎯 age filter
        user.city === city.toLowerCase() // 🎯 city filter
    );

    if (match) {
      const roomId = [name, match.name].sort().join("#");

      let chat = await Chat.findOne({
        participants: { $all: [name, match.name] },
      });

      if (!chat) {
        chat = await Chat.create({
          participants: [name, match.name],
          messages: [],
        });
      }

      socket.roomId = roomId;
      const matchSocket = io.sockets.sockets.get(match.socketId);
      matchSocket.roomId = roomId;

      socket.userData.partner = match.name;
      matchSocket.userData.partner = name;

      socket.emit("chatHistory", chat.messages);
      matchSocket.emit("chatHistory", chat.messages);

      socket.emit("paired", { name: match.name });
      matchSocket.emit("paired", { name });

      waitingUsers = waitingUsers.filter((u) => u.socketId !== match.socketId);
    } else {
      waitingUsers.push({
        socketId: socket.id,
        name,
        gender,
        lookingFor,
        age,
        city: city.toLowerCase(),
      });
    }
  });

  socket.on("message", async (msg) => {
    const { name, partner } = socket.userData || {};
    const roomId = socket.roomId;

    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partner && s.roomId === roomId
    );

    if (partnerSocket) {
      partnerSocket.emit("message", { from: name, text: msg });
    }

    await Chat.findOneAndUpdate(
      { participants: { $all: [name, partner] } },
      { $push: { messages: { from: name, text: msg } } }
    );
  });

  socket.on("typing", () => {
    const partnerName = socket.userData?.partner;
    const roomId = socket.roomId;
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partnerName && s.roomId === roomId
    );
    if (partnerSocket) {
      partnerSocket.emit("partnerTyping");
    }
  });

  socket.on("stopTyping", () => {
    const partnerName = socket.userData?.partner;
    const roomId = socket.roomId;
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partnerName && s.roomId === roomId
    );
    if (partnerSocket) {
      partnerSocket.emit("partnerStopTyping");
    }
  });

  socket.on("disconnect", async () => {
    console.log("🔴 Disconnected:", socket.id);

    // Remove from waiting list
    waitingUsers = waitingUsers.filter((u) => u.socketId !== socket.id);

    // ✅ Check for registration before proceeding
    if (!socket.userData) return;

    const { name, partner } = socket.userData;

    // Notify partner if still connected
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partner
    );
    if (partnerSocket) {
      partnerSocket.emit("partnerLeft");
    }

    // Delete chat
    try {
      await Chat.deleteOne({ participants: { $all: [name, partner] } });
      console.log(`🗑 Chat between ${name} and ${partner} deleted`);
    } catch (err) {
      console.error("❌ Error deleting chat:", err);
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Server running at http://localhost:3001");
});
