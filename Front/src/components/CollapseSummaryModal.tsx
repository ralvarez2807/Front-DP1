import React, { useState } from 'react';
import { AlertOctagon, X, Package } from 'lucide-react';
import { CollapseResult } from '../providers/SimulationProvider';
import { ReportRows } from './SummaryReportModal';
import { LastSolutionModal } from './LastSolutionModal';
import { useUserTimezone } from '../hooks/useUserTimezone';

const REASON_LABELS: Record<string, string> = {
  DEADLINE_EXCEEDED: 'Una maleta superó su fecha límite de entrega',
  NO_VIABLE_ROUTE:   'No se encontró ruta viable tras varios ciclos consecutivos de optimización',
};

function fmtDuration(ms: number, unitsLabel: [string, string]): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} ${unitsLabel[minutes === 1 ? 0 : 1]}`;
}

/**
 * Cuadro de finalización mostrado cuando el backend detecta colapso operativo
 * (evento WS COLLAPSE_DETECTED). Resume cuánto tiempo simulado y cuánto tiempo
 * real tomó llegar a ese punto.
 */
export function CollapseSummaryModal({ result, onClose }: { result: CollapseResult; onClose: () => void }) {
  const gmtOffset = useUserTimezone();
  const [lastSolutionOpen, setLastSolutionOpen] = useState(false);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-white rounded-3xl border border-rose-200 shadow-2xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-rose-600 px-8 py-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
            <AlertOctagon className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-black text-white">Colapso detectado</h3>
            <p className="text-rose-200 text-xs font-semibold">Prueba de estrés finalizada</p>
          </div>
          <button onClick={onClose} className="text-rose-200 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 space-y-5 overflow-y-auto custom-scrollbar">
          <p className="text-sm text-slate-700 leading-relaxed">
            {REASON_LABELS[result.reason] ?? result.reason}
            {result.baggageId && <> (maleta <span className="font-mono font-bold">{result.baggageId}</span>)</>}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tiempo simulado</p>
              <p className="text-base font-black text-slate-900">{fmtDuration(result.simElapsedMs, ['minuto', 'minutos'])}</p>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tiempo real</p>
              <p className="text-base font-black text-slate-900">{fmtDuration(result.realElapsedMs, ['minuto', 'minutos'])}</p>
            </div>
          </div>

          {/* Reporte de la última planificación estable al momento del colapso (G10) */}
          {result.report && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Última planificación estable
              </p>
              <ReportRows report={result.report} gmtOffset={gmtOffset} />
            </div>
          )}

          <button
            onClick={() => setLastSolutionOpen(true)}
            className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5"
          >
            <Package className="w-3.5 h-3.5" /> Ver última solución exitosa
          </button>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-lg shadow-rose-600/20"
          >
            Cerrar
          </button>
        </div>
      </div>

      {lastSolutionOpen && (
        <LastSolutionModal sessionId={result.sessionId} onClose={() => setLastSolutionOpen(false)} />
      )}
    </div>
  );
}
