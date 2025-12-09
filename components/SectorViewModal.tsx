import React, { useEffect, useState } from 'react';
import { CalibrationResult } from '../types';
import { generateSectorImage } from '../utils/calibration';
import { X, Loader2, Maximize2 } from 'lucide-react';

interface SectorViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  calibration: CalibrationResult | null;
}

export const SectorViewModal: React.FC<SectorViewModalProps> = ({ 
  isOpen, 
  onClose, 
  imageSrc, 
  calibration 
}) => {
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && imageSrc && calibration && calibration.isValid) {
      setLoading(true);
      setError(null);
      generateSectorImage(imageSrc, calibration)
        .then(url => {
          setResultSrc(url);
          setLoading(false);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-slate-900/90 to-transparent z-10 flex justify-between items-start pointer-events-none">
            <div className="pointer-events-auto">
                <h2 className="text-xl font-bold text-white shadow-black drop-shadow-md">Sector Result</h2>
                <p className="text-sm text-slate-300 drop-shadow-md">
                   Transformed view based on calculated geometry.
                </p>
            </div>
            <button 
                onClick={onClose} 
                className="bg-black/50 hover:bg-slate-700 text-white p-2 rounded-full backdrop-blur-md transition pointer-events-auto"
            >
                <X className="w-6 h-6" />
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center bg-slate-950 overflow-hidden relative">
            {loading && (
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                    <span>Processing Transform...</span>
                </div>
            )}
            
            {error && (
                <div className="text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900/50">
                    {error}
                </div>
            )}

            {!loading && !error && resultSrc && (
                <div className="w-full h-full overflow-auto flex items-center justify-center custom-scrollbar p-8">
                     <img 
                        src={resultSrc} 
                        alt="Sector Result" 
                        className="max-w-none shadow-2xl border border-slate-800"
                        style={{ maxHeight: '100%', objectFit: 'contain' }}
                     />
                </div>
            )}

            {!loading && !calibration?.isValid && (
                 <div className="text-slate-500 text-center max-w-md p-6">
                    <p className="text-lg mb-2">Calibration Invalid</p>
                    <p>Cannot generate sector view. Please ensure at least 3 valid ellipses are extracted to calculate the transformation model.</p>
                 </div>
            )}
        </div>
      </div>
    </div>
  );
};
