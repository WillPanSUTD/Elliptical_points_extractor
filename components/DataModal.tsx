import React from 'react';
import { EllipseData, CalibrationResult } from '../types';
import { X, FileJson, FileText, ClipboardCheck, ScanLine } from 'lucide-react';
import { getPhysicalDimensions } from '../utils/calibration';

interface DataModalProps {
  isOpen: boolean;
  onClose: () => void;
  ellipses: EllipseData[];
  calibration: CalibrationResult | null;
}

export const DataModal: React.FC<DataModalProps> = ({ isOpen, onClose, ellipses, calibration }) => {
  const [copied, setCopied] = React.useState<'json' | 'csv' | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, type: 'json' | 'csv') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const getCSV = () => {
    let header = "ID,Center_X,Center_Y,Radius_X,Radius_Y,Angle_Degrees";
    if (calibration && calibration.isValid) {
        header += ",Phys_Radius,Phys_Arc,Rotation_Center_X";
    }
    header += "\n";

    const rows = ellipses.map((e, idx) => {
      let row = `${idx + 1},${e.cx.toFixed(3)},${e.cy.toFixed(3)},${e.rx.toFixed(3)},${e.ry.toFixed(3)},${(e.angle * 180 / Math.PI).toFixed(3)}`;
      
      if (calibration && calibration.isValid) {
          const { radius, arc } = getPhysicalDimensions(e, calibration);
          row += `,${radius.toFixed(3)},${arc.toFixed(3)},${calibration.rotationCenterX.toFixed(3)}`;
      }
      return row;
    }).join("\n");
    return header + rows;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700 bg-slate-800/50 rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
               Extracted Parameters
               {calibration && calibration.isValid && (
                   <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                       <ScanLine className="w-3 h-3" />
                       Calibrated
                   </span>
               )}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Geometric data {calibration?.isValid ? '& sector correction' : ''} for all regions.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-0">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-800 shadow-sm z-10">
              <tr className="border-b border-slate-700 text-slate-300 text-xs uppercase tracking-wider">
                <th className="p-4 font-semibold">ID</th>
                <th className="p-4 font-semibold text-right">Center X (px)</th>
                <th className="p-4 font-semibold text-right">Center Y (px)</th>
                <th className="p-4 font-semibold text-right">Rx (Width)</th>
                <th className="p-4 font-semibold text-right">Ry (Height)</th>
                <th className="p-4 font-semibold text-right">Rot (°)</th>
                {calibration && calibration.isValid && (
                    <>
                        <th className="p-4 font-semibold text-right bg-emerald-950/20 text-emerald-400">Phys. Radius</th>
                        <th className="p-4 font-semibold text-right bg-emerald-950/20 text-emerald-400">Phys. Arc</th>
                    </>
                )}
              </tr>
            </thead>
            <tbody className="text-slate-300 divide-y divide-slate-800/50 bg-slate-900/50">
              {ellipses.map((e, idx) => {
                const phys = calibration?.isValid ? getPhysicalDimensions(e, calibration) : null;
                return (
                    <tr key={e.id} className="hover:bg-slate-800 transition-colors group">
                    <td className="p-4 font-mono text-blue-400 font-bold group-hover:text-blue-300">
                        #{idx + 1}
                    </td>
                    <td className="p-4 font-mono text-right text-slate-300">
                        {e.cx.toFixed(2)}
                    </td>
                    <td className="p-4 font-mono text-right text-slate-300">
                        {e.cy.toFixed(2)}
                    </td>
                    <td className="p-4 font-mono text-right text-slate-400">
                        {e.rx.toFixed(2)}
                    </td>
                    <td className="p-4 font-mono text-right text-slate-400">
                        {e.ry.toFixed(2)}
                    </td>
                    <td className="p-4 font-mono text-right text-purple-400/90">
                        {(e.angle * 180 / Math.PI).toFixed(2)}°
                    </td>
                    {phys && (
                        <>
                            <td className="p-4 font-mono text-right text-emerald-300 bg-emerald-900/10 font-bold">
                                {phys.radius.toFixed(1)}
                            </td>
                            <td className="p-4 font-mono text-right text-emerald-300 bg-emerald-900/10">
                                {Math.round(phys.arc).toLocaleString()}
                            </td>
                        </>
                    )}
                    </tr>
                );
              })}
              {ellipses.length === 0 && (
                 <tr>
                    <td colSpan={calibration?.isValid ? 8 : 6} className="text-center py-16 text-slate-500">
                        No data extracted yet. Please process the image first.
                    </td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-700 bg-slate-800/30 rounded-b-xl flex flex-wrap gap-4 items-center">
             <div className="text-xs text-slate-500 hidden sm:block">
                Tip: "Phys. Radius" is relative to the calculated Rotation Center.
             </div>
             <div className="flex-1"></div>
             
             <button 
                onClick={() => copyToClipboard(JSON.stringify(ellipses, null, 2), 'json')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition hover:border-orange-500/50 group"
             >
                {copied === 'json' ? <ClipboardCheck className="w-4 h-4 text-green-500" /> : <FileJson className="w-4 h-4 text-orange-400 group-hover:scale-110 transition-transform" />}
                <span className={copied === 'json' ? "text-green-500" : "text-slate-200"}>
                    {copied === 'json' ? "Copied JSON" : "Copy JSON"}
                </span>
             </button>
             
             <button 
                onClick={() => copyToClipboard(getCSV(), 'csv')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm font-medium transition hover:border-green-500/50 group"
             >
                {copied === 'csv' ? <ClipboardCheck className="w-4 h-4 text-green-500" /> : <FileText className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />}
                <span className={copied === 'csv' ? "text-green-500" : "text-slate-200"}>
                    {copied === 'csv' ? "Copied CSV" : "Copy CSV"}
                </span>
             </button>

             <div className="h-8 w-px bg-slate-700 mx-2 hidden sm:block"></div>

             <button 
                onClick={onClose}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-blue-900/20"
             >
                Close
             </button>
        </div>
      </div>
    </div>
  );
};