import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CalibrationResult, CorrectionMetrics, EllipseData, ROI } from '../types';
import { generateSectorImage } from '../utils/calibration';
import { analyzeTransformedSpots, extractEllipseFromROI, autoDetectEllipses } from '../utils/imageProcessing';
import { X, Loader2, Download, ShieldCheck, Target, Activity, TrendingDown, Sliders, List, FileJson, FileText, ArrowLeft, Maximize2, MoveHorizontal, CircleDashed, ZoomIn, ZoomOut, Maximize, Ruler, ScanLine, Hand, MousePointer2, Wand2, Trash2, Play, Search, CheckCircle2, MoveDiagonal, Compass } from 'lucide-react';

interface EvaluationLabProps {
  onBack: () => void;
  imageSrc: string | null;
  calibration: CalibrationResult | null;
  mode: 'dark' | 'light';
}

type InteractionMode = 'pan' | 'roi' | 'guide';

export const EvaluationLab: React.FC<EvaluationLabProps> = ({ 
  onBack, 
  imageSrc, 
  calibration,
  mode
}) => {
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [metrics, setMetrics] = useState<CorrectionMetrics | null>(null);
  const [detectedEllipses, setDetectedEllipses] = useState<EllipseData[]>([]);
  const [fitLine, setFitLine] = useState<{x1:number, y1:number, x2:number, y2:number} | undefined>(undefined);
  const [gridLines, setGridLines] = useState<{rows: any[], cols: any[]} | undefined>(undefined);
  
  const [rois, setRois] = useState<ROI[]>([]);
  const [activeRoiId, setActiveRoiId] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('pan');

  // Manual Grid Basis State (3-point)
  const [gridSelectionStep, setGridSelectionStep] = useState<0 | 1 | 2>(0); 
  const [gridBasisIds, setGridBasisIds] = useState<{ origin?: number, x?: number, y?: number }>({});
  const [hoveredEllipseId, setHoveredEllipseId] = useState<number | null>(null);
  
  const [detectionThreshold, setDetectionThreshold] = useState(128);
  const [minRadius, setMinRadius] = useState(10);
  const [maxRadius, setMaxRadius] = useState(200);

  const [showOverlay, setShowOverlay] = useState(true); 
  const [showLinearity, setShowLinearity] = useState(true); 
  const [showSpacing, setShowSpacing] = useState(true); 
  const [activeTab, setActiveTab] = useState<'metrics' | 'data'>('metrics');

  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [drawingRoi, setDrawingRoi] = useState<{startPoint: {x:number, y:number}, currentId: number} | null>(null);

  // 1. Initialize Image
  useEffect(() => {
    if (imageSrc && calibration && calibration.isValid) {
      setLoading(true); setError(null); setMetrics(null);
      generateSectorImage(imageSrc, calibration)
        .then(url => {
          setResultSrc(url);
          const img = new Image(); img.src = url;
          img.onload = () => {
              imageRef.current = img; setLoading(false);
              handleFitToScreen(img);
          };
        })
        .catch(() => { setError("Failed to generate sector image."); setLoading(false); });
    } else { setError("Invalid calibration data."); setLoading(false); }
  }, [imageSrc, calibration]);

  const getContext = () => {
      if (!imageRef.current) return null;
      const canvas = document.createElement('canvas');
      canvas.width = imageRef.current.width;
      canvas.height = imageRef.current.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) ctx.drawImage(imageRef.current, 0, 0);
      return ctx;
  };

  // STEP 1: Detection
  const runDetection = useCallback((currentRois: ROI[]) => {
      const ctx = getContext();
      if (!ctx) return;

      let newEllipses: EllipseData[] = [];
      if (currentRois.length > 0) {
          newEllipses = currentRois.map(roi => extractEllipseFromROI(ctx, roi, mode, detectionThreshold));
          newEllipses = newEllipses.filter(e => e.rx >= minRadius && e.rx <= maxRadius && e.ry >= minRadius && e.ry <= maxRadius);
      } else {
          const res = autoDetectEllipses(ctx, mode, detectionThreshold, minRadius, maxRadius, false);
          newEllipses = res.ellipses;
      }
      
      setDetectedEllipses(newEllipses);
      // Reset grid analysis only if no valid basis exists
      if (!gridBasisIds.origin || !gridBasisIds.x || !gridBasisIds.y) {
          setMetrics(null);
          setGridLines(undefined);
          setFitLine(undefined);
      }
  }, [mode, detectionThreshold, minRadius, maxRadius, gridBasisIds]);

  useEffect(() => {
      if (rois.length > 0) runDetection(rois);
  }, [rois, runDetection]);

  // STEP 2: Analysis (Slow)
  const runGridAnalysis = () => {
      if (detectedEllipses.length < 2) return;
      setAnalyzing(true);
      
      setTimeout(() => {
          const ctx = getContext();
          if (ctx) {
              // Resolve basis IDs to objects
              let gridBasis = undefined;
              if (gridBasisIds.origin && gridBasisIds.x && gridBasisIds.y) {
                  const origin = detectedEllipses.find(e => e.id === gridBasisIds.origin);
                  const xRef = detectedEllipses.find(e => e.id === gridBasisIds.x);
                  const yRef = detectedEllipses.find(e => e.id === gridBasisIds.y);
                  if (origin && xRef && yRef) {
                      gridBasis = { origin, xRef, yRef };
                  }
              }

              const res = analyzeTransformedSpots(ctx, mode, { 
                  threshold: detectionThreshold, 
                  minRadius, 
                  maxRadius,
                  inputEllipses: detectedEllipses,
                  gridBasis: gridBasis
              });
              setMetrics(res.metrics);
              setGridLines(res.grid);
              setFitLine(res.bestFitLine);
              setDetectedEllipses(res.ellipses); 
          }
          setAnalyzing(false);
      }, 50);
  };

  // 3. Zoom & Mouse Management
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

  // 4. Drawing & Interaction Logic
  const handleMouseDown = (e: React.MouseEvent) => {
      const pos = getMousePos(e);

      // --- GUIDE MODE (3-Step) ---
      if (interactionMode === 'guide') {
          // Use hovered ellipse if available for precision
          if (hoveredEllipseId) {
              const id = hoveredEllipseId;
              if (gridSelectionStep === 0) {
                  setGridBasisIds({ origin: id });
                  setGridSelectionStep(1);
              } else if (gridSelectionStep === 1) {
                  setGridBasisIds(prev => ({ ...prev, x: id }));
                  setGridSelectionStep(2);
              } else if (gridSelectionStep === 2) {
                  setGridBasisIds(prev => ({ ...prev, y: id }));
                  setGridSelectionStep(0);
                  setInteractionMode('pan'); // Finish
                  // Automatically trigger calculation when full basis is defined? 
                  // User asked for "Click Calculate Metrics", so we just set state.
              }
          }
          return;
      }

      // --- ROI MODE ---
      if (interactionMode === 'roi') {
          for (const roi of rois) {
              if (Math.sqrt(Math.pow(pos.x - roi.cx, 2) + Math.pow(pos.y - roi.cy, 2)) < roi.rx) { setActiveRoiId(roi.id); return; }
          }
          const newId = Date.now();
          setRois([...rois, { id: newId, cx: pos.x, cy: pos.y, rx: 2, ry: 2, rotation: 0 }]);
          setDrawingRoi({ startPoint: pos, currentId: newId }); setActiveRoiId(newId);
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      const pos = getMousePos(e);
      
      // Update Hover in Guide Mode
      if (interactionMode === 'guide') {
          let bestEll: EllipseData | null = null;
          let minD = Infinity;
          detectedEllipses.forEach(ell => {
              const d = Math.sqrt((ell.cx - pos.x)**2 + (ell.cy - pos.y)**2);
              const limit = Math.max(ell.rx, ell.ry) * 2; // Snap radius
              if (d < limit && d < minD) {
                  minD = d;
                  bestEll = ell;
              }
          });
          setHoveredEllipseId(bestEll ? (bestEll as EllipseData).id : null);
      } else {
          setHoveredEllipseId(null);
      }

      if (drawingRoi) {
          const r = Math.sqrt(Math.pow(pos.x - drawingRoi.startPoint.x, 2) + Math.pow(pos.y - drawingRoi.startPoint.y, 2));
          setRois(prev => prev.map(roi => roi.id === drawingRoi.currentId ? { ...roi, rx: r, ry: r } : roi));
      }
  };

  const handleAutoDetectLabRois = () => {
      const ctx = getContext();
      if (!ctx) return;
      const { rois: detectedRois } = autoDetectEllipses(ctx, mode, detectionThreshold, minRadius, maxRadius, false);
      setRois(detectedRois);
  };

  const handleExportPoints = (format: 'json' | 'csv') => {
      if (!detectedEllipses.length) return;
      const content = format === 'json' ? JSON.stringify(detectedEllipses.map(e => ({ id: e.id, x: e.cx, y: e.cy, width: e.rx*2, height: e.ry*2 })), null, 2) : "ID,X,Y,Width,Height\n" + detectedEllipses.map((e, idx) => `${idx+1},${e.cx.toFixed(3)},${e.cy.toFixed(3)},${(e.rx*2).toFixed(3)},${(e.ry*2).toFixed(3)}`).join('\n');
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evaluation_points.${format}`; a.click();
  };

  const handleSaveImage = () => { if (resultSrc) { const a = document.createElement('a'); a.href = resultSrc; a.download = 'evaluation_report.png'; a.click(); } };

  // Shortcuts
  useEffect(() => {
      const handleKey = (e: KeyboardEvent) => { if (activeRoiId && (e.key === 'Delete' || e.key === 'Backspace')) setRois(prev => prev.filter(r => r.id !== activeRoiId)); };
      window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [activeRoiId]);

  // 5. Canvas Rendering
  useEffect(() => {
      const canvas = canvasRef.current; if (!canvas || !imageRef.current) return;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const img = imageRef.current; canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Measurements
      if (showSpacing && detectedEllipses.length > 1 && fitLine) {
          ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const dx = fitLine.x2 - fitLine.x1, dy = fitLine.y2 - fitLine.y1, len = Math.sqrt(dx*dx + dy*dy) || 1;
          const sorted = [...detectedEllipses].map(e => ({ ...e, t: e.cx * (dx/len) + e.cy * (dy/len) })).sort((a, b) => a.t - b.t);
          for (let i = 0; i < sorted.length - 1; i++) {
              const p1 = sorted[i], p2 = sorted[i+1], dist = Math.sqrt(Math.pow(p2.cx - p1.cx, 2) + Math.pow(p2.cy - p1.cy, 2));
              if (dist < 300) {
                  ctx.beginPath(); ctx.moveTo(p1.cx, p1.cy); ctx.lineTo(p2.cx, p2.cy); ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'; ctx.lineWidth = 3; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
                  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'; ctx.fillRect((p1.cx+p2.cx)/2 - 18, (p1.cy+p2.cy)/2 - 8, 36, 16);
                  ctx.fillStyle = '#60a5fa'; ctx.fillText(dist.toFixed(1), (p1.cx+p2.cx)/2, (p1.cy+p2.cy)/2);
              }
          }
      }
      
      // ROIs
      rois.forEach(roi => {
          ctx.beginPath(); ctx.arc(roi.cx, roi.cy, roi.rx, 0, Math.PI * 2); ctx.lineWidth = 3;
          ctx.strokeStyle = roi.id === activeRoiId ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)'; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
      });

      // Linearity Line & Grid (Thick lines 6px)
      if (showLinearity) {
          if (gridLines) {
              // Draw Rows
              gridLines.rows.forEach(line => {
                  ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2);
                  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
              });
              // Draw Cols
              gridLines.cols.forEach(line => {
                  ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2);
                  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)'; ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
              });
          } else if (fitLine) {
              const ext = Math.max(img.width, img.height); const dx = fitLine.x2 - fitLine.x1, dy = fitLine.y2 - fitLine.y1, len = Math.sqrt(dx*dx + dy*dy) || 1;
              ctx.beginPath(); ctx.moveTo(fitLine.x1 - (dx/len)*ext, fitLine.y1 - (dy/len)*ext); ctx.lineTo(fitLine.x1 + (dx/len)*ext, fitLine.y1 + (dy/len)*ext);
              ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; ctx.setLineDash([10, 5]); ctx.stroke(); ctx.setLineDash([]);
          }
      }
      
      // Detected Points (Thick)
      if (showOverlay) {
          detectedEllipses.forEach(e => {
              ctx.beginPath(); ctx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#10b981'; ctx.stroke();
              ctx.beginPath(); ctx.moveTo(e.cx-8, e.cy); ctx.lineTo(e.cx+8, e.cy); ctx.moveTo(e.cx, e.cy-8); ctx.lineTo(e.cx, e.cy+8); ctx.lineWidth = 3; ctx.strokeStyle = '#facc15'; ctx.stroke();
          });
      }

      // Hover Snap Feedback
      if (interactionMode === 'guide' && hoveredEllipseId) {
          const hovered = detectedEllipses.find(e => e.id === hoveredEllipseId);
          if (hovered) {
              ctx.beginPath(); ctx.arc(hovered.cx, hovered.cy, Math.max(hovered.rx, hovered.ry) + 10, 0, Math.PI * 2);
              ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
              ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(`Snap to Center`, hovered.cx + 20, hovered.cy - 20);
          }
      }

      // 3-Point Grid Basis Visual Feedback
      if (gridBasisIds.origin) {
          const origin = detectedEllipses.find(e => e.id === gridBasisIds.origin);
          if (origin) {
              // Highlight Origin
              ctx.beginPath(); ctx.arc(origin.cx, origin.cy, 12, 0, Math.PI*2);
              ctx.fillStyle = '#facc15'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
              
              if (gridBasisIds.x) {
                  const xRef = detectedEllipses.find(e => e.id === gridBasisIds.x);
                  if (xRef) {
                      // Arrow to X
                      ctx.beginPath(); ctx.moveTo(origin.cx, origin.cy); ctx.lineTo(xRef.cx, xRef.cy);
                      ctx.lineWidth = 6; ctx.strokeStyle = '#3b82f6'; ctx.stroke();
                      ctx.beginPath(); ctx.arc(xRef.cx, xRef.cy, 10, 0, Math.PI*2);
                      ctx.fillStyle = '#3b82f6'; ctx.fill();
                  }
              }
              if (gridBasisIds.y) {
                  const yRef = detectedEllipses.find(e => e.id === gridBasisIds.y);
                  if (yRef) {
                      // Arrow to Y
                      ctx.beginPath(); ctx.moveTo(origin.cx, origin.cy); ctx.lineTo(yRef.cx, yRef.cy);
                      ctx.lineWidth = 6; ctx.strokeStyle = '#ef4444'; ctx.stroke();
                      ctx.beginPath(); ctx.arc(yRef.cx, yRef.cy, 10, 0, Math.PI*2);
                      ctx.fillStyle = '#ef4444'; ctx.fill();
                  }
              }
          }
      }

  }, [detectedEllipses, rois, activeRoiId, fitLine, gridLines, showOverlay, showLinearity, showSpacing, scale, interactionMode, gridBasisIds, hoveredEllipseId]);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
        {/* Top Header */}
        <div className="h-14 bg-slate-900 border-b border-slate-800 flex justify-between items-center px-4 shrink-0 z-40">
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition"><ArrowLeft className="w-4 h-4" /> Back</button>
                <div className="h-6 w-px bg-slate-800"></div>
                <h1 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Evaluation Lab</h1>
            </div>
            {metrics && <div className="px-3 py-1 bg-emerald-950/30 border border-emerald-900/50 rounded-full text-xs text-emerald-400 font-bold">Score: {metrics.finalScore}/100</div>}
        </div>

        <div className="flex-1 flex overflow-hidden">
            {/* Tool Bar */}
            <div className="w-14 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4 gap-4 z-30">
                <button onClick={() => setInteractionMode('pan')} className={`p-3 rounded-xl transition ${interactionMode === 'pan' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:bg-slate-800'}`} title="Pan Tool"><Hand className="w-5 h-5" /></button>
                <button onClick={() => setInteractionMode('roi')} className={`p-3 rounded-xl transition ${interactionMode === 'roi' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-slate-400 hover:bg-slate-800'}`} title="ROI Drawing"><Target className="w-5 h-5" /></button>
                <button 
                    onClick={() => { setInteractionMode('guide'); setGridSelectionStep(0); setGridBasisIds({}); }} 
                    className={`p-3 rounded-xl transition ${interactionMode === 'guide' ? 'bg-pink-600 text-white shadow-lg shadow-pink-900/20' : 'text-slate-400 hover:bg-slate-800'}`} 
                    title="Define Grid (3-Point)"
                >
                    <Compass className="w-5 h-5" />
                </button>
                
                <div className="w-8 h-px bg-slate-800"></div>
                <button onClick={handleAutoDetectLabRois} className="p-3 rounded-xl text-emerald-400 hover:bg-emerald-950/30 transition" title="Auto Detect ROIs"><Wand2 className="w-5 h-5" /></button>
                <button disabled={!activeRoiId} onClick={() => activeRoiId && setRois(r => r.filter(x => x.id !== activeRoiId))} className="p-3 rounded-xl text-red-400 hover:bg-red-950/30 transition disabled:opacity-20"><Trash2 className="w-5 h-5" /></button>
            </div>

            {/* Main Viewport */}
            <div className="flex-1 flex flex-col bg-black overflow-hidden relative">
                <div className="absolute top-4 left-4 z-20 flex gap-2">
                    <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg flex gap-1 shadow-2xl">
                        <button onClick={() => setShowOverlay(!showOverlay)} className={`p-2 rounded transition ${showOverlay ? 'text-emerald-400 bg-emerald-900/30 font-bold' : 'text-slate-400'}`} title="Toggle Circles"><CircleDashed className="w-4 h-4" /></button>
                        <button onClick={() => setShowLinearity(!showLinearity)} className={`p-2 rounded transition ${showLinearity ? 'text-red-400 bg-red-900/30 font-bold' : 'text-slate-400'}`} title="Toggle Grid/Linearity"><ScanLine className="w-4 h-4" /></button>
                        <button onClick={() => setShowSpacing(!showSpacing)} className={`p-2 rounded transition ${showSpacing ? 'text-blue-400 bg-blue-900/30 font-bold' : 'text-slate-400'}`} title="Toggle Spacing"><Ruler className="w-4 h-4" /></button>
                    </div>
                </div>
                
                {/* Guide Mode Instructions */}
                {interactionMode === 'guide' && (
                     <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-slate-900/90 backdrop-blur border border-pink-500/50 px-4 py-2 rounded-lg text-sm text-pink-200 pointer-events-none shadow-2xl flex flex-col items-center">
                        <div className="font-bold flex items-center gap-2 mb-1"><Compass className="w-4 h-4"/> Define Grid Basis</div>
                        <div className="text-xs text-pink-300/80 mb-2">Hover and click circle center</div>
                        <div className="flex gap-2 text-xs">
                             <span className={gridSelectionStep === 0 ? "text-yellow-400 font-bold animate-pulse" : "text-slate-500"}>1. Origin</span>
                             <span className="text-slate-600">→</span>
                             <span className={gridSelectionStep === 1 ? "text-blue-400 font-bold animate-pulse" : "text-slate-500"}>2. X-Neighbor</span>
                             <span className="text-slate-600">→</span>
                             <span className={gridSelectionStep === 2 ? "text-red-400 font-bold animate-pulse" : "text-slate-500"}>3. Y-Neighbor</span>
                        </div>
                     </div>
                )}
                
                {/* Manual Grid Info */}
                {!interactionMode.includes('guide') && gridBasisIds.origin && gridBasisIds.x && gridBasisIds.y && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-pink-900/90 backdrop-blur border border-pink-700 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-3">
                         <span className="text-xs font-bold text-pink-100 flex items-center gap-1"><Compass className="w-3 h-3"/> Grid Basis Set</span>
                         <button onClick={() => { setGridBasisIds({}); runGridAnalysis(); }} className="text-pink-300 hover:text-white"><X className="w-3 h-3"/></button>
                    </div>
                )}

                <div className="absolute bottom-4 left-4 z-20 flex items-center bg-slate-900/90 border border-slate-700 rounded-lg p-1 shadow-2xl">
                    <button onClick={handleZoomOut} className="p-2 text-slate-400 hover:text-white transition"><ZoomOut className="w-4 h-4" /></button>
                    <span className="text-[10px] font-mono w-12 text-center text-slate-300">{Math.round(scale * 100)}%</span>
                    <button onClick={handleZoomIn} className="p-2 text-slate-400 hover:text-white transition"><ZoomIn className="w-4 h-4" /></button>
                    <div className="w-px h-4 bg-slate-700 mx-1"></div>
                    <button onClick={() => handleFitToScreen()} className="p-2 text-blue-400 hover:text-white transition"><Maximize className="w-4 h-4" /></button>
                </div>

                <div ref={containerRef} className="flex-1 overflow-auto custom-scrollbar flex bg-slate-950" onWheel={handleWheel}>
                    <div className="m-auto min-w-max min-h-max relative">
                        {loading && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-30 bg-slate-950/80"><Loader2 className="w-10 h-10 animate-spin text-blue-500" /><span className="text-slate-400">Rendering Lab...</span></div>}
                        <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => setDrawingRoi(null)} className={`shadow-2xl transition-transform duration-75 origin-top-left ${interactionMode === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`} style={{ display: resultSrc ? 'block' : 'none', width: imageRef.current ? imageRef.current.width * scale : 'auto', height: imageRef.current ? imageRef.current.height * scale : 'auto' }} />
                    </div>
                </div>
            </div>

            {/* Right Panel */}
            <div className="w-96 bg-slate-900 flex flex-col border-l border-slate-800 shrink-0 z-30 shadow-2xl">
                <div className="flex border-b border-slate-800">
                    <button onClick={() => setActiveTab('metrics')} className={`flex-1 py-4 text-sm font-medium transition ${activeTab === 'metrics' ? 'border-b-2 border-emerald-500 text-emerald-400 bg-slate-800/30' : 'text-slate-400 hover:text-slate-200'}`}>Scorecard</button>
                    <button onClick={() => setActiveTab('data')} className={`flex-1 py-4 text-sm font-medium transition ${activeTab === 'data' ? 'border-b-2 border-blue-500 text-blue-400 bg-slate-800/30' : 'text-slate-400 hover:text-slate-200'}`}>Coordinates</button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    {activeTab === 'metrics' && <div className="space-y-8">
                        
                        {/* STEP 1: Detection */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] border border-slate-700">1</span>
                                Spot Detection
                            </h3>
                            
                            <div className="space-y-3 bg-slate-900 p-3 rounded-lg border border-slate-800">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[11px] text-slate-400"><span>Detection Threshold</span><span className="font-mono text-emerald-400">{detectionThreshold}</span></div>
                                    <input type="range" min="1" max="254" value={detectionThreshold} onChange={(e) => setDetectionThreshold(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                                </div>
                                
                                <div className="space-y-2 pt-2 border-t border-slate-800/50">
                                    <div className="flex justify-between text-[11px] text-slate-400"><span>Radius Filter (px)</span></div>
                                    <div className="flex gap-2">
                                        <div className="flex-1 space-y-1">
                                            <label className="text-[10px] text-slate-500">Min</label>
                                            <input type="number" min="1" max={maxRadius} value={minRadius} onChange={(e) => setMinRadius(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-emerald-500 outline-none" />
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <label className="text-[10px] text-slate-500">Max</label>
                                            <input type="number" min={minRadius} max="500" value={maxRadius} onChange={(e) => setMaxRadius(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-emerald-500 outline-none" />
                                        </div>
                                    </div>
                                </div>

                                <button onClick={() => runDetection(rois)} className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition">
                                    <Search className="w-4 h-4" />
                                    {rois.length > 0 ? 'Update from ROIs' : 'Detect Spots (Auto)'}
                                </button>
                                {rois.length > 0 && <p className="text-[10px] text-slate-500 text-center italic">Using {rois.length} manual ROIs</p>}
                            </div>
                        </div>

                        {/* STEP 2: Analysis */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] border border-slate-700">2</span>
                                Grid Analysis
                            </h3>

                            <div className="space-y-4">
                                <button 
                                    onClick={runGridAnalysis} 
                                    disabled={detectedEllipses.length < 2 || analyzing}
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-900/20 transition"
                                >
                                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                                    Calculate Metrics
                                </button>
                                
                                {gridBasisIds.origin && gridBasisIds.x && gridBasisIds.y && (
                                    <div className="text-xs text-pink-300 text-center border border-pink-900/50 bg-pink-900/20 p-2 rounded">
                                        Using manual 3-point grid basis
                                    </div>
                                )}

                                {metrics ? (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50"><div className="text-[10px] text-slate-500 mb-1">Mean Roundness</div><div className="text-xl font-bold">{metrics.meanRoundness.toFixed(3)}</div></div>
                                            <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50"><div className="text-[10px] text-slate-500 mb-1">Linearity RMS</div><div className="text-xl font-bold">{metrics.linearityRMS.toFixed(2)}px</div></div>
                                        </div>
                                        <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
                                            <div className="flex justify-between items-center"><span className="text-xs text-slate-400 flex items-center gap-2"><MoveHorizontal className="w-3 h-3" /> Avg. Spacing</span><span className="font-mono text-sm">{metrics.spacingMean.toFixed(2)}px</span></div>
                                            <div className="flex justify-between items-center"><span className="text-xs text-slate-400">Consistency (CV)</span><span className={`font-mono text-sm ${metrics.spacingCV < 0.05 ? 'text-emerald-400' : 'text-yellow-500'}`}>{(metrics.spacingCV * 100).toFixed(1)}%</span></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-6 text-center text-slate-600 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                                        <Activity className="w-6 h-6 mx-auto mb-2 opacity-50" />
                                        <p className="text-xs">Run analysis to see grid stats</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <button onClick={handleSaveImage} className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 py-3 rounded-xl border border-slate-700 transition font-bold shadow-lg shadow-black/20"><Download className="w-4 h-4" /> Save Map View</button>
                    </div>}
                    {activeTab === 'data' && <div className="space-y-4">
                        <div className="flex gap-2">
                            <button onClick={() => handleExportPoints('csv')} className="flex-1 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 flex items-center justify-center gap-2"><FileText className="w-3.5 h-3.5" /> Export CSV</button>
                            <button onClick={() => handleExportPoints('json')} className="flex-1 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 flex items-center justify-center gap-2"><FileJson className="w-3.5 h-3.5" /> Export JSON</button>
                        </div>
                        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                            <table className="w-full text-[10px] text-left">
                                <thead className="bg-slate-900 text-slate-500 uppercase tracking-tighter"><tr><th className="p-3">#</th><th className="p-3">Pos(X,Y)</th><th className="p-3 text-right">Roundness</th></tr></thead>
                                <tbody className="divide-y divide-slate-800 text-slate-300">
                                    {detectedEllipses.map((e, idx) => {
                                        const r = Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry);
                                        return (
                                            <tr key={idx} className={`hover:bg-slate-800/40 transition-colors ${activeRoiId === e.id ? 'bg-blue-900/10' : ''}`}>
                                                <td className="p-3 font-mono text-slate-600">{idx+1}</td>
                                                <td className="p-3 font-mono">{e.cx.toFixed(1)}, {e.cy.toFixed(1)}</td>
                                                <td className={`p-3 text-right font-mono ${r > 0.9 ? 'text-emerald-400' : 'text-yellow-500'}`}>{r.toFixed(3)}</td>
                                            </tr>
                                        );
                                    })}
                                    {detectedEllipses.length === 0 && <tr><td colSpan={3} className="p-10 text-center text-slate-600 italic">Draw ROIs or Auto-Detect to see data</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>}
                </div>
            </div>
        </div>
    </div>
  );
};