import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CalibrationResult, CorrectionMetrics, EllipseData } from '../types';
import { generateSectorImage } from '../utils/calibration';
import { analyzeTransformedSpots } from '../utils/imageProcessing';
import { X, Loader2, Download, ShieldCheck, Target, Ruler, Activity, CheckCircle2, TrendingDown, Eye, Sliders, List, FileJson, FileText } from 'lucide-react';

interface SectorViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  calibration: CalibrationResult | null;
  mode: 'dark' | 'light';
}

export const SectorViewModal: React.FC<SectorViewModalProps> = ({ 
  isOpen, 
  onClose, 
  imageSrc, 
  calibration,
  mode
}) => {
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [metrics, setMetrics] = useState<CorrectionMetrics | null>(null);
  const [detectedEllipses, setDetectedEllipses] = useState<EllipseData[]>([]);
  const [fitLine, setFitLine] = useState<{x1:number, y1:number, x2:number, y2:number} | undefined>(undefined);
  
  const [detectionThreshold, setDetectionThreshold] = useState(128);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showLine, setShowLine] = useState(true);
  const [activeTab, setActiveTab] = useState<'metrics' | 'data'>('metrics');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // 1. Generate Image on open
  useEffect(() => {
    if (isOpen && imageSrc && calibration && calibration.isValid) {
      setLoading(true);
      setError(null);
      setMetrics(null);
      
      generateSectorImage(imageSrc, calibration)
        .then(url => {
          setResultSrc(url);
          const img = new Image();
          img.src = url;
          img.onload = () => {
              imageRef.current = img;
              setLoading(false);
              // Initial analysis
              runAnalysis(img, 128, true); 
          };
        })
        .catch(err => {
          console.error(err);
          setError("Failed to generate sector image. Please check calibration data.");
          setLoading(false);
        });
    } else {
        setResultSrc(null);
    }
  }, [isOpen, imageSrc, calibration]);

  // 2. Analysis Function
  const runAnalysis = (img: HTMLImageElement, threshold: number, useAuto: boolean = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const res = analyzeTransformedSpots(ctx, mode as any, useAuto ? undefined : threshold);
      setMetrics(res.metrics);
      setDetectedEllipses(res.ellipses);
      setFitLine(res.bestFitLine);
  };

  // 3. Handle Slider Change
  const handleThresholdChange = (val: number) => {
      setDetectionThreshold(val);
      if (imageRef.current) {
          runAnalysis(imageRef.current, val, false);
      }
  };

  // 4. Render Canvas (Image + Overlay)
  useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !imageRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = imageRef.current;
      // Resize canvas to fit container or image? 
      // For pixel precision, canvas should match image size, displayed with CSS scaling.
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw Image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Draw Overlay
      if (showOverlay) {
          detectedEllipses.forEach((e, idx) => {
              ctx.beginPath();
              ctx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle, 0, Math.PI * 2);
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#10b981'; // emerald-500
              ctx.stroke();

              // Draw Crosshair
              ctx.beginPath();
              ctx.moveTo(e.cx - 2, e.cy); ctx.lineTo(e.cx + 2, e.cy);
              ctx.moveTo(e.cx, e.cy - 2); ctx.lineTo(e.cx, e.cy + 2);
              ctx.strokeStyle = '#facc15'; // yellow
              ctx.stroke();

              // Draw ID
              ctx.fillStyle = '#fff';
              ctx.font = '10px sans-serif';
              ctx.fillText(`#${idx+1}`, e.cx + e.rx, e.cy);
          });
      }

      // Draw Line
      if (showLine && fitLine) {
          ctx.beginPath();
          ctx.moveTo(fitLine.x1, fitLine.y1);
          ctx.lineTo(fitLine.x2, fitLine.y2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; // red-500
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
      }

  }, [detectedEllipses, fitLine, showOverlay, showLine, resultSrc]);

  const handleExportPoints = (format: 'json' | 'csv') => {
      if (detectedEllipses.length === 0) return;
      
      let content = '';
      let filename = 'corrected_points.' + format;
      let type = '';

      if (format === 'json') {
          content = JSON.stringify(detectedEllipses.map(e => ({
              id: e.id, x: e.cx, y: e.cy, width: e.rx*2, height: e.ry*2
          })), null, 2);
          type = 'application/json';
      } else {
          content = "ID,X,Y,Width,Height\n" + detectedEllipses.map((e, idx) => 
            `${idx+1},${e.cx.toFixed(3)},${e.cy.toFixed(3)},${(e.rx*2).toFixed(3)},${(e.ry*2).toFixed(3)}`
          ).join('\n');
          type = 'text/csv';
      }

      const blob = new Blob([content], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const handleSaveImage = () => {
    if (resultSrc) {
        const a = document.createElement('a');
        a.href = resultSrc;
        a.download = 'sector_corrected_image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <div className="p-4 bg-slate-800 border-b border-slate-700 z-10 flex justify-between items-center">
            <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    Correction Evaluation Lab
                </h2>
                <p className="text-sm text-slate-400">
                   Evaluate geometry and extract coordinates from corrected image.
                </p>
            </div>
            <button 
                onClick={onClose} 
                className="p-2 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition"
            >
                <X className="w-6 h-6" />
            </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            
            {/* Interactive Canvas Area */}
            <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative border-r border-slate-800">
                {/* Toolbar */}
                <div className="absolute top-4 left-4 z-20 flex gap-2">
                    <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg flex gap-1 shadow-lg">
                        <button 
                            onClick={() => setShowOverlay(!showOverlay)}
                            className={`p-2 rounded transition ${showOverlay ? 'bg-emerald-900/50 text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                            title="Toggle Circles"
                        >
                            <Target className="w-4 h-4" />
                        </button>
                         <button 
                            onClick={() => setShowLine(!showLine)}
                            className={`p-2 rounded transition ${showLine ? 'bg-red-900/50 text-red-400' : 'text-slate-400 hover:text-white'}`}
                            title="Toggle Fit Line"
                        >
                            <Activity className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Loading / Canvas */}
                <div className="flex-1 overflow-auto flex items-center justify-center custom-scrollbar p-8 relative">
                    {loading && (
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                            <span>Processing...</span>
                        </div>
                    )}
                    {error && (
                        <div className="text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900/50">
                            {error}
                        </div>
                    )}
                    <canvas 
                        ref={canvasRef}
                        className="max-w-none shadow-2xl border border-slate-800"
                        style={{ display: (!loading && !error && resultSrc) ? 'block' : 'none' }}
                    />
                </div>
            </div>

            {/* Sidebar Controls & Data */}
            <div className="w-full md:w-96 bg-slate-900 flex flex-col border-l border-slate-800">
                
                {/* Tabs */}
                <div className="flex border-b border-slate-800">
                    <button 
                        onClick={() => setActiveTab('metrics')}
                        className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${activeTab === 'metrics' ? 'border-emerald-500 text-emerald-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                        <Activity className="w-4 h-4" />
                        Metrics & Tune
                    </button>
                    <button 
                         onClick={() => setActiveTab('data')}
                         className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${activeTab === 'data' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                        <List className="w-4 h-4" />
                        Coordinates
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    
                    {activeTab === 'metrics' && (
                        <div className="space-y-6">
                            {/* Threshold Control */}
                            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-3">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                                        <Sliders className="w-4 h-4 text-purple-400" />
                                        Detection Threshold
                                    </label>
                                    <span className="font-mono text-xs bg-slate-900 px-2 py-1 rounded text-purple-300">{detectionThreshold}</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="1" max="254" 
                                    value={detectionThreshold}
                                    onChange={(e) => handleThresholdChange(Number(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                />
                                <p className="text-[10px] text-slate-500">
                                    Adjust if spots are missed or noise is detected.
                                </p>
                            </div>

                            {/* Score Breakdown (Reused) */}
                            {metrics ? (
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                        <TrendingDown className="w-3 h-3" /> Score Components
                                    </h4>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50">
                                            <div className="text-[10px] text-slate-400 mb-1">Roundness</div>
                                            <div className={`text-lg font-bold ${metrics.scoreRoundness > 70 ? 'text-green-400' : 'text-orange-400'}`}>
                                                {metrics.scoreRoundness}
                                            </div>
                                        </div>
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50">
                                            <div className="text-[10px] text-slate-400 mb-1">Linearity</div>
                                            <div className={`text-lg font-bold ${metrics.scoreLinearity > 70 ? 'text-green-400' : 'text-orange-400'}`}>
                                                {metrics.scoreLinearity}
                                            </div>
                                        </div>
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50">
                                            <div className="text-[10px] text-slate-400 mb-1">Consistency</div>
                                            <div className={`text-lg font-bold ${metrics.scoreConsistency > 70 ? 'text-green-400' : 'text-orange-400'}`}>
                                                {metrics.scoreConsistency}
                                            </div>
                                        </div>
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50">
                                            <div className="text-[10px] text-slate-400 mb-1">Avg Radius</div>
                                            <div className="text-lg font-bold text-slate-200">
                                                {metrics.radiusMean.toFixed(1)} <span className="text-[10px] text-slate-500">px</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="text-[10px] text-slate-500 bg-slate-950 p-3 rounded border border-slate-800">
                                        Linearity Err: {(metrics.linearityRelative*100).toFixed(2)}% <br/>
                                        Roundness Err: {((1-metrics.meanRoundness)*100).toFixed(2)}%
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-10 text-slate-500">No Metrics</div>
                            )}

                            <button
                                onClick={handleSaveImage}
                                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-lg font-medium transition border border-slate-700"
                            >
                                <Download className="w-4 h-4" />
                                Save Corrected Image
                            </button>
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <div className="space-y-4">
                             <div className="flex gap-2">
                                <button 
                                    onClick={() => handleExportPoints('csv')}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 py-2 rounded text-xs transition"
                                >
                                    <FileText className="w-3.5 h-3.5 text-green-400" /> Export CSV
                                </button>
                                <button 
                                    onClick={() => handleExportPoints('json')}
                                    className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 py-2 rounded text-xs transition"
                                >
                                    <FileJson className="w-3.5 h-3.5 text-orange-400" /> Export JSON
                                </button>
                             </div>

                             <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
                                 <table className="w-full text-left text-xs">
                                     <thead className="bg-slate-900 text-slate-400">
                                         <tr>
                                             <th className="p-2 font-medium">#</th>
                                             <th className="p-2 font-medium">X</th>
                                             <th className="p-2 font-medium">Y</th>
                                             <th className="p-2 font-medium">Roundness</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-800">
                                         {detectedEllipses.map((e, idx) => {
                                             const r = Math.min(e.rx,e.ry)/Math.max(e.rx,e.ry);
                                             return (
                                                <tr key={idx} className="hover:bg-slate-900/50 transition">
                                                    <td className="p-2 font-mono text-slate-500">{idx+1}</td>
                                                    <td className="p-2 font-mono text-slate-300">{e.cx.toFixed(1)}</td>
                                                    <td className="p-2 font-mono text-slate-300">{e.cy.toFixed(1)}</td>
                                                    <td className={`p-2 font-mono font-bold ${r > 0.9 ? 'text-green-400' : 'text-yellow-500'}`}>
                                                        {r.toFixed(2)}
                                                    </td>
                                                </tr>
                                             );
                                         })}
                                         {detectedEllipses.length === 0 && (
                                             <tr><td colSpan={4} className="p-4 text-center text-slate-600">No spots found</td></tr>
                                         )}
                                     </tbody>
                                 </table>
                             </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};