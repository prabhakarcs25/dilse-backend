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
    origin: "https://dilse-frontend.vercel.app", // during development/testing
    methods: ["GET", "POST"],
  },
});

// Connect MongoDB
mongoose
  .connect(
    "mongodb+srv://prabhakarsingh63915:LVarp18@cluster0.5olyu2h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
  )
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

app.use(cors());
app.use(express.json());

let waitingUsers = []; // Users waiting to be matched

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // Register user
  socket.on("register", async ({ name, gender, lookingFor, age, city }) => {
    socket.userData = { name, gender, lookingFor, age, city };

    const match = waitingUsers.find(
      (user) =>
        user.lookingFor === gender &&
        user.gender === lookingFor &&
        (!user.city || user.city === city) &&
        (!user.age || user.age === age)
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

      // Set partner references
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
        city,
      });
    }
  });

  // Handle messaging
  socket.on("message", async (msg) => {
    const name = socket.userData?.name;
    const partner = socket.userData?.partner;

    if (!name || !partner) return;

    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partner && s.roomId === socket.roomId
    );

    if (partnerSocket) {
      partnerSocket.emit("message", { from: name, text: msg });
    }

    await Chat.findOneAndUpdate(
      { participants: { $all: [name, partner] } },
      { $push: { messages: { from: name, text: msg } } }
    );
  });

  // Typing indicator
  socket.on("typing", () => {
    const partner = socket.userData?.partner;
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partner && s.roomId === socket.roomId
    );
    if (partnerSocket) partnerSocket.emit("partnerTyping");
  });

  socket.on("stopTyping", () => {
    const partner = socket.userData?.partner;
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === partner && s.roomId === socket.roomId
    );
    if (partnerSocket) partnerSocket.emit("partnerStopTyping");
  });

  // WebRTC: Offer
  socket.on("offer", (offer) => {
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === socket.userData?.partner
    );
    if (partnerSocket) partnerSocket.emit("offer", offer);
  });

  // WebRTC: Answer
  socket.on("answer", (answer) => {
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === socket.userData?.partner
    );
    if (partnerSocket) partnerSocket.emit("answer", answer);
  });

  // WebRTC: ICE candidate
  socket.on("ice", (candidate) => {
    const partnerSocket = [...io.sockets.sockets.values()].find(
      (s) => s.userData?.name === socket.userData?.partner
    );
    if (partnerSocket) partnerSocket.emit("ice", candidate);
  });

  // On disconnect
  socket.on("disconnect", async () => {
    console.log("🔴 Disconnected:", socket.id);

    // Remove from waiting list
    waitingUsers = waitingUsers.filter((u) => u.socketId !== socket.id);

    const { name, partner } = socket.userData || {};

    if (partner) {
      const partnerSocket = [...io.sockets.sockets.values()].find(
        (s) => s.userData?.name === partner
      );

      if (partnerSocket) {
        partnerSocket.emit("partnerLeft");
        partnerSocket.userData.partner = null;
      }

      try {
        await Chat.deleteOne({ participants: { $all: [name, partner] } });
        console.log(`🗑 Chat between ${name} and ${partner} deleted`);
      } catch (err) {
        console.error("❌ Error deleting chat:", err);
      }
    }
  });
});

server.listen(3001, () => {
  console.log("✅ Server running at http://localhost:3001");
});
