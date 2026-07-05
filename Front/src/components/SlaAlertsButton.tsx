import React, { useMemo, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SimShipment } from '../services/simulationService';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';
import { cn } from '../lib/utils';

// Alertas de riesgo de incumplimiento de SLA (LE-84/LE-85). Decisión documentada
// en el Excel de exigencias: el umbral y el color ámbar los calcula el FRONT a
// partir de los deadlines — no hay evento del backend para esto.
//
// Un envío está "en riesgo" si no está entregado, aún no venció, y su deadline
// cae dentro de la ventana de riesgo respecto al reloj simulado actual.
export const SLA_RISK_WINDOW_MINUTES = 120;

interface SlaAlertsButtonProps {
  shipments: SimShipment[];
  /** Reloj simulado actual en epoch ms; null si aún no se conoce. */
  simNowMs: number | null;
  onSelectShipment?: (s: SimShipment) => void;
}

export function SlaAlertsButton({ shipments, simNowMs, onSelectShipment }: SlaAlertsButtonProps) {
  const gmtOffset = useUserTimezone();
  const [open, setOpen] = useState(false);

  const { atRisk, plannedLate } = useMemo(() => {
    const atRisk: { s: SimShipment; minutesLeft: number }[] = [];
    const plannedLate: SimShipment[] = [];
    if (simNowMs != null) {
      for (const s of shipments) {
        const delivered = s.totalBaggages > 0 && s.delivered >= s.totalBaggages;
        if (delivered) continue;
        if (s.breached > 0) continue; // ya vencido — lo cubre el contador "SLA venc."
        const minutesLeft = (new Date(s.deadlineUtc).getTime() - simNowMs) / 60_000;
        if (minutesLeft > 0 && minutesLeft <= SLA_RISK_WINDOW_MINUTES) {
          atRisk.push({ s, minutesLeft });
        } else if (s.late > 0) {
          // Entrega planificada después del deadline: riesgo estructural aunque falte tiempo
          plannedLate.push(s);
        }
      }
      atRisk.sort((a, b) => a.minutesLeft - b.minutesLeft);
    }
    return { atRisk, plannedLate };
  }, [shipments, simNowMs]);

  const count = atRisk.length + plannedLate.length;

  const pick = (s: SimShipment) => {
    setOpen(false);
    onSelectShipment?.(s);
  };

  return (
    <div className="relative">
      <AnimatePresence>
        {open && (
          <motion.div
            key="sla-alerts-pop"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-2 w-[320px] bg-white/97 backdrop-blur-md rounded-2xl border border-amber-200 shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
              <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">
                Alertas activas de SLA
              </p>
              <p className="text-[9px] text-amber-600 font-semibold">
                Umbral de riesgo: deadline a menos de {SLA_RISK_WINDOW_MINUTES / 60} h simuladas
              </p>
            </div>
            <div className="max-h-72 overflow-y-auto custom-scrollbar">
              {count === 0 && (
                <p className="text-center text-xs text-slate-400 py-8">
                  Sin envíos en riesgo de incumplimiento ahora.
                </p>
              )}
              {atRisk.map(({ s, minutesLeft }) => (
                <button
                  key={s.shipmentId}
                  onClick={() => pick(s)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-slate-50 hover:bg-amber-50/60 text-left transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black font-mono text-slate-800 truncate">{s.shipmentId}</p>
                    <p className="text-[10px] font-mono text-slate-500">
                      {s.originIcao} → {s.destIcao} · {fmtLeft(minutesLeft)} restantes
                    </p>
                  </div>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                    Por vencer
                  </span>
                  {onSelectShipment && <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                </button>
              ))}
              {plannedLate.map(s => (
                <button
                  key={s.shipmentId}
                  onClick={() => pick(s)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-slate-50 hover:bg-orange-50/60 text-left transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black font-mono text-slate-800 truncate">{s.shipmentId}</p>
                    <p className="text-[10px] font-mono text-slate-500">
                      {s.originIcao} → {s.destIcao} · deadline {formatUserDayTime(s.deadlineUtc, gmtOffset)}
                    </p>
                  </div>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 shrink-0">
                    Plan tardío
                  </span>
                  {onSelectShipment && <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg',
          count > 0
            ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-amber-500/30'
            : open
              ? 'bg-slate-800 text-white'
              : 'bg-white/90 backdrop-blur-md text-slate-600 border border-slate-200 hover:bg-slate-50'
        )}
        title="Envíos en riesgo de incumplir su SLA (umbral calculado en vivo)"
      >
        <Bell className={cn('w-4 h-4', count > 0 && 'animate-pulse')} />
        Alertas
        {count > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-white text-amber-600 text-[10px] font-black flex items-center justify-center">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

function fmtLeft(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
