import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Activity, Globe, Settings2, LayoutDashboard,
  LogOut, Calendar, Search, ChevronRight, ChevronDown, ChevronUp,
  Package, Plane, AlertTriangle, CheckCircle, TrendingUp, PackagePlus, Warehouse,
  Play, Pause, RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useNetworkData } from './hooks/useNetworkData';
import { useAuthContext } from './providers/AuthProvider';
import { useSimulationContext } from './providers/SimulationProvider';
import { useOperationsContext } from './providers/OperationsProvider';

import { getStorageStatus } from './lib/simulation-utils';
import { cn } from './lib/utils';
import { Auth } from './components/Auth';

import { AirportManagerView }      from './views/AirportManagerView';
import { DailyOperationsView }     from './views/DailyOperationsView';
import { MonitoringView }          from './views/MonitoringView';
import { OrderUploadView }         from './views/OrderUploadView';
import { SimulationDashboardView } from './views/SimulationDashboardView';
import { TrackingView }            from './views/TrackingView';

type View = 'dashboard' | 'orders' | 'airports' | 'monitoring' | 'simulation' | 'tracking';

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
  const { user, logout, isAuthenticated, login } = useAuthContext();
  const { hubs, flights, shipments } = useNetworkData(isAuthenticated);
  const {
    session, lastSimUpdate, completionReport, clearCompletionReport, dashboardMetrics,
    startSimulation, pauseSimulation, resetSimulation, isLoading, sessionStartedAt,
  } = useSimulationContext();
  const { metrics: opsMetrics, activeFlightCount, connected: opsConnected } = useOperationsContext();
  const SPEED_FACTOR = 80;

  const [activeView, setActiveView] = useState<View>('dashboard');
  const [hoveredRoute, setHoveredRoute] = useState<any>(null);
  const [hoveredHub,   setHoveredHub]   = useState<any>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [simDashOpen, setSimDashOpen] = useState(false);
  const [simConfigOpen, setSimConfigOpen] = useState(false);
  const simDashRef = useRef<HTMLDivElement>(null);

  const simRunning = session?.status === 'running';

  // Cronómetro de tiempo real de la sesión activa (solo en pestaña simulación)
  const [elapsedRealMs, setElapsedRealMs] = useState(0);
  useEffect(() => {
    if (!sessionStartedAt || !session?.id || activeView !== 'simulation') {
      setElapsedRealMs(0); return;
    }
    const startedAt = sessionStartedAt;
    const id = setInterval(() => setElapsedRealMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [sessionStartedAt, session?.id, activeView]);

  const formatSimElapsed = (totalHours: number) => {
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  };
  const formatRealElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}m ${sec.toString().padStart(2,'0')}s`;
    return `${m}m ${sec.toString().padStart(2,'0')}s`;
  };

  // Cierra el panel si se hace clic fuera
  useEffect(() => {
    if (!simDashOpen) return;
    const handler = (e: MouseEvent) => {
      if (simDashRef.current && !simDashRef.current.contains(e.target as Node)) {
        setSimDashOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [simDashOpen]);

  // Cierra el panel si la sesión termina
  useEffect(() => { if (!session) setSimDashOpen(false); }, [session]);

  // ── Reloj — muestra hora simulada cuando hay sesión, real si no ───────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // La fecha simulada solo aparece cuando el usuario está en la pestaña de Simulación.
  // En cualquier otra pestaña (incluida Operación Diaria) siempre muestra la hora real.
  const displayDate = useMemo(() => {
    if (activeView !== 'simulation' || !session?.startTimeAt) return now;
    if (lastSimUpdate && session.status === 'running') {
      return new Date(lastSimUpdate.simMs + (now.getTime() - lastSimUpdate.realMs) * SPEED_FACTOR);
    }
    return new Date(new Date(session.startTimeAt).getTime() + (session.currentTimeAt || 0) * 3_600_000);
  }, [now, session, lastSimUpdate, SPEED_FACTOR, activeView]);

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
          <NavItem active={activeView==='orders'}     icon={<PackagePlus />}     label="Órdenes"    onClick={() => setActiveView('orders')} />
          <NavItem active={activeView==='airports'}   icon={<Warehouse />}       label="Aeropuertos" onClick={() => setActiveView('airports')} />
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

        {/* HEADER */}
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md shrink-0 z-40">
          <div className="h-16 flex items-center justify-between px-8">
            {/* Reloj simulado / real */}
            <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
              <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="flex flex-col leading-none">
                <span className="tabular-nums font-black text-slate-900 text-sm tracking-wide">
                  {formatDate(displayDate)}
                </span>
                <span className="tabular-nums font-mono text-slate-500 text-xs mt-0.5">
                  {formatTime(displayDate)}
                  {session && activeView === 'simulation' && <span className="ml-1.5 text-indigo-400 font-bold">(simulado)</span>}
                </span>
              </div>
            </div>

            {/* ── Métricas de operación diaria en el header (solo vista Dashboard) ── */}
            {activeView === 'dashboard' && (
              <div className="flex items-center gap-2 flex-1 justify-center mx-4 min-w-0">
                <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                  <div className={cn('w-2 h-2 rounded-full shrink-0', opsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} />
                  <span className="text-[9px] font-mono text-slate-400 hidden sm:block">
                    {opsConnected ? 'Conectado' : 'Reconectando…'}
                  </span>
                </div>
                {opsMetrics && (
                  <>
                    <div className="h-7 w-px bg-slate-200 shrink-0" />
                    <SimStat label="Entregadas"  value={opsMetrics.delivered}                    className="text-emerald-700" />
                    <SimStat label="Pendientes"  value={opsMetrics.pending}                      className="text-amber-700" />
                    <SimStat label="En vuelo"    value={activeFlightCount}                       className="text-blue-700" />
                    <SimStat label="Asignadas"   value={opsMetrics.assigned}                     className="text-indigo-700" />
                    <SimStat label="SLA venc."   value={opsMetrics.slaBreaches}                  className="text-red-600" />
                    <SimStat label="Rend./h"     value={opsMetrics.throughputPerHour.toFixed(1)} className="text-violet-700" />
                  </>
                )}
              </div>
            )}

            {/* ── Controles de simulación en el header (solo vista Simulación) ── */}
            {activeView === 'simulation' && (
              <div className="flex items-center gap-2 flex-1 justify-center mx-4 min-w-0">
                {session ? (
                  <>
                    <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', simRunning ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} />
                      <span className="text-[9px] font-mono text-slate-400 hidden sm:block">{session.id.substring(0, 10)}…</span>
                    </div>
                    <div className="h-7 w-px bg-slate-200 shrink-0" />
                    <SimStat label="T. Simulado" value={formatSimElapsed(session.currentTimeAt || 0)} className="text-indigo-700" />
                    <SimStat label="T. Real"     value={formatRealElapsed(elapsedRealMs)}             className="text-emerald-700" />
                    <div className="h-7 w-px bg-slate-200 shrink-0" />
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={simRunning ? pauseSimulation : startSimulation}
                        disabled={session.status === 'starting' || isLoading}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1 transition-all',
                          session.status === 'starting'
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : simRunning
                              ? 'bg-amber-500 hover:bg-amber-400 text-white'
                              : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                        )}
                      >
                        {session.status === 'starting'
                          ? <span className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                          : simRunning
                            ? <><Pause className="w-3.5 h-3.5" />Pausar</>
                            : <><Play  className="w-3.5 h-3.5" />Reanudar</>
                        }
                      </button>
                      <button
                        onClick={resetSimulation}
                        className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 transition-all"
                        title="Detener simulación"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {dashboardMetrics && (
                      <>
                        <div className="h-7 w-px bg-slate-200 shrink-0" />
                        <SimStat label="Entregadas" value={dashboardMetrics.delivered}                    className="text-emerald-700" />
                        <SimStat label="Pendientes" value={dashboardMetrics.pending}                      className="text-amber-700" />
                        <SimStat label="En vuelo"   value={dashboardMetrics.inFlight}                     className="text-blue-700" />
                        <SimStat label="Asignadas"  value={dashboardMetrics.assigned}                     className="text-indigo-700" />
                        <SimStat label="SLA venc."  value={dashboardMetrics.slaBreaches}                  className="text-red-600" />
                        <SimStat label="Rend./h"    value={dashboardMetrics.throughputPerHour.toFixed(1)} className="text-violet-700" />
                      </>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => setSimConfigOpen(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold text-xs transition-all',
                      simConfigOpen
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                    )}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Configurar simulación
                    {simConfigOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
              </div>
            )}

          {/* Dashboard de simulación — botón toggle (otras pestañas con sesión activa) */}
            {session && activeView !== 'simulation' && (
              <div className="relative" ref={simDashRef}>
                <button
                  onClick={() => setSimDashOpen(v => !v)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl border font-bold text-sm transition-all',
                    simDashOpen
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/20'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                  )}
                >
                  <Activity className="w-4 h-4" />
                  Dashboard Simulación
                  {session.status === 'running' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {simDashOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {/* Panel desplegable */}
                <AnimatePresence>
                  {simDashOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scaleY: 0.95 }}
                      animate={{ opacity: 1, y: 0, scaleY: 1 }}
                      exit={{ opacity: 0, y: -8, scaleY: 0.95 }}
                      transition={{ duration: 0.15 }}
                      style={{ transformOrigin: 'top center' }}
                      className="absolute top-full right-0 mt-2 w-[520px] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-50"
                    >
                      {/* Cabecera del panel */}
                      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            'w-2 h-2 rounded-full',
                            session.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                          )} />
                          <span className="text-xs font-black text-slate-700 uppercase tracking-widest">
                            Simulación — {session.status.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">ID: {session.id.slice(0, 12)}…</span>
                      </div>

                      {/* Métricas */}
                      {dashboardMetrics ? (
                        <div className="p-5 grid grid-cols-3 gap-3">
                          <MetricCard icon={<Package className="w-4 h-4" />} label="Entregadas" value={dashboardMetrics.delivered} color="emerald" />
                          <MetricCard icon={<Activity className="w-4 h-4" />} label="Pendientes" value={dashboardMetrics.pending} color="amber" />
                          <MetricCard icon={<Plane className="w-4 h-4" />} label="En vuelo" value={dashboardMetrics.inFlight} color="blue" />
                          <MetricCard icon={<CheckCircle className="w-4 h-4" />} label="Asignadas" value={dashboardMetrics.assigned} color="indigo" />
                          <MetricCard icon={<AlertTriangle className="w-4 h-4" />} label="SLA vencidas" value={dashboardMetrics.slaBreaches} color="red" />
                          <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Rendim./h" value={dashboardMetrics.throughputPerHour.toFixed(1)} color="violet" />
                        </div>
                      ) : (
                        <div className="p-6 text-center text-sm text-slate-400">
                          {session.status === 'starting' ? 'Iniciando simulación…' : 'Cargando métricas…'}
                        </div>
                      )}

                      {/* Tiempo simulado */}
                      <div className="px-5 pb-4 pt-1 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Tiempo simulado</span>
                        <span className="text-xs font-black font-mono text-indigo-700">
                          {session.currentTimeAt
                            ? `${Math.floor(session.currentTimeAt / 24)}d ${session.currentTimeAt % 24}h`
                            : '0h'}
                          {' · '}
                          {displayDate.toISOString().slice(0, 16).replace('T', ' ')} UTC
                        </span>
                      </div>

                      {/* Botón para ir a la simulación */}
                      {activeView !== 'simulation' && (
                        <div className="px-5 pb-4">
                          <button
                            onClick={() => { setActiveView('simulation'); setSimDashOpen(false); }}
                            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
                          >
                            Ver mapa de simulación →
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Etiqueta de vista */}
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {activeView === 'dashboard'  && 'Operación Diaria'}
              {activeView === 'orders'     && 'Carga de Órdenes'}
              {activeView === 'airports'   && 'Gestor de Aeropuertos'}
              {activeView === 'simulation' && 'Simulación'}
              {activeView === 'monitoring' && 'Monitoreo'}
              {activeView === 'tracking'   && 'Tracking'}
            </div>
          </div>
        </header>

        {/* MAIN */}
        <main className={cn(
          'flex-1 relative overflow-hidden',
          !isFullScreen && 'overflow-y-auto p-8 custom-scrollbar'
        )}>
          {/*
            SimulationDashboardView se mantiene SIEMPRE montado para que el estado
            (aviones animados, viewTransform, seenFlights) persista entre pestañas.
            Solo se oculta/muestra con CSS.
          */}
          <div
            className={cn('absolute inset-0', activeView === 'simulation' ? 'block' : 'hidden')}
            style={{ zIndex: activeView === 'simulation' ? 1 : 0 }}
          >
            <SimulationDashboardView
              showConfig={simConfigOpen}
              onConfigClose={() => setSimConfigOpen(false)}
            />
          </div>

          {/*
            DailyOperationsView (Operación Día a Día) también se mantiene SIEMPRE
            montado: su estado vive en OperationsProvider, pero mantenerlo montado
            preserva además el zoom/pan del mapa. Así, al volver al dashboard, ni el
            mapa, ni los aeropuertos, ni los vuelos se reinician.
          */}
          <div
            className={cn('absolute inset-0', activeView === 'dashboard' ? 'block' : 'hidden')}
            style={{ zIndex: activeView === 'dashboard' ? 1 : 0 }}
          >
            <DailyOperationsView />
          </div>

          <AnimatePresence mode="wait">
            {activeView === 'orders'     && <OrderUploadView   key="orders"     />}
            {activeView === 'airports'   && <AirportManagerView key="airports"  />}
            {activeView === 'monitoring' && <MonitoringView    key="monitoring" />}
            {activeView === 'tracking'   && <TrackingView      key="tracking"   />}
          </AnimatePresence>

          {/* Tooltip hover (solo en dashboard) */}
          <AnimatePresence>
            {(hoveredRoute || hoveredHub) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                style={{ position: 'fixed', left: mousePos.x + 15, top: mousePos.y + 15, zIndex: 1000, pointerEvents: 'none' }}
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

      {/* ── NOTIFICACIÓN GLOBAL: Simulación completada ───────────────────────── */}
      <AnimatePresence>
        {completionReport && (
          <motion.div
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-6 right-6 z-[300] w-80 bg-white rounded-2xl border border-emerald-200 shadow-2xl overflow-hidden"
          >
            <div className="bg-emerald-600 px-4 py-3 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-white shrink-0" />
              <div className="flex-1">
                <p className="text-white font-black text-sm">Simulación completada</p>
                <p className="text-emerald-200 text-[10px]">Los resultados están disponibles</p>
              </div>
              <button
                onClick={clearCompletionReport}
                className="text-emerald-200 hover:text-white text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>
            {!completionReport.error && (
              <div className="px-4 py-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400 font-semibold">Entregadas</p>
                  <p className="font-black text-slate-900">{completionReport.delivered ?? '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <p className="text-slate-400 font-semibold">SLA vencidas</p>
                  <p className="font-black text-red-600">{completionReport.slaBreaches ?? '—'}</p>
                </div>
              </div>
            )}
            <div className="px-4 pb-4 flex gap-2">
              <button
                onClick={() => { setActiveView('simulation'); clearCompletionReport(); }}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
              >
                Ver simulación →
              </button>
              <button
                onClick={clearCompletionReport}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

type MetricColor = 'emerald' | 'amber' | 'blue' | 'indigo' | 'red' | 'violet';
const COLOR_MAP: Record<MetricColor, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber:   'bg-amber-50   text-amber-700   border-amber-100',
  blue:    'bg-blue-50    text-blue-700    border-blue-100',
  indigo:  'bg-indigo-50  text-indigo-700  border-indigo-100',
  red:     'bg-red-50     text-red-700     border-red-100',
  violet:  'bg-violet-50  text-violet-700  border-violet-100',
};

function SimStat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col leading-tight px-1 shrink-0">
      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">{label}</span>
      <span className={cn('text-sm font-black font-mono leading-tight', className)}>{value}</span>
    </div>
  );
}

function MetricCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number | string; color: MetricColor;
}) {
  return (
    <div className={cn('rounded-xl border px-3 py-2.5 flex items-center gap-2.5', COLOR_MAP[color])}>
      <span className="shrink-0 opacity-70">{icon}</span>
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest opacity-60">{label}</p>
        <p className="text-base font-black font-mono leading-tight">{value}</p>
      </div>
    </div>
  );
}
