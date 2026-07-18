import React, { useState, useEffect } from 'react';
import { Clock, Minimize2 } from 'lucide-react';
import { cn } from '../lib/utils';

// Ancho del panel de navegación izquierdo cuando está expandido (Tailwind w-64).
// El reloj está fijado al viewport, así que se desplaza este ancho para no quedar
// tapado por el panel al abrirse.
const SIDEBAR_WIDTH = 256;

interface FloatingSimClockProps {
  realDate: string;
  realTime: string;
  /** Etiqueta de la zona horaria mostrada: la ciudad del usuario (p.ej. "Lima"),
   *  o el GMT como respaldo si el usuario no corresponde a ninguna ciudad. */
  zoneLabel: string;
  simDate: string | null;
  simTime: string | null;
  paused: boolean;
  simElapsed: string;
  realElapsed: string;
  /** Cuando es true (p.ej. fuera de la pantalla de Simulación) el reloj se colapsa
   *  automáticamente a una píldora pequeña en el borde. El usuario puede reabrirlo
   *  con un click, y minimizarlo manualmente con el botón del encabezado. */
  autoCollapse?: boolean;
  /** true cuando el panel de navegación izquierdo está expandido; desplaza el reloj
   *  a la derecha para que el panel no lo tape. */
  sidebarExpanded?: boolean;
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

// Reloj flotante (posición fija) con los 4 tiempos de la simulación (real,
// simulado, transcurrido simulado, transcurrido real). Se ubica arriba a la
// izquierda, junto a los controles de zoom, y se desplaza si el panel de
// navegación se expande. Se colapsa a una píldora pequeña en el borde al salir
// de la pantalla de Simulación (autoCollapse) o manualmente; un click la reabre.
export function FloatingSimClock({
  realDate, realTime, zoneLabel, simDate, simTime, paused, simElapsed, realElapsed, autoCollapse, sidebarExpanded,
}: FloatingSimClockProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Colapsa/expande automáticamente al cambiar de pantalla, sin bloquear el toggle
  // manual dentro de una misma pantalla (solo reacciona cuando autoCollapse cambia).
  useEffect(() => { setCollapsed(!!autoCollapse); }, [autoCollapse]);

  return (
    <div
      style={{ top: 72, left: (sidebarExpanded ? SIDEBAR_WIDTH : 0) + 68, transition: 'left 0.25s ease' }}
      className={cn('fixed z-40 select-none')}
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
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 text-slate-500">
            <Clock className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
            <span className="text-[9px] font-black uppercase tracking-widest flex-1">Reloj de simulación</span>
            <button
              onClick={() => setCollapsed(true)}
              className="shrink-0 p-0.5 -mr-0.5 rounded hover:bg-slate-100 hover:text-slate-700"
              title="Minimizar"
            >
              <Minimize2 className="w-3 h-3" />
            </button>
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            <Row label="Real" tone="text-slate-500" value={`${realDate} · ${realTime}`} />
            <div className="text-right text-[9px] font-semibold text-slate-500 -mt-1">{zoneLabel}</div>
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
