import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { supabaseAdmin, createUserClient } from '../config/supabase.js';
import { JWT_SECRET } from '../middleware/auth.js';

let io = null;
const userSockets = new Map(); // userId -> Set of socketIds
const socketUsers = new Map(); // socketId -> userId

const initialize = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });
  
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      // Verify token: Supabase first (primary), then legacy custom JWT.
      let decoded;
      const { data: { user }, error: sbError } = await supabaseAdmin.auth.getUser(token);
      if (!sbError && user) {
        decoded = { id: user.id };
      } else {
        try {
          decoded = jwt.verify(token, JWT_SECRET);
          if (!decoded || !decoded.id) {
            throw new Error('missing subject');
          }
        } catch (jwtError) {
          return next(new Error('Invalid token'));
        }
      }

      // Get user profile
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', decoded.id)
        .single();

      if (profileError || !profile) {
        return next(new Error('User profile not found'));
      }

      if (!profile.is_active) {
        return next(new Error('Account is deactivated'));
      }

      socket.user = {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: (profile.role || '').toLowerCase(),
        avatar_url: profile.avatar_url,
        phone: profile.phone
      };
      socket.accessToken = token;
      socket.supabase = createUserClient(token);
      
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });
  
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`User connected: ${userId} (${socket.id})`);
    
    // Track user sockets
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);
    socketUsers.set(socket.id, userId);
    
    // Join user room
    socket.join(`user_${userId}`);
    
    // Handle joining store room
    socket.on('joinStore', async (storeId) => {
      if (!storeId) return;
      
      // Verify user has access to store
      const { data: store } = await supabaseAdmin
        .from('stores')
        .select('id, owner_id')
        .eq('id', storeId)
        .single();
      
      if (store && (store.owner_id === userId || ['admin', 'owner'].includes(socket.user.role))) {
        socket.join(`store_${storeId}`);
        console.log(`User ${userId} joined store room: store_${storeId}`);
      }
    });
    
    socket.on('leaveStore', (storeId) => {
      if (!storeId) return;
      socket.leave(`store_${storeId}`);
    });
    
    // Handle joining conversation
    socket.on('joinConversation', async (conversationId) => {
      if (!conversationId) return;
      
      // Verify membership
      const { data: member } = await supabaseAdmin
        .from('conversation_members')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('profile_id', userId)
        .is('left_at', null)
        .single();
      
      if (member) {
        socket.join(`conversation_${conversationId}`);
        console.log(`User ${userId} joined conversation: ${conversationId}`);
      }
    });
    
    socket.on('leaveConversation', (conversationId) => {
      if (!conversationId) return;
      socket.leave(`conversation_${conversationId}`);
    });
    
    // Handle joining delivery tracking
    socket.on('joinDelivery', async (deliveryId) => {
      if (!deliveryId) return;
      
      // Verify access
      const { data: delivery } = await supabaseAdmin
        .from('deliveries')
        .select(`
          *,
          store_order:store_orders(
            store:stores(owner_id),
            order:orders(customer_id)
          ),
          courier_id
        `)
        .eq('id', deliveryId)
        .single();
      
      if (delivery) {
        const hasAccess = delivery.store_order.order.customer_id === userId ||
          delivery.store_order.store.owner_id === userId ||
          delivery.courier_id === userId ||
          ['admin', 'owner'].includes(socket.user.role);
        
        if (hasAccess) {
          socket.join(`delivery_${deliveryId}`);
          console.log(`User ${userId} joined delivery tracking: ${deliveryId}`);
        }
      }
    });
    
    socket.on('leaveDelivery', (deliveryId) => {
      if (!deliveryId) return;
      socket.leave(`delivery_${deliveryId}`);
    });
    
    // Typing indicators (user id comes from the socket's verified token)
    socket.on('typing', ({ conversationId, name }) => {
      if (!conversationId) return;
      socket.to(`conversation_${conversationId}`).emit('typing', {
        userId,
        name
      });
    });
    
    socket.on('stopTyping', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(`conversation_${conversationId}`).emit('stopTyping', {
        userId
      });
    });
    
    // Call signaling
    socket.on('callSignal', async ({ callId, signal }) => {
      if (!callId || !signal) return;
      // Only a participant of an active call may send signaling.
      const { data: call } = await supabaseAdmin
        .from('call_history')
        .select('caller_id, callee_id, status')
        .eq('id', callId)
        .in('status', ['ringing', 'accepted'])
        .single();
      if (!call || (call.caller_id !== userId && call.callee_id !== userId)) return;
      // Forward to the other participant in the call room.
      socket.to(`call_${callId}`).emit('callSignal', { 
        from: userId, 
        signal 
      });
    });
    
    socket.on('joinCall', async (callId) => {
      if (!callId) return;
      // Only participants may join the call signaling room.
      const { data: call } = await supabaseAdmin
        .from('call_history')
        .select('caller_id, callee_id, status')
        .eq('id', callId)
        .in('status', ['ringing', 'accepted'])
        .single();
      if (!call || (call.caller_id !== userId && call.callee_id !== userId)) return;
      socket.join(`call_${callId}`);
    });
    
    socket.on('leaveCall', (callId) => {
      if (!callId) return;
      socket.leave(`call_${callId}`);
    });
    
    // Courier location updates
    socket.on('courierLocationUpdate', async ({ deliveryId, coordinates, metadata }) => {
      // Verify courier
      const { data: delivery } = await supabaseAdmin
        .from('deliveries')
        .select('courier_id')
        .eq('id', deliveryId)
        .single();
      
      if (delivery && delivery.courier_id === userId) {
        // Broadcast to delivery room
        io.to(`delivery_${deliveryId}`).emit('courierLocationUpdate', {
          courierId: userId,
          coordinates,
          metadata,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId} (${socket.id})`);
      
      const userSocketSet = userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          userSockets.delete(userId);
        }
      }
      socketUsers.delete(socket.id);
    });
  });
  
  return io;
};

// Emit to user
const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

// Emit to store
const emitToStore = (storeId, event, data) => {
  if (io) {
    io.to(`store_${storeId}`).emit(event, data);
  }
};

// Emit to conversation
const emitToConversation = (conversationId, event, data) => {
  if (io) {
    io.to(`conversation_${conversationId}`).emit(event, data);
  }
};

// Emit to delivery
const emitToDelivery = (deliveryId, event, data) => {
  if (io) {
    io.to(`delivery_${deliveryId}`).emit(event, data);
  }
};

// Emit new message
const emitNewMessage = (message) => {
  if (!io) return;

  const conversationId = message?.conversation_id ?? message?.conversationId ?? null;
  const messageId = message?.id ?? message?._id ?? null;

  // Non-sensitive diagnostic: ids and room names only, never token or content.
  console.log('[socket] emit newMessage', { conversationId, messageId });

  if (conversationId) {
    io.to(`conversation_${conversationId}`).emit('newMessage', message);
  }

  // Also notify individual users
  if (message?.receiver_id) {
    io.to(`user_${message.receiver_id}`).emit('newMessage', message);
  }
};

// Emit message read
const emitMessageRead = (conversationId, userId, count) => {
  if (!io) return;
  io.to(`conversation_${conversationId}`).emit('messagesRead', { conversationId, userId, count });
};

// Emit order status update
const emitOrderUpdate = (orderId, storeId, customerId, status, data = {}) => {
  if (!io) return;
  
  if (storeId) {
    io.to(`store_${storeId}`).emit('orderStatusUpdate', { orderId, status, ...data });
  }
  
  io.to(`user_${customerId}`).emit('orderStatusUpdate', { orderId, status, ...data });
};

// Emit new order
const emitNewOrder = (storeId, order) => {
  if (!io) return;
  io.to(`store_${storeId}`).emit('newOrder', order);
};

// Emit delivery status update
const emitDeliveryUpdate = (deliveryId, status, data = {}) => {
  if (!io) return;
  io.to(`delivery_${deliveryId}`).emit('deliveryStatusUpdate', { deliveryId, status, ...data });
};

// Emit courier location update
const emitCourierLocation = (deliveryId, locationData) => {
  if (!io) return;
  io.to(`delivery_${deliveryId}`).emit('courierLocationUpdate', locationData);
};

// Emit incoming call
const emitIncomingCall = (calleeId, callData) => {
  if (!io) return;
  io.to(`user_${calleeId}`).emit('incomingCall', callData);
};

// Emit call ended
const emitCallEnded = (callId, callData) => {
  if (!io) return;
  io.to(`call_${callId}`).emit('callEnded', callData);
};

// Emit notification
const emitNotification = (userId, notification) => {
  if (!io) return;
  io.to(`user_${userId}`).emit('notification', notification);
};

// Get online users
const getOnlineUsers = () => {
  return Array.from(userSockets.keys());
};

// Check if user is online
const isUserOnline = (userId) => {
  return userSockets.has(userId);
};

const getIO = () => io;

export {
  initialize,
  emitToUser,
  emitToStore,
  emitToConversation,
  emitToDelivery,
  emitNewMessage,
  emitMessageRead,
  emitOrderUpdate,
  emitNewOrder,
  emitDeliveryUpdate,
  emitCourierLocation,
  emitIncomingCall,
  emitCallEnded,
  emitNotification,
  getOnlineUsers,
  isUserOnline,
  getIO
};