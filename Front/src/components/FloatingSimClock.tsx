import React, { useRef, useState, useEffect } from 'react';
import { GripVertical, Clock, Minimize2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface FloatingSimClockProps {
  realDate: string;
  realTime: string;
  gmtLabel: string;
  simDate: string | null;
  simTime: string | null;
  paused: boolean;
  simElapsed: string;
  realElapsed: string;
  /** Cuando es true (p.ej. fuera de la pantalla de Simulación) el reloj se colapsa
   *  automáticamente a una píldora pequeña en el borde. El usuario puede reabrirlo
   *  con un click, y minimizarlo manualmente con el botón del encabezado. */
  autoCollapse?: boolean;
}

function Row({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-[8px] font-sans font-bold uppercase tracking-wider shrink-0', tone)}>{label}</span>
      <span className="tabular-nums font-mono text-xs font-black text-slate-800 text-right">
        {value}
        {sub}
      </span>
    </div>
  );
}

// Reloj flotante y movible con los 4 tiempos de la simulación (real, simulado,
// transcurrido simulado, transcurrido real). Se arrastra desde el asa superior.
// Se colapsa a una píldora pequeña en el borde al salir de la pantalla de
// Simulación (autoCollapse) o manualmente; un click la vuelve a expandir.
export function FloatingSimClock({
  realDate, realTime, gmtLabel, simDate, simTime, paused, simElapsed, realElapsed, autoCollapse,
}: FloatingSimClockProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Colapsa/expande automáticamente al cambiar de pantalla, sin bloquear el toggle
  // manual dentro de una misma pantalla (solo reacciona cuando autoCollapse cambia).
  useEffect(() => { setCollapsed(!!autoCollapse); }, [autoCollapse]);

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = widgetRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos?.x ?? rect.left,
      origY: pos?.y ?? rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={widgetRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn('fixed z-40 select-none', !pos && 'top-20 right-4')}
    >
      {collapsed ? (
        // ── Píldora minimizada (en el borde) ──────────────────────────────────
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 bg-white/95 backdrop-blur-md rounded-full border border-slate-200 shadow-lg hover:bg-slate-50 transition-colors"
          title="Mostrar reloj de simulación"
        >
          <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="tabular-nums font-mono text-[11px] font-black text-slate-800">
            {simTime ?? realTime}
          </span>
          {paused && <span className="text-amber-500 text-[9px] font-bold">⏸</span>}
        </button>
      ) : (
        // ── Reloj completo ────────────────────────────────────────────────────
        <div className="w-[210px] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl">
          <div
            onMouseDown={onDragStart}
            className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
            title="Arrastrar para mover"
          >
            <GripVertical className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-widest flex-1">Reloj de simulación</span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
              className="shrink-0 p-0.5 -mr-0.5 rounded hover:bg-slate-100 hover:text-slate-700"
              title="Minimizar"
            >
              <Minimize2 className="w-3 h-3" />
            </button>
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            <Row label="Real" tone="text-slate-400" value={`${realDate} · ${realTime}`} />
            <div className="text-right text-[9px] text-slate-400 -mt-1">{gmtLabel}</div>
            {simDate && simTime && (
              <Row
                label="Sim" tone="text-indigo-400"
                value={`${simDate} · ${simTime}`}
                sub={paused && <span className="ml-1 text-amber-500 font-sans text-[9px] font-bold">(pausado)</span>}
              />
            )}
            <div className="h-px bg-slate-100 my-1.5" />
            <Row label="T. Simulado" tone="text-indigo-400" value={simElapsed} />
            <Row label="T. Real" tone="text-emerald-500" value={realElapsed} />
          </div>
        </div>
      )}
    </div>
  );
}
