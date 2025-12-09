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

  // Prepare data points: X = cx, Y = Aspect Ratio (rx / ry)
  // We use rx/ry because in a sector scan:
  // rx (radial width) is roughly constant for a fixed object size.
  // ry (azimuthal height) shrinks as Radius increases (ry ~ 1/R).
  // Therefore, rx/ry scales linearly with Radius (R).
  // Since R = x - x_center, rx/ry is linear with x.
  
  const n = ellipses.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  ellipses.forEach(e => {
    const x = e.cx;
    const y = e.rx / e.ry;
    
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

  // Rotation Center is where Aspect Ratio would be 0 (Infinite Height / Zero Radius)
  // 0 = slope * x + intercept => x = -intercept / slope
  let rotationCenterX = 0;
  if (Math.abs(slope) > 1e-10) {
      rotationCenterX = -intercept / slope;
  }

  return {
    rotationCenterX,
    slope,
    intercept,
    rSquared: Math.abs(rSquared), // Ensure positive
    isValid: Math.abs(rSquared) > 0.6 // Basic validity check
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
        // Slope corresponds to Radians per Y-Pixel (approximately)
        // Total Angle Span = Slope * Image Height
        // If slope is negative, we take absolute value (direction handled by sign)
        const slope = Math.abs(calibration.slope); 
        const totalAngle = slope * img.height; 
        
        const rotationCenterX = calibration.rotationCenterX;
        
        // Define Radial bounds based on image width
        // Assume x=0 is left, x=W is right.
        // R = x - rotationCenterX.
        const rMin = 0 - rotationCenterX;
        const rMax = img.width - rotationCenterX;

        // Bounding Box Calculation for the Output Canvas
        // Fan centers at (0,0) in polar space.
        // We scan theta from -totalAngle/2 to +totalAngle/2
        // We essentially want to draw the arc.
        
        // To keep it simple and upright-ish:
        // Let's assume the fan opens towards the right (Positive X) like typical math polar coords
        // if we mapped X_source -> R, Y_source -> Theta.
        
        // We need to find the bounding box of the fan shape in Cartesian (u, v) space.
        // u = R * cos(theta), v = R * sin(theta)
        // theta range: [-totalAngle/2, totalAngle/2]
        // R range: [rMin, rMax]
        
        // Corners of the annular sector:
        const corners = [];
        const thetas = [-totalAngle/2, totalAngle/2];
        const radii = [rMin, rMax];
        
        // Extreme points for bounding box
        for(let r of radii) {
            for(let t of thetas) {
                corners.push({ u: r * Math.cos(t), v: r * Math.sin(t) });
            }
        }
        // Also check arc extreme (max X is at theta=0 if included)
        if (thetas[0] < 0 && thetas[1] > 0) {
            corners.push({ u: rMax, v: 0 }); // Max extents right
            // corners.push({ u: rMin, v: 0 }); // Min extents right (hole)
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
        
        // Offset to center the sector in the canvas
        const offU = -minU + padding;
        const offV = -minV + padding;

        const srcW = img.width;
        const srcH = img.height;
        const data = srcData.data;
        const outData = outImageData.data;

        // 4. Inverse Mapping Loop
        // Iterate over every pixel in output canvas (u_out, v_out)
        // Convert to Polar (r, theta)
        // Check if in valid range
        // Map to Source (x, y)
        // Bilinear Sample

        for (let py = 0; py < outHeight; py++) {
            for (let px = 0; px < outWidth; px++) {
                // Coordinate relative to fan origin
                const u = px - offU;
                const v = py - offV;
                
                // Polar conversion
                const r = Math.sqrt(u*u + v*v);
                let theta = Math.atan2(v, u);

                // Check bounds
                if (r >= rMin && r <= rMax && theta >= -totalAngle/2 && theta <= totalAngle/2) {
                    
                    // Map back to Source X
                    // r = x - rotationCenterX  => x = r + rotationCenterX
                    const srcX = r + rotationCenterX;

                    // Map back to Source Y
                    // theta = slope * (y - height/2)  (Centering theta around middle of image height)
                    // y = theta / slope + height/2
                    const srcY = (theta / slope) + (srcH / 2);

                    // Nearest Neighbor Sampling (for speed/simplicity)
                    // Check bounds
                    if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
                        const ix = Math.floor(srcX);
                        const iy = Math.floor(srcY);
                        const srcIdx = (iy * srcW + ix) * 4;
                        const outIdx = (py * outWidth + px) * 4;

                        outData[outIdx] = data[srcIdx];
                        outData[outIdx + 1] = data[srcIdx + 1];
                        outData[outIdx + 2] = data[srcIdx + 2];
                        outData[outIdx + 3] = 255; // Alpha
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