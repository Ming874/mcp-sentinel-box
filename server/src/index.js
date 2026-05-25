const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

const DB_PATH = path.join(__dirname, '../../sentinelbox.db');

// Ensure DB exists before connecting
if (!fs.existsSync(DB_PATH)) {
  console.log(`Waiting for database creation at ${DB_PATH}...`);
}

let db = null;
const connectDB = () => {
  try {
    if (fs.existsSync(DB_PATH)) {
      db = new Database(DB_PATH, { readonly: true });
      console.log("Connected to real database.");
      return true;
    }
  } catch (e) {
    console.error("Failed to connect to db:", e.message);
  }
  return false;
};

// 追蹤上一次讀取的 ID，避免重複推送
let lastSampleId = 0;
let lastEventId = 0;

// 初始化：取得最新的 ID
const init = () => {
  if (!db) return;
  try {
    const sample = db.prepare('SELECT MAX(id) as id FROM resource_samples').get();
    const event = db.prepare('SELECT MAX(id) as id FROM syscall_events').get();
    lastSampleId = sample?.id || 0;
    lastEventId = event?.id || 0;
    console.log(`Initial IDs: sample=${lastSampleId}, event=${lastEventId}`);
  } catch (e) {
      console.log("Tables might not exist yet:", e.message);
  }
};

if (connectDB()) init();

io.on('connection', (socket) => {
  console.log('Client connected');
  if (!db) return;
  try {
    const samples = db.prepare('SELECT * FROM resource_samples ORDER BY id DESC LIMIT 20').all().reverse();
    samples.forEach(s => {
      socket.emit('telemetry', {
        time: new Date(s.ts).toLocaleTimeString(),
        cpu: s.cpu_pct,
        memory: s.mem_bytes / (1024 * 1024),
        totalMemory: os.totalmem() / (1024 * 1024)
      });
    });

    const events = db.prepare('SELECT * FROM syscall_events ORDER BY id DESC LIMIT 50').all().reverse();
    events.forEach(e => {
      socket.emit('security_event', {
        id: e.id,
        time: new Date(e.ts).toLocaleTimeString(),
        type: 'Violation',
        signal: e.signal_name,
        syscall: e.syscall_name,
        path: e.path || '',
        message: e.semantic_msg
      });
    });

    // 初始傳送運行中的沙盒
    const actives = db.prepare('SELECT * FROM executions WHERE end_ts IS NULL').all();
    socket.emit('active_sandboxes', actives.map(e => ({
      id: e.id,
      pid: e.pid,
      command: e.command,
      profile: e.profile,
      startTime: new Date(e.start_ts).toLocaleTimeString()
    })));
  } catch (err) {
    console.error('Error sending initial data:', err.message);
  }

  socket.on('kill_sandbox', (data) => {
    const { pid, id } = data;
    console.log(`Request to kill sandbox: PID=${pid}, ID=${id}`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        console.error(`Failed to kill process ${pid}:`, err.message);
      }
    }
  });
});

// 每秒輪詢資料庫
setInterval(() => {
  if (!db) {
      if (connectDB()) init();
      return;
  }
  
  try {
    // 取得新樣本
    const samples = db.prepare('SELECT * FROM resource_samples WHERE id > ? ORDER BY id ASC').all(lastSampleId);
    if (samples.length > 0) {
      samples.forEach(s => {
        io.emit('telemetry', {
          time: new Date(s.ts).toLocaleTimeString(),
          cpu: s.cpu_pct,
          memory: s.mem_bytes / (1024 * 1024), // 轉為 MB
          totalMemory: os.totalmem() / (1024 * 1024) // 轉為 MB
        });
        lastSampleId = s.id;
      });
    }

    // 取得新事件
    const events = db.prepare('SELECT * FROM syscall_events WHERE id > ? ORDER BY id ASC').all(lastEventId);
    if (events.length > 0) {
      events.forEach(e => {
        io.emit('security_event', {
          id: e.id,
          time: new Date(e.ts).toLocaleTimeString(),
          type: 'Violation',
          signal: e.signal_name,
          syscall: e.syscall_name,
          path: e.path || '',
          message: e.semantic_msg
        });
        lastEventId = e.id;
      });
    }

    // 更新運行中的沙盒列表
    const actives = db.prepare('SELECT * FROM executions WHERE end_ts IS NULL').all();
    io.emit('active_sandboxes', actives.map(e => ({
      id: e.id,
      pid: e.pid,
      command: e.command,
      profile: e.profile,
      startTime: new Date(e.start_ts).toLocaleTimeString()
    })));
  } catch (err) {
    // console.error('Database polling error:', err.message); // Commented to reduce noise if DB is locked
  }
}, 1000);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Real-time data bridge running on port ${PORT}`);
});
