import React, { useState, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { RoiCanvas } from './components/RoiCanvas';
import { DataModal } from './components/DataModal';
import { CircleROI, EllipseData, ProcessingMode } from './types';
import { extractEllipseFromROI, autoDetectEllipses } from './utils/imageProcessing';

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [rois, setRois] = useState<CircleROI[]>([]);
  const [ellipses, setEllipses] = useState<EllipseData[]>([]);
  const [mode, setMode] = useState<ProcessingMode>('dark');
  const [activeRoiId, setActiveRoiId] = useState<number | null>(null);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setRois([]);
        setEllipses([]);
        setActiveRoiId(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClear = () => {
    setRois([]);
    setEllipses([]);
    setActiveRoiId(null);
  };

  const handleDeleteRoi = (id: number) => {
    setRois(prev => prev.filter(r => r.id !== id));
    setEllipses(prev => prev.filter(e => e.id !== id));
    if (activeRoiId === id) {
      setActiveRoiId(null);
    }
  };

  const handleProcess = () => {
    if (!imageSrc) return;

    // Create a clean offscreen canvas to extract data from.
    // This prevents the ROI overlays (circles, numbers, handles) from interfering with the image processing.
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      
      if (!tempCtx) return;
      
      tempCtx.drawImage(img, 0, 0);

      // Process on the clean context
      const newEllipses = rois.map(roi => extractEllipseFromROI(tempCtx, roi, mode));
      setEllipses(newEllipses);
    };
  };

  const handleAutoDetect = (threshold: number, minRadius: number, maxRadius: number) => {
    if (!imageSrc) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      
      if (!tempCtx) return;
      
      tempCtx.drawImage(img, 0, 0);

      // Run auto detection with radius filters
      const { ellipses: detectedEllipses, rois: generatedRois } = autoDetectEllipses(
        tempCtx, 
        mode, 
        threshold,
        minRadius,
        maxRadius
      );
      
      setEllipses(detectedEllipses);
      setRois(generatedRois);
      
      if (detectedEllipses.length === 0) {
          alert("No ellipses found matching the threshold and radius criteria.");
      }
    };
  }

  const handleExport = () => {
    if (ellipses.length === 0) return;
    
    // Export standard JSON
    const dataStr = JSON.stringify(ellipses, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'elliptical_points.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Main Canvas Area */}
      <div className="flex-1 h-full relative">
        <RoiCanvas
          imageSrc={imageSrc}
          rois={rois}
          setRois={setRois}
          ellipses={ellipses}
          onCanvasReady={(canvas) => { canvasRef.current = canvas; }}
          activeRoiId={activeRoiId}
          setActiveRoiId={setActiveRoiId}
          onDeleteRoi={handleDeleteRoi}
        />
        
        {/* Instruction Overlay when image exists but no ROIs */}
        {imageSrc && rois.length === 0 && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-900/80 backdrop-blur px-4 py-2 rounded-full border border-slate-700 text-sm pointer-events-none transition-opacity duration-500 shadow-xl z-10">
            Click points manually or use "Auto Detect" in the sidebar
          </div>
        )}
      </div>

      {/* Sidebar Controls */}
      <Sidebar
        rois={rois}
        setRois={setRois}
        ellipses={ellipses}
        onClear={handleClear}
        onProcess={handleProcess}
        onAutoDetect={handleAutoDetect}
        mode={mode}
        setMode={setMode}
        onExport={handleExport}
        onImageUpload={handleImageUpload}
        activeRoiId={activeRoiId}
        onViewData={() => setIsDataModalOpen(true)}
        onDeleteRoi={handleDeleteRoi}
      />

      {/* Data Modal Overlay */}
      <DataModal 
        isOpen={isDataModalOpen} 
        onClose={() => setIsDataModalOpen(false)} 
        ellipses={ellipses} 
      />
    </div>
  );
}