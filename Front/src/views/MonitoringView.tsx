import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, MapPin, Clock, Activity, ShieldAlert, CheckCircle } from 'lucide-react';
import { useMonitoringContext } from '../providers/MonitoringProvider';
import { useSimulationContext } from '../providers/SimulationProvider';
import { cn } from '../lib/utils';

export const MonitoringView: React.FC = () => {
  const { alerts, metrics, resolveAlert } = useMonitoringContext();
  const { criticalPoints } = useSimulationContext();

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">Monitoreo de Red & SLA</h2>
          <p className="text-slate-500 text-sm mt-1">Detección proactiva de interrupciones y riesgos operativos.</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* SLA Alerts */}
        <div className="col-span-7 bg-white rounded-3xl border border-slate-200 p-6 flex flex-col h-[650px] shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              Alertas de SLA (Tiempo Real)
            </h3>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-lg">
              {alerts.length} Incidencias
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                <CheckCircle className="w-12 h-12 text-emerald-100" />
                <p className="text-sm font-medium italic">Todos los SLAs están dentro de los parámetros nominales.</p>
              </div>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className={cn(
                  "p-5 rounded-2xl border transition-all",
                  alert.status === 'resolved' ? "bg-emerald-50 border-emerald-100 opacity-60" : "bg-rose-50 border-rose-100 hover:border-rose-200"
                )}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex gap-3">
                      <div className={cn(
                        "p-2 rounded-xl",
                        alert.status === 'resolved' ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
                      )}>
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">{alert.shipmentId}</p>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{alert.type.replace('_', ' ')}</p>
                      </div>
                    </div>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full",
                      alert.status === 'resolved' ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'
                    )}>
                      {alert.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Retraso Actual</span>
                      <span className="text-xs font-mono font-bold text-rose-600">+{alert.currentDelay}h</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Deadline</span>
                      <span className="text-xs font-mono font-bold text-slate-700">T+{alert.deadline}h</span>
                    </div>
                  </div>

                  {alert.status === 'new' && (
                    <button 
                      onClick={() => resolveAlert(alert.id, 'Optimized route recalculated')}
                      className="w-full py-2 bg-white border border-rose-200 text-rose-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-colors"
                    >
                      Resolver Incidencia
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Critical Points & Network Health */}
        <div className="col-span-5 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              Puntos Críticos de la Red
            </h3>
            <div className="space-y-4">
              {criticalPoints.map(point => (
                <div key={point.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all group">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      point.impactScore > 0.7 ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                    )}>
                      {point.type === 'hub_overflow' ? <MapPin className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{point.locationId}</p>
                      <p className="text-[10px] text-slate-500 font-medium leading-tight">{point.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Severidad</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500" style={{ width: `${point.impactScore * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-700">{Math.round(point.impactScore * 100)}%</span>
                    </div>
                  </div>
                </div>
              ))}
              {criticalPoints.length === 0 && (
                <p className="text-center py-4 text-slate-400 text-xs italic">Sincronizando puntos críticos...</p>
              )}
            </div>
          </div>

          <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl">
             <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6">Mismo Nivel Operativo</h3>
             <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Salud de Red</span>
                    <span className="text-2xl font-black text-emerald-400">{metrics?.networkHealthScore || 0}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div 
                      animate={{ width: `${metrics?.networkHealthScore || 0}%` }}
                      className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Throughput</span>
                    <span className="text-lg font-black text-blue-400">{metrics?.systemThroughput || 0} req/s</span>
                  </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
