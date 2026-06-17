import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  availableDays: string[];  // YYYY-MM-DD
  selected: string;
  onChange: (day: string) => void;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function pad(n: number) { return n.toString().padStart(2, '0'); }

export const AvailableDayPicker: React.FC<Props> = ({ availableDays, selected, onChange, disabled }) => {
  const availableSet = useMemo(() => new Set(availableDays), [availableDays]);

  const seed = selected || availableDays[0] || '';
  const [viewYear,  setViewYear]  = useState(() => seed ? parseInt(seed.slice(0, 4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => seed ? parseInt(seed.slice(5, 7)) - 1 : new Date().getMonth());

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // Build the grid: prefix nulls so the first day falls on correct weekday (Mon=0)
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-3 select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          disabled={disabled}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-600" />
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-800">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={disabled}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40"
        >
          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <div key={d} className="text-center text-[9px] font-bold text-slate-400 py-0.5">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
          const isAvailable = availableSet.has(dateStr);
          const isSelected  = dateStr === selected;
          return (
            <button
              key={i}
              type="button"
              onClick={() => isAvailable && !disabled && onChange(dateStr)}
              disabled={!isAvailable || disabled}
              className={cn(
                'w-full aspect-square rounded-lg text-[10px] font-bold transition-colors leading-none flex items-center justify-center',
                isSelected
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : isAvailable
                    ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100'
                    : 'text-slate-300 cursor-not-allowed',
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
};
