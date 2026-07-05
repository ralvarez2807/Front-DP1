import React, { useEffect, useState } from 'react';
import { FileText, X, Loader2 } from 'lucide-react';
import { simulationService } from '../services/simulationService';
import { formatUserDayTime } from '../lib/timezone';
import { useUserTimezone } from '../hooks/useUserTimezone';

// Reporte de la última planificación estable (G08/G09/G10): métricas agregadas
// de GET /simulations/:id/reports/summary. Puede recibir el reporte ya cargado
// (cierre de simulación) o buscarlo en vivo por sessionId (Operación Día a Día).
interface SummaryReportModalProps {
  title: string;
  subtitle?: string;
  sessionId?: string;    // si se pasa, el reporte se consulta al abrir
  report?: any | null;   // si se pasa, se muestra directamente
  onClose: () => void;
}

export function ReportRows({ report, gmtOffset }: { report: any; gmtOffset: number }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Envíos totales',   value: report.totalShipments ?? '—' },
    { label: 'Maletas totales',  value: report.totalBaggages ?? '—' },
    { label: 'Entregadas',       value: <span className="text-emerald-600">{report.delivered ?? '—'}</span> },
    { label: 'SLA vencidas',     value: <span className="text-red-600">{report.slaBreaches ?? '—'}</span> },
    { label: 'Sin ruta / pendientes', value: report.pending ?? '—' },
    { label: 'En vuelo',         value: report.inFlight ?? '—' },
    { label: 'Rendimiento (maletas/h)', value: report.throughputPerHour != null ? Number(report.throughputPerHour).toFixed(1) : '—' },
  ];
  return (
    <>
      {(report.simStart || report.simEnd) && (
        <p className="text-[11px] text-slate-400 font-mono mb-2">
          {report.simStart ? formatUserDayTime(report.simStart, gmtOffset) : '—'}
          {' → '}
          {report.simEnd ? formatUserDayTime(report.simEnd, gmtOffset) : '—'}
        </p>
      )}
      <div className="space-y-2.5">
        {rows.map(row => (
          <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
            <span className="text-sm text-slate-600 font-semibold">{row.label}</span>
            <span className="text-sm font-black text-slate-900 font-mono">{row.value}</span>
          </div>
        ))}
      </div>
      {Array.isArray(report.topRoutes) && report.topRoutes.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Rutas más usadas
          </p>
          <div className="space-y-1">
            {report.topRoutes.slice(0, 5).map((r: any, i: number) => (
              <div key={`${r.fromIcao}-${r.toIcao}-${i}`} className="flex justify-between items-center text-[12px]">
                <span className="font-mono font-bold text-slate-700">{r.fromIcao} → {r.toIcao}</span>
                <span className="font-mono text-slate-500">{r.count} tramo(s)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function SummaryReportModal({ title, subtitle, sessionId, report: reportProp, onClose }: SummaryReportModalProps) {
  const gmtOffset = useUserTimezone();
  const [report, setReport] = useState<any | null>(reportProp ?? null);
  const [loading, setLoading] = useState(!!sessionId && !reportProp);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!sessionId || reportProp) return;
    const ctrl = new AbortController();
    simulationService.getSummaryReport(sessionId, ctrl.signal)
      .then(r => { setReport(r); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [sessionId, reportProp]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={onClose}>
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-slate-800 px-8 py-5 flex items-center gap-4 shrink-0">
          <div className="w-11 h-11 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black text-white">{title}</h3>
            {subtitle && <p className="text-slate-300 text-[11px] font-semibold">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 overflow-y-auto custom-scrollbar">
          {loading && (
            <p className="text-sm text-slate-400 text-center py-6 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generando reporte…
            </p>
          )}
          {error && <p className="text-sm text-rose-500 text-center py-6">No se pudo obtener el reporte.</p>}
          {report && <ReportRows report={report} gmtOffset={gmtOffset} />}
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
