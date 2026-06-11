import React, { useState } from 'react';
import { Globe, Mail, Lock, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

interface AuthProps {
  onLogin: (email: string, password?: string) => void;
}

export function Auth({ onLogin }: AuthProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-blue-600/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-emerald-600/10 blur-[120px] rounded-full" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-2xl shadow-blue-600/20">
            <Globe className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Tasf.B2B</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mt-1">Logistics Operational System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Usuario</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@tasf.com"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-sm text-white outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-sm text-white outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4 shadow-xl shadow-blue-600/20"
          >
            Acceder al Sistema
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-[10px] text-slate-600 mt-8">
          Al acceder, aceptas nuestros términos de servicio y políticas de privacidad operativa.
        </p>
      </motion.div>
    </div>
  );
}
