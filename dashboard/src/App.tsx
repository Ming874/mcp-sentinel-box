import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShieldAlert, Cpu, MemoryStick, Play, Pause, Trash2, LayoutDashboard, Copy, Check, Maximize2, Minimize2, X, Terminal, Sparkles, FileUp } from 'lucide-react';
import { io } from 'socket.io-client';
import Prism from 'prismjs';
import { motion, AnimatePresence } from 'framer-motion';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/themes/prism-tomorrow.css';

const generateInitialData = (length: number) => {
  return Array.from({ length }, (_, i) => {
    return {
      time: new Date(Date.now() - (length - i) * 1000).toLocaleTimeString(),
      cpu: 0,
      memory: 0,
    };
  });
};

function App() {
  const [timeRange, setTimeRange] = useState(20); // Default 20 seconds
  const [data, setData] = useState(generateInitialData(20));
  const [totalMem, setTotalMem] = useState(8192); // Default 8GB, will update from server
  const [logs, setLogs] = useState<any[]>([]);
  const [activeSandboxes, setActiveSandboxes] = useState<any[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  
  // Code Execution State
  const [language, setLanguage] = useState('sh');
  const [code, setCode] = useState('#!/bin/sh\necho "Hello from SentinelBox!"\n# Try to read a sensitive file\ncat /etc/shadow 2>&1 || echo "Access denied to /etc/shadow"\n');
  const [profile, setProfile] = useState('strict');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Results State: Multiple results tracking
  const [executionResults, setExecutionResults] = useState<any[]>([]);
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);

  // UI Polish States
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [showCopyToast, setShowCopyToast] = useState(false);

  const profiles = [
    { id: 'strict', label: 'High Security', description: 'Maximum isolation. No network, restricted syscalls. Best for untrusted code.' },
    { id: 'datascience', label: 'AI/Data Sandbox', description: 'High memory limit. Local networking allowed. Best for AI model execution.' },
    { id: 'web', label: 'Web/Network', description: 'Outbound HTTP/HTTPS allowed. Restricted listening. Best for web crawlers.' }
  ];

  const languages = [
    { id: 'sh', label: 'Shell Script', defaultCode: '#!/bin/sh\necho "Hello from SentinelBox!"\n# Try to read a sensitive file\ncat /etc/shadow 2>&1 || echo "Access denied to /etc/shadow"\n' },
    { id: 'c', label: 'C Language', defaultCode: '#include <stdio.h>\n#include <unistd.h>\n\nint main() {\n    printf("Hello from C Sandbox!\\n");\n    printf("My PID is %d\\n", getpid());\n    // Try to open a file\n    FILE *f = fopen("/etc/shadow", "r");\n    if (f == NULL) {\n        perror("fopen /etc/shadow");\n    } else {\n        printf("Successfully opened /etc/shadow (Wait, what?)\\n");\n        fclose(f);\n    }\n    return 0;\n}\n' }
  ];

  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCode(content);

      // Auto-detect language
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension === 'c') {
        setLanguage('c');
      } else if (extension === 'sh') {
        setLanguage('sh');
      }

      // Reset file input so same file can be uploaded again
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Update cursor to start
      setCursorLine(1);
    };
    reader.readAsText(file);
  };

  // Handle language change
  const handleLanguageChange = (langId: string) => {
    setLanguage(langId);
    const lang = languages.find(l => l.id === langId);
    if (lang) setCode(lang.defaultCode);
  };

  // 當 timeRange 改變時，調整數據長度
  useEffect(() => {
    setData(prev => {
      if (prev.length > timeRange) return prev.slice(prev.length - timeRange);
      if (prev.length < timeRange) {
        const padding = Array.from({ length: timeRange - prev.length }, (_, i) => ({
          time: new Date(Date.now() - (timeRange - i) * 1000).toLocaleTimeString(),
          cpu: 0,
          memory: 0,
        }));
        return [...padding, ...prev];
      }
      return prev;
    });
  }, [timeRange]);

  useEffect(() => {
    // 建立 Socket 連線
    socketRef.current = io('http://localhost:3001');

    socketRef.current.on('telemetry', (payload: any) => {
      if (payload.totalMemory) setTotalMem(payload.totalMemory);
      setData((prevData) => {
        const newData = [...prevData, payload];
        return newData.slice(-timeRange);
      });
    });

    socketRef.current.on('security_event', (payload: any) => {
      setLogs(prev => [payload, ...prev]); // Newest first
    });

    socketRef.current.on('active_sandboxes', (payload: any[]) => {
      setActiveSandboxes(payload);
    });

    socketRef.current.on('execution_started', (payload: any) => {
      const { execId } = payload;
      setExecutionResults(prev => [{
        execId,
        status: 'running',
        startTime: new Date().toLocaleTimeString(),
        output: '',
        language,
        profile
      }, ...prev]);
    });

    socketRef.current.on('execution_result', (payload: any) => {
      const { execId, output, code, success } = payload;
      setIsExecuting(false);
      setExecutionResults(prev => prev.map(res => 
        res.execId === execId ? { ...res, status: 'completed', output, code, success } : res
      ));
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [timeRange, language, profile]);

  useEffect(() => {
    // logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const currentCpu = data[data.length - 1]?.cpu || 0;
  const currentMem = data[data.length - 1]?.memory || 0;

  const getCpuColor = (val: number) => val > 65 ? 'text-rose-400' : val > 45 ? 'text-amber-400' : 'text-emerald-400';
  const getMemColor = (val: number) => val > (totalMem * 0.8) ? 'text-rose-400' : val > (totalMem * 0.6) ? 'text-amber-400' : 'text-emerald-400';

  const copyToClipboard = (log: typeof logs[0]) => {
    const textToCopy = `[${log.time}] [${log.signal}] Syscall: ${log.syscall} ${log.path ? `(${log.path})` : ''} - ${log.message}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinelbox-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const killSandbox = (pid: number, id: number) => {
    if (confirm(`Are you sure you want to kill sandbox (PID: ${pid})?`)) {
      socketRef.current.emit('kill_sandbox', { pid, id });
      setActiveSandboxes(prev => prev.filter(sb => sb.id !== id));
    }
  };

  const runCode = () => {
    if (!code.trim()) return;
    setIsExecuting(true);
    socketRef.current.emit('execute_code', { code, profile, language });
  };

  const copyResult = (res: any) => {
    if (res.output) {
      navigator.clipboard.writeText(res.output).then(() => {
        setCopiedResultId(res.execId);
        setTimeout(() => setCopiedResultId(null), 2000);
      });
    }
  };

  const clearResults = () => {
    if (confirm("Clear all execution results?")) {
      setExecutionResults([]);
    }
  };

  const removeResult = (execId: string) => {
    setExecutionResults(prev => prev.filter(r => r.execId !== execId));
  };

  // Editor Interaction
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const handleEditorScroll = (e: any) => {
    if (editorContainerRef.current) {
      editorContainerRef.current.scrollTop = e.target.scrollTop;
    }
  };

  const updateCursorLine = (textarea: HTMLTextAreaElement) => {
    const pos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, pos);
    const lines = textBefore.split('\n');
    setCursorLine(lines.length);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    updateCursorLine(textarea);
    
    const selection = window.getSelection()?.toString();
    if (selection && selection.length > 0) {
      navigator.clipboard.writeText(selection).then(() => {
        setShowCopyToast(true);
        setTimeout(() => setShowCopyToast(false), 1500);
      });
    }
  };

  const formatUptime = (startTs: number) => {
    const diff = Date.now() - startTs;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const colorizeConsole = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      let className = "text-neutral-300";
      if (line.match(/\[ERR \]|Compilation Error|failed|fail|SIGKILL|killed|denied|EPERM|ENOENT|EACCES|error:/i)) {
        className = "text-rose-400 font-bold";
      } else if (line.match(/\[WARN\]|warning:|Notice/i)) {
        className = "text-amber-400";
      } else if (line.match(/SUCCESS|finished|succeeded|completed|OK|hello from sandbox/i)) {
        className = "text-emerald-400 font-medium";
      } else if (line.match(/\[EXEC\]|\[KILL\]|\[monitor\]|\[sentinelbox\]/)) {
        className = "text-emerald-500 font-bold";
      } else if (line.startsWith('[SEMANTIC]')) {
        className = "text-indigo-300 italic";
      }

      return <div key={i} className={`${className} min-h-[1.2em]`}>{line}</div>;
    });
  };

  const highlightedCode = Prism.highlight(
    code,
    language === 'c' ? Prism.languages.c : Prism.languages.bash,
    language
  );

  const lineCount = code.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

  // 統一字體與行高 CSS 以確保對齊
  const editorStyle: React.CSSProperties = {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    lineHeight: isFullscreen ? '24px' : '18px',
    fontSize: isFullscreen ? '14px' : '11px',
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-6 font-sans select-none flex flex-col">
      <div className="max-w-[1800px] mx-auto w-full flex-1 flex flex-col space-y-4">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between pb-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-inner">
              <ShieldAlert className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white cursor-default">SentinelBox <span className="text-emerald-500 font-bold">Security</span> Center</h1>
              <p className="text-xs text-neutral-500 cursor-default font-medium">Core Security Analytics Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 md:mt-0">
             <div className="flex items-center gap-2 bg-neutral-900 border border-white/5 rounded-lg px-2 py-1">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-tighter">Range</span>
                <select 
                  value={timeRange} 
                  onChange={(e) => setTimeRange(Number(e.target.value))}
                  className="bg-transparent text-xs text-neutral-300 focus:outline-none cursor-pointer"
                >
                  <option value={20}>20s</option>
                  <option value={60}>1m</option>
                  <option value={300}>5m</option>
                </select>
             </div>
             <button 
              onClick={exportLogs}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 transition-all border border-white/5 active:scale-95 text-xs font-medium"
            >
              Export JSON
            </button>
             <button 
              onClick={() => setIsPaused(!isPaused)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 transition-all border border-white/5 active:scale-95 text-xs font-medium"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <div className="flex items-center gap-3 px-3 py-1.5 bg-neutral-900 rounded-full border border-emerald-500/20 shadow-sm shadow-emerald-900/5">
              <span className="relative flex h-2 w-2">
                {!isPaused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              </span>
              <span className="text-[11px] font-bold text-neutral-400">System Protected</span>
            </div>
          </div>
        </header>

        {/* Main Grid: Left Column Scrollable, Right Column Sticky */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Stats & Charts (Scrollable) */}
          <div className="lg:col-span-9 flex flex-col space-y-6">
            
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">CPU Usage</h3>
                  <Cpu className="text-emerald-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getCpuColor(currentCpu)}`}>
                  {currentCpu.toFixed(3)}%
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentCpu > 65 ? 'bg-rose-500' : currentCpu > 45 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${currentCpu}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Memory Load</h3>
                  <MemoryStick className="text-emerald-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getMemColor(currentMem)}`}>
                  {currentMem.toFixed(1)} MB
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentMem > (totalMem * 0.8) ? 'bg-rose-500' : currentMem > (totalMem * 0.6) ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min((currentMem/totalMem)*100, 100)}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Active Instances</h3>
                  <LayoutDashboard className="text-emerald-400/80 w-4 h-4" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-white">{activeSandboxes.length}</div>
                <div className="mt-2 space-y-2 max-h-[100px] overflow-y-auto custom-scrollbar">
                  {activeSandboxes.length === 0 ? (
                    <div className="mt-2 flex gap-1.5">
                      <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium bg-emerald-500/5 text-emerald-400 border border-emerald-500/10">IDLE</span>
                    </div>
                  ) : (
                    activeSandboxes.map(sb => (
                      <div key={sb.id} className="flex items-center justify-between group/sb bg-emerald-500/5 p-1.5 rounded-md border border-emerald-500/10">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-emerald-400">PID {sb.pid}</span>
                            <span className="px-1 py-0.5 rounded-[3px] text-[8px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">{sb.profile}</span>
                            <span className="text-[9px] text-neutral-500">{formatUptime(sb.startTs)}</span>
                          </div>
                          <span className="text-[9px] text-neutral-400 truncate w-full italic font-mono" title={sb.command}>{sb.command || 'unknown'}</span>
                        </div>
                        <button 
                          onClick={() => killSandbox(sb.pid, sb.id)}
                          className="p-1 rounded bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-all ml-2"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Code Execution Panel */}
            <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-md flex flex-col space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Play className="w-4 h-4" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-widest">Interactive Execution</h3>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 bg-neutral-950 border border-white/10 rounded px-2 py-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-bold">Lang</span>
                    <select 
                      value={language} 
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      className="bg-transparent text-[10px] text-neutral-300 focus:outline-none cursor-pointer"
                    >
                      {languages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </div>

                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 transition-all border border-white/5 active:scale-95 text-[10px] font-bold"
                  >
                    <FileUp className="w-3.5 h-3.5 text-emerald-400" />
                    Inport
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".c,.sh,.txt" />
                  
                  <div className="flex items-center gap-2 bg-neutral-950 border border-white/10 rounded px-2 py-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-bold">Profile</span>
                    <select 
                      value={profile} 
                      onChange={(e) => setProfile(e.target.value)}
                      className="bg-transparent text-[10px] text-neutral-300 focus:outline-none cursor-pointer"
                    >
                      {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>

                  <button 
                    onClick={runCode}
                    disabled={isExecuting}
                    className={`flex items-center gap-2 px-5 py-1.5 rounded-lg transition-all text-[11px] font-bold shadow-lg shadow-emerald-900/10 active:scale-95 ${isExecuting ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                  >
                    {isExecuting ? 'RUNNING...' : 'RUN SANDBOX'}
                  </button>
                </div>
              </div>

              <div className="px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/10 rounded-md flex items-center justify-between">
                <p className="text-[10px] text-emerald-400/80 italic">
                  <strong>{profiles.find(p => p.id === profile)?.label}:</strong> {profiles.find(p => p.id === profile)?.description}
                </p>
                <button 
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-1 rounded hover:bg-emerald-500/10 text-emerald-500/60 transition-colors"
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-4 h-[440px]">
                <div className={`flex-1 min-w-0 relative group/editor ${isFullscreen ? 'fixed inset-0 z-[100] bg-neutral-950 p-4 md:p-8 flex flex-col h-screen' : 'relative flex flex-col'}`}>
                  {isFullscreen && (
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                          <Terminal className="w-5 h-5 text-emerald-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white uppercase tracking-tighter">Advanced Sandbox Center</h2>
                      </div>
                      <button onClick={() => setIsFullscreen(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors">
                        <X className="w-8 h-8 text-neutral-500" />
                      </button>
                    </div>
                  )}

                  <div className={`flex-1 flex overflow-hidden border border-white/10 rounded-lg bg-neutral-900/20 shadow-inner relative ${isFullscreen ? 'text-base' : 'text-xs'}`}>
                    <div style={editorStyle} className="select-none bg-neutral-900/50 border-r border-white/5 text-right font-mono text-neutral-600 p-3 pr-2 whitespace-pre min-w-[3.5em]">
                      {lineNumbers}
                    </div>
                    <div className="flex-1 relative overflow-hidden" ref={editorContainerRef}>
                      <div className="absolute left-0 right-0 bg-emerald-500/5 border-y border-emerald-500/5 pointer-events-none transition-all duration-100 z-0"
                           style={{ top: `${(cursorLine - 1) * (isFullscreen ? 24 : 18) + 12}px`, height: `${isFullscreen ? 24 : 18}px` }} />
                      <div style={editorStyle} className="absolute inset-0 p-3 font-mono pointer-events-none overflow-hidden whitespace-pre-wrap break-all relative z-[5]"
                           dangerouslySetInnerHTML={{ __html: Prism.highlight(code, language === 'c' ? Prism.languages.c : Prism.languages.bash, language) + '\n' }} />
                      <textarea ref={editorRef} style={editorStyle} value={code} onChange={(e) => { setCode(e.target.value); updateCursorLine(e.target); }}
                                onScroll={handleEditorScroll} onKeyUp={(e) => updateCursorLine(e.currentTarget)} onClick={(e) => updateCursorLine(e.currentTarget)} onMouseUp={handleMouseUp}
                                spellCheck={false} className="absolute inset-0 w-full h-full bg-transparent p-3 font-mono text-transparent caret-emerald-400 focus:outline-none custom-scrollbar resize-none z-10 whitespace-pre-wrap break-all" />
                    </div>
                  </div>
                  {isFullscreen && (
                    <div className="mt-8 flex justify-end gap-4">
                      <button onClick={() => setIsFullscreen(false)} className="px-6 py-2.5 rounded-xl bg-neutral-900 text-neutral-400 font-bold hover:bg-neutral-800 transition-all border border-white/5">CANCEL</button>
                      <button onClick={() => { runCode(); setIsFullscreen(false); }} className="px-10 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-900/20 active:scale-95 flex items-center gap-2">
                        <Play className="w-4 h-4 fill-current" /> DEPLOY & RUN
                      </button>
                    </div>
                  )}
                </div>
                
                {!isFullscreen && (
                  <div className="flex-1 min-w-0 bg-black/20 border border-white/5 rounded-lg overflow-hidden flex flex-col shadow-inner">
                    <div className="p-3 border-b border-white/5 flex items-center justify-between bg-neutral-900/40">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Execution Queue</span>
                      </div>
                      {executionResults.length > 0 && (
                        <button onClick={clearResults} className="text-[9px] font-bold text-neutral-600 hover:text-rose-400 transition-colors uppercase">Clear All</button>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                      {executionResults.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-neutral-700">
                          <Terminal className="w-8 h-8 mb-2 opacity-20" />
                          <p className="text-[10px] italic">No active executions</p>
                        </div>
                      ) : (
                        executionResults.map((res) => (
                          <div key={res.execId} className={`rounded-lg border transition-all ${res.status === 'running' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-neutral-900/60 border-white/5'}`}>
                            <div className="p-2 flex items-center justify-between border-b border-white/5">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${res.status === 'running' ? 'bg-emerald-400 animate-pulse' : res.success ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                                <span className="text-[10px] font-mono text-neutral-500">{res.startTime}</span>
                                <span className="text-[9px] font-bold px-1 rounded bg-emerald-500/10 text-emerald-500 uppercase">{res.language}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {res.status === 'completed' && (
                                  <>
                                    <button onClick={() => copyResult(res)} className="p-1 hover:bg-white/5 rounded transition-colors">
                                      {copiedResultId === res.execId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-neutral-600" />}
                                    </button>
                                    <button onClick={() => removeResult(res.execId)} className="p-1 hover:bg-rose-500/10 rounded transition-colors">
                                      <X className="w-3 h-3 text-neutral-600 hover:text-rose-400" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="p-2 font-mono text-[10px] max-h-[120px] overflow-y-auto custom-scrollbar leading-relaxed">
                              {res.status === 'running' ? (
                                <div className="text-emerald-400/60 animate-pulse">Initializing sandbox environment...</div>
                              ) : (
                                <div className="whitespace-pre-wrap break-all">
                                  {colorizeConsole(res.output || '(No output)')}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Split Charts: CPU and Memory separately */}
            <div className="flex flex-col space-y-6">
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[320px]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-widest">CPU Telemetry (eBPF Core)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">Unit: %</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#525252" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }} isAnimationActive={false} formatter={(value: any) => [typeof value === 'number' ? value.toFixed(3) : value, 'CPU (%)']} />
                      <Line type="monotone" dataKey="cpu" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#10b981', strokeWidth: 0 }} name="CPU" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[320px]">
                 <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></div>
                    <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-widest">Memory Telemetry (Cgroup v2)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">Unit: MB</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#525252" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} domain={[0, totalMem]} />
                      <Tooltip contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }} isAnimationActive={false} formatter={(value: any) => [typeof value === 'number' ? `${value.toFixed(1)} MB (${((value / totalMem) * 100).toFixed(1)}%)` : value, 'Memory']} />
                      <Line type="monotone" dataKey="memory" stroke="#059669" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#059669', strokeWidth: 0 }} name="Memory" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Security Logs (FIXED SIDEBAR) */}
          <div className="lg:col-span-3 lg:sticky lg:top-6 flex flex-col h-[calc(100vh-48px)] bg-neutral-900/40 rounded-xl border border-emerald-500/10 shadow-lg overflow-hidden">
            <div className="p-4 border-b border-emerald-500/10 flex flex-col gap-3 flex-shrink-0 bg-neutral-900/60 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-xs font-bold text-white tracking-tighter">Security Events</h3>
                </div>
                <button 
                  onClick={() => setLogs([])}
                  className="p-1.5 rounded-md text-neutral-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                  title="Clear Records"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Filter syscall or signal..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 rounded-md px-3 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-neutral-600"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0 bg-black/10">
              <AnimatePresence initial={false}>
                {logs.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center text-xs text-neutral-600 font-medium italic space-y-2">
                    <ShieldAlert className="w-8 h-8 opacity-10" />
                    <span>Clear - No Violations</span>
                  </motion.div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {logs.filter(log => 
                      searchTerm === '' || 
                      log.syscall?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      log.signal?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      log.message?.toLowerCase().includes(searchTerm.toLowerCase())
                    ).map(log => (
                      <motion.div key={log.id} layout initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
                        className="p-3 rounded-lg bg-neutral-950/80 border border-white/5 hover:border-emerald-500/30 transition-colors cursor-pointer group relative overflow-hidden"
                        onClick={() => copyToClipboard(log)}
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/40"></div>
                        <div className={`absolute top-3 right-3 transition-opacity duration-200 ${copiedId === log.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                          {copiedId === log.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                        </div>
                        <div className="flex justify-between items-start mb-2 pr-6">
                          <span className="text-[10px] font-mono text-neutral-500 group-hover:text-neutral-400 transition-colors">{log.time}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase tracking-tighter">
                            {log.signal}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-300 font-medium mb-1 flex items-center gap-1.5">
                          <span className="text-neutral-500">Syscall:</span> 
                          <code className="font-mono text-emerald-400/90 text-[11px] bg-emerald-500/5 px-1.5 py-0.5 rounded">{log.syscall}</code>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-relaxed border-l border-neutral-800 pl-2 mt-2 group-hover:text-neutral-300 transition-colors italic">
                          {log.message}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </div>

            <div className="p-2 bg-neutral-950/50 border-t border-emerald-500/10 flex items-center justify-center gap-2 flex-shrink-0">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Active Protection</span>
            </div>
          </div>

        </div>
      </div>

      <AnimatePresence>
        {showCopyToast && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.5 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-emerald-500 text-white px-6 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-3"
          >
            <Sparkles className="w-4 h-4" />
            SELECTION COPIED TO CLIPBOARD
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
