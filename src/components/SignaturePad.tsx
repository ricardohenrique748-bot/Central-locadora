/**
 * Central Locação - Componente de Assinatura Digital em Tela (Touch / Mouse)
 * Usado para Romaneio de Saída e Comprovante de Devolução
 */

import React, { useRef, useState, useEffect } from 'react';
import { Eraser, Check, PenTool } from 'lucide-react';

interface SignaturePadProps {
  signerName: string;
  onSave: (dataUrl: string) => void;
  initialSignature?: string;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({
  signerName,
  onSave,
  initialSignature,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajustar resolução para nitidez
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = initialSignature;
    }
  }, [initialSignature]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      setIsDrawing(false);
      onSave(canvasRef.current.toDataURL('image/png'));
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSave('');
  };

  return (
    <div className="border border-slate-300 rounded-lg p-3 bg-white shadow-xs">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100 text-xs text-slate-600">
        <span className="flex items-center gap-1.5 font-medium text-slate-800">
          <PenTool className="w-3.5 h-3.5 text-[#2AA3D8]" /> Assinar na tela ({signerName || 'Recebedor'})
        </span>
        <button
          type="button"
          onClick={clearCanvas}
          className="flex items-center gap-1 text-slate-500 hover:text-red-600 transition-colors py-1 px-2 rounded hover:bg-slate-100 text-xs"
        >
          <Eraser className="w-3 h-3" /> Limpar
        </button>
      </div>

      <div className="relative w-full h-32 bg-slate-50 rounded border border-dashed border-slate-300 touch-none">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-xs select-none">
            Desenhe a assinatura com o dedo ou mouse aqui
          </div>
        )}
      </div>

      <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
        <span>Carimbo digital com data/hora e IP vinculados ao checklist</span>
        {hasSignature && (
          <span className="text-emerald-600 flex items-center gap-1 font-semibold">
            <Check className="w-3 h-3" /> Assinado
          </span>
        )}
      </div>
    </div>
  );
};
