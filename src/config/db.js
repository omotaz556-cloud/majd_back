const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI is not set in environment variables');
  }

  mongoose.connection.on('connected', () => {
    console.log('[DB] MongoDB connected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[DB] MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected');
  });

  await mongoose.connect(uri, {
    // Mongoose 7+ no longer needs useNewUrlParser/useUnifiedTopology
  });
}

module.exports = connectDB;
