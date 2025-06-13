require('dotenv').config();
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
const io = socketIo(server, { 
  cors: { 
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  } 
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload configuration
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
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
    cb(new Error('Invalid file type. Only JPEG, PNG, PDF, DOC, and DOCX are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

// Enhanced MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://dilip:Mongodbdilip@blog.slftveg.mongodb.net/whatsapp?retryWrites=true&w=majority';

const connectWithRetry = () => {
  mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    w: 'majority'
  })
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

connectWithRetry();

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Mongoose connection closed due to app termination');
  process.exit(0);
});

// Database Schemas
const userSchema = new mongoose.Schema({
  phoneNumber: { 
    type: String, 
    unique: true, 
    required: true,
    validate: {
      validator: function(v) {
        return /^\+\d{10,15}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  username: { 
    type: String, 
    required: true,
    minlength: 3,
    maxlength: 30
  },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  profilePicture: String,
  status: { type: String, default: 'Hey there! I am using WhatsApp' }
}, { timestamps: true });

const groupSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    minlength: 3,
    maxlength: 50 
  },
  members: [{ 
    type: String,
    validate: {
      validator: function(v) {
        return /^\+\d{10,15}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  }],
  createdBy: {
    type: String,
    required: true
  },
  groupPicture: String,
  description: String
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  senderPhone: {
    type: String,
    required: true
  },
  receiverPhone: String,
  groupId: String,
  message: {
    type: String,
    maxlength: 1000
  },
  fileUrl: String,
  fileType: String,
  fileSize: Number,
  status: { 
    type: String, 
    enum: ['sent', 'delivered', 'read'], 
    default: 'sent' 
  },
  reactions: { 
    type: Map, 
    of: String, 
    default: {} 
  },
  deletedFor: [String]
}, { timestamps: true });

// Indexes for better query performance
messageSchema.index({ senderPhone: 1, receiverPhone: 1 });
messageSchema.index({ groupId: 1 });
messageSchema.index({ createdAt: -1 });

const User = mongoose.model('User', userSchema);
const Group = mongoose.model('Group', groupSchema);
const Message = mongoose.model('Message', messageSchema);

// Database connection middleware
app.use((req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: 'Database not connected',
      details: 'Please try again later'
    });
  }
  next();
});

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { phoneNumber, username } = req.body;
    
    if (!phoneNumber || !username) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: 'Phone number and username are required'
      });
    }

    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(409).json({ 
        error: 'Conflict',
        details: 'Phone number already registered'
      });
    }

    const user = new User({ phoneNumber, username });
    await user.save();
    
    res.status(201).json({ 
      message: 'User registered successfully', 
      user: { 
        phoneNumber: user.phoneNumber, 
        username: user.username 
      } 
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: err.message 
      });
    }
    console.error('Register error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: 'Failed to register user' 
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: 'Phone number is required' 
      });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ 
        error: 'Not found',
        details: 'User not found' 
      });
    }

    await User.updateOne({ phoneNumber }, { 
      isOnline: true, 
      lastSeen: new Date() 
    });
    
    res.json({ 
      message: 'Login successful', 
      user: { 
        phoneNumber: user.phoneNumber, 
        username: user.username,
        isOnline: true,
        lastSeen: user.lastSeen
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: 'Failed to login' 
    });
  }
});

// ... [Previous route handlers remain largely the same, but with enhanced error handling]

// Enhanced Socket.IO Events
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('join', async (phoneNumber) => {
    try {
      if (!phoneNumber) {
        throw new Error('Phone number is required');
      }
      
      socket.join(phoneNumber);
      await User.updateOne({ phoneNumber }, { 
        isOnline: true, 
        lastSeen: new Date() 
      });
      
      io.emit('userStatus', { 
        phoneNumber, 
        isOnline: true 
      });
      
      console.log(`${phoneNumber} joined room`);
    } catch (err) {
      console.error('Join error:', err);
      socket.emit('error', { 
        message: 'Failed to join',
        details: err.message 
      });
    }
  });

  // ... [Other socket event handlers with enhanced error handling]

  socket.on('disconnect', async () => {
    try {
      const phoneNumber = Object.keys(socket.rooms)
        .find(room => room !== socket.id);
      
      if (phoneNumber) {
        await User.updateOne({ phoneNumber }, { 
          isOnline: false, 
          lastSeen: new Date() 
        });
        
        io.emit('userStatus', { 
          phoneNumber, 
          isOnline: false 
        });
      }
      
      console.log('Client disconnected:', socket.id);
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      error: 'File upload error',
      details: err.message 
    });
  } else if (err) {
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
  
  next();
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
