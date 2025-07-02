// ==== server/models/Chat.js ====
import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
  participants: [String],
  messages: [
    {
      from: String,
      text: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

export default mongoose.model("Chat", chatSchema);
