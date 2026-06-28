import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { simulationService, SlaBreach } from '../services/simulationService';

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const MM = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MM[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

const STATUS_CLS: Record<string, string> = {
  PENDING:   'bg-rose-100 text-rose-700',
  WAITING:   'bg-amber-100 text-amber-700',
  IN_FLIGHT: 'bg-indigo-100 text-indigo-700',
};

/**
 * Lista forense: cada fila es el instante exacto en que el contador "SLA venc."
 * subió, con el contexto del momento (dónde estaba la maleta, si tenía ruta y por qué falló).
 */
export function SlaBreachesModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'loading' | 'error' } | { status: 'ready'; data: SlaBreach[] }>({ status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    simulationService.getSlaBreaches(sessionId, ctrl.signal)
      .then(d => setState({ status: 'ready', data: d }))
      .catch(() => setState({ status: 'error' }));
    return () => ctrl.abort();
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Incumplimientos de SLA</p>
            <p className="text-base font-black text-slate-900">
              Detalle del momento exacto en que venció cada maleta
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3">
          {state.status === 'loading' && <p className="text-sm text-slate-400 text-center py-8">Cargando…</p>}
          {state.status === 'error'   && <p className="text-sm text-red-500 text-center py-8">No se pudo cargar.</p>}
          {state.status === 'ready' && state.data.length === 0 && (
            <p className="text-sm text-emerald-600 text-center py-8">Ningún incumplimiento de SLA registrado. 🎉</p>
          )}
          {state.status === 'ready' && state.data.map((b, i) => (
            <div key={`${b.baggageId}-${i}`} className="border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-sm text-slate-800">{b.baggageId}</span>
                  <span className="text-[11px] text-slate-500 font-mono">{b.originIcao}→{b.destIcao}</span>
                  <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-md', STATUS_CLS[b.statusAtBreach] ?? 'bg-slate-100 text-slate-600')}>
                    {b.statusAtBreach} @ {b.locationIcao}
                  </span>
                </div>
                <span className="text-[11px] text-red-600 font-bold">Venció: {fmt(b.breachTimeUtc)}</span>
              </div>

              <p className="text-[12px] text-slate-700 leading-relaxed">{b.cause}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>¿Tenía ruta completa?: <b className={b.hadCompleteRoute ? 'text-slate-700' : 'text-red-600'}>{b.hadCompleteRoute ? 'Sí' : 'No'}</b></span>
                {b.plannedEtaUtc && (
                  <span>ETA del plan: <b>{fmt(b.plannedEtaUtc)}</b> (<b className="text-red-600">+{b.plannedEtaLateMinutes} min</b>)</span>
                )}
              </div>

              {b.plannedRoute.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-slate-600 pt-1">
                  {b.plannedRoute.map((l, j) => (
                    <span key={j} className={cn(
                      'px-1.5 py-0.5 rounded',
                      l.state === 'ARRIVED' ? 'bg-emerald-50 text-emerald-700'
                        : l.state === 'DEPARTED' ? 'bg-amber-50 text-amber-700'
                        : 'bg-blue-50 text-blue-700',
                    )}>
                      {l.fromIcao}→{l.toIcao}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
