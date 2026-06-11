import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, MapPin, CheckCircle, AlertTriangle } from 'lucide-react';
import { baggageService } from '../services/baggageService';
import { FullTrackingData } from '../models/operational';
import { cn } from '../lib/utils';

export const TrackingView: React.FC = () => {
  const [searchId, setSearchId] = useState('');
  const [trackingData, setTrackingData] = useState<FullTrackingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async (e?: React.FormEvent, signal?: AbortSignal) => {
    if (e) e.preventDefault();
    if (!searchId) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await baggageService.getTracking(searchId, signal);
      setTrackingData(data);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'No se encontró el bulto solicitado.');
      setTrackingData(null);
    } finally {
      setIsLoading(false);
    }
  }, [searchId]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
    };
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="max-w-4xl mx-auto space-y-8 pb-20"
    >
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Enterprise Baggage Tracking</h2>
        <p className="text-slate-500 text-sm max-w-lg mx-auto leading-relaxed">
          Sincronización en tiempo real con los checkpoints operativos de la red global.
        </p>
      </div>

      <div className="relative group">
        <form onSubmit={handleSearch} className="flex gap-4 p-2 bg-white border border-slate-200 rounded-3xl shadow-xl shadow-blue-600/5 focus-within:border-blue-500 transition-all">
          <div className="flex-1 flex items-center gap-4 px-6">
            <Search size={24} className="text-slate-400 group-focus-within:text-blue-600 transition-colors" />
            <input 
              type="text" 
              placeholder="Ingrese Tracking ID (Ej: B2B-XXXXXXXX)" 
              value={searchId}
              onChange={(e) => setSearchId(e.target.value.toUpperCase())}
              className="w-full bg-transparent outline-none text-lg font-bold text-slate-900 placeholder:text-slate-300"
            />
          </div>
          <button 
            type="submit"
            disabled={isLoading}
            className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] disabled:bg-slate-300"
          >
            {isLoading ? 'Rastreando...' : 'Rastrear'}
          </button>
        </form>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-6 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-4 text-rose-600"
          >
            <AlertTriangle className="shrink-0" />
            <p className="text-sm font-bold uppercase tracking-wide">{error}</p>
          </motion.div>
        )}

        {trackingData && (
          <motion.div 
            key={trackingData.shipmentId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Header Info */}
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm grid grid-cols-3 gap-8">
               <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Baggage ID</span>
                  <p className="text-xl font-black text-slate-900">{trackingData.shipmentId}</p>
                  <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-black uppercase tracking-widest rounded-full">{trackingData.status}</span>
               </div>
               <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ubicación Actual</span>
                  <p className="text-lg font-bold text-slate-900">{trackingData.currentHub.city}</p>
                  <p className="text-[10px] text-slate-500">{trackingData.currentHub.name}</p>
               </div>
               <div className="space-y-1 text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ETA Estimado</span>
                  <p className="text-xl font-mono font-black text-blue-600">T+{trackingData.estimatedArrival}h</p>
                  <p className="text-[10px] text-slate-500">Calculado por Routing Engine</p>
               </div>
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-10">Historial Operacional del Bulto</h3>
                <div className="space-y-0 relative">
                    <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-slate-100" />
                    
                    {trackingData.timeline.map((step, idx) => (
                      <div key={idx} className="relative pl-16 pb-12 last:pb-0">
                         <div className={cn(
                           "absolute left-0 w-12 h-12 rounded-2xl flex items-center justify-center border-4 border-white shadow-lg transition-all",
                           step.status === 'completed' ? "bg-emerald-500 text-white" : 
                           step.status === 'current' ? "bg-blue-600 text-white scale-110 z-10" : "bg-slate-50 text-slate-300"
                         )}>
                            {step.status === 'completed' ? <CheckCircle size={20} /> : <MapPin size={20} />}
                         </div>

                         <div className="grid grid-cols-4 gap-8 items-start">
                            <div className="col-span-1">
                               <p className={cn(
                                 "text-sm font-black",
                                 step.status === 'pending' ? "text-slate-400" : "text-slate-900"
                               )}>{step.hubId}</p>
                               <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">{step.status}</span>
                            </div>

                            <div className="col-span-1 space-y-1">
                               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Llegada</span>
                               <p className="text-xs font-mono font-bold text-slate-700">{step.arrivalTime ? `T+${step.arrivalTime}h` : '—'}</p>
                            </div>

                            <div className="col-span-2 space-y-2">
                               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Eventos en Nodo</span>
                               <div className="space-y-1.5">
                                  {step.events.map(evt => (
                                    <div key={evt.id} className="flex gap-2 items-start bg-slate-50 p-2 rounded-lg border border-slate-100">
                                       <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                                       <p className="text-[10px] text-slate-600 leading-tight">{evt.message}</p>
                                    </div>
                                  ))}
                                  {step.events.length === 0 && <span className="text-[10px] italic text-slate-300">No hay registros</span>}
                               </div>
                            </div>
                         </div>
                      </div>
                    ))}
                </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
