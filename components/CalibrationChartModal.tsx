import React, { useRef, useEffect } from 'react';
import { EllipseData, CalibrationResult } from '../types';
import { X, LineChart } from 'lucide-react';

interface CalibrationChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  ellipses: EllipseData[];
  calibration: CalibrationResult | null;
}

export const CalibrationChartModal: React.FC<CalibrationChartModalProps> = ({ 
  isOpen, 
  onClose, 
  ellipses,
  calibration 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen || !canvasRef.current || ellipses.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Data prep
    const dataPoints = ellipses.map(e => {
        const cosT = Math.cos(e.angle);
        const sinT = Math.sin(e.angle);
        const w = 2 * Math.sqrt(Math.pow(e.rx * cosT, 2) + Math.pow(e.ry * sinT, 2));
        const h = 2 * Math.sqrt(Math.pow(e.rx * sinT, 2) + Math.pow(e.ry * cosT, 2));
        return { 
            x: e.cx, 
            y: w / h,
            status: e.status
        };
    });

    // Find ranges
    const minX = Math.min(...dataPoints.map(p => p.x)) * 0.9;
    const maxX = Math.max(...dataPoints.map(p => p.x)) * 1.1;
    const minY = Math.min(...dataPoints.map(p => p.y)) * 0.8;
    const maxY = Math.max(...dataPoints.map(p => p.y)) * 1.2;

    const W = canvas.width;
    const H = canvas.height;
    const pad = 60;
    
    // Scale helpers
    const scaleX = (val: number) => pad + ((val - minX) / (maxX - minX)) * (W - 2 * pad);
    const scaleY = (val: number) => H - pad - ((val - minY) / (maxY - minY)) * (H - 2 * pad);

    // Clear
    ctx.fillStyle = '#0f172a'; // slate-950
    ctx.fillRect(0, 0, W, H);

    // Draw Grid
    ctx.strokeStyle = '#334155'; // slate-700
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    // Y-Axis
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, H - pad);
    ctx.stroke();

    // X-Axis
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();

    // Draw Labels
    ctx.fillStyle = '#94a3b8'; // slate-400
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Position X (px)', W / 2, H - 20);
    
    ctx.save();
    ctx.translate(20, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Aspect Ratio', 0, 0);
    ctx.restore();

    // Draw Ticks
    ctx.textAlign = 'center';
    ctx.fillText(minX.toFixed(0), pad, H - pad + 20);
    ctx.fillText(maxX.toFixed(0), W - pad, H - pad + 20);
    
    ctx.textAlign = 'right';
    ctx.fillText(maxY.toFixed(2), pad - 10, pad + 10);
    ctx.fillText(minY.toFixed(2), pad - 10, H - pad);

    // Draw Line
    if (calibration && calibration.isValid) {
        ctx.strokeStyle = '#3b82f6'; // blue-500
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const x1 = minX;
        const y1 = calibration.slope * x1 + calibration.intercept;
        const x2 = maxX;
        const y2 = calibration.slope * x2 + calibration.intercept;

        ctx.moveTo(scaleX(x1), scaleY(y1));
        ctx.lineTo(scaleX(x2), scaleY(y2));
        ctx.stroke();
    }

    // Draw Points
    dataPoints.forEach(p => {
        const px = scaleX(p.x);
        const py = scaleY(p.y);
        
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        
        if (p.status === 'outlier') {
            ctx.fillStyle = '#ef4444'; // red
            ctx.strokeStyle = '#7f1d1d';
        } else {
            ctx.fillStyle = '#10b981'; // green
            ctx.strokeStyle = '#064e3b';
        }
        
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
    });

  }, [isOpen, ellipses, calibration]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50 rounded-t-xl">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
             <LineChart className="w-5 h-5 text-blue-400" />
             Calibration Fit (Aspect Ratio vs Position)
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 bg-slate-950 flex justify-center">
            <canvas 
                ref={canvasRef} 
                width={800} 
                height={400} 
                className="w-full h-auto bg-slate-950 rounded border border-slate-800"
            />
        </div>
        <div className="p-4 border-t border-slate-700 bg-slate-800/30 text-xs text-slate-400 flex gap-4 justify-center">
             <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-green-500"></div>
                 <span>Active Inliers</span>
             </div>
             <div className="flex items-center gap-2">
                 <div className="w-3 h-3 rounded-full bg-red-500"></div>
                 <span>Outliers</span>
             </div>
             <div className="flex items-center gap-2">
                 <div className="w-8 h-0.5 bg-blue-500"></div>
                 <span>Fitted Model</span>
             </div>
        </div>
      </div>
    </div>
  );
};