import React, { useMemo, useState, useEffect } from 'react';
import {
  Activity, Globe, Settings2, LayoutDashboard,
  LogOut, Calendar, Search, ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useNetworkData } from './hooks/useNetworkData';
import { useAuthContext } from './providers/AuthProvider';
import { useSimulationContext } from './providers/SimulationProvider';

import { getStorageStatus } from './lib/simulation-utils';
import { cn } from './lib/utils';
import { Auth } from './components/Auth';

import { DashboardView }           from './views/DashboardView';
import { MonitoringView }          from './views/MonitoringView';
import { SimulationDashboardView } from './views/SimulationDashboardView';
import { TrackingView }            from './views/TrackingView';

type View = 'dashboard' | 'monitoring' | 'simulation' | 'tracking';

// ── Formateadores de fecha ──────────────────────────────────────────────────
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function formatDate(d: Date) {
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}
function formatTime(d: Date) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── App ─────────────────────────────────────────────────────────────────────
function AppContent() {
  const { hubs, flights, shipments } = useNetworkData();
  const { user, logout, isAuthenticated, login } = useAuthContext();
  const { session } = useSimulationContext();

  const [activeView, setActiveView] = useState<View>('dashboard');
  const [hoveredRoute, setHoveredRoute] = useState<any>(null);
  const [hoveredHub,   setHoveredHub]   = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Reloj — fecha real (Dashboard = siempre operación diaria) ─────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const displayDate = useMemo(() => {
    const base = new Date(now);
    const elapsed = session?.currentTimeAt || 0;
    return new Date(base.getTime() + elapsed * 3_600_000);
  }, [now, session?.currentTimeAt]);

  // ── Rutas activas ────────────────────────────────────────────────────────
  const activeRoutes = useMemo(() => {
    const active = new Set<string>();
    const arr = Array.isArray(shipments) ? shipments : [];
    arr.forEach(s => {
      if (s.status === 'in-transit' && Array.isArray(s.path)) {
        const nextHubId = s.path[s.currentPathIndex];
        const prevHubId = s.path[s.currentPathIndex - 1] || s.originId;
        const flight = flights.find(f => f.originId === prevHubId && f.destinationId === nextHubId);
        if (flight) active.add(flight.id);
      }
    });
    return active;
  }, [shipments, flights]);

  const time = session?.currentTimeAt || 0;
  const day  = Math.floor(time / 24) + 1;
  const hour = time % 24;

  const isFullScreen = activeView === 'dashboard' || activeView === 'simulation';

  if (!isAuthenticated) return <Auth onLogin={login} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex overflow-hidden">

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0 z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <Globe className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Tasf.B2B</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Enterprise Operational</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          <NavItem active={activeView==='dashboard'}  icon={<LayoutDashboard />} label="Dashboard"  onClick={() => setActiveView('dashboard')} />
          <NavItem active={activeView==='monitoring'} icon={<Activity />}        label="Monitoreo"  onClick={() => setActiveView('monitoring')} />
          <NavItem active={activeView==='simulation'} icon={<Settings2 />}       label="Simulación" onClick={() => setActiveView('simulation')} />
          <NavItem active={activeView==='tracking'}   icon={<Search />}          label="Tracking"   onClick={() => setActiveView('tracking')} />
        </nav>

        <div className="p-4 mt-auto border-t border-slate-200">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 mb-4">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">
              {user?.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{user?.name}</p>
              <p className="text-[10px] text-slate-500 truncate capitalize">{user?.role}</p>
            </div>
            <button onClick={logout} className="text-slate-400 hover:text-red-500 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2">
            <span>v2.2.0</span>
            <span className="text-emerald-600 flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          </div>
        </div>
      </aside>

      {/* ── CONTENT ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* HEADER — solo fecha, sin selector de escenario */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
            <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="flex flex-col leading-none">
              <span className="tabular-nums font-black text-slate-900 text-sm tracking-wide">
                {formatDate(displayDate)}
              </span>
              <span className="tabular-nums font-mono text-slate-500 text-xs mt-0.5">
                {formatTime(displayDate)}
              </span>
            </div>
          </div>

          {/* Etiqueta de vista actual */}
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {activeView === 'dashboard'  && 'Operación Diaria'}
            {activeView === 'simulation' && 'Simulación'}
            {activeView === 'monitoring' && 'Monitoreo'}
            {activeView === 'tracking'   && 'Tracking'}
          </div>
        </header>

        {/* MAIN */}
        <main className={cn(
          'flex-1 relative overflow-hidden',
          !isFullScreen && 'overflow-y-auto p-8 custom-scrollbar'
        )}>
          <AnimatePresence mode="wait">
            {activeView === 'dashboard' && (
              <DashboardView
                key="dashboard"
                hubs={hubs}
                flights={flights}
                shipments={shipments}
                activeRoutes={activeRoutes}
                day={day}
                hour={hour}
                getStorageStatus={getStorageStatus}
                setHoveredHub={setHoveredHub}
                setHoveredRoute={setHoveredRoute}
                setMousePos={setMousePos}
              />
            )}
            {activeView === 'simulation' && (
              <SimulationDashboardView key="simulation" />
            )}
            {activeView === 'monitoring' && <MonitoringView  key="monitoring" />}
            {activeView === 'tracking'   && <TrackingView    key="tracking"   />}
          </AnimatePresence>

          {/* Tooltip hover (solo en dashboard) */}
          <AnimatePresence>
            {(hoveredRoute || hoveredHub) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                style={{
                  position: 'fixed',
                  left: mousePos.x + 15,
                  top:  mousePos.y + 15,
                  zIndex: 1000,
                  pointerEvents: 'none',
                }}
                className="bg-slate-900 text-white p-3 rounded-xl shadow-2xl border border-slate-700 min-w-[180px]"
              >
                {hoveredRoute && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-700 pb-1">Route Info</p>
                    <div className="flex justify-between items-center gap-4">
                      <span className="text-xs font-bold">{hoveredRoute.originId}</span>
                      <ChevronRight size={12} className="text-slate-600" />
                      <span className="text-xs font-bold">{hoveredRoute.destinationId}</span>
                    </div>
                  </div>
                )}
                {hoveredHub && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-700 pb-1">Hub Status</p>
                    <p className="text-xs font-bold">{hoveredHub.city}</p>
                    <div className="flex justify-between text-[9px]">
                      <span className="text-slate-400">Load:</span>
                      <span className="font-mono text-emerald-400">
                        {Math.round((hoveredHub.currentStorage / (hoveredHub.storageCapacity || 1)) * 100)}%
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}

export default function App() {
  return <AppContent />;
}

function NavItem({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all group',
        active
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
      )}
    >
      <span className={cn('transition-colors', active ? 'text-white' : 'text-slate-400 group-hover:text-blue-600')}>
        {React.cloneElement(icon as React.ReactElement, { size: 18 })}
      </span>
      {label}
    </button>
  );
}
