const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

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
      startTime: new Date(e.start_ts).toLocaleTimeString(),
      startTs: e.start_ts
    })));
  } catch (err) {
    console.error('Error sending initial data:', err.message);
  }

  socket.on('kill_sandbox', (data) => {
    const { pid, id } = data;
    console.log(`[KILL] Request to kill sandbox: PID=${pid}, ID=${id}`);
    if (pid) {
      try {
        // 殺死整個進程組 (Process Group)
        // 對負數 PID 送訊號會送到該 PID 所屬的進程組
        // 解決沙盒內有無窮迴圈子進程殺不掉的問題
        process.kill(-pid, 'SIGKILL');
        console.log(`[KILL] Sent SIGKILL to process group ${pid}`);
      } catch (err) {
        console.error(`[KILL] Group kill failed for ${pid}, trying single pid:`, err.message);
        try {
          process.kill(pid, 'SIGKILL');
        } catch (e2) {
          // 進程可能已經結束
        }
        
        // 更激進的 Shell Fallback
        exec(`sudo kill -9 -${pid} || sudo kill -9 ${pid} || kill -9 -${pid} || kill -9 ${pid}`, (error) => {
          if (error) console.error(`[KILL] Final shell kill failed for ${pid}:`, error.message);
        });
      }
    }
  });

  socket.on('execute_code', (data) => {
    const { code, profile = 'strict', language = 'sh' } = data;
    const execId = `exec_${Date.now()}`;
    console.log(`[EXEC] [${execId}] Executing ${language} code with profile: ${profile}`);
    
    socket.emit('execution_started', { execId });

    let tmpFile;
    if (language === 'c') {
      const sourceFile = path.join(os.tmpdir(), `sentinelbox_${Date.now()}.c`);
      const binaryFile = path.join(os.tmpdir(), `sentinelbox_${Date.now()}.bin`);
      fs.writeFileSync(sourceFile, code);

      exec(`gcc -static ${sourceFile} -o ${binaryFile}`, (compileError, stdout, stderr) => {
        if (compileError) {
          socket.emit('execution_result', {
            execId,
            code: 1,
            output: `Compilation Error:\n${stderr}`,
            success: false
          });
          try { fs.unlinkSync(sourceFile); } catch (e) {}
          return;
        }

        const runScript = path.join(__dirname, '../../scripts/run.sh');
        const cmd = `cat > /tmp/exe && chmod +x /tmp/exe && /tmp/exe`;
        const child = spawn('bash', [runScript, '--profile', profile, '--', '/bin/sh', '-c', cmd]);
        
        const binaryData = fs.readFileSync(binaryFile);
        handleChild(child, socket, [sourceFile, binaryFile], execId, binaryData);
      });
      return;
    } else {
      const runScript = path.join(__dirname, '../../scripts/run.sh');
      const cmd = `cat > /tmp/script.sh && chmod +x /tmp/script.sh && /bin/sh /tmp/script.sh`;
      const child = spawn('bash', [runScript, '--profile', profile, '--', '/bin/sh', '-c', cmd]);
      handleChild(child, socket, [], execId, code);
    }
  });
});

function handleChild(child, socket, filesToCleanup, execId, stdinData) {
  let output = '';

  if (stdinData) {
    child.stdin.write(stdinData);
    child.stdin.end();
  }

  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    output += data.toString();
  });

  child.on('close', (code) => {
    console.log(`[EXEC] [${execId}] Sandbox execution finished with code ${code}`);
    socket.emit('execution_result', {
      execId,
      code,
      output: output.trim(),
      success: code === 0
    });
    filesToCleanup.forEach(f => {
      try { fs.unlinkSync(f); } catch (e) {}
    });
  });

  child.on('error', (err) => {
    console.error(`[EXEC] [${execId}] Failed to start sandbox:`, err);
    socket.emit('execution_result', {
      execId,
      error: err.message,
      success: false
    });
    filesToCleanup.forEach(f => {
      try { fs.unlinkSync(f); } catch (e) {}
    });
  });
}

let lastActivePids = "";

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
    const currentActivePids = actives.map(e => e.pid).sort().join(',');
    if (currentActivePids !== lastActivePids) {
      io.emit('active_sandboxes', actives.map(e => ({
        id: e.id,
        pid: e.pid,
        command: e.command,
        profile: e.profile,
        startTime: new Date(e.start_ts).toLocaleTimeString(),
        startTs: e.start_ts
      })));
      lastActivePids = currentActivePids;
    }
  } catch (err) {
    // console.error('Database polling error:', err.message); // Commented to reduce noise if DB is locked
  }
}, 1000);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Real-time data bridge running on port ${PORT}`);
});
