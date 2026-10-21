/**
 * Central Locação - Tela de Login
 * Cores da Marca: Azul (#2AA3D8), Vermelho (#D9332B), Grafite (#4A4A4A), Laranja (#E07A2E)
 */

import React, { useState } from 'react';
import logo from '../assets/logo-central-locadora.png';
import { Mail, Lock, Eye, EyeOff, LogIn, AlertCircle, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const EMAIL_LEMBRADO_KEY = 'central_locacao_v2_emailLembrado';

export const LoginView: React.FC = () => {
  const { login } = useApp();

  const [emailLembrado] = useState(() => {
    try {
      return localStorage.getItem(EMAIL_LEMBRADO_KEY) || '';
    } catch {
      return '';
    }
  });
  const [email, setEmail] = useState(emailLembrado);
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(emailLembrado !== '');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setEntrando(true);
    const falha = await login(email, senha, lembrar);
    setEntrando(false);
    if (falha) {
      setErro(falha);
      setSenha('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-10 font-sans relative overflow-hidden">
      {/* Fundo decorativo */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#2AA3D8]/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-[#D9332B]/15 blur-3xl" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 select-none">
          <img src={logo} alt="Central Locadora Rio Preto" className="h-28 w-auto mb-3" />
          <p className="text-xs text-slate-400">Gestão de Equipamentos</p>
        </div>

        {/* Card de Login */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 space-y-5"
        >
          <div>
            <h1 className="text-lg font-extrabold text-slate-900">Acessar o sistema</h1>
            <p className="text-xs text-slate-500 mt-0.5">Entre com seu e-mail e senha corporativos.</p>
          </div>

          {erro && (
            <div className="flex items-center gap-2 text-xs font-semibold text-[#D9332B] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {erro}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-bold text-slate-700">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus={!emailLembrado}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8] focus:border-[#2AA3D8]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="senha" className="text-xs font-bold text-slate-700">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="senha"
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete="current-password"
                required
                autoFocus={!!emailLembrado}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8] focus:border-[#2AA3D8]"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={lembrar}
              onChange={(e) => setLembrar(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 accent-[#2AA3D8] cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-600">Lembrar meus dados</span>
          </label>

          <button
            type="submit"
            disabled={entrando}
            className="w-full flex items-center justify-center gap-2 bg-[#2AA3D8] hover:bg-[#1c8fc2] disabled:opacity-60 text-white font-bold text-sm py-2.5 rounded-lg shadow-md transition-colors"
          >
            {entrando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {entrando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          Desenvolvido por <span className="font-black text-slate-300 tracking-wider">LYNUS TECNOLOGIA</span>
        </p>
      </div>
    </div>
  );
};
