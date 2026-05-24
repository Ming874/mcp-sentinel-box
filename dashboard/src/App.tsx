import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShieldAlert, Cpu, MemoryStick, Play, Pause, Trash2, LayoutDashboard, Copy, Check } from 'lucide-react';
import { io } from 'socket.io-client';

const INITIAL_DATA_LENGTH = 20;

const generateInitialData = () => {
  return Array.from({ length: INITIAL_DATA_LENGTH }, (_, i) => {
    return {
      time: new Date(Date.now() - (INITIAL_DATA_LENGTH - i) * 1000).toLocaleTimeString(),
      cpu: 0,
      memory: 0,
    };
  });
};

function App() {
  const [data, setData] = useState(generateInitialData());
  const [logs, setLogs] = useState<any[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    // 建立 Socket 連線
    socketRef.current = io('http://localhost:3001');

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to real-time bridge');
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    socketRef.current.on('telemetry', (payload: any) => {
      setData((prevData) => {
        const newData = [...prevData.slice(1)];
        newData.push(payload);
        return newData;
      });
    });

    socketRef.current.on('security_event', (payload: any) => {
      setLogs(prev => [...prev, payload]);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const currentCpu = data[data.length - 1]?.cpu || 0;
  const currentMem = data[data.length - 1]?.memory || 0;

  // 統一色調：CPU 藍色系 (Blue)，Memory 靛青色系 (Indigo)
  const getCpuColor = (val: number) => val > 65 ? 'text-rose-400' : val > 45 ? 'text-amber-400' : 'text-blue-400';
  const getMemColor = (val: number) => val > 6000 ? 'text-rose-400' : val > 4000 ? 'text-amber-400' : 'text-indigo-400';

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
              <p className="text-xs text-neutral-500 cursor-default font-medium">Security Analytics Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 md:mt-0">
             <button 
              onClick={() => setIsPaused(!isPaused)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 transition-all border border-white/5 active:scale-95 text-xs font-medium"
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <div className="flex items-center gap-3 px-3 py-1.5 bg-neutral-900 rounded-full border border-white/5 shadow-sm">
              <span className="relative flex h-2 w-2">
                {!isPaused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
              </span>
              <span className="text-[11px] font-bold text-neutral-400">System Active</span>
            </div>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          
          {/* Left Column: Stats & Charts */}
          <div className="lg:col-span-3 flex flex-col space-y-4">
            
            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500">CPU Usage</h3>
                  <Cpu className="text-blue-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getCpuColor(currentCpu)}`}>
                  {currentCpu.toFixed(1)}%
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentCpu > 65 ? 'bg-rose-500' : currentCpu > 45 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${currentCpu}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500">Memory Load</h3>
                  <MemoryStick className="text-indigo-400/80 w-4 h-4" />
                </div>
                <div className={`text-2xl font-bold tracking-tight ${getMemColor(currentMem)}`}>
                  {currentMem.toFixed(1)} MB
                </div>
                <div className="mt-2 w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${currentMem > 6000 ? 'bg-rose-500' : currentMem > 4000 ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min((currentMem/8192)*100, 100)}%` }}></div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-500">Active Sandboxes</h3>
                  <LayoutDashboard className="text-blue-400/80 w-4 h-4" />
                </div>
                <div className="text-2xl font-bold tracking-tight text-white">1</div>
                <div className="mt-2 flex gap-1.5">
                  <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">Strict Profile</span>
                  <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium bg-white/5 text-neutral-400 border border-white/10">Rootless</span>
                </div>
              </div>
            </div>

            {/* Split Charts: CPU and Memory separately */}
            <div className="flex flex-col space-y-4">
              {/* CPU Chart */}
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[300px]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                    <h3 className="text-xs font-bold text-neutral-300">CPU Telemetry (eBPF Core)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">Unit: %</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#525252" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }}
                        isAnimationActive={false}
                      />
                      <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} name="CPU" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Memory Chart */}
              <div className="bg-neutral-900/40 p-4 rounded-xl border border-white/5 shadow-sm flex flex-col h-[300px]">
                 <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                    <h3 className="text-xs font-bold text-neutral-300">Memory Telemetry (Cgroup v2)</h3>
                  </div>
                  <span className="text-[10px] font-mono text-neutral-500">Unit: MB</span>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="time" stroke="#525252" fontSize={10} tickMargin={8} tickLine={false} axisLine={false} />
                      <YAxis stroke="#525252" fontSize={10} tickLine={false} axisLine={false} domain={[0, 'dataMax + 100']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', color: '#f5f5f5', borderRadius: '4px', fontSize: '11px', padding: '6px' }}
                        isAnimationActive={false}
                      />
                      <Line type="monotone" dataKey="memory" stroke="#6366f1" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} name="Memory" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Security Logs (Fixed height container allowing internal scrolling) */}
          <div className="lg:col-span-1 bg-neutral-900/40 rounded-xl border border-white/5 shadow-sm flex flex-col h-[500px] lg:h-[752px] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0 bg-neutral-900/20 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <h3 className="text-xs font-bold text-white">Security Events</h3>
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
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar min-h-0">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-neutral-600 font-medium italic">
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
                      <span className="text-[10px] font-mono text-neutral-500 group-hover:text-neutral-400 transition-colors">{log.time}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${log.type === 'Violation' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                        {log.signal}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-300 font-medium mb-1 flex items-center gap-1.5">
                      <span className="text-neutral-500">Syscall:</span> 
                      <code className="font-mono text-blue-400/90 text-[11px] bg-blue-500/5 px-1.5 py-0.5 rounded select-text">{log.syscall}</code>
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed border-l border-neutral-800 pl-2 mt-2 group-hover:text-neutral-300 transition-colors">
                      {log.message}
                    </p>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="p-2 bg-neutral-950/50 border-t border-white/5 flex items-center justify-center gap-2 flex-shrink-0">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-[10px] font-medium text-neutral-500">Real-time Stream Protected</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
