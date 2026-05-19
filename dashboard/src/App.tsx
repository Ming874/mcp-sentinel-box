import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, ShieldAlert, Cpu, MemoryStick } from 'lucide-react';

const generateMockData = () => {
  return Array.from({ length: 20 }, (_, i) => ({
    time: new Date(Date.now() - (20 - i) * 1000).toLocaleTimeString(),
    cpu: Math.random() * 40 + 10,
    memory: Math.random() * 20 + 30,
  }));
};

const mockAuditLogs = [
  { id: 1, time: '10:45:02', type: 'Violation', signal: 'SIGSYS', syscall: 'socket', message: 'Action Denied: Attempted to perform a restricted network call.' },
  { id: 2, time: '10:46:15', type: 'Warning', signal: 'OOM_KILL', syscall: 'mmap', message: 'Resource Exhausted: The process exceeded memory limits.' },
  { id: 3, time: '10:47:30', type: 'Violation', signal: 'EPERM', syscall: 'open', path: '/etc/shadow', message: 'Security Violation: Operation not permitted on restricted resource.' }
];

function App() {
  const [data, setData] = useState(generateMockData());

  useEffect(() => {
    const interval = setInterval(() => {
      setData((prevData) => {
        const newData = [...prevData.slice(1)];
        newData.push({
          time: new Date().toLocaleTimeString(),
          cpu: Math.random() * 40 + 10,
          memory: Math.random() * 20 + 30,
        });
        return newData;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <ShieldAlert className="w-7 h-7 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">SentinelBox</h1>
              <p className="text-sm text-neutral-400">AI Agent Security Sandbox</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4 md:mt-0 px-4 py-2 bg-white/5 rounded-full border border-white/5 shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-sm font-medium text-neutral-300">System Active</span>
          </div>
        </header>

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-neutral-900/50 backdrop-blur-sm p-5 rounded-2xl border border-white/5 shadow-sm hover:bg-neutral-900 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-neutral-400">CPU Usage</h3>
              <Cpu className="text-blue-400/80 w-5 h-5" />
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-semibold tracking-tight text-white">{data[data.length - 1].cpu.toFixed(1)}<span className="text-xl text-neutral-500 font-normal">%</span></div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="w-full bg-neutral-800 rounded-full h-1.5 mr-3">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${data[data.length - 1].cpu}%` }}></div>
              </div>
              <div className="text-xs text-neutral-500 font-mono whitespace-nowrap">Limit: 50%</div>
            </div>
          </div>
          
          <div className="bg-neutral-900/50 backdrop-blur-sm p-5 rounded-2xl border border-white/5 shadow-sm hover:bg-neutral-900 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-neutral-400">Memory Usage</h3>
              <MemoryStick className="text-indigo-400/80 w-5 h-5" />
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-semibold tracking-tight text-white">{data[data.length - 1].memory.toFixed(1)}<span className="text-xl text-neutral-500 font-normal"> MB</span></div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="w-full bg-neutral-800 rounded-full h-1.5 mr-3">
                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(data[data.length - 1].memory / 128) * 100}%` }}></div>
              </div>
              <div className="text-xs text-neutral-500 font-mono whitespace-nowrap">Limit: 128 MB</div>
            </div>
          </div>

          <div className="bg-neutral-900/50 backdrop-blur-sm p-5 rounded-2xl border border-white/5 shadow-sm hover:bg-neutral-900 transition-colors relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none"></div>
            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="text-sm font-medium text-neutral-400">Active Sandboxes</h3>
              <Activity className="text-emerald-400/80 w-5 h-5" />
            </div>
            <div className="flex items-baseline gap-2 relative z-10">
              <div className="text-3xl font-semibold tracking-tight text-white">1</div>
            </div>
            <div className="mt-3 flex items-center gap-2 relative z-10">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Strict Profile</span>
              <span className="text-xs text-neutral-500">Rootless NS</span>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section */}
          <div className="lg:col-span-2 bg-neutral-900/40 p-6 rounded-2xl border border-white/5 shadow-sm flex flex-col min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Real-time Telemetry (eBPF)
              </h3>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-xs text-neutral-400"><div className="w-2 h-2 rounded-full bg-blue-500"></div>CPU</div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-400"><div className="w-2 h-2 rounded-full bg-indigo-500"></div>Memory</div>
              </div>
            </div>
            <div className="flex-1 min-h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                  <XAxis dataKey="time" stroke="#525252" fontSize={11} tickMargin={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#525252" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#f5f5f5', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ color: '#e5e5e5', fontSize: '13px' }}
                    labelStyle={{ color: '#a3a3a3', marginBottom: '4px', fontSize: '12px' }}
                  />
                  <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} name="CPU (%)" isAnimationActive={false} />
                  <Line type="monotone" dataKey="memory" stroke="#6366f1" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} name="Memory (MB)" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Logs Section */}
          <div className="bg-neutral-900/40 p-6 rounded-2xl border border-white/5 shadow-sm flex flex-col min-h-[400px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Security Audit Logs
              </h3>
              <span className="text-xs bg-neutral-800 text-neutral-300 px-2 py-1 rounded-md border border-neutral-700">Live</span>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
              {mockAuditLogs.map(log => (
                <div key={log.id} className="p-4 rounded-xl bg-neutral-950/50 border border-neutral-800/80 hover:border-neutral-700 transition-colors group">
                  <div className="flex justify-between items-start mb-2.5">
                    <span className="text-[11px] font-mono text-neutral-500 mt-0.5">{log.time}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded text-white font-medium tracking-wide ${log.type === 'Violation' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' : 'bg-amber-500/20 text-amber-400 border border-amber-500/20'}`}>
                      {log.signal}
                    </span>
                  </div>
                  <div className="text-sm text-neutral-200 mb-1.5">
                    <span className="text-neutral-400 mr-1.5">Syscall:</span> 
                    <code className="font-mono text-blue-300/90 text-xs bg-blue-500/10 px-1.5 py-0.5 rounded">{log.syscall}</code>
                    {log.path && <span className="text-neutral-500 text-xs ml-2 font-mono">({log.path})</span>}
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed border-l-2 border-neutral-800 pl-2 mt-2">
                    {log.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
