// Chapter 3: User-Employee Chat Switching with MongoDB + Express + Socket.IO
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import authRoutes from "./routes/auth";
import { authenticate } from "./middleware/auth";
// ----- MongoDB Models -----

// Define User and Employee types for simplicity
interface IUser {
  _id: string;
  name: string;
  socketId?: string;
  isEmployee: boolean;
}

// Chat message type
interface IMessage {
  sender: string;
  receiver: string;
  text: string;
  timestamp: Date;
}

// Setup Mongoose Schemas
const userSchema = new mongoose.Schema<IUser>({
  name: String,
  socketId: String,
  isEmployee: Boolean,
});

const messageSchema = new mongoose.Schema<IMessage>({
  sender: String,
  receiver: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});

const User = mongoose.model<IUser>("User", userSchema);
const Message = mongoose.model<IMessage>("Message", messageSchema);

// ----- Express and Socket.IO Setup -----

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    socket.data.userId = payload.userId;
    socket.data.isEmployee = payload.isEmployee;
    return next();
  } catch {
    return next(new Error("Authentication error"));
  }
});

// ----- Socket.IO Logic -----

io.on("connection", (socket: Socket) => {
  console.log("New client connected:", socket.id);
  const { userId, isEmployee } = socket.data;

  socket.on(
    "register",
    async ({ name, isEmployee }: { name: string; isEmployee: boolean }) => {
      const user = new User({ name, socketId: socket.id, isEmployee });
      await user.save();
      console.log(
        `User ${name} registered as ${isEmployee ? "Employee" : "User"}`
      );
    }
  );

  socket.on("sendMessage", async ({ senderId, receiverId, text }) => {
    const message = new Message({
      sender: senderId,
      receiver: receiverId,
      text,
    });
    await message.save();

    const receiver = await User.findById(receiverId);
    if (receiver?.socketId) {
      io.to(receiver.socketId).emit("receiveMessage", message);
    }
  });

  socket.on("disconnect", async () => {
    console.log("Client disconnected:", socket.id);
    await User.findOneAndDelete({ socketId: socket.id });
  });
});

// ----- Express Routes -----

// Public auth routes
app.use("/auth", authRoutes);

app.get("/employees", authenticate, async (req, res) => {
  const employees = await User.find({ isEmployee: true });
  res.json(employees);
});

app.get("/messages/:userId/:employeeId", authenticate, async (req, res) => {
  const { userId, employeeId } = req.params;
  const messages = await Message.find({
    $or: [
      { sender: userId, receiver: employeeId },
      { sender: employeeId, receiver: userId },
    ],
  }).sort({ timestamp: 1 });
  res.json(messages);
});

// ----- Server Start -----

mongoose.connect("mongodb://localhost:27017/chatapp").then(() => {
  console.log("MongoDB connected");
  server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
  });
});
