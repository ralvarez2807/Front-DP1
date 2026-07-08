import React, { useEffect, useState } from 'react';
import { X, Loader2, Package } from 'lucide-react';
import { simulationService, SimulationResult } from '../services/simulationService';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';
import { cn } from '../lib/utils';

// Última solución exitosa (G08/G09/G10): a diferencia del reporte de métricas
// agregadas (/reports/summary), esto muestra la última planificación estable
// con las rutas asignadas a cada maleta, vía GET /simulations/:id/result.
// Responde incluso con la sesión corriendo (status "RUNNING") — TTL 5 min desde
// el último snapshot, así que puede fallar si ya pasó mucho desde que cerró.

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: 'SIN RUTA',   cls: 'bg-red-100 text-red-700' },
  WAITING:   { label: 'EN ALMACÉN', cls: 'bg-amber-100 text-amber-700' },
  IN_FLIGHT: { label: 'EN VUELO',   cls: 'bg-indigo-100 text-indigo-700' },
  DELIVERED: { label: 'ENTREGADA',  cls: 'bg-emerald-100 text-emerald-700' },
};

const RESULT_STATUS_META: Record<string, string> = {
  RUNNING:   'En curso',
  COMPLETED: 'Completada',
  COLLAPSED: 'Colapsó',
  STOPPED:   'Detenida',
};

const LEG_META: Record<string, { label: string; dot: string }> = {
  ARRIVED:  { label: 'Recorrido',      dot: 'bg-emerald-500' },
  DEPARTED: { label: 'En vuelo ahora', dot: 'bg-amber-500' },
  PLANNED:  { label: 'Planificado',    dot: 'bg-blue-400' },
};

const MAX_ROWS = 200;

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function LastSolutionModal({ sessionId, onClose }: Props) {
  const gmtOffset = useUserTimezone();
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    setResult(null);
    simulationService.getResult(sessionId, ctrl.signal)
      .then(r => setResult(r))
      .catch((err: any) => {
        // Una petición cancelada (p. ej. el doble efecto de StrictMode en dev,
        // o cerrar el modal antes de que responda) no es un error real — solo
        // marcar error si de verdad falló.
        if (err?.message !== 'canceled') setError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [sessionId]);

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-slate-800 px-8 py-5 flex items-center gap-4 shrink-0">
          <div className="w-11 h-11 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black text-white">Última solución exitosa</h3>
            <p className="text-slate-300 text-[11px] font-semibold">Última planificación estable con rutas asignadas</p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 overflow-y-auto custom-scrollbar">
          {loading && (
            <p className="text-sm text-slate-400 text-center py-6 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando…
            </p>
          )}
          {error && (
            <p className="text-sm text-rose-500 text-center py-6">
              No se pudo obtener la última solución (puede que ya haya expirado — TTL de 5 minutos).
            </p>
          )}
          {result && (() => {
            // Solo maletas con ruta real asignada (legs no vacío) — "assignedRoutes"
            // trae también las que aún no tienen tramos (p. ej. sin rutear todavía).
            const routed = result.assignedRoutes.filter(b => b.legs.length > 0);
            return (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500 mb-4">
                  <span>Estado: <b className="text-slate-800">{RESULT_STATUS_META[result.status] ?? result.status}</b></span>
                  {result.endedAt && (
                    <span>Fin: <b className="text-slate-800">{formatUserDayTime(result.endedAt, gmtOffset)}</b></span>
                  )}
                  {result.collapseReason && (
                    <span className="text-rose-600">Motivo colapso: <b>{result.collapseReason}</b></span>
                  )}
                  <span>{routed.length} maleta(s) con ruta</span>
                </div>

                {routed.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">Sin maletas con ruta asignada.</p>
                ) : (
                  <div className="space-y-3">
                    {routed.slice(0, MAX_ROWS).map(b => {
                      const st = STATUS_META[b.status] ?? { label: b.status, cls: 'bg-slate-100 text-slate-600' };
                      return (
                        <div key={b.baggageId} className="border border-slate-100 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-mono font-black text-sm text-slate-800">{b.baggageId}</span>
                            <span className={cn('text-[9px] font-black uppercase px-2 py-0.5 rounded-full', st.cls)}>{st.label}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 mb-2">
                            <span className="font-mono">{b.currentIcao} → {b.destIcao}</span>
                            <span>Deadline: {formatUserDayTime(b.deadlineUtc, gmtOffset)}</span>
                          </div>
                          <div className="space-y-1.5 border-t border-slate-50 pt-2">
                            {b.legs.map((leg, i) => {
                              const meta = LEG_META[leg.state] ?? { label: leg.state, dot: 'bg-slate-300' };
                              return (
                                <div key={`${leg.flightId}-${i}`} className="flex items-center gap-2 text-[10px]">
                                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dot, leg.state === 'DEPARTED' && 'animate-pulse')} />
                                  <span className="font-mono font-bold text-slate-700 w-24 shrink-0">{leg.fromIcao} → {leg.toIcao}</span>
                                  <span className="font-mono text-slate-500 flex-1">
                                    {formatUserDayTime(leg.depTime, gmtOffset)} — {formatUserDayTime(leg.arrTime, gmtOffset)}
                                  </span>
                                  <span className="font-mono text-slate-400 hidden sm:block">{leg.flightId}</span>
                                  <span className="font-black uppercase tracking-wider text-slate-500 shrink-0">{meta.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {routed.length > MAX_ROWS && (
                      <p className="text-[10px] text-slate-400 text-center pt-2">
                        Mostrando {MAX_ROWS} de {routed.length}
                      </p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors mt-5"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
