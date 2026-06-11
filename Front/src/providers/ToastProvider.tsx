import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const value = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-auto min-w-[300px] border
                ${toast.type === 'error' ? 'bg-red-50/90 border-red-200 text-red-800' : ''}
                ${toast.type === 'success' ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800' : ''}
                ${toast.type === 'warning' ? 'bg-amber-50/90 border-amber-200 text-amber-800' : ''}
                ${toast.type === 'info' ? 'bg-blue-50/90 border-blue-200 text-blue-800' : ''}
              `}
            >
              {toast.type === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
              {toast.type === 'warning' && <AlertCircle className="w-5 h-5 text-amber-500" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-blue-500" />}
              
              <p className="text-sm font-medium flex-1">{toast.message}</p>
              
              <button 
                onClick={() => removeToast(toast.id)}
                className="p-1 hover:bg-black/5 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 opacity-50" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
