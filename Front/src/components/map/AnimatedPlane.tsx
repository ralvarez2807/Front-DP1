import React, { useEffect, useMemo, useRef, useState } from 'react';

// Extrae el ID de horario sin fecha: "SKBO-SEQM-19:00-20260103" → "SKBO-SEQM-19:00"
export function scheduleIdOf(flightId: string): string {
  return flightId.replace(/-\d{8}$/, '');
}

export function getPlaneColor(occupied: number, capacity: number, highlighted: boolean): string {
  if (highlighted) return '#f59e0b';
  if (capacity === 0) return '#2563eb';
  const pct = (occupied / capacity) * 100;
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  return '#10b981';
}

/**
 * Avión animado a lo largo de un arco Bézier cuadrático idéntico al de las rutas
 * del mapa. El progreso se calcula con requestAnimationFrame en función del tiempo
 * real transcurrido desde `startedAt`, por lo que se mantiene en la posición correcta
 * aunque el componente se monte a mitad del vuelo (restauración desde snapshot).
 */
export function AnimatedPlane({
  x1, y1, x2, y2,
  startedAt,
  durationMs,
  iconScale = 1,
  highlighted = false,
  capacity = 0,
  occupied = 0,
}: {
  x1: number; y1: number; x2: number; y2: number;
  startedAt: number;
  durationMs: number;
  iconScale?: number;
  highlighted?: boolean;
  capacity?: number;
  occupied?: number;
}) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const p = Math.min(elapsed / durationMs, 1);
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [startedAt, durationMs]);

  const pos = useMemo(() => {
    // Mismo control point que arcPath en MapProvider: punto medio - 20% de la distancia
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - dist * 0.2;
    const t = progress;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    const dx = 2 * mt * (cx - x1) + 2 * t * (x2 - cx);
    const dy = 2 * mt * (cy - y1) + 2 * t * (y2 - cy);
    // +90 porque la nariz del avión apunta a (0,-8) = arriba en SVG
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return { x, y, angle };
  }, [x1, y1, x2, y2, progress]);

  if (progress >= 1) return null;

  const color = getPlaneColor(occupied, capacity, highlighted);
  const size = highlighted ? 1.4 : 1;

  return (
    <g transform={`translate(${pos.x},${pos.y}) rotate(${pos.angle}) scale(${iconScale * size * 0.6})`}>
      {highlighted && <circle cx="0" cy="0" r="14" fill="rgba(245,158,11,0.15)" />}
      {/* Fuselaje */}
      <ellipse cx="0" cy="0" rx="1.8" ry="7" fill={color} />
      {/* Nariz */}
      <ellipse cx="0" cy="-6.5" rx="1.8" ry="2.5" fill={color} />
      {/* Alas principales */}
      <path d="M-1.5,-1 L-10,3 L-9,5 L-1.5,2 L1.5,2 L9,5 L10,3 L1.5,-1 Z" fill={color} />
      {/* Cola */}
      <path d="M-1.5,5 L-5,8 L-4,9 L-1.5,7 L1.5,7 L4,9 L5,8 L1.5,5 Z" fill={color} />
      {/* Borde blanco para contraste */}
      <ellipse cx="0" cy="0" rx="1.8" ry="7" fill="none" stroke="white" strokeWidth="0.6" />
      <path d="M-1.5,-1 L-10,3 L-9,5 L-1.5,2 L1.5,2 L9,5 L10,3 L1.5,-1 Z" fill="none" stroke="white" strokeWidth="0.5" />
    </g>
  );
}

export default AnimatedPlane;
