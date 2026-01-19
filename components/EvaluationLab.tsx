import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CalibrationResult, CorrectionMetrics, EllipseData, ROI } from '../types';
import { generateSectorImage } from '../utils/calibration';
import { analyzeTransformedSpots, extractEllipseFromROI, autoDetectEllipses } from '../utils/imageProcessing';
import { X, Loader2, Download, ShieldCheck, Target, Activity, TrendingDown, Sliders, List, FileJson, FileText, ArrowLeft, Maximize2, MoveHorizontal, CircleDashed, ZoomIn, ZoomOut, Maximize, Ruler, ScanLine, Hand, MousePointer2, Wand2, Trash2 } from 'lucide-react';

interface EvaluationLabProps {
  onBack: () => void;
  imageSrc: string | null;
  calibration: CalibrationResult | null;
  mode: 'dark' | 'light';
}

type InteractionMode = 'pan' | 'roi';

export const EvaluationLab: React.FC<EvaluationLabProps> = ({ 
  onBack, 
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
  
  const [rois, setRois] = useState<ROI[]>([]);
  const [activeRoiId, setActiveRoiId] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('pan');

  const [detectionThreshold, setDetectionThreshold] = useState(128);
  const [minRadius, setMinRadius] = useState(2);
  const [maxRadius, setMaxRadius] = useState(100);

  const [showOverlay, setShowOverlay] = useState(true); 
  const [showLinearity, setShowLinearity] = useState(true); 
  const [showSpacing, setShowSpacing] = useState(true); 
  const [activeTab, setActiveTab] = useState<'metrics' | 'data'>('metrics');

  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [drawingRoi, setDrawingRoi] = useState<{startPoint: {x:number, y:number}, currentId: number} | null>(null);

  // Initialize Evaluation Lab
  useEffect(() => {
    if (imageSrc && calibration && calibration.isValid) {
      setLoading(true); setError(null); setMetrics(null);
      generateSectorImage(imageSrc, calibration)
        .then(url => {
          setResultSrc(url);
          const img = new Image(); img.src = url;
          img.onload = () => {
              imageRef.current = img; setLoading(false);
              runAnalysis(img, []); handleFitToScreen(img);
          };
        })
        .catch(() => { setError("Failed to generate sector image."); setLoading(false); });
    } else { setError("Invalid calibration data."); setLoading(false); }
  }, [imageSrc, calibration]);

  // Core Extraction & Metric Calculation Logic (Matches Main App)
  const runAnalysis = (img: HTMLImageElement, currentRois: ROI[]) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);

      // Same Parameters as Main App
      const params = { threshold: detectionThreshold, minRadius, maxRadius };
      
      let finalEllipses: EllipseData[] = [];
      if (currentRois.length > 0) {
          // Process manual ROIs using precision fitting
          finalEllipses = currentRois.map(roi => extractEllipseFromROI(ctx, roi, mode, detectionThreshold));
          const res = analyzeTransformedSpots(ctx, mode, { ...params, inputEllipses: finalEllipses });
          setDetectedEllipses(finalEllipses);
          setMetrics(res.metrics); setFitLine(res.bestFitLine);
      } else {
          // Standard auto-detection for evaluation
          const res = analyzeTransformedSpots(ctx, mode, params);
          setMetrics(res.metrics); setDetectedEllipses(res.ellipses); setFitLine(res.bestFitLine);
      }
  };

  useEffect(() => { if (imageRef.current) runAnalysis(imageRef.current, rois); }, [detectionThreshold, minRadius, maxRadius, rois]);

  const getMousePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const handleFitToScreen = (img: HTMLImageElement = imageRef.current!) => {
      if (!containerRef.current || !img) return;
      const padding = 64;
      const fitScale = Math.min((containerRef.current.clientWidth - padding) / img.width, (containerRef.current.clientHeight - padding) / img.height, 1.0);
      setScale(fitScale);
  };

  const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 8.0));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.05));
  const handleWheel = (e: React.WheelEvent) => { if (e.ctrlKey) { e.preventDefault(); if (e.deltaY < 0) handleZoomIn(); else handleZoomOut(); } };

  const handleMouseDown = (e: React.MouseEvent) => {
      if (interactionMode === 'pan') return;
      const pos = getMousePos(e);
      // Select ROI?
      for (const roi of rois) {
          if (Math.sqrt(Math.pow(pos.x - roi.cx, 2) + Math.pow(pos.y - roi.cy, 2)) < roi.rx) { setActiveRoiId(roi.id); return; }
      }
      // Draw new ROI
      const newId = Date.now();
      setRois([...rois, { id: newId, cx: pos.x, cy: pos.y, rx: 5, ry: 5, rotation: 0 }]);
      setDrawingRoi({ startPoint: pos, currentId: newId }); setActiveRoiId(newId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (drawingRoi) {
          const pos = getMousePos(e);
          const r = Math.sqrt(Math.pow(pos.x - drawingRoi.startPoint.x, 2) + Math.pow(pos.y - drawingRoi.startPoint.y, 2));
          setRois(prev => prev.map(roi => roi.id === drawingRoi.currentId ? { ...roi, rx: r, ry: r } : roi));
      }
  };

  const handleAutoDetectLabRois = () => {
      if (!imageRef.current) return;
      const canvas = document.createElement('canvas'); canvas.width = imageRef.current.width; canvas.height = imageRef.current.height;
      const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.drawImage(imageRef.current, 0, 0);
      // Auto-detect and populate ROIs
      const { rois: detectedRois } = autoDetectEllipses(ctx, mode, detectionThreshold, minRadius, maxRadius, false);
      setRois(detectedRois);
  };

  const handleExportPoints = (format: 'json' | 'csv') => {
      if (!detectedEllipses.length) return;
      const content = format === 'json' ? JSON.stringify(detectedEllipses.map(e => ({ id: e.id, x: e.cx, y: e.cy, width: e.rx*2, height: e.ry*2 })), null, 2) : "ID,X,Y,Width,Height\n" + detectedEllipses.map((e, idx) => `${idx+1},${e.cx.toFixed(3)},${e.cy.toFixed(3)},${(e.rx*2).toFixed(3)},${(e.ry*2).toFixed(3)}`).join('\n');
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evaluation_points.${format}`; a.click();
  };

  const handleSaveImage = () => { 
      if (resultSrc) { 
          const a = document.createElement('a'); a.href = resultSrc; a.download = 'evaluation_map.png'; a.click(); 
      } 
  };

  // Delete Shortcut
  useEffect(() => {
      const handleKey = (e: KeyboardEvent) => { 
          if (activeRoiId && (e.key === 'Delete' || e.key === 'Backspace')) setRois(prev => prev.filter(r => r.id !== activeRoiId)); 
      };
      window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [activeRoiId]);

  // Main Drawing Loop
  useEffect(() => {
      const canvas = canvasRef.current; if (!canvas || !imageRef.current) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const img = imageRef.current; canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Render measurements
      if (showSpacing && detectedEllipses.length > 1 && fitLine) {
          ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const dx = fitLine.x2 - fitLine.x1, dy = fitLine.y2 - fitLine.y1, len = Math.sqrt(dx*dx + dy*dy) || 1;
          const sorted = [...detectedEllipses].map(e => ({ ...e, t: e.cx * (dx/len) + e.cy * (dy/len) })).sort((a, b) => a.t - b.t);
          for (let i = 0; i < sorted.length - 1; i++) {
              const p1 = sorted[i], p2 = sorted[i+1], dist = Math.sqrt(Math.pow(p2.cx - p1.cx, 2) + Math.pow(p2.cy - p1.cy, 2));
              if (dist < 400) {
                  ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
                  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'; ctx.fillRect((p1.cx+p2.cx)/2 - 15, (p1.cy+p2.cy)/2 - 6, 30, 12);
                  ctx.fillStyle = '#60a5fa'; ctx.fillText(dist.toFixed(1), (p1.cx+p2.cx)/2, (p1.cy+p2.cy)/2);
              }
          }
      }
      // Render ROIs
      rois.forEach(roi => {
          ctx.beginPath(); ctx.arc(roi.cx, roi.cy, roi.rx, 0, Math.PI * 2); ctx.lineWidth = 1;
          ctx.strokeStyle = roi.id === activeRoiId ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
      });
      // Render Grid Linearity
      if (showLinearity && fitLine) {
          const ext = Math.max(img.width, img.height); const dx = fitLine.x2 - fitLine.x1, dy = fitLine.y2 - fitLine.y1, len = Math.sqrt(dx*dx + dy*dy) || 1;
          ctx.beginPath(); ctx.moveTo(fitLine.x1 - (dx/len)*ext, fitLine.y1 - (dy/len)*ext); ctx.lineTo(fitLine.x1 + (dx/len)*ext, fitLine.y1 + (dy/len)*ext);
          ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'; ctx.setLineDash([10, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
      // Render Precision Fitted Ellipses
      if (showOverlay) {
          detectedEllipses.forEach(e => {
              ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#10b981'; ctx.stroke();
              ctx.beginPath(); ctx.moveTo(e.cx-3, e.cy); ctx.lineTo(e.cx+3, e.cy); ctx.moveTo(e.cx, e.cy-3); ctx.lineTo(e.cx, e.cy+3); ctx.strokeStyle = '#facc15'; ctx.stroke();
          });
      }
  }, [detectedEllipses, rois, activeRoiId, fitLine, showOverlay, showLinearity, showSpacing, scale]);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-slate-900 border-b border-slate-800 flex justify-between items-center px-4 shrink-0 z-40">
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition"><ArrowLeft className="w-4 h-4" /> Back</button>
                <div className="h-6 w-px bg-slate-800"></div>
                <h1 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Evaluation Lab</h1>
            </div>
            {metrics && <div className="px-3 py-1 bg-emerald-950/30 border border-emerald-900/50 rounded-full text-xs text-emerald-400 font-bold shadow-lg">Score: {metrics.finalScore}/100</div>}
        </div>

        <div className="flex-1 flex overflow-hidden">
            {/* Toolbar */}
            <div className="w-14 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4 gap-4 z-30">
                <button onClick={() => setInteractionMode('pan')} className={`p-3 rounded-xl transition ${interactionMode === 'pan' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`} title="Pan (H)"><Hand className="w-5 h-5" /></button>
                <button onClick={() => setInteractionMode('roi')} className={`p-3 rounded-xl transition ${interactionMode === 'roi' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`} title="Draw ROI (R)"><Target className="w-5 h-5" /></button>
                <div className="w-8 h-px bg-slate-800"></div>
                <button onClick={handleAutoDetectLabRois} className="p-3 rounded-xl text-emerald-400 hover:bg-emerald-950/30 transition" title="Auto Detect"><Wand2 className="w-5 h-5" /></button>
                <button disabled={!activeRoiId} onClick={() => activeRoiId && setRois(r => r.filter(x => x.id !== activeRoiId))} className="p-3 rounded-xl text-red-400 hover:bg-red-950/30 transition disabled:opacity-20"><Trash2 className="w-5 h-5" /></button>
            </div>

            {/* Canvas Viewport */}
            <div className="flex-1 flex flex-col bg-black overflow-hidden relative">
                <div className="absolute top-4 left-4 z-20 flex gap-2">
                    <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg flex gap-1 shadow-2xl">
                        <button onClick={() => setShowOverlay(!showOverlay)} className={`p-2 rounded transition ${showOverlay ? 'text-emerald-400 bg-emerald-900/30' : 'text-slate-400'}`}><CircleDashed className="w-4 h-4" /></button>
                        <button onClick={() => setShowLinearity(!showLinearity)} className={`p-2 rounded transition ${showLinearity ? 'text-red-400 bg-red-900/30' : 'text-slate-400'}`}><ScanLine className="w-4 h-4" /></button>
                        <button onClick={() => setShowSpacing(!showSpacing)} className={`p-2 rounded transition ${showSpacing ? 'text-blue-400 bg-blue-900/30' : 'text-slate-400'}`}><Ruler className="w-4 h-4" /></button>
                    </div>
                </div>
                <div className="absolute bottom-4 left-4 z-20 flex items-center bg-slate-900/90 border border-slate-700 rounded-lg p-1 shadow-2xl">
                    <button onClick={handleZoomOut} className="p-2 text-slate-400 hover:text-white transition"><ZoomOut className="w-4 h-4" /></button>
                    <span className="text-[10px] font-mono w-12 text-center text-slate-300">{Math.round(scale * 100)}%</span>
                    <button onClick={handleZoomIn} className="p-2 text-slate-400 hover:text-white transition"><ZoomIn className="w-4 h-4" /></button>
                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button onClick={() => handleFitToScreen()} className="p-2 text-blue-400 hover:text-white transition"><Maximize className="w-4 h-4" /></button>
                </div>
                {/* Scrollable Container with Centered Content */}
                <div ref={containerRef} className="flex-1 overflow-auto custom-scrollbar flex bg-slate-950" onWheel={handleWheel}>
                    <div className="m-auto min-w-max min-h-max relative">
                        {loading && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-30 bg-slate-950/80"><Loader2 className="w-10 h-10 animate-spin text-blue-500" /><span className="text-slate-400">Analyzing...</span></div>}
                        <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => setDrawingRoi(null)} className={`shadow-2xl transition-transform duration-75 origin-top-left ${interactionMode === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`} style={{ display: resultSrc ? 'block' : 'none', width: imageRef.current ? imageRef.current.width * scale : 'auto', height: imageRef.current ? imageRef.current.height * scale : 'auto' }} />
                    </div>
                </div>
            </div>

            {/* Sidebar Controls */}
            <div className="w-96 bg-slate-900 flex flex-col border-l border-slate-800 shrink-0 z-30">
                <div className="flex border-b border-slate-800">
                    <button onClick={() => setActiveTab('metrics')} className={`flex-1 py-4 text-sm font-medium transition ${activeTab === 'metrics' ? 'border-b-2 border-emerald-500 text-emerald-400 bg-slate-800/30' : 'text-slate-400 hover:text-slate-200'}`}>Metrics</button>
                    <button onClick={() => setActiveTab('data')} className={`flex-1 py-4 text-sm font-medium transition ${activeTab === 'data' ? 'border-b-2 border-blue-500 text-blue-400 bg-slate-800/30' : 'text-slate-400 hover:text-slate-200'}`}>Data List</button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    {activeTab === 'metrics' && <div className="space-y-8">
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Global Tuning</h3>
                            <div className="space-y-2">
                                <div className="flex justify-between text-[11px] text-slate-400"><span>Detection Threshold</span><span className="font-mono text-emerald-400">{detectionThreshold}</span></div>
                                <input type="range" min="1" max="254" value={detectionThreshold} onChange={(e) => setDetectionThreshold(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                            </div>
                        </div>
                        {metrics && <div className="space-y-6">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Geometric Metrics</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50"><div className="text-[10px] text-slate-500 mb-1">Mean Roundness</div><div className="text-xl font-bold">{metrics.meanRoundness.toFixed(3)}</div></div>
                                <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50"><div className="text-[10px] text-slate-500 mb-1">Linearity RMS</div><div className="text-xl font-bold">{metrics.linearityRMS.toFixed(2)}px</div></div>
                            </div>
                            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
                                <div className="flex justify-between items-center"><span className="text-xs text-slate-400 flex items-center gap-2"><MoveHorizontal className="w-3 h-3" /> Average Spacing</span><span className="font-mono text-sm">{metrics.spacingMean.toFixed(2)}px</span></div>
                                <div className="flex justify-between items-center"><span className="text-xs text-slate-400">Spacing CV</span><span className={`font-mono text-sm ${metrics.spacingCV < 0.05 ? 'text-emerald-400' : 'text-yellow-500'}`}>{(metrics.spacingCV * 100).toFixed(1)}%</span></div>
                            </div>
                        </div>}
                        <button onClick={handleSaveImage} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 py-3 rounded-xl border border-slate-700 transition font-bold shadow-xl"><