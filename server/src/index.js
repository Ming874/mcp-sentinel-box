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
      // 移除 readonly: true 讓前端可以透過 Socket 清除資料庫
      db = new Database(DB_PATH);
      console.log("Connected to real database (Read-Write).");
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
    const latestExec = db.prepare('SELECT id FROM executions ORDER BY id DESC LIMIT 1').get();
    let samples = [];
    if (latestExec) {
      samples = db.prepare('SELECT * FROM resource_samples WHERE exec_id = ? ORDER BY id DESC LIMIT 20').all(latestExec.id).reverse();
    }
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
        message: e.semantic_msg,
        remediation: e.remediation || ''
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

  socket.on('clear_database', () => {
    console.log('[DB] Request to clear all records');
    if (!db) return;
    try {
      db.prepare('DELETE FROM resource_samples').run();
      db.prepare('DELETE FROM syscall_events').run();
      db.prepare('DELETE FROM executions').run();
      lastSampleId = 0;
      lastEventId = 0;
      lastActivePids = ""; // Reset active tracking
      console.log('[DB] Database cleared successfully.');
      io.emit('database_cleared'); // Use io.emit to notify ALL clients
    } catch (e) {
      console.error('[DB] Failed to clear database:', e.message);
    }
  });

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
    // 判斷是否為 C 語言 (包含 c_oom 範本)
    if (language === 'c' || language === 'c_oom') {
      const sourceFile = path.join(os.tmpdir(), `sentinelbox_${Date.now()}.c`);
      const binaryFile = path.join(os.tmpdir(), `sentinelbox_${Date.now()}.bin`);
      fs.writeFileSync(sourceFile, code);

      // 使用 systemd-run 包裝編譯與執行，確保 cgroup delegation
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
        // 核心修正：加入 systemd-run --user --scope --property=Delegate=yes
        const child = spawn('systemd-run', [
            '--user', '--scope', '--property=Delegate=yes',
            'bash', runScript, '--profile', profile, '--', '/bin/sh', '-c', cmd
        ]);
        
        const binaryData = fs.readFileSync(binaryFile);
        handleChild(child, socket, [sourceFile, binaryFile], execId, binaryData);
      });
      return;
    } else {
      const runScript = path.join(__dirname, '../../scripts/run.sh');
      const cmd = `cat > /tmp/script.sh && chmod +x /tmp/script.sh && /bin/sh /tmp/script.sh`;
      // 核心修正：加入 systemd-run --user --scope --property=Delegate=yes
      const child = spawn('systemd-run', [
          '--user', '--scope', '--property=Delegate=yes',
          'bash', runScript, '--profile', profile, '--', '/bin/sh', '-c', cmd
      ]);
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
          message: e.semantic_msg,
          remediation: e.remediation || ''
        });
        lastEventId = e.id;
      });
    }

    // 更新運行中的沙盒列表
    const actives = db.prepare('SELECT * FROM executions WHERE end_ts IS NULL').all();
    const currentActivePids = actives.map(e => e.pid).sort().join(',');
    
    // 如果沒有沙盒在跑，主動發送 0 負載訊號讓儀表板降回去
    if (actives.length === 0) {
      io.emit('telemetry', {
        time: new Date().toLocaleTimeString(),
        cpu: 0,
        memory: 0,
        totalMemory: os.totalmem() / (1024 * 1024)
      });
    }

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
}, 100);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Real-time data bridge running on port ${PORT}`);
});
