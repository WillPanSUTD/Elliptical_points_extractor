import { EllipseData, CalibrationResult } from '../types';

/**
 * Calculates the Sector Transformation parameters based on ellipse aspect ratios.
 * Model: AspectRatio (rx/ry) = A * x + B
 * Rotation Center X = -B / A
 */
export const calculateSectorCalibration = (ellipses: EllipseData[]): CalibrationResult => {
  if (ellipses.length < 3) {
    return { rotationCenterX: 0, slope: 0, intercept: 0, rSquared: 0, isValid: false };
  }

  // Prepare data points: X = cx, Y = Aspect Ratio
  // We used to use rx/ry. However, imageProcessing returns rx as Major Axis and ry as Minor Axis (sorted by size).
  // If the ellipses are tall (dy > dx), rx is Height, ry is Width.
  // Then rx/ry > 1.
  // But physically in a sector scan, Aspect Ratio (Width/Height) should be proportional to R.
  // If R is small/slow scan, Width/Height < 1.
  // To fix this, we calculate the Bounding Box Width and Height.
  
  const n = ellipses.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  ellipses.forEach(e => {
    const x = e.cx;
    
    // Calculate projected width and height (Bounding Box)
    // Width = 2 * sqrt( (rx * cos theta)^2 + (ry * sin theta)^2 )
    // Height = 2 * sqrt( (rx * sin theta)^2 + (ry * cos theta)^2 )
    // This is robust against 90 degree rotations.
    
    const cosT = Math.cos(e.angle);
    const sinT = Math.sin(e.angle);
    
    const w = 2 * Math.sqrt(Math.pow(e.rx * cosT, 2) + Math.pow(e.ry * sinT, 2));
    const h = 2 * Math.sqrt(Math.pow(e.rx * sinT, 2) + Math.pow(e.ry * cosT, 2));
    
    const y = w / h; // Aspect Ratio (Width / Height)
    
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  });

  const denominator = (n * sumXX - sumX * sumX);
  
  if (Math.abs(denominator) < 1e-10) {
     return { rotationCenterX: 0, slope: 0, intercept: 0, rSquared: 0, isValid: false };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-Squared
  const ssTotal = sumYY - (sumY * sumY) / n;
  const ssRes = sumYY - intercept * sumY - slope * sumXY;
  // Handle perfect fit case or numerical noise
  const rSquared = ssTotal === 0 ? 0 : 1 - (ssRes / ssTotal);

  // Rotation Center is where Aspect Ratio would be 0
  // 0 = slope * x + intercept => x = -intercept / slope
  let rotationCenterX = 0;
  if (Math.abs(slope) > 1e-10) {
      rotationCenterX = -intercept / slope;
  }

  return {
    rotationCenterX,
    slope, // slope corresponds to Radians per Pixel (Y-axis) roughly
    intercept,
    rSquared: Math.abs(rSquared),
    isValid: Math.abs(rSquared) > 0.6 
  };
};

export const getPhysicalDimensions = (e: EllipseData, cal: CalibrationResult) => {
    if (!cal.isValid) return { radius: 0, arc: 0 };
    
    // Physical Radius in pixels relative to rotation center
    const R = e.cx - cal.rotationCenterX;
    
    // Physical Arc Length (approximate relative value)
    const Arc = e.cy * R; 

    return { radius: R, arc: Arc };
};

/**
 * Generates a Sector (Fan) view from the rectangular raw data using the calibration.
 * Performs an Inverse Mapping from the Target (Fan) coordinates back to Source (Rect) coordinates.
 */
export const generateSectorImage = async (
  imageSrc: string,
  calibration: CalibrationResult
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      try {
        // 1. Setup Source Canvas
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        const srcCtx = srcCanvas.getContext('2d');
        if (!srcCtx) throw new Error('Could not create source context');
        srcCtx.drawImage(img, 0, 0);
        const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

        // 2. Calculate Geometry
        // Slope corresponds to Radians per Pixel (Y-axis)
        // Note: AR = Width/Height. 
        // Width = 1 * R_radial. Height = R_radial * dTheta/dPixelY.
        // AR = dTheta/dPixelY * R ?? No.
        // ArcLength = R * dTheta. Height_px = ArcLength / (1?).
        // Actually: AR = Width_px / Height_px.
        // Width_px ~ Constant (Radial resolution).
        // Height_px ~ 1/R.
        // AR ~ R. Slope is d(AR)/dx.
        // Slope relates strictly to angular resolution.
        
        const slope = Math.abs(calibration.slope); 
        const totalAngle = slope * img.height; 
        
        const rotationCenterX = calibration.rotationCenterX;
        
        // Define Radial bounds based on image width
        // Assume x=0 is left, x=W is right.
        // R = x - rotationCenterX.
        const rMin = 0 - rotationCenterX;
        const rMax = img.width - rotationCenterX;

        // Bounding Box Calculation for the Output Canvas
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

        // Add padding
        const padding = 20;
        const outWidth = Math.ceil(maxU - minU + padding * 2);
        const outHeight = Math.ceil(maxV - minV + padding * 2);

        // 3. Create Output Canvas
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

        // 4. Inverse Mapping Loop
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