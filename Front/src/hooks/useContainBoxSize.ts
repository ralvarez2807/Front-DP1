import { useEffect, useState, type RefObject } from 'react';

/**
 * Tamaño en píxeles del rectángulo más grande con relación de aspecto
 * `aspectW:aspectH` que cabe dentro del contenedor referenciado, sin recortar
 * ni deformar — el equivalente de `object-fit: contain`, calculado en JS
 * porque un <svg> inline con viewBox no soporta ese fit de forma confiable
 * entre navegadores (a diferencia de <img>/<video>).
 *
 * Se recalcula con ResizeObserver: cambios de ventana, o cuando un panel
 * lateral se abre/cierra y el contenedor cambia de ancho.
 */
export function useContainBoxSize(
  containerRef: RefObject<HTMLElement | null>,
  aspectW: number,
  aspectH: number
): { width: number; height: number } {
  const [size, setSize] = useState({ width: aspectW, height: aspectH });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const targetRatio = aspectW / aspectH;

    const update = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (w === 0 || h === 0) return;
      const containerRatio = w / h;
      setSize(
        containerRatio > targetRatio
          ? { width: h * targetRatio, height: h }
          : { width: w, height: w / targetRatio }
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, aspectW, aspectH]);

  return size;
}
