require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { initDatabase } = require('./database/db');
const deviceRoutes = require('./routes/devices');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const streamRoutes = require('./routes/stream');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS — allow all local network and development origins
app.use(cors({
  origin: true,
  credentials: true,
}));

// Request parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
app.use(morgan('combined'));

// Serve static web files — disable cache for HTML so fixes always load
const staticOptions = {
  setHeaders: function (res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
};
app.use(express.static(path.join(__dirname, '../web'), staticOptions));
app.use(express.static(path.join(__dirname, '../web/assets')));

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/manage');
});

// API Routes
app.use('/api/stream', streamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/', deviceRoutes);

// Serve web pages for all non-API routes
app.get('/add-device', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/pages/add-device.html'));
});

app.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/pages/manage.html'));
});

app.get('/device-management', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/pages/manage.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/pages/admin.html'));
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/pages/success.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error (without sensitive data)
  console.error('[Server Error]', {
    message: err.message,
    code: err.code,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: { code: 'CORS_ERROR', message: 'Cross-origin request not allowed.' },
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'SERVER_ERROR',
      message: 'An internal server error occurred.',
    },
  });
});

// Initialize database and start
async function start() {
  try {
    await initDatabase();
    console.log('[DB] Database initialized');
  } catch (e) {
    console.error('[DB] Database initialization failed:', e.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] FOX PLAYER backend running on http://0.0.0.0:${PORT}`);
    console.log(`[Server] Pairing page: http://localhost:${PORT}/add-device?device-id=XXXXXXXX`);
  });
}

start();

module.exports = app;
