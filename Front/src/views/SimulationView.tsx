import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Play, Pause, RotateCcw, Settings2, Database, Zap, Activity } from 'lucide-react';
import { SCENARIOS, SCENARIO_LABELS } from '../constants/domain';
import { useSimulationContext } from '../providers/SimulationProvider';
import { hubService } from '../services/hubService';
import { cn } from '../lib/utils';
import { HUBS } from '../models/infrastructure';

export const SimulationView: React.FC = () => {
  const { session, events, createSession, startSimulation, pauseSimulation, resetSimulation, injectFault, isLoading } = useSimulationContext();
  const [selectedScenario, setSelectedScenario] = useState<any>(SCENARIOS.DAILY);
  const [selectedHub, setSelectedHub] = useState(HUBS[0].id);
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [daysLoading, setDaysLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setDaysLoading(true);
    hubService.getAvailableDays(controller.signal)
      .then(days => {
        const sorted = [...days].sort();
        setAvailableDays(sorted);
        if (sorted.length > 0) setSelectedDate(sorted[0]);
      })
      .catch(() => {})
      .finally(() => setDaysLoading(false));
    return () => controller.abort();
  }, []);

  const handleCreate = async () => {
    if (!selectedDate) return;
    await createSession(selectedScenario, selectedDate);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">Control de Simulación Enterprise</h2>
          <p className="text-slate-500 text-sm mt-1">Gestión de sesiones, inyección de fallos y control de flujo operacional.</p>
        </div>
      </div>

      {!session ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-2xl mx-auto shadow-xl">
          <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Settings2 size={40} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Configurar Nueva Sesión</h3>
          <p className="text-slate-500 text-sm mb-8">Selecciona el escenario base para inicializar el motor de simulación en el servidor.</p>
          
          <div className="space-y-6 text-left">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Escenario Maestro</label>
              <select 
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 transition-colors"
                disabled={isLoading}
              >
                {Object.values(SCENARIOS).map(s => (
                  <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fecha de Inicio</label>
              {daysLoading ? (
                <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm text-slate-400">Cargando fechas disponibles…</div>
              ) : availableDays.length === 0 ? (
                <div className="w-full bg-rose-50 border border-rose-200 rounded-2xl px-6 py-4 text-sm text-rose-500 font-bold">Sin fechas disponibles en el servidor</div>
              ) : (
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 transition-colors"
                  disabled={isLoading}
                >
                  {availableDays.map(day => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              )}
            </div>

            <button
              onClick={handleCreate}
              disabled={isLoading || !selectedDate || availableDays.length === 0}
              className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-sm transition-all active:scale-[0.98] shadow-xl shadow-blue-600/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Database size={18} />
              {isLoading ? 'Inicializando...' : 'Inicializar Motor de Simulación'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8 space-y-8">
             <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg",
                      session.status === 'running' ? "bg-emerald-500 shadow-emerald-500/20" : "bg-amber-500 shadow-amber-500/20"
                    )}>
                      {session.status === 'running' ? <Activity size={24} /> : <Pause size={24} />}
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900">Estado de la Sesión</h3>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">ID: {session.id} — {session.status.toUpperCase()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={session.status === 'running' ? pauseSimulation : startSimulation}
                      className={cn(
                         "w-14 h-14 rounded-2xl flex items-center justify-center transition-all active:scale-90 shadow-xl",
                         session.status === 'running' ? "bg-amber-500 text-white shadow-amber-500/20" : "bg-emerald-500 text-white shadow-emerald-500/20"
                      )}
                    >
                      {session.status === 'running' ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
                    </button>
                    <button 
                      onClick={resetSimulation}
                      className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition-all active:scale-90 border border-slate-200"
                    >
                      <RotateCcw size={28} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Tiempo Operacional</span>
                    <p className="text-lg font-mono font-black text-slate-900">T+{session.currentTimeAt || 0}h</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Velocidad</span>
                    <p className="text-lg font-black text-slate-900">{session.config.speed}x Factor</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Escenario</span>
                    <p className="text-xs font-black text-slate-900 uppercase tracking-wider">{session.config.scenario.replace('_', ' ')}</p>
                  </div>
                </div>
             </div>

             <div className="bg-rose-50 border border-rose-100 rounded-3xl p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <Zap className="text-rose-600" />
                  <h3 className="text-lg font-black text-slate-900">Inyección de Fallos Operacionales</h3>
                </div>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo de Incidencia</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => injectFault('hub_overflow', selectedHub)}
                          className="p-3 bg-white border border-rose-200 rounded-xl text-[10px] font-black uppercase text-rose-600 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"
                        >
                          Overload Hub
                        </button>
                        <button 
                          onClick={() => injectFault('flight_delay', 'F1')}
                          className="p-3 bg-white border border-rose-200 rounded-xl text-[10px] font-black uppercase text-rose-600 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"
                        >
                          Delay Route
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Target Location</label>
                    <select 
                      value={selectedHub}
                      onChange={(e) => setSelectedHub(e.target.value)}
                      className="w-full bg-white border border-rose-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-900 outline-none"
                    >
                      {HUBS.map(h => <option key={h.id} value={h.id}>{h.city} ({h.id})</option>)}
                    </select>
                  </div>
                </div>
             </div>
          </div>

          <div className="col-span-4 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col h-[600px]">
             <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
                <Activity size={16} className="text-blue-600" />
                Operational Event Log
             </h3>
             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2">
                {events.map((evt, idx) => (
                  <div key={evt.id || idx} className="text-[11px] leading-relaxed relative pl-4 border-l-2 border-slate-100">
                    <div className={cn(
                      "absolute -left-[5px] top-1.5 w-2 h-2 rounded-full",
                      evt.severity === 'critical' ? 'bg-red-500' : evt.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                    )} />
                    <div className="flex justify-between items-start mb-0.5">
                      <span className="font-black text-slate-900 uppercase tracking-wider">{evt.id || 'EVT'}</span>
                      <span className="text-[9px] text-slate-400 font-mono">T+{evt.timestamp}</span>
                    </div>
                    <p className="text-slate-600">{evt.message}</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
