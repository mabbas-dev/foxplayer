const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.MYSQL_HOST || '194.164.64.35', // or 82.197.82.27 / localhost
  user: process.env.MYSQL_USER || 'u139837297_fox_db',
  password: process.env.MYSQL_PASSWORD || '6pXeaXlP@',
  database: process.env.MYSQL_DATABASE || 'u139837297_fox_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;

function getDb() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

async function initDatabase() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  // Test connection
  try {
    const conn = await pool.getConnection();
    conn.release();
    console.log('[DB] Connected to MySQL u139837297_fox_db successfully.');
  } catch (err) {
    console.warn('[DB] MySQL connection warning:', err.message);
  }
  return pool;
}

module.exports = { initDatabase, getDb };
