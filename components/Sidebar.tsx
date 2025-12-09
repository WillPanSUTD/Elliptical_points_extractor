import React from 'react';
import { CircleROI, EllipseData, ProcessingMode } from '../types';
import { Trash2, Calculator, Download, Upload, Sliders, TableProperties, Wand2, X } from 'lucide-react';

interface SidebarProps {
  rois: CircleROI[];
  ellipses: EllipseData[];
  onClear: () => void;
  onProcess: () => void;
  onAutoDetect: (threshold: number, minRadius: number, maxRadius: number) => void;
  mode: ProcessingMode;
  setMode: (m: ProcessingMode) => void;
  onExport: () => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeRoiId: number | null;
  setRois: React.Dispatch<React.SetStateAction<CircleROI[]>>;
  onViewData: () => void;
  onDeleteRoi: (id: number) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  rois,
  ellipses,
  onClear,
  onProcess,
  onAutoDetect,
  mode,
  setMode,
  onExport,
  onImageUpload,
  activeRoiId,
  setRois,
  onViewData,
  onDeleteRoi,
}) => {
  const activeRoi = activeRoiId ? rois.find(r => r.id === activeRoiId) : null;
  const [threshold, setThreshold] = React.useState(128);
  const [minRadius, setMinRadius] = React.useState(10);
  const [maxRadius, setMaxRadius] = React.useState(200);

  const handleRadiusChange = (newRadius: number) => {
    if (activeRoiId) {
      setRois(prev => prev.map(r => r.id === activeRoiId ? { ...r, radius: newRadius } : r));
    }
  };

  const handleApplyRadiusToAll = () => {
    if (activeRoi) {
      setRois(prev => prev.map(r => ({ ...r, radius: activeRoi.radius })));
    }
  };

  return (
    <div className="w-full md:w-80 bg-slate-800 border-l border-slate-700 flex flex-col h-full overflow-hidden shadow-2xl z-10 relative">
      
      {/* Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-900">
        <h1 className="text-xl font-bold text-blue-400 flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          ROI Extractor
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manual or Automatic calibration.
        </p>
      </div>

      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        
        {/* Upload Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">1. Source Image</label>
          <div className="relative group">
            <input 
              type="file" 
              accept="image/*" 
              onChange={onImageUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="border-2 border-dashed border-slate-600 rounded-lg p-4 flex flex-col items-center justify-center bg-slate-800 group-hover:bg-slate-750 group-hover:border-blue-500 transition-colors">
              <Upload className="w-6 h-6 text-slate-400 mb-2" />
              <span className="text-sm text-slate-400">Click to Upload Image</span>
            </div>
          </div>
        </div>

        {/* Global Settings */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-300">2. Detection Mode</label>
          <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-lg">
            <button
              onClick={() => setMode('dark')}
              className={`py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                mode === 'dark' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dark Spots
            </button>
            <button
              onClick={() => setMode('light')}
              className={`py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                mode === 'light' 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Light Spots
            </button>
          </div>
        </div>

        {/* Auto Detect Section */}
        <div className="space-y-2 border-t border-slate-700 pt-4">
             <label className="block text-sm font-medium text-slate-300 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-purple-400" />
                Auto Detection
             </label>
             <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 space-y-3">
                {/* Threshold Control */}
                <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                        <span>Threshold</span>
                        <span className="font-mono text-purple-300">{threshold}</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="254"
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                </div>

                {/* Radius Filter */}
                <div className="space-y-1 pt-1">
                   <div className="flex justify-between text-xs text-slate-300 mb-1">
                      <span>Radius Range (px)</span>
                   </div>
                   <div className="flex gap-2">
                      <div className="flex-1 space-y-0.5">
                         <label className="text-[10px] text-slate-500">Min</label>
                         <input 
                            type="number" 
                            min="1" 
                            max={maxRadius}
                            value={minRadius}
                            onChange={(e) => setMinRadius(Number(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:border-purple-500 outline-none"
                         />
                      </div>
                      <div className="flex-1 space-y-0.5">
                         <label className="text-[10px] text-slate-500">Max</label>
                         <input 
                            type="number" 
                            min={minRadius} 
                            max="1000"
                            value={maxRadius}
                            onChange={(e) => setMaxRadius(Number(e.target.value))}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:border-purple-500 outline-none"
                         />
                      </div>
                   </div>
                </div>

                <div className="pt-2">
                  <button
                      onClick={() => onAutoDetect(threshold, minRadius, maxRadius)}
                      className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white py-2 px-3 rounded text-sm font-medium transition-colors shadow-lg shadow-purple-900/20"
                  >
                      <Wand2 className="w-3.5 h-3.5" />
                      Auto Detect All
                  </button>
                </div>
             </div>
        </div>

        {/* Status */}
        <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 mt-2">
            <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-300">Current ROIs</span>
                <span className="text-sm font-bold text-blue-400">
                    {rois.length}
                </span>
            </div>
            {rois.length === 0 && (
                 <p className="text-xs text-slate-500">
                    Use Auto Detect or click on the image manually.
                 </p>
            )}
        </div>

        {/* Selected ROI Settings */}
        {activeRoi && (
          <div className="space-y-2 animate-in slide-in-from-right-2 duration-200 border-t border-slate-700 pt-4">
             <label className="block text-sm font-medium text-slate-300 flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                Edit ROI #{rois.indexOf(activeRoi) + 1}
             </label>
             <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 space-y-3">
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-300">
                        <span>Radius</span>
                        <span className="font-mono text-blue-300">{Math.round(activeRoi.radius)}px</span>
                    </div>
                    <input
                        type="range"
                        min="5"
                        max="200"
                        value={activeRoi.radius}
                        onChange={(e) => handleRadiusChange(Number(e.target.value))}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleApplyRadiusToAll}
                        className="flex-1 text-xs bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-300 py-2 rounded border border-slate-700 transition-colors"
                    >
                        Apply Size to All
                    </button>
                    <button
                        onClick={() => onDeleteRoi(activeRoi.id)}
                        className="text-xs bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 px-3 rounded border border-red-900/30 transition-colors"
                        title="Delete this ROI"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
          </div>
        )}

        {/* Data Preview */}
        {ellipses.length > 0 && (
          <div className="space-y-2 border-t border-slate-700 pt-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">Extracted Data</h3>
                <button 
                  onClick={onViewData}
                  className="text-xs bg-slate-900 hover:bg-slate-700 text-blue-400 px-2 py-1 rounded border border-slate-700 transition-colors flex items-center gap-1"
                >
                  <TableProperties className="w-3 h-3" />
                  Table View
                </button>
            </div>
            
            <div className="space-y-1.5">
              {ellipses.map((e, idx) => (
                <div 
                    key={e.id} 
                    className={`flex flex-col text-xs p-2 rounded border transition-colors group relative ${
                        activeRoiId === e.id 
                        ? 'bg-blue-900/30 border-blue-500/50' 
                        : 'bg-slate-900 border-slate-700'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold font-mono ${activeRoiId === e.id ? 'text-blue-300' : 'text-slate-400'}`}>#{idx + 1}</span>
                    <button 
                        onClick={(ev) => { ev.stopPropagation(); onDeleteRoi(e.id); }}
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete"
                    >
                        <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center text-slate-500 mb-1">
                    <span className="font-mono text-slate-300">
                      {Math.round(e.cx)}, {Math.round(e.cy)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-500">
                     <span className="flex items-center gap-1">
                        Rx: <span className="font-mono text-emerald-400/80">{e.rx.toFixed(1)}</span>
                     </span>
                     <span className="flex items-center gap-1">
                        Ry: <span className="font-mono text-emerald-400/80">{e.ry.toFixed(1)}</span>
                     </span>
                     <span className="flex items-center gap-1">
                        θ: <span className="font-mono text-purple-400/80">{(e.angle * 180 / Math.PI).toFixed(1)}°</span>
                     </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-slate-700 bg-slate-900 space-y-3">
        
        {ellipses.length > 0 ? (
           <button
             onClick={onExport}
             className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 px-4 rounded-lg font-medium transition-colors shadow-lg shadow-emerald-900/20"
           >
             <Download className="w-4 h-4" />
             Save JSON
           </button>
        ) : (
            <button
            onClick={onProcess}
            disabled={rois.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-2.5 px-4 rounded-lg font-medium transition-colors shadow-lg shadow-blue-900/20"
          >
            <Calculator className="w-4 h-4" />
            Extract from ROIs
          </button>
        )}

        <button
          onClick={onClear}
          className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-red-900/30 hover:text-red-400 text-slate-400 py-2 px-4 rounded-lg text-sm font-medium transition-colors border border-slate-700 hover:border-red-900/50"
        >
          <Trash2 className="w-4 h-4" />
          Clear All
        </button>
      </div>
    </div>
  );
};