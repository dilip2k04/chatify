const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: 'https://chatify-48y2.onrender.com' } });

// Middleware
app.use(cors());
app.use(express.json());

// Ensure Uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'application/pdf', 
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, PDF, DOC, DOCX'));
    }
  }
});

// MongoDB Connection
const MONGO_URI = 'mongodb+srv://dilip:Mongodbdilip@blog.slftveg.mongodb.net/';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, required: true },
  username: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  members: [{ type: String }],
  createdBy: String
});
const Group = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
  senderPhone: String,
  receiverPhone: String,
  groupId: String,
  message: String,
  fileUrl: String,
  fileType: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  reactions: { type: Map, of: String, default: {} }
});
const Message = mongoose.model('Message', messageSchema);

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { phoneNumber, username } = req.body;
    if (!phoneNumber || !username) {
      return res.status(400).json({ error: 'Phone number and username required' });
    }
    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }
    const user = new User({ phoneNumber, username });
    await user.save();
    res.status(201).json({ message: 'User registered successfully', user: { phoneNumber, username } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await User.updateOne({ phoneNumber }, { isOnline: true, lastSeen: new Date() });
    res.json({ message: 'Login successful', user: { phoneNumber: user.phoneNumber, username: user.username } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'phoneNumber username isOnline lastSeen');
    res.json(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { name, members, createdBy } = req.body;
    if (!name || !members || !createdBy) {
      return res.status(400).json({ error: 'Name, members, and creator required' });
    }
    const group = new Group({ name, members, createdBy });
    await group.save();
    members.forEach(phone => io.to(phone).emit('groupCreated', group));
    res.status(201).json(group);
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.get('/api/groups/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const groups = await Group.find({ members: phoneNumber });
    res.json(groups);
  } catch (err) {
    console.error('Fetch groups error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.get('/api/messages/:userPhone/:contactPhone', async (req, res) => {
  try {
    const { userPhone, contactPhone } = req.params;
    const messages = await Message.find({
      $or: [
        { senderPhone: userPhone, receiverPhone: contactPhone },
        { senderPhone: contactPhone, receiverPhone: userPhone }
      ]
    }).sort({ timestamp: 1 }).limit(50);
    await Message.updateMany(
      { senderPhone: contactPhone, receiverPhone: userPhone, status: { $in: ['sent', 'delivered'] } },
      { status: 'read' }
    );
    io.to(contactPhone).emit('messageStatus', { receiverPhone: userPhone });
    res.json(messages);
  } catch (err) {
    console.error('Fetch messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/group-messages/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const messages = await Message.find({ groupId }).sort({ timestamp: 1 }).limit(50);
    res.json(messages);
  } catch (err) {
    console.error('Fetch group messages error:', err);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

app.post('/api/messages', upload.single('file'), async (req, res) => {
  try {
    const { senderPhone, receiverPhone, groupId, message } = req.body;
    if (!senderPhone || (!receiverPhone && !groupId) || (!message && !req.file)) {
      return res.status(400).json({ error: 'Sender, receiver/group, and message/file required' });
    }
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const newMessage = new Message({
      senderPhone,
      receiverPhone,
      groupId,
      message,
      fileUrl,
      fileType: req.file ? req.file.mimetype : null,
      status: 'sent'
    });
    await newMessage.save();
    
    if (groupId) {
      const group = await Group.findById(groupId);
      group.members.forEach(phone => {
        if (phone !== senderPhone) {
          io.to(phone).emit('message', newMessage);
        }
      });
    } else {
      io.to(receiverPhone).emit('message', newMessage);
      const receiver = await User.findOne({ phoneNumber: receiverPhone });
      if (receiver?.isOnline) {
        newMessage.status = 'delivered';
        await newMessage.save();
        io.to(senderPhone).emit('messageStatus', { messageId: newMessage._id, status: 'delivered' });
      }
    }
    io.to(senderPhone).emit('message', newMessage);
    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: err.message || 'Failed to send message' });
  }
});

app.delete('/api/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    await Message.deleteOne({ _id: messageId });
    if (message.groupId) {
      const group = await Group.findById(message.groupId);
      group.members.forEach(phone => io.to(phone).emit('messageDeleted', messageId));
    } else {
      io.to(message.senderPhone).emit('messageDeleted', messageId);
      io.to(message.receiverPhone).emit('messageDeleted', messageId);
    }
    res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

app.get('/api/search-messages/:userPhone/:query', async (req, res) => {
  try {
    const { userPhone, query } = req.params;
    const messages = await Message.find({
      $or: [
        { senderPhone: userPhone, message: { $regex: query, $options: 'i' } },
        { receiverPhone: userPhone, message: { $regex: query, $options: 'i' } }
      ]
    }).sort({ timestamp: -1 }).limit(50);
    res.json(messages);
  } catch (err) {
    console.error('Search messages error:', err);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Socket.IO Events
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('join', async (phoneNumber) => {
    socket.join(phoneNumber);
    await User.updateOne({ phoneNumber }, { isOnline: true, lastSeen: new Date() });
    io.emit('userStatus', { phoneNumber, isOnline: true });
    console.log(`${phoneNumber} joined room`);
  });

  socket.on('typing', ({ senderPhone, receiverPhone, groupId, isTyping }) => {
    if (groupId) {
      Group.findById(groupId).then(group => {
        group.members.forEach(phone => {
          if (phone !== senderPhone) {
            io.to(phone).emit('typing', { senderPhone, groupId, isTyping });
          }
        });
      });
    } else {
      io.to(receiverPhone).emit('typing', { senderPhone, isTyping });
    }
  });

  socket.on('reaction', async ({ messageId, userPhone, reaction }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;
      message.reactions.set(userPhone, reaction);
      await message.save();
      if (message.groupId) {
        const group = await Group.findById(message.groupId);
        group.members.forEach(phone => io.to(phone).emit('reaction', { messageId, userPhone, reaction }));
      } else {
        io.to(message.senderPhone).emit('reaction', { messageId, userPhone, reaction });
        io.to(message.receiverPhone).emit('reaction', { messageId, userPhone, reaction });
      }
    } catch (err) {
      console.error('Reaction error:', err);
    }
  });

  socket.on('disconnect', async () => {
    const phoneNumber = Object.keys(socket.rooms).find(room => room !== socket.id);
    if (phoneNumber) {
      await User.updateOne({ phoneNumber }, { isOnline: false, lastSeen: new Date() });
      io.emit('userStatus', { phoneNumber, isOnline: false });
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
