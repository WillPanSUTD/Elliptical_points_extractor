import { EllipseData, CalibrationResult, CalibrationMethod } from '../types';

/**
 * Helper to calculate Aspect Ratio (Width/Height) of the bounding box.
 */
const getAspectRatio = (e: EllipseData) => {
    const cosT = Math.cos(e.angle);
    const sinT = Math.sin(e.angle);
    const w = 2 * Math.sqrt(Math.pow(e.rx * cosT, 2) + Math.pow(e.ry * sinT, 2));
    const h = 2 * Math.sqrt(Math.pow(e.rx * sinT, 2) + Math.pow(e.ry * cosT, 2));
    return w / h;
};

// --- RANSAC Implementation ---
const fitRansac = (data: {x: number, y: number}[], iterations: number = 100, threshold: number = 0.15) => {
    const n = data.length;
    if (n < 2) return null;

    let bestSlope = 0;
    let bestIntercept = 0;
    let maxInliers = 0;
    let bestInlierIndices: number[] = [];

    for (let i = 0; i < iterations; i++) {
        // 1. Pick two random points
        const idx1 = Math.floor(Math.random() * n);
        let idx2 = Math.floor(Math.random() * n);
        while (idx1 === idx2) {
            idx2 = Math.floor(Math.random() * n);
        }

        const p1 = data[idx1];
        const p2 = data[idx2];

        // 2. Fit model
        if (Math.abs(p2.x - p1.x) < 1e-5) continue; // Vertical line check
        const slope = (p2.y - p1.y) / (p2.x - p1.x);
        const intercept = p1.y - slope * p1.x;

        // 3. Count inliers
        let currentInliers = 0;
        const currentInlierIndices: number[] = [];

        for (let j = 0; j < n; j++) {
            const predictedY = slope * data[j].x + intercept;
            const error = Math.abs(data[j].y - predictedY);
            if (error < threshold) {
                currentInliers++;
                currentInlierIndices.push(j);
            }
        }

        // 4. Update best
        if (currentInliers > maxInliers) {
            maxInliers = currentInliers;
            bestSlope = slope;
            bestIntercept = intercept;
            bestInlierIndices = currentInlierIndices;
        }
    }

    if (maxInliers < 2) return null;

    // 5. Refine using Least Squares on ALL inliers
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const inlierCount = bestInlierIndices.length;
    
    bestInlierIndices.forEach(idx => {
        const p = data[idx];
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
    });

    const refinedSlope = (inlierCount * sumXY - sumX * sumY) / (inlierCount * sumXX - sumX * sumX);
    const refinedIntercept = (sumY - refinedSlope * sumX) / inlierCount;

    return {
        slope: refinedSlope,
        intercept: refinedIntercept,
        inlierIndices: new Set(bestInlierIndices)
    };
};

// --- Iterative Removal Implementation ---
const fitIterative = (data: {x: number, y: number}[], iterations: number, percentage: number) => {
    // Store original index to return the correct set of inliers
    let currentData = data.map((p, i) => ({ ...p, originalIndex: i }));
    
    for (let k = 0; k < iterations; k++) {
        if (currentData.length < 3) break;

        // 1. Fit Linear on current set
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = currentData.length;
        currentData.forEach(p => {
             sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
        });
        
        const denom = (n * sumXX - sumX * sumX);
        if (Math.abs(denom) < 1e-9) break;

        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;

        // 2. Calculate Residuals
        const residuals = currentData.map(p => ({
            ...p,
            res: Math.abs(p.y - (slope * p.x + intercept))
        }));

        // 3. Sort by residual (descending)
        residuals.sort((a, b) => b.res - a.res);

        // 4. Remove top %
        const countToRemove = Math.max(1, Math.floor(n * (percentage / 100)));
        const countToKeep = Math.max(3, n - countToRemove);
        
        // Keep the bottom 'countToKeep' (smallest residuals)
        currentData = residuals.slice(residuals.length - countToKeep);
    }

    // Final Fit on remaining data to get best line params (handled by main function, we just return indices)
    return new Set(currentData.map(d => d.originalIndex));
};

/**
 * Standard robust-ish linear fit (iterative removal based on std dev)
 */
const fitLinearWithOutlierRemoval = (data: {x: number, y: number}[]) => {
     // 1. Initial LS
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = data.length;

    data.forEach(p => {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumXX += p.x * p.x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // 2. Residuals
    const residuals = data.map(p => {
        const predicted = slope * p.x + intercept;
        return Math.abs(p.y - predicted);
    });

    const meanRes = residuals.reduce((a, b) => a + b, 0) / n;
    const variance = residuals.reduce((a, b) => a + Math.pow(b - meanRes, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const threshold = Math.max(stdDev * 2.0, 0.05);

    const inlierIndices = new Set<number>();
    residuals.forEach((res, i) => {
        if (res <= threshold) inlierIndices.add(i);
    });
    
    return { slope, intercept, inlierIndices };
};

export interface CalibrationOptions {
    iterativeIterations?: number;
    iterativePercentage?: number;
}

/**
 * Main Calibration Function
 */
export const calculateSectorCalibration = (
    ellipses: EllipseData[], 
    method: CalibrationMethod = 'linear',
    options: CalibrationOptions = {}
): { result: CalibrationResult, updatedEllipses: EllipseData[] } => {
  
  if (ellipses.length < 3) {
      const emptyRes = { rotationCenterX: 0, slope: 0, intercept: 0, angularResolution: 0, rSquared: 0, reprojectionError: 0, isValid: false };
      const resetEllipses = ellipses.map(e => ({ ...e, status: 'active' as const }));
      return { result: emptyRes, updatedEllipses: resetEllipses };
  }

  const data = ellipses.map(e => ({ x: e.cx, y: getAspectRatio(e) }));
  
  let slope = 0;
  let intercept = 0;
  let inlierIndices = new Set<number>();

  if (method === 'ransac') {
      const ransacRes = fitRansac(data);
      if (ransacRes) {
          slope = ransacRes.slope;
          intercept = ransacRes.intercept;
          inlierIndices = ransacRes.inlierIndices;
      }
  } else if (method === 'iterative') {
      const iterations = options.iterativeIterations || 3;
      const percentage = options.iterativePercentage || 10;
      const indices = fitIterative(data, iterations, percentage);
      
      inlierIndices = indices;
      
      // Calculate final LS params on inliers
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      let count = 0;
      data.forEach((p, i) => {
          if (inlierIndices.has(i)) {
              sumX += p.x; sumY += p.y; sumXY += p.x*p.y; sumXX += p.x*p.x;
              count++;
          }
      });
      if (count >= 2) {
          slope = (count * sumXY - sumX * sumY) / (count * sumXX - sumX * sumX);
          intercept = (sumY - slope * sumX) / count;
      }
      
  } else {
      // Linear (Direct with standard 2-sigma filter)
      const linRes = fitLinearWithOutlierRemoval(data);
      slope = linRes.slope;
      intercept = linRes.intercept;
      inlierIndices = linRes.inlierIndices;
  }

  // Calculate R-Squared and Reprojection Error (RMSE) using only Inliers
  let ssTotal = 0;
  let ssRes = 0;
  let validCount = 0;
  let sumY = 0;
  let sumSquaredError = 0;

  // First pass for mean Y of inliers
  data.forEach((p, i) => {
      if (inlierIndices.has(i)) {
          sumY += p.y;
          validCount++;
      }
  });
  const meanY = validCount > 0 ? sumY / validCount : 0;

  data.forEach((p, i) => {
      if (inlierIndices.has(i)) {
          const predicted = slope * p.x + intercept;
          const residual = p.y - predicted;
          
          ssTotal += Math.pow(p.y - meanY, 2);
          ssRes += Math.pow(residual, 2);
          
          // Sum of squared residuals for RMSE
          sumSquaredError += residual * residual;
      }
  });

  const rSquared = ssTotal === 0 ? 0 : 1 - (ssRes / ssTotal);
  
  // RMSE: Root Mean Square Error (Reprojection Error)
  // This represents the average deviation of the observed aspect ratio from the model
  const rmse = validCount > 0 ? Math.sqrt(sumSquaredError / validCount) : 0;
  
  let rotationCenterX = 0;
  if (Math.abs(slope) > 1e-10) {
      rotationCenterX = -intercept / slope;
  }

  const angularResolution = slope * (180 / Math.PI);
  
  // Construct Result
  const result: CalibrationResult = {
      rotationCenterX,
      slope,
      intercept,
      angularResolution,
      rSquared: Math.abs(rSquared),
      reprojectionError: rmse,
      isValid: validCount >= 3 && Math.abs(rSquared) > 0.5
  };

  // Update Ellipses Status
  const updatedEllipses = ellipses.map((e, i): EllipseData => ({
      ...e,
      status: inlierIndices.has(i) ? 'active' : 'outlier'
  }));

  return { result, updatedEllipses };
};

export const filterEllipsesByTrend = (ellipses: EllipseData[]): EllipseData[] => {
    // Basic linear filter for auto-detection
    const { updatedEllipses } = calculateSectorCalibration(ellipses, 'linear');
    return updatedEllipses;
};

export const getPhysicalDimensions = (e: EllipseData, cal: CalibrationResult) => {
    if (!cal.isValid) return { radius: 0, arc: 0 };
    const R = e.cx - cal.rotationCenterX;
    const Arc = e.cy * R; 
    return { radius: R, arc: Arc };
};

export const generateSectorImage = async (
  imageSrc: string,
  calibration: CalibrationResult
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      try {
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Could not create source context');
        srcCtx.drawImage(img, 0, 0);
        const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

        const slope = Math.abs(calibration.slope); 
        const totalAngle = slope * img.height; 
        
        const rotationCenterX = calibration.rotationCenterX;
        
        const rMin = 0 - rotationCenterX;
        const rMax = img.width - rotationCenterX;

        const corners = [];
        const thetas = [-totalAngle/2, totalAngle/2];
        const radii = [rMin, rMax];
        
        for(let r of radii) {
            for(let t of thetas) {
                corners.push({ u: r * Math.cos(t), v: r * Math.sin(t) });
            }
        }
        if (thetas[0] < 0 && thetas[1] > 0) {
            corners.push({ u: rMax, v: 0 }); 
        }

        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        corners.forEach(p => {
            minU = Math.min(minU, p.u);
            maxU = Math.max(maxU, p.u);
            minV = Math.min(minV, p.v);
            maxV = Math.max(maxV, p.v);
        });

        const padding = 20;
        const outWidth = Math.ceil(maxU - minU + padding * 2);
        const outHeight = Math.ceil(maxV - minV + padding * 2);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outWidth;
        outCanvas.height = outHeight;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) throw new Error('Could not create output context');
        
        const outImageData = outCtx.createImageData(outWidth, outHeight);
        
        const offU = -minU + padding;
        const offV = -minV + padding;

        const srcW = img.width;
        const srcH = img.height;
        const data = srcData.data;
        const outData = outImageData.data;

        for (let py = 0; py < outHeight; py++) {
            for (let px = 0; px < outWidth; px++) {
                const u = px - offU;
                const v = py - offV;
                
                const r = Math.sqrt(u*u + v*v);
                let theta = Math.atan2(v, u);

                if (r >= rMin && r <= rMax && theta >= -totalAngle/2 && theta <= totalAngle/2) {
                    
                    const srcX = r + rotationCenterX;
                    const srcY = (theta / slope) + (srcH / 2);

                    if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
                        const ix = Math.floor(srcX);
                        const iy = Math.floor(srcY);
                        const srcIdx = (iy * srcW + ix) * 4;
                        const outIdx = (py * outWidth + px) * 4;

                        outData[outIdx] = data[srcIdx];
                        outData[outIdx + 1] = data[srcIdx + 1];
                        outData[outIdx + 2] = data[srcIdx + 2];
                        outData[outIdx + 3] = 255; 
                    }
                }
            }
        }

        outCtx.putImageData(outImageData, 0, 0);
        resolve(outCanvas.toDataURL());

      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
  });
};