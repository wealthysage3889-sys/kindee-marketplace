const http = require("http");
const { Server } = require("socket.io");

let io = null;

const initialize = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("joinStore", (storeId) => {
      if (!storeId) return;
      socket.join(`store_${storeId}`);
      console.log(`Socket ${socket.id} joined store room: store_${storeId}`);
    });

    socket.on("leaveStore", (storeId) => {
      if (!storeId) return;
      socket.leave(`store_${storeId}`);
      console.log(`Socket ${socket.id} left store room: store_${storeId}`);
    });

    socket.on("joinUser", (userId) => {
      if (!userId) return;
      socket.join(`user_${userId}`);
      console.log(`Socket ${socket.id} joined user room: user_${userId}`);
    });

    socket.on("joinRoom", (room) => {
      if (!room) return;
      socket.join(room);
      console.log(`Socket ${socket.id} joined room: ${room}`);
    });

    socket.on("leaveRoom", (room) => {
      if (!room) return;
      socket.leave(room);
      console.log(`Socket ${socket.id} left room: ${room}`);
    });

    socket.on("typing", ({ storeId, userId, name }) => {
      socket.to(`store_${storeId}`).emit("typing", { userId, name });
    });

    socket.on("stopTyping", ({ storeId, userId }) => {
      socket.to(`store_${storeId}`).emit("stopTyping", { userId });
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });
};

const emitToRoom = (room, event, data) => {
  if (io) {
    io.to(room).emit(event, data);
  }
};

const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

const emitNewMessage = (message) => {
  if (!io) return;
  const storeId = message.store?._id || message.store;
  io.to(`store_${storeId}`).emit("newMessage", message);
  if (message.receiver) {
    const receiverId = message.receiver._id || message.receiver;
    io.to(`user_${receiverId}`).emit("newMessage", message);
  }
};

const emitMessageRead = (storeId, userId, count) => {
  if (!io) return;
  io.to(`store_${storeId}`).emit("messagesRead", { storeId, userId, count });
};

const emitOrderUpdate = (orderId, storeId, customerId, status, data = {}) => {
  if (io) {
    io.to(`store_${storeId}`).emit("orderStatusUpdate", { orderId, status, ...data });
    io.to(`user_${customerId}`).emit("orderStatusUpdate", { orderId, status, ...data });
  }
};

const emitNewOrder = (storeId, order) => {
  if (io) {
    io.to(`store_${storeId}`).emit("newOrder", order);
  }
};

const emitProductUpdate = (storeId, product) => {
  if (io) {
    io.to(`store_${storeId}`).emit("productUpdate", product);
  }
};

module.exports = {
  initialize,
  emitToRoom,
  emitToUser,
  emitNewMessage,
  emitMessageRead,
  emitOrderUpdate,
  emitNewOrder,
  emitProductUpdate,
  getIO: () => io,
};