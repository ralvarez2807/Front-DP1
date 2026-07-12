import React, { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
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
// transcurrido simulado, transcurrido real). Se arrastra desde el asa superior;
// la posición se guarda en memoria del componente (no persiste entre recargas,
// el widget solo existe mientras hay una sesión de simulación activa).
export function FloatingSimClock({
  realDate, realTime, gmtLabel, simDate, simTime, paused, simElapsed, realElapsed,
}: FloatingSimClockProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

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
      className={cn(
        'fixed z-40 w-[210px] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl select-none',
        !pos && 'top-20 right-4'
      )}
    >
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
        title="Arrastrar para mover"
      >
        <GripVertical className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[9px] font-black uppercase tracking-widest">Reloj de simulación</span>
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
  );
}
