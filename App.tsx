import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { RoiCanvas } from './components/RoiCanvas';
import { DataModal } from './components/DataModal';
import { SectorViewModal } from './components/SectorViewModal';
import { CalibrationChartModal } from './components/CalibrationChartModal';
import { CircleROI, EllipseData, ProcessingMode, CalibrationResult, CalibrationMethod } from './types';
import { extractEllipseFromROI, autoDetectEllipses } from './utils/imageProcessing';
import { calculateSectorCalibration } from './utils/calibration';

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [rois, setRois] = useState<CircleROI[]>([]);
  const [ellipses, setEllipses] = useState<EllipseData[]>([]);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [mode, setMode] = useState<ProcessingMode>('dark');
  const [activeRoiId, setActiveRoiId] = useState<number | null>(null);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [isSectorModalOpen, setIsSectorModalOpen] = useState(false);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [calibrationMethod, setCalibrationMethod] = useState<CalibrationMethod>('linear');
  
  // Iterative Params
  const [iterIterations, setIterIterations] = useState(3);
  const [iterPercentage, setIterPercentage] = useState(10);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Centralized function to update calibration based on current ellipses and method
  const updateCalibration = useCallback((currentEllipses: EllipseData[], method: CalibrationMethod) => {
    if (currentEllipses.length >= 3) {
      const { result, updatedEllipses: calibratedEllipses } = calculateSectorCalibration(
          currentEllipses, 
          method,
          {
              iterativeIterations: iterIterations,
              iterativePercentage: iterPercentage
          }
      );
      setCalibration(result);
      setEllipses(calibratedEllipses);
    } else {
      setCalibration(null);
      // Just set them as is if we can't calibrate yet
      setEllipses(currentEllipses);
    }
  }, [iterIterations, iterPercentage]);

  // Re-run calibration if iterative params change while method is 'iterative'
  useEffect(() => {
    if (ellipses.length >= 3 && calibrationMethod === 'iterative') {
        updateCalibration(ellipses, 'iterative');
    }
  }, [iterIterations, iterPercentage, calibrationMethod, updateCalibration]); // ellipses dependency omitted to avoid cycle, we trigger manual updates mostly

  const handleCalibrationMethodChange = (method: CalibrationMethod) => {
    setCalibrationMethod(method);
    updateCalibration(ellipses, method);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setRois([]);
        setEllipses([]);
        setActiveRoiId(null);
        setCalibration(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClear = () => {
    setRois([]);
    setEllipses([]);
    setActiveRoiId(null);
    setCalibration(null);
  };

  const handleDeleteRoi = (id: number) => {
    const newRois = rois.filter(r => r.id !== id);
    const newEllipses = ellipses.filter(e => e.id !== id);
    
    setRois(newRois);
    if (activeRoiId === id) {
      setActiveRoiId(null);
    }
    updateCalibration(newEllipses, calibrationMethod);
  };

  const handleProcess = () => {
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

      // Process on the clean context
      const extracted = rois.map(roi => extractEllipseFromROI(tempCtx, roi, mode));
      updateCalibration(extracted, calibrationMethod);
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

      const { ellipses: detectedEllipses, rois: generatedRois } = autoDetectEllipses(
        tempCtx, 
        mode, 
        threshold,
        minRadius,
        maxRadius
      );
      
      setRois(generatedRois);
      updateCalibration(detectedEllipses, calibrationMethod);
      
      if (detectedEllipses.length === 0) {
          alert("No ellipses found matching the threshold and radius criteria.");
      }
    };
  }

  const handleExport = () => {
    if (ellipses.length === 0) return;
    
    // Add calibration data to export if valid
    const exportData = ellipses.map(e => {
        let extra = {};
        if (calibration && calibration.isValid) {
            const R = e.cx - calibration.rotationCenterX;
            const Arc = e.cy * R;
            extra = {
                physicalRadius: R,
                physicalArc: Arc,
                rotationCenterX: calibration.rotationCenterX
            };
        }
        return { ...e, ...extra };
    });

    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'elliptical_points_calibrated.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCalibration = () => {
    if (!calibration) return;
    const dataStr = JSON.stringify(calibration, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calibration_model.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportCalibration = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                // Basic validation
                if (typeof json.slope === 'number' && typeof json.rotationCenterX === 'number') {
                    setCalibration(json);
                } else {
                    alert("Invalid calibration file format.");
                }
            } catch (err) {
                alert("Failed to parse calibration file.");
            }
        };
        reader.readAsText(file);
    }
    // Reset input
    e.target.value = ''; 
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
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
        
        {imageSrc && rois.length === 0 && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-900/80 backdrop-blur px-4 py-2 rounded-full border border-slate-700 text-sm pointer-events-none transition-opacity duration-500 shadow-xl z-10">
            Click points manually or use "Auto Detect" in the sidebar
          </div>
        )}
      </div>

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
        calibration={calibration}
        onViewSector={() => setIsSectorModalOpen(true)}
        calibrationMethod={calibrationMethod}
        setCalibrationMethod={handleCalibrationMethodChange}
        onViewChart={() => setIsChartModalOpen(true)}
        hasImage={!!imageSrc}
        onExportCalibration={handleExportCalibration}
        onImportCalibration={handleImportCalibration}
        iterIterations={iterIterations}
        setIterIterations={setIterIterations}
        iterPercentage={iterPercentage}
        setIterPercentage={setIterPercentage}
      />

      <DataModal 
        isOpen={isDataModalOpen} 
        onClose={() => setIsDataModalOpen(false)} 
        ellipses={ellipses} 
        calibration={calibration}
      />
      
      <SectorViewModal 
        isOpen={isSectorModalOpen} 
        onClose={() => setIsSectorModalOpen(false)} 
        imageSrc={imageSrc} 
        calibration={calibration}
      />

      <CalibrationChartModal
        isOpen={isChartModalOpen}
        onClose={() => setIsChartModalOpen(false)}
        ellipses={ellipses}
        calibration={calibration}
      />
    </div>
  );
}