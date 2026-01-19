import React, { useEffect, useState, useRef, useCallback } from 'react';
import { CalibrationResult, CorrectionMetrics, EllipseData } from '../types';
import { generateSectorImage } from '../utils/calibration';
import { analyzeTransformedSpots } from '../utils/imageProcessing';
import { X, Loader2, Download, ShieldCheck, Target, Activity, TrendingDown, Sliders, List, FileJson, FileText, ArrowLeft, Maximize2, MoveHorizontal, CircleDashed, ZoomIn, ZoomOut, Maximize, Ruler, ScanLine } from 'lucide-react';

interface EvaluationLabProps {
  onBack: () => void;
  imageSrc: string | null;
  calibration: CalibrationResult | null;
  mode: 'dark' | 'light';
}

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
  
  const [detectionThreshold, setDetectionThreshold] = useState(128);
  const [minRadius, setMinRadius] = useState(2);
  const [maxRadius, setMaxRadius] = useState(100);

  // Visualization Toggles
  const [showOverlay, setShowOverlay] = useState(true); // Circles & IDs
  const [showLinearity, setShowLinearity] = useState(true); // Fit line & Residuals
  const [showSpacing, setShowSpacing] = useState(true); // Spacing lines & text

  const [activeTab, setActiveTab] = useState<'metrics' | 'data'>('metrics');

  // Zoom State
  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // 1. Generate Image on open
  useEffect(() => {
    if (imageSrc && calibration && calibration.isValid) {
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
              runAnalysis(img);
              // Fit to screen initially
              handleFitToScreen(img);
          };
        })
        .catch(err => {
          console.error(err);
          setError("Failed to generate sector image. Please check calibration data.");
          setLoading(false);
        });
    } else {
        setError("Invalid calibration data or image missing.");
        setLoading(false);
    }
  }, [imageSrc, calibration]);

  // 2. Analysis Function
  const runAnalysis = (img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const res = analyzeTransformedSpots(ctx, mode, { 
          threshold: detectionThreshold,
          minRadius: minRadius,
          maxRadius: maxRadius
      });
      setMetrics(res.metrics);
      setDetectedEllipses(res.ellipses);
      setFitLine(res.bestFitLine);
  };

  // 3. Handle Updates
  useEffect(() => {
      if (imageRef.current) {
          runAnalysis(imageRef.current);
      }
  }, [detectionThreshold, minRadius, maxRadius]);

  // 4. Zoom Helpers
  const handleFitToScreen = (img: HTMLImageElement = imageRef.current!) => {
      if (!containerRef.current || !img) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const padding = 64; // padding around
      const scaleX = (clientWidth - padding) / img.width;
      const scaleY = (clientHeight - padding) / img.height;
      const fitScale = Math.min(scaleX, scaleY, 1.0); // Never auto-scale up beyond 1.0 initially
      setScale(fitScale);
  };

  const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 5.0));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.1));

  const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey) {
          e.preventDefault();
          if (e.deltaY < 0) handleZoomIn();
          else handleZoomOut();
      }
  };

  // Helper: Project point onto line defined by (x1,y1)->(x2,y2)
  const getProjection = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx*dx + dy*dy;
      if (lenSq === 0) return { x: x1, y: y1 }; // Point line
      
      const t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      return {
          x: x1 + t * dx,
          y: y1 + t * dy
      };
  };

  // 5. Render Canvas (Image + Overlay)
  useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !imageRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = imageRef.current;
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw Image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // --- Draw Spacing (Between adjacent sorted points along best fit direction) ---
      if (showSpacing && detectedEllipses.length > 1 && fitLine) {
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Sort ellipses by projection onto the best fit line
          const dx = fitLine.x2 - fitLine.x1;
          const dy = fitLine.y2 - fitLine.y1;
          const len = Math.sqrt(dx*dx + dy*dy);
          const vx = dx / (len || 1);
          const vy = dy / (len || 1);

          // We only connect points that are "neighbors" in this projection
          // But since we might have multiple rows, we should be careful.
          // Simple heuristic: Sort all, then check if neighbors in sorted list are spatially close.
          
          const sorted = [...detectedEllipses].map(e => ({
              ...e,
              t: e.cx * vx + e.cy * vy
          })).sort((a, b) => a.t - b.t);

          for (let i = 0; i < sorted.length - 1; i++) {
              const p1 = sorted[i];
              const p2 = sorted[i+1];
              
              // Only draw if physically close enough to be a sequence
              const dist = Math.sqrt(Math.pow(p2.cx - p1.cx, 2) + Math.pow(p2.cy - p1.cy, 2));
              const avgRadius = (p1.rx + p1.ry + p2.rx + p2.ry) / 4;
              
              if (dist < avgRadius * 6) { 
                  // Draw Line
                  ctx.beginPath();
                  ctx.moveTo(p1.cx, p1.cy);
                  ctx.lineTo(p2.cx, p2.cy);
                  ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'; // blue-500 transparent
                  ctx.lineWidth = 1;
                  ctx.setLineDash([2, 2]);
                  ctx.stroke();
                  ctx.setLineDash([]);

                  // Draw Label Background
                  const midX = (p1.cx + p2.cx) / 2;
                  const midY = (p1.cy + p2.cy) / 2;
                  const text = dist.toFixed(1);
                  const metrics = ctx.measureText(text);
                  const pad = 2;
                  
                  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'; // slate-900
                  ctx.fillRect(midX - metrics.width/2 - pad, midY - 6, metrics.width + pad*2, 12);
                  
                  // Draw Text
                  ctx.fillStyle = '#60a5fa'; // blue-400
                  ctx.fillText(text, midX, midY);
              }
          }
      }

      // --- Draw Linearity (Fit Line + Residuals) ---
      if (showLinearity && fitLine) {
          // 1. Draw Infinite Fit Line
          ctx.beginPath();
          // Extend the line visually beyond the calculated segment
          const dx = fitLine.x2 - fitLine.x1;
          const dy = fitLine.y2 - fitLine.y1;
          const ext = Math.max(img.width, img.height) * 2;
          // Normalize
          const len = Math.sqrt(dx*dx + dy*dy);
          const ux = dx/(len||1);
          const uy = dy/(len||1);
          
          // Draw dashed long line
          // We anchor at x1,y1
          ctx.moveTo(fitLine.x1 - ux * ext, fitLine.y1 - uy * ext);
          ctx.lineTo(fitLine.x1 + ux * ext, fitLine.y1 + uy * ext);
          
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // red-500
          ctx.setLineDash([8, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // 2. Draw Residuals (Perpendicular to the line)
          // Note: In grid mode, we want residuals to the CLOSEST parallel grid line.
          // But for simple visualization, we show residuals to the main line, 
          // which might be confusing if there are multiple rows.
          // BETTER: Just draw the line through the "best row" (the one with most points)
          // and let the user see the alignment.
          // For visualization residuals, maybe only draw for points "close" to this line?
          // Or draw lines for *each* row?
          // Let's stick to the single best fit line for now as per "direction" request.
          
          // Let's filter points that belong to this "best line" (inliers) to draw residuals
          // This prevents drawing long residuals from other rows.
          const inlierThreshold = (detectedEllipses[0]?.rx || 10) * 2; 

          detectedEllipses.forEach(e => {
              const proj = getProjection(e.cx, e.cy, fitLine.x1, fitLine.y1, fitLine.x2, fitLine.y2);
              const dist = Math.sqrt(Math.pow(e.cx - proj.x, 2) + Math.pow(e.cy - proj.y, 2));

              if (dist < inlierThreshold) {
                  ctx.beginPath();
                  ctx.moveTo(e.cx, e.cy);
                  ctx.lineTo(proj.x, proj.y);
                  ctx.strokeStyle = '#f87171'; // red-400
                  ctx.stroke();
              }
          });
      }

      // --- Draw Circles Overlay ---
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
              ctx.textAlign = 'left';
              ctx.fillText(`#${idx+1}`, e.cx + e.rx + 2, e.cy);
          });
      }

  }, [detectedEllipses, fitLine, showOverlay, showLinearity, showSpacing, resultSrc]);

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
        a.download = 'corrected_image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
        
        {/* Header */}
        <div className="h-14 bg-slate-900 border-b border-slate-800 flex justify-between items-center px-4 shrink-0 z-10">
            <div className="flex items-center gap-4">
                <button 
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-slate-400 hover:text-white transition"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <div className="h-6 w-px bg-slate-800"></div>
                <h1 className="text-lg font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    Evaluation Lab
                </h1>
            </div>
            {metrics && (
                <div className="flex items-center gap-4 text-sm">
                     <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
                         <span className="text-slate-400">Total Score:</span>
                         <span className={`font-bold ${metrics.finalScore > 80 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                             {metrics.finalScore}/100
                         </span>
                     </div>
                </div>
            )}
        </div>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
            
            {/* Interactive Canvas Area */}
            <div className="flex-1 flex flex-col bg-black/50 overflow-hidden relative border-r border-slate-800">
                {/* Overlay Controls (Visiblity) */}
                <div className="absolute top-4 left-4 z-20 flex gap-2">
                    <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg flex gap-1 shadow-lg">
                        <button 
                            onClick={() => setShowOverlay(!showOverlay)}
                            className={`p-2 rounded transition ${showOverlay ? 'bg-emerald-900/50 text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                            title="Circles & Labels"
                        >
                            <Target className="w-4 h-4" />
                        </button>
                         <button 
                            onClick={() => setShowLinearity(!showLinearity)}
                            className={`p-2 rounded transition ${showLinearity ? 'bg-red-900/50 text-red-400' : 'text-slate-400 hover:text-white'}`}
                            title="Linearity & Residuals"
                        >
                            <ScanLine className="w-4 h-4" />
                        </button>
                        <button 
                            onClick={() => setShowSpacing(!showSpacing)}
                            className={`p-2 rounded transition ${showSpacing ? 'bg-blue-900/50 text-blue-400' : 'text-slate-400 hover:text-white'}`}
                            title="Spacing Measurements"
                        >
                            <Ruler className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Zoom Controls (Bottom Left) */}
                <div className="absolute bottom-4 left-4 z-20 flex gap-2">
                    <div className="bg-slate-900/90 backdrop-blur border border-slate-700 p-1 rounded-lg flex gap-1 shadow-lg items-center">
                        <button 
                            onClick={handleZoomOut}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                            title="Zoom Out"
                        >
                            <ZoomOut className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-mono w-12 text-center text-slate-300">
                            {Math.round(scale * 100)}%
                        </span>
                        <button 
                            onClick={handleZoomIn}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                            title="Zoom In"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-slate-700 mx-1"></div>
                        <button 
                            onClick={() => handleFitToScreen()}
                            className="p-2 text-blue-400 hover:text-white hover:bg-blue-900/50 rounded transition"
                            title="Fit to Screen"
                        >
                            <Maximize className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Canvas Container */}
                <div 
                    ref={containerRef}
                    className="flex-1 overflow-auto flex custom-scrollbar relative bg-slate-950/50"
                    onWheel={handleWheel}
                >
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 z-10 bg-slate-950/80">
                            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                            <span>Correcting & Analyzing...</span>
                        </div>
                    )}
                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-950/80">
                            <div className="text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900/50 flex flex-col items-center gap-2">
                                <p>{error}</p>
                                <button onClick={onBack} className="text-sm underline hover:text-white">Return to Main</button>
                            </div>
                        </div>
                    )}
                    
                    {/* The Canvas */}
                    <canvas 
                        ref={canvasRef}
                        className="max-w-none shadow-2xl border border-slate-800 transition-transform duration-75 origin-top-left m-auto"
                        style={{ 
                            display: (!loading && !error && resultSrc) ? 'block' : 'none',
                            width: imageRef.current ? imageRef.current.width * scale : 'auto',
                            height: imageRef.current ? imageRef.current.height * scale : 'auto'
                        }}
                    />
                </div>
            </div>

            {/* Right Sidebar */}
            <div className="w-96 bg-slate-900 flex flex-col border-l border-slate-800 shrink-0 z-20 shadow-xl">
                
                {/* Tabs */}
                <div className="flex border-b border-slate-800">
                    <button 
                        onClick={() => setActiveTab('metrics')}
                        className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${activeTab === 'metrics' ? 'border-emerald-500 text-emerald-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                        <Maximize2 className="w-4 h-4" />
                        Metrics
                    </button>
                    <button 
                         onClick={() => setActiveTab('data')}
                         className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${activeTab === 'data' ? 'border-blue-500 text-blue-400 bg-slate-800/50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                    >
                        <List className="w-4 h-4" />
                        Data List
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    {activeTab === 'metrics' && (
                        <div className="space-y-6">
                            {/* Tune Section */}
                            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 space-y-4">
                                
                                {/* Threshold */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                                            <Sliders className="w-4 h-4 text-purple-400" />
                                            Spot Sensitivity
                                        </label>
                                        <span className="font-mono text-xs bg-slate-900 px-2 py-1 rounded text-purple-300">{detectionThreshold}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" max="254" 
                                        value={detectionThreshold}
                                        onChange={(e) => setDetectionThreshold(Number(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                    />
                                </div>

                                {/* Radius Filter */}
                                <div className="space-y-3 pt-2 border-t border-slate-700/50">
                                    <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                                        <CircleDashed className="w-4 h-4 text-blue-400" />
                                        Radius Filter (px)
                                    </label>
                                    <div className="flex gap-3">
                                        <div className="flex-1 space-y-1">
                                            <div className="flex justify-between text-[10px] text-slate-400">
                                                <span>Min</span>
                                                <span className="text-blue-300">{minRadius}</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="1" max={maxRadius}
                                                value={minRadius}
                                                onChange={(e) => setMinRadius(Math.min(Number(e.target.value), maxRadius))}
                                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                            />
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <div className="flex justify-between text-[10px] text-slate-400">
                                                <span>Max</span>
                                                <span className="text-blue-300">{maxRadius}</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min={minRadius} max="200"
                                                value={maxRadius}
                                                onChange={(e) => setMaxRadius(Math.max(Number(e.target.value), minRadius))}
                                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic">
                                        Filter out noise or artifacts by limiting the allowed spot size.
                                    </p>
                                </div>
                            </div>

                            {/* Metrics Breakdown */}
                            {metrics ? (
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                        <TrendingDown className="w-3 h-3" /> Geometric Analysis
                                    </h4>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        {/* Roundness */}
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 relative overflow-hidden">
                                            <div className="text-[10px] text-slate-400 mb-1">Mean Roundness</div>
                                            <div className="text-xl font-bold text-slate-200">
                                                {(metrics.meanRoundness).toFixed(3)}
                                            </div>
                                            <div className="absolute bottom-0 left-0 h-1 bg-blue-500" style={{width: `${metrics.meanRoundness*100}%`}}></div>
                                        </div>

                                        {/* Linearity */}
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 relative overflow-hidden">
                                            <div className="text-[10px] text-slate-400 mb-1">Linearity (RMS)</div>
                                            <div className="text-xl font-bold text-slate-200">
                                                {metrics.linearityRMS.toFixed(2)}<span className="text-xs text-slate-500">px</span>
                                            </div>
                                            <div className="absolute bottom-0 left-0 h-1 bg-purple-500" style={{width: `${Math.max(0, 100 - metrics.linearityRMS*5)}%`}}></div>
                                        </div>

                                        {/* Avg Spacing */}
                                        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 col-span-2 flex justify-between items-center">
                                            <div>
                                                <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                                                    <MoveHorizontal className="w-3 h-3" /> Avg Center Spacing
                                                </div>
                                                <div className="text-xl font-bold text-slate-200">
                                                    {metrics.spacingMean.toFixed(2)} <span className="text-xs text-slate-500">px</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                 <div className="text-[10px] text-slate-500">Spacing CV</div>
                                                 <div className={`font-mono font-bold ${metrics.spacingCV < 0.05 ? 'text-green-400' : 'text-orange-400'}`}>
                                                     {(metrics.spacingCV * 100).toFixed(1)}%
                                                 </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Detailed Scores */}
                                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-slate-400">Roundness Score</span>
                                            <span className="font-mono">{metrics.scoreRoundness}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500" style={{width: `${metrics.scoreRoundness}%`}}></div>
                                        </div>

                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-slate-400">Linearity Score</span>
                                            <span className="font-mono">{metrics.scoreLinearity}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-purple-500" style={{width: `${metrics.scoreLinearity}%`}}></div>
                                        </div>

                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-slate-400">Consistency Score</span>
                                            <span className="font-mono">{metrics.scoreConsistency}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500" style={{width: `${metrics.scoreConsistency}%`}}></div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-10 text-slate-500">No Data</div>
                            )}

                            <button
                                onClick={handleSaveImage}
                                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-lg font-medium transition border border-slate-700 mt-auto"
                            >
                                <Download className="w-4 h-4" />
                                Export Image
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
                                             <th className="p-2 font-medium">Pos(X,Y)</th>
                                             <th className="p-2 font-medium text-right">Round</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-800">
                                         {detectedEllipses.map((e, idx) => {
                                             const r = Math.min(e.rx,e.ry)/Math.max(e.rx,e.ry);
                                             return (
                                                <tr key={idx} className="hover:bg-slate-900/50 transition">
                                                    <td className="p-2 font-mono text-slate-500">{idx+1}</td>
                                                    <td className="p-2 font-mono text-slate-300">
                                                        {e.cx.toFixed(1)}, {e.cy.toFixed(1)}
                                                    </td>
                                                    <td className={`p-2 font-mono font-bold text-right ${r > 0.9 ? 'text-green-400' : 'text-yellow-500'}`}>
                                                        {r.toFixed(2)}
                                                    </td>
                                                </tr>
                                             );
                                         })}
                                         {detectedEllipses.length === 0 && (
                                             <tr><td colSpan={3} className="p-4 text-center text-slate-600">No spots found</td></tr>
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
  );
};