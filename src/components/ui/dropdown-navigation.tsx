/**
 * Menu de navegação com submenus animados (hover no desktop, toque/clique no celular, Esc fecha).
 * Baseado no modelo "dropdown-navigation", adaptado para a barra escura do sistema
 * e para navegação interna (onSelect) em vez de links.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';

export interface DropdownNavSubItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  badge?: number;
  alert?: boolean; // badge em vermelho (ex.: inadimplência)
}

export interface DropdownNavItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  badge?: number;
  alert?: boolean;
  subMenus?: { title: string; items: DropdownNavSubItem[] }[];
}

interface Props {
  navItems: DropdownNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

const Badge: React.FC<{ value: number; alert?: boolean; inverted?: boolean }> = ({ value, alert, inverted }) => (
  <span
    className={`ml-1 min-w-4 px-1.5 rounded-full text-[10px] font-bold leading-4 text-center ${
      alert ? 'bg-[#D9332B] text-white' : inverted ? 'bg-white text-[#2AA3D8]' : 'bg-slate-700 text-slate-200'
    }`}
  >
    {value}
  </span>
);

const ClampedDropdown: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState<number>(0);

  useEffect(() => {
    const adjust = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pad = 12;
      const vw = window.innerWidth;

      const currentLeft = rect.left - shiftX;
      const currentRight = rect.right - shiftX;

      let newShift = 0;
      if (currentRight > vw - pad) {
        newShift = vw - pad - currentRight;
      }
      if (currentLeft + newShift < pad) {
        newShift = pad - currentLeft;
      }

      setShiftX(newShift);
    };

    adjust();
    window.addEventListener('resize', adjust);
    return () => window.removeEventListener('resize', adjust);
  }, [shiftX]);

  return (
    <div
      ref={containerRef}
      style={shiftX !== 0 ? { transform: `translateX(${shiftX}px)` } : undefined}
      className="absolute top-full left-0 pt-2 z-50"
    >
      {children}
    </div>
  );
};

export function DropdownNavigation({ navItems, activeId, onSelect }: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLUListElement>(null);

  // Fecha ao tocar/clicar fora ou apertar Esc
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const select = (id: string) => {
    onSelect(id);
    setOpenMenu(null);
    setHovered(null);
  };

  return (
    <ul ref={rootRef} className="relative flex flex-wrap items-center gap-0.5">
      {navItems.map((navItem) => {
        const hasSub = !!navItem.subMenus?.length;
        const childIds = navItem.subMenus?.flatMap((s) => s.items.map((i) => i.id)) || [];
        const isActive = activeId === navItem.id || childIds.includes(activeId);
        const isOpen = openMenu === navItem.id;
        const Icon = navItem.icon;
        const subAlerts = navItem.subMenus?.flatMap((s) => s.items).filter((i) => i.alert && i.badge).reduce((a, i) => a + (i.badge || 0), 0) || 0;

        return (
          <li
            key={navItem.id}
            className="relative"
            // hover só em dispositivos com mouse; no toque o clique abre/fecha
            onMouseEnter={() => hasSub && window.matchMedia('(hover: hover)').matches && setOpenMenu(navItem.id)}
            onMouseLeave={() => window.matchMedia('(hover: hover)').matches && setOpenMenu(null)}
          >
            <button
              type="button"
              aria-haspopup={hasSub ? 'true' : undefined}
              aria-expanded={hasSub ? isOpen : undefined}
              aria-current={isActive && !hasSub ? 'page' : undefined}
              onClick={() => (hasSub ? setOpenMenu(isOpen ? null : navItem.id) : select(navItem.id))}
              onMouseEnter={() => setHovered(navItem.id)}
              onMouseLeave={() => setHovered(null)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap rounded-full transition-colors duration-300 group ${
                isActive ? 'text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isActive && <span className="absolute inset-0 rounded-full bg-[#2AA3D8] shadow-sm" aria-hidden />}
              {!isActive && (hovered === navItem.id || isOpen) && (
                <motion.span layoutId="nav-hover-bg" className="absolute inset-0 bg-white/10" style={{ borderRadius: 99 }} aria-hidden />
              )}
              <span className="relative flex items-center gap-1.5">
                {Icon && <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />}
                {navItem.label}
                {navItem.badge !== undefined && navItem.badge > 0 && <Badge value={navItem.badge} alert={navItem.alert} inverted={isActive} />}
                {subAlerts > 0 && <Badge value={subAlerts} alert />}
                {hasSub && <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />}
              </span>
            </button>

            <AnimatePresence>
              {isOpen && hasSub && (
                <ClampedDropdown>
                  <motion.div
                    layoutId="nav-menu"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white border border-slate-200 shadow-2xl p-4 w-max max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] overflow-y-auto"
                    style={{ borderRadius: 16 }}
                  >
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-9">
                      {navItem.subMenus!.map((sub) => (
                        <motion.div layout key={sub.title} className="min-w-0">
                          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">{sub.title}</h3>
                          <ul className="space-y-1">
                            {sub.items.map((item) => {
                              const ItemIcon = item.icon;
                              const current = activeId === item.id;
                              return (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    onClick={() => select(item.id)}
                                    aria-current={current ? 'page' : undefined}
                                    className={`w-full flex items-start gap-3 rounded-lg p-2 -mx-2 text-left group/item transition-colors ${current ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                                  >
                                    <span
                                      className={`flex items-center justify-center size-9 shrink-0 rounded-md border transition-colors duration-300 ${
                                        current ? 'border-[#2AA3D8] bg-[#2AA3D8] text-white' : 'border-slate-200 text-slate-700 group-hover/item:bg-[#1e3a5f] group-hover/item:border-[#1e3a5f] group-hover/item:text-white'
                                      }`}
                                    >
                                      <ItemIcon className="w-[18px] h-[18px]" />
                                    </span>
                                    <span className="leading-5 min-w-0">
                                      <span className="flex items-center text-sm font-semibold text-slate-900 sm:whitespace-nowrap">
                                        {item.label}
                                        {item.badge !== undefined && item.badge > 0 && <Badge value={item.badge} alert={item.alert} />}
                                      </span>
                                      <span className="block text-xs text-slate-500 group-hover/item:text-slate-700 transition-colors duration-300 sm:whitespace-nowrap">{item.description}</span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                </ClampedDropdown>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
