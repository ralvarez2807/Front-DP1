import React, { useMemo, useState } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import { loadRunHistory, RunRecord } from '../lib/runHistory';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';
import { SCENARIO_LABELS, SimulationScenario } from '../constants/domain';
import { cn } from '../lib/utils';

// Comparativa de dos ejecuciones (LE-76): métricas de /reports/summary capturadas
// al cierre de cada corrida (ver lib/runHistory). Sin endpoint dedicado — se
// comparan los dos reportes lado a lado.

const OUTCOME_LABELS: Record<RunRecord['outcome'], string> = {
  completed: 'Completada',
  collapsed: 'Colapsó',
  stopped:   'Detenida',
};

function runLabel(r: RunRecord, gmtOffset: number): string {
  const scenario = SCENARIO_LABELS[r.scenario as SimulationScenario] ?? r.scenario;
  return `${formatUserDayTime(r.endedAt, gmtOffset)} · ${scenario} · ${OUTCOME_LABELS[r.outcome]}`;
}

// true = mayor es mejor · false = menor es mejor
const METRICS: { key: string; label: string; higherIsBetter: boolean; fmt?: (v: any) => string }[] = [
  { key: 'totalShipments',    label: 'Envíos totales',    higherIsBetter: true },
  { key: 'totalBaggages',     label: 'Maletas totales',   higherIsBetter: true },
  { key: 'delivered',         label: 'Entregadas',        higherIsBetter: true },
  { key: 'slaBreaches',       label: 'SLA vencidas',      higherIsBetter: false },
  { key: 'pending',           label: 'Pendientes',        higherIsBetter: false },
  { key: 'inFlight',          label: 'En vuelo al cierre', higherIsBetter: false },
  { key: 'throughputPerHour', label: 'Rendimiento (maletas/h)', higherIsBetter: true, fmt: v => Number(v).toFixed(1) },
];

export function RunComparisonModal({ onClose }: { onClose: () => void }) {
  const gmtOffset = useUserTimezone();
  const history = useMemo(() => loadRunHistory(), []);
  const [idA, setIdA] = useState<string>(history[0]?.id ?? '');
  const [idB, setIdB] = useState<string>(history[1]?.id ?? '');

  const runA = history.find(r => r.id === idA) ?? null;
  const runB = history.find(r => r.id === idB) ?? null;

  const selectCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-indigo-400';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-white rounded-3xl border border-indigo-200 shadow-2xl max-w-2xl w-full overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-indigo-600 px-8 py-5 flex items-center gap-4 shrink-0">
          <div className="w-11 h-11 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
            <GitCompareArrows className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black text-white">Comparar ejecuciones</h3>
            <p className="text-indigo-200 text-[11px] font-semibold">
              Desempeño operativo de dos corridas con distintos parámetros
            </p>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 overflow-y-auto custom-scrollbar">
          {history.length < 2 ? (
            <p className="text-sm text-slate-500 text-center py-8 leading-relaxed">
              Aún no hay suficientes corridas guardadas para comparar.<br />
              El reporte final de cada simulación se guarda automáticamente al terminar —
              ejecuta al menos dos simulaciones.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 block mb-1.5">Ejecución A</label>
                  <select value={idA} onChange={e => setIdA(e.target.value)} className={selectCls}>
                    {history.map(r => <option key={r.id} value={r.id}>{runLabel(r, gmtOffset)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-violet-600 block mb-1.5">Ejecución B</label>
                  <select value={idB} onChange={e => setIdB(e.target.value)} className={selectCls}>
                    {history.map(r => <option key={r.id} value={r.id}>{runLabel(r, gmtOffset)}</option>)}
                  </select>
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-slate-50 border-b border-slate-200 px-4 py-2.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Métrica</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 text-right">A</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-violet-600 text-right">B</span>
                </div>
                {METRICS.map(m => {
                  const va = runA?.report?.[m.key];
                  const vb = runB?.report?.[m.key];
                  const bothNums = typeof va === 'number' && typeof vb === 'number' && va !== vb;
                  const aWins = bothNums && (m.higherIsBetter ? va > vb : va < vb);
                  const bWins = bothNums && !aWins;
                  const fmt = (v: any) => v == null ? '—' : (m.fmt ? m.fmt(v) : String(v));
                  return (
                    <div key={m.key} className="grid grid-cols-[1.4fr_1fr_1fr] px-4 py-2.5 border-b border-slate-100 last:border-0">
                      <span className="text-[12px] font-semibold text-slate-600">{m.label}</span>
                      <span className={cn('text-[13px] font-black font-mono text-right', aWins ? 'text-emerald-600' : 'text-slate-800')}>
                        {fmt(va)}
                      </span>
                      <span className={cn('text-[13px] font-black font-mono text-right', bWins ? 'text-emerald-600' : 'text-slate-800')}>
                        {fmt(vb)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-3">
                En verde, el mejor valor de cada métrica. Corridas sin reporte capturado muestran “—”.
              </p>
            </>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-colors mt-5"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
