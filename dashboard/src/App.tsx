import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShieldAlert, Cpu, MemoryStick, Play, Pause, Trash2, LayoutDashboard, Copy, Check } from 'lucide-react';

const INITIAL_DATA_LENGTH = 20;

// 隨機漫步演算法：讓數值基於前一次的結果微調，達到平滑變動
const getNextValue = (current: number, min: number, max: number, maxDelta: number) => {
  const delta = (Math.random() - 0.5) * maxDelta;
  return Math.max(min, Math.min(max, current + delta));
};

const generateInitialData = () => {
  let lastCpu = 25;
  let lastMem = 45;
  return Array.from({ length: INITIAL_DATA_LENGTH }, (_, i) => {
    lastCpu = getNextValue(lastCpu, 5, 60, 5);
    lastMem = getNextValue(lastMem, 30, 90, 8);
    return {
      time: new Date(Date.now() - (INITIAL_DATA_LENGTH - i) * 1000).toLocaleTimeString(),
      cpu: lastCpu,
      memory: lastMem,
    };
  });
};

const initialLogs = [
  { id: 1, time: new Date(Date.now() - 15000).toLocaleTimeString(), type: 'Violation', signal: 'SIGSYS', syscall: 'socket', path: '', message: 'Action Denied: Attempted to perform a restricted network call.' },
  { id: 2, time: new Date(Date.now() - 5000).toLocaleTimeString(), type: 'Warning', signal: 'OOM_KILL', syscall: 'mmap', path: '', message: 'Resource Exhausted: The process exceeded memory limits.' }
];

const mockSyscalls = ['open', 'execve', 'ptrace', 'connect', 'kill', 'chmod'];
const mockSignals = ['EPERM', 'SIGSYS', 'SIGSEGV', 'EACCES'];

function App() {
  const [data, setData] = useState(generateInitialData());
  const [logs, setLogs] = useState(initialLogs);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setData((prevData) => {
        const last = prevData[prevData.length - 1];
        const newData = [...prevData.slice(1)];
        newData.push({
          time: new Date().toLocaleTimeString(),
          cpu: getNextValue(last.cpu, 2, 85, 6),
          memory: getNextValue(last.memory, 20, 125, 4),
        });
        return newData;
      });

      if (Math.random() < 0.15) {
        setLogs(prev => [...prev, {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          type: Math.random() > 0.6 ? 'Violation' : 'Warning',
          signal: mockSignals[Math.floor(Math.random() * mockSignals.length)],
          syscall: mockSyscalls[Math.floor(Math.random() * mockSyscalls.length)],
          path: Math.random() > 0.5 ? '/etc/shadow' : '',
          message: 'Intercepted by Seccomp-BPF filter. Mapping to semantic feedback...'
        }]);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const currentCpu = data[data.length - 1].cpu;
  const currentMem = data[data.length - 1].memory;

  const getCpuColor = (val: number) => val > 65 ? 'text-rose-400' : val > 45 ? 'text-amber-400' : 'text-sky-400';
  const getMemColor = (val: number) => val > 110 ? 'text-rose-400' : val > 90 ? 'text-amber-400' : 'text-fuchsia-400';

  const copyToClipboard = (log: typeof logs[0]) => {
    const textToCopy = `[${log.time}] [${log.signal}] Syscall: ${log.syscall} ${log.path ? `(${log.path})` : ''} - ${log.message}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-6 font-sans select-none flex flex-col">
      <div className="max-w-[1600px] mx-auto w-full flex-1 flex flex-col space-y-4">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between pb-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-inner">
              <ShieldAlert className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white cursor-default">SentinelBox Dashboard</h1>
              <p className="text-xs text-neutral-500 cursor-default uppercase tracking-widest font-medium">Security Analytics Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 md:mt-0">
             <button 
              onClick={() => setIsPaused(!isPaused)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 transition-all border border-white/5 active:scale-95 text-xs font-medium"
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {isPaused ? 'RESUME' : 'PAUSE'}
            </button>
            <div className="flex items-center gap-3 px-3 py-1.5 bg-neutral-900 rounded-full border border-white/5 shadow-sm">
              <span className="relative flex h-2 w-2">
                {!isPaused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              </span>
              <span className="text-[11px] font-bold text-neutral-400 tracking-wider uppercase">System Active</span>
            </div>
          </div>
        </header>

        {/* Main Grid: 左側自然展開，右側與左側等高並內部滾動 */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          
          {/* Left Column: Stats & Charts */}
          <div className="lg:col-span-3 flex flex-col space-y-4">
            
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">CPU Intensity</h3>
                  <Cpu className="text-sky-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getCpuColor(currentCpu)}`}>
                  {currentCpu.toFixed(1)}%
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentCpu > 65 ? 'bg-rose-500' : currentCpu > 45 ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${currentCpu}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Memory Load</h3>
                  <MemoryStick className="text-fuchsia-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getMemColor(currentMem)}`}>
                  {currentMem.toFixed(1)} MB
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentMem > 110 ? 'bg-rose-500' : currentMem > 90 ? 'bg-amber-500' : 'bg-fuchsia-500'}`} style={{ width: `${(currentMem/128)*100}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Isolation Instance</h3>
                  <LayoutDashboard className="text-emerald-400/80 w-4 h-4" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-white">01</div>
                <div className="mt-2 flex gap-1.5">
                  <span className="px-1.5 py-0.5 rounded-[4px] text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">Strict</span>
                  <span className="px-1.5 py-0.5 rounded-[4px] text-[9px] font-bold bg-white/5 text-neutral-400 border border-white/10 uppercase">Rootless</span>
                </div>
              </div>
            </div>

            {/* Split Charts: CPU and Memory separately */}
            <div className="flex flex-col space-y-4">
              {/* CPU Chart */}
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[300px]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></div>
                    <h3 className="text-[10px] font-bold text-neutral-300 uppercase tracking-widest">CPU Telemetry (eBPF Core)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">UNIT: %</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#404040" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#404040" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }}
                        isAnimationActive={false}
                      />
                      <Line type="monotone" dataKey="cpu" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Memory Chart */}
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[300px]">
                 <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 animate-pulse"></div>
                    <h3 className="text-[10px] font-bold text-neutral-300 uppercase tracking-widest">Memory Telemetry (Cgroup v2)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">UNIT: MB</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#404040" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#404040" fontSize={10} tickLine={false} axisLine={false} domain={[0, 150]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }}
                        isAnimationActive={false}
                      />
                      <Line type="monotone" dataKey="memory" stroke="#e879f9" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Security Logs (Sticky height matching left column) */}
          <div className="lg:col-span-1 bg-neutral-900/40 rounded-xl border border-white/5 shadow-sm flex flex-col h-[calc(100vh-120px)] lg:h-auto lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-48px)] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0 bg-neutral-900/20 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <h3 className="text-[11px] font-bold text-white uppercase tracking-wider">Security Events</h3>
              </div>
              <button 
                onClick={() => setLogs([])}
                className="p-1.5 rounded-md text-neutral-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                title="Clear Records"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {/* 這是關鍵滾動區域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-[300px]">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-neutral-600 font-bold uppercase tracking-widest italic min-h-[100px]">
                  Clear - No Violations
                </div>
              ) : (
                logs.map(log => (
                  <div 
                    key={log.id} 
                    onClick={() => copyToClipboard(log)}
                    className="p-3 rounded-lg bg-neutral-950/80 border border-white/5 hover:border-neutral-700 transition-colors cursor-pointer group relative"
                    title="Click to copy log details"
                  >
                    {/* Copy Feedback Indicator */}
                    <div className={`absolute top-3 right-3 transition-opacity duration-200 ${copiedId === log.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                      {copiedId === log.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-500" />}
                    </div>

                    <div className="flex justify-between items-start mb-2 pr-6">
                      <span className="text-[9px] font-mono text-neutral-600 group-hover:text-neutral-400 transition-colors">{log.time}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold tracking-tighter uppercase ${log.type === 'Violation' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                        {log.signal}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-300 font-medium mb-1 flex items-center gap-1.5">
                      <span className="text-neutral-600">SYSCALL:</span> 
                      <code className="font-mono text-blue-400/90 text-[10px] bg-blue-500/5 px-1.5 py-0.5 rounded select-text">{log.syscall}</code>
                    </div>
                    <p className="text-[10px] text-neutral-500 leading-normal border-l border-neutral-800 pl-2 mt-2 group-hover:text-neutral-400 transition-colors italic">
                      {log.message}
                    </p>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="p-2 bg-neutral-950/50 border-t border-white/5 flex items-center justify-center gap-2 flex-shrink-0">
               <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
               <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-tighter">Real-time Stream</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
