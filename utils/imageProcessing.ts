import { ROI, EllipseData, ProcessingMode, CorrectionMetrics, CorrectionAnalysisResult } from '../types';
import { filterEllipsesByTrend } from './calibration';

// Helper to get luminance from RGB
const getLuminance = (r: number, g: number, b: number) => {
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

// Calculate ellipse parameters from raw moments
const calculateEllipseFromMoments = (
  id: number,
  m00: number, 
  m10: number, 
  m01: number, 
  m11: number, 
  m20: number, 
  m02: number,
  offsetX: number,
  offsetY: number
): EllipseData => {
  // Centroid
  const xc = m10 / m00;
  const yc = m01 / m00;

  // Central moments
  const mu20 = m20 / m00 - xc * xc;
  const mu02 = m02 / m00 - yc * yc;
  const mu11 = m11 / m00 - xc * yc;

  // Eigenvalues of the covariance matrix
  const common = Math.sqrt(4 * mu11 * mu11 + (mu20 - mu02) * (mu20 - mu02));
  const lambda1 = (mu20 + mu02 + common) / 2;
  const lambda2 = (mu20 + mu02 - common) / 2;

  // 2-sigma radius
  const rx = 2 * Math.sqrt(Math.abs(lambda1));
  const ry = 2 * Math.sqrt(Math.abs(lambda2));

  // Angle
  let angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);

  return {
    id,
    cx: offsetX + xc,
    cy: offsetY + yc,
    rx: Math.max(1, rx),
    ry: Math.max(1, ry),
    angle: angle,
    status: 'active'
  };
};

export const extractEllipseFromROI = (
  ctx: CanvasRenderingContext2D,
  roi: ROI,
  mode: ProcessingMode
): EllipseData => {
  const maxRadius = Math.max(roi.rx, roi.ry);
  const startX = Math.floor(Math.max(0, roi.cx - maxRadius));
  const startY = Math.floor(Math.max(0, roi.cy - maxRadius));
  const endX = Math.ceil(Math.min(ctx.canvas.width, roi.cx + maxRadius));
  const endY = Math.ceil(Math.min(ctx.canvas.height, roi.cy + maxRadius));
  
  const width = endX - startX;
  const height = endY - startY;

  if (width <= 0 || height <= 0) {
    return { id: roi.id, cx: roi.cx, cy: roi.cy, rx: roi.rx, ry: roi.ry, angle: roi.rotation, status: 'active' };
  }

  const imageData = ctx.getImageData(startX, startY, width, height);
  const data = imageData.data;
  const cosT = Math.cos(-roi.rotation);
  const sinT = Math.sin(-roi.rotation);
  
  const pixels: {x: number, y: number, val: number}[] = [];
  let minVal = 255;
  let maxVal = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const px = startX + col; 
      const py = startY + row;
      const tx = px - roi.cx;
      const ty = py - roi.cy;
      const rx_coord = tx * cosT - ty * sinT;
      const ry_coord = tx * sinT + ty * cosT;

      if ((rx_coord*rx_coord)/(roi.rx*roi.rx) + (ry_coord*ry_coord)/(roi.ry*roi.ry) > 1) continue;

      const idx = (row * width + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      let val = getLuminance(r, g, b);
      if (mode === 'dark') val = 255 - val;
      
      pixels.push({ x: col, y: row, val });
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
  }

  if (pixels.length === 0) return { id: roi.id, cx: roi.cx, cy: roi.cy, rx: roi.rx, ry: roi.ry, angle: roi.rotation, status: 'active' };

  const range = maxVal - minVal;
  const threshold = range > 10 ? (minVal + range * 0.5) : minVal;

  let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;
  let validPixels = 0;

  for (const p of pixels) {
      if (p.val >= threshold) {
          const weight = p.val - threshold + 1;
          m00 += weight; m10 += weight * p.x; m01 += weight * p.y;
          m11 += weight * p.x * p.y; m20 += weight * p.x * p.x; m02 += weight * p.y * p.y;
          validPixels++;
      }
  }

  if (m00 === 0 || validPixels < 3) {
      m00 = 0; m10 = 0; m01 = 0; m11 = 0; m20 = 0; m02 = 0;
      for (const p of pixels) {
          const weight = p.val; 
          m00 += weight; m10 += weight * p.x; m01 += weight * p.y;
          m11 += weight * p.x * p.y; m20 += weight * p.x * p.x; m02 += weight * p.y * p.y;
      }
  }

  return calculateEllipseFromMoments(roi.id, m00, m10, m01, m11, m20, m02, startX, startY);
};

export interface AnalysisOptions {
    threshold?: number;
    minRadius?: number;
    maxRadius?: number;
}

// Distance from point (px,py) to infinite line passing through (x1,y1) and (x2,y2)
const distanceToLine = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const len_sq = C * C + D * D;
    if (len_sq === 0) return Math.sqrt(A*A + B*B);
    const cross = C * B - D * A; // Z component of cross product
    return Math.abs(cross) / Math.sqrt(len_sq);
};

// Robust line fit using RANSAC to find the "direction with most centers"
const findDominantLine = (ellipses: EllipseData[], width: number, height: number) => {
    if (ellipses.length < 2) return undefined;

    const n = ellipses.length;
    let bestCount = 0;
    let bestError = Infinity;
    let bestLine = { x1: 0, y1: 0, x2: 0, y2: 0 };
    
    // Heuristic threshold: Average radius or a fixed value like 20px
    const avgRadius = ellipses.reduce((sum, e) => sum + Math.max(e.rx, e.ry), 0) / n;
    const threshold = Math.max(avgRadius, 10);

    // Limit iterations for performance if N is large, but for spots N is usually small (<100)
    const pairs = [];
    if (n < 50) {
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) pairs.push([i, j]);
        }
    } else {
        for (let k = 0; k < 500; k++) {
            const i = Math.floor(Math.random() * n);
            let j = Math.floor(Math.random() * n);
            while(i===j) j = Math.floor(Math.random() * n);
            pairs.push([i, j]);
        }
    }

    pairs.forEach(([i, j]) => {
        const p1 = ellipses[i];
        const p2 = ellipses[j];
        
        let inliers = 0;
        let errorSum = 0;
        
        // Count inliers
        for (let k = 0; k < n; k++) {
            const dist = distanceToLine(ellipses[k].cx, ellipses[k].cy, p1.cx, p1.cy, p2.cx, p2.cy);
            if (dist < threshold) {
                inliers++;
                errorSum += dist;
            }
        }
        
        // We prefer more inliers. If equal, prefer lower error (tighter line)
        // Weighting: Count is dominant.
        if (inliers > bestCount || (inliers === bestCount && errorSum < bestError)) {
            bestCount = inliers;
            bestError = errorSum;
            bestLine = { x1: p1.cx, y1: p1.cy, x2: p2.cx, y2: p2.cy };
        }
    });

    if (bestCount < 2) return undefined;

    // Refine the line using Least Squares on the inliers
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    let count = 0;
    let minX = Infinity, maxX = -Infinity;
    
    // Identify inliers again for LS
    const inliers: EllipseData[] = [];
    ellipses.forEach(e => {
        const dist = distanceToLine(e.cx, e.cy, bestLine.x1, bestLine.y1, bestLine.x2, bestLine.y2);
        if (dist < threshold) {
            sumX += e.cx;
            sumY += e.cy;
            sumXY += e.cx * e.cy;
            sumXX += e.cx * e.cx;
            minX = Math.min(minX, e.cx);
            maxX = Math.max(maxX, e.cx);
            count++;
            inliers.push(e);
        }
    });

    // Check if vertical
    const isVertical = Math.abs(bestLine.x2 - bestLine.x1) < 1e-5;
    
    if (isVertical) {
        const avgX = sumX / count;
        let minY = Infinity, maxY = -Infinity;
        inliers.forEach(e => {
            minY = Math.min(minY, e.cy);
            maxY = Math.max(maxY, e.cy);
        });
        return { x1: avgX, y1: minY, x2: avgX, y2: maxY, inliers, vx: 0, vy: 1 };
    } else {
        const slope = (count * sumXY - sumX * sumY) / (count * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / count;
        
        const y1 = slope * minX + intercept;
        const y2 = slope * maxX + intercept;
        
        // Normalize direction vector
        const len = Math.sqrt(1 + slope*slope);
        
        return { 
            x1: minX, y1, x2: maxX, y2, 
            inliers,
            vx: 1/len, vy: slope/len
        };
    }
};

/**
 * Analyzes spots in the corrected image to provide discriminative metrics.
 */
export const analyzeTransformedSpots = (
  ctx: CanvasRenderingContext2D,
  mode: ProcessingMode,
  optionsOrThreshold?: number | AnalysisOptions
): CorrectionAnalysisResult => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  
  // Parse options
  let thresholdOverride: number | undefined;
  let minRadius = 2;
  let maxRadius = Math.max(width, height) / 2;

  if (typeof optionsOrThreshold === 'number') {
      thresholdOverride = optionsOrThreshold;
  } else if (typeof optionsOrThreshold === 'object') {
      if (optionsOrThreshold.threshold !== undefined) thresholdOverride = optionsOrThreshold.threshold;
      if (optionsOrThreshold.minRadius !== undefined) minRadius = optionsOrThreshold.minRadius;
      if (optionsOrThreshold.maxRadius !== undefined) maxRadius = optionsOrThreshold.maxRadius;
  }
  
  // 1. Thresholding
  let threshold = 128;
  if (thresholdOverride !== undefined) {
      threshold = thresholdOverride;
  } else {
      // Auto-Calculate Threshold based on image statistics
      const imageData = ctx.getImageData(0, 0, width, height);
      let minLum = 255, maxLum = 0;
      for (let i = 0; i < imageData.data.length; i += 16) {
          const l = getLuminance(imageData.data[i], imageData.data[i+1], imageData.data[i+2]);
          if (l < minLum) minLum = l;
          if (l > maxLum) maxLum = l;
      }
      threshold = (minLum + maxLum) / 2;
  }

  // 2. Detect with threshold and radius limits
  const { ellipses } = autoDetectEllipses(ctx, mode, threshold, minRadius, maxRadius, false);
  
  const emptyMetrics: CorrectionMetrics = { 
    meanRoundness: 0,
    radiusMean: 0,
    radiusStdDev: 0,
    radiusCV: 1,
    spacingMean: 0,
    spacingStdDev: 0,
    spacingCV: 1,
    linearityRMS: 0,
    linearityRelative: 1,
    scoreRoundness: 0,
    scoreLinearity: 0,
    scoreConsistency: 0,
    finalScore: 0,
    sampleCount: ellipses.length 
  };

  if (ellipses.length < 2) {
    return { metrics: emptyMetrics, ellipses };
  }

  // 1. Roundness Analysis
  let totalRoundness = 0;
  const radii: number[] = [];
  
  ellipses.forEach(e => {
    const roundness = Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry);
    totalRoundness += roundness;
    radii.push((e.rx + e.ry) / 2);
  });

  const meanRoundness = totalRoundness / ellipses.length;

  // 2. Size Consistency (Dispersion)
  const radiusMean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const radiusVar = radii.reduce((a, b) => a + Math.pow(b - radiusMean, 2), 0) / radii.length;
  const radiusStdDev = Math.sqrt(radiusVar);
  const radiusCV = radiusMean > 0 ? radiusStdDev / radiusMean : 1;


  // 3. Linearity Analysis using RANSAC Grid Orientation
  const domLine = findDominantLine(ellipses, width, height);
  
  // Default values if line finding fails
  let linearityRMS = 0;
  let vx = 1, vy = 0; // Default Horizontal
  let linePoints = undefined;
  
  if (domLine) {
      linePoints = { x1: domLine.x1, y1: domLine.y1, x2: domLine.x2, y2: domLine.y2 };
      vx = domLine.vx;
      vy = domLine.vy;

      // Calculate Grid Linearity (Grid-Aware)
      // Rotate points so the dominant line is horizontal
      const cosT = vx; 
      const sinT = vy;
      
      const rotated = ellipses.map(e => ({
          ...e,
          // We rotate by -angle. 
          // New X = x * cos + y * sin (Projection onto line)
          // New Y = -x * sin + y * cos (Projection onto normal / Distance from line)
          u: e.cx * cosT + e.cy * sinT,
          v: -e.cx * sinT + e.cy * cosT
      }));

      // Find rows by clustering V coordinates
      // Sort by V
      rotated.sort((a, b) => a.v - b.v);
      
      const rows: typeof rotated[] = [];
      if (rotated.length > 0) {
          let currentRow = [rotated[0]];
          const rowGapThreshold = radiusMean; // If gap > radius, new row
          
          for (let i = 1; i < rotated.length; i++) {
              if (Math.abs(rotated[i].v - rotated[i-1].v) < rowGapThreshold) {
                  currentRow.push(rotated[i]);
              } else {
                  rows.push(currentRow);
                  currentRow = [rotated[i]];
              }
          }
          rows.push(currentRow);
      }

      // Calculate RMS of V within each row (straightness of rows)
      let sumSquaredResiduals = 0;
      let totalPoints = 0;
      
      rows.forEach(row => {
          if (row.length < 2) return; // Ignore single points
          const meanV = row.reduce((sum, p) => sum + p.v, 0) / row.length;
          row.forEach(p => {
              sumSquaredResiduals += Math.pow(p.v - meanV, 2);
          });
          totalPoints += row.length;
      });

      if (totalPoints > 0) {
          linearityRMS = Math.sqrt(sumSquaredResiduals / totalPoints);
      }
  }

  const linearityRelative = radiusMean > 0 ? linearityRMS / radiusMean : 1;

  // 4. Spacing Analysis (Along the dominant direction)
  let spacingMean = 0;
  let spacingStdDev = 0;
  let spacingCV = 0;

  // Sort by projection onto dominant axis (U coordinate)
  const sortedEllipses = [...ellipses].map(e => ({
      ...e,
      t: e.cx * vx + e.cy * vy
  })).sort((a, b) => a.t - b.t);

  // We should only measure spacing between NEIGHBORS in the grid structure.
  // Using the simple sorted list works if it's a single line. 
  // If it's a grid, we should calculate spacing within rows/cols.
  // Let's use the 'rows' logic implicitly by checking spatial proximity.
  
  const spacings: number[] = [];
  for (let i = 0; i < sortedEllipses.length - 1; i++) {
      const p1 = sortedEllipses[i];
      const p2 = sortedEllipses[i+1];
      const dist = Math.sqrt(Math.pow(p2.cx - p1.cx, 2) + Math.pow(p2.cy - p1.cy, 2));
      // Only count if they are close enough to be neighbors (e.g. < 5 * radius)
      if (dist < radiusMean * 5) {
          spacings.push(dist);
      }
  }

  if (spacings.length > 0) {
      spacingMean = spacings.reduce((a, b) => a + b, 0) / spacings.length;
      const spacingVar = spacings.reduce((a, b) => a + Math.pow(b - spacingMean, 2), 0) / spacings.length;
      spacingStdDev = Math.sqrt(spacingVar);
      spacingCV = spacingMean > 0 ? spacingStdDev / spacingMean : 1;
  }

  // 6. Exponential Decay Scoring
  const scoreRoundness = Math.round(100 * Math.exp(-3 * (1 - meanRoundness)));
  // Linearity score: RMS error of 10% radius -> ~60 score. 
  const scoreLinearity = Math.round(100 * Math.exp(-5 * linearityRelative));
  
  // Consistency score
  const combinedCV = (radiusCV + spacingCV) / 2;
  const scoreConsistency = Math.round(100 * Math.exp(-3 * combinedCV));

  const finalScore = Math.round(
      0.40 * scoreRoundness + 
      0.35 * scoreLinearity + 
      0.25 * scoreConsistency
  );

  const metrics = {
    meanRoundness,
    radiusMean,
    radiusStdDev,
    radiusCV,
    spacingMean,
    spacingStdDev,
    spacingCV,
    linearityRMS,
    linearityRelative,
    scoreRoundness,
    scoreLinearity,
    scoreConsistency,
    finalScore,
    sampleCount: ellipses.length
  };

  return { metrics, ellipses: sortedEllipses, bestFitLine: linePoints };
};

export const autoDetectEllipses = (
  ctx: CanvasRenderingContext2D,
  mode: ProcessingMode,
  threshold: number,
  minRadius: number,
  maxRadius: number,
  enableFiltering: boolean = true
): { ellipses: EllipseData[], rois: ROI[] } => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const visited = new Uint8Array(width * height);
  const detected: EllipseData[] = [];
  
  const isTarget = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = getLuminance(r, g, b);
    return mode === 'dark' ? lum < threshold : lum > threshold;
  };

  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (visited[pos]) continue;
      
      if (isTarget(pos * 4)) {
        stack.push(pos);
        visited[pos] = 1;
        let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        let count = 0;

        while (stack.length > 0) {
          const curr = stack.pop()!;
          const cy = Math.floor(curr / width);
          const cx = curr % width;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          m00 += 1; m10 += cx; m01 += cy;
          m11 += cx * cy; m20 += cx * cx; m02 += cy * cy;
          count++;

          const neighbors = [curr - 1, curr + 1, curr - width, curr + width];
          for (const n of neighbors) {
            if (n >= 0 && n < width * height && !visited[n]) {
              if ((curr % width === 0 && n === curr - 1) || (curr % width === width - 1 && n === curr + 1)) continue;
              if (isTarget(n * 4)) {
                visited[n] = 1;
                stack.push(n);
              }
            }
          }
        }
        
        // Lowered minimum pixel count from 10 to 5 to catch small dots
        if (count > 5 && count < (width * height * 0.4)) {
           const rawEllipse = calculateEllipseFromMoments(0, m00, m10, m01, m11, m20, m02, 0, 0);
           if (rawEllipse.rx >= minRadius && rawEllipse.rx <= maxRadius && 
               rawEllipse.ry >= minRadius && rawEllipse.ry <= maxRadius) {
               const aspectRatio = Math.max(rawEllipse.rx, rawEllipse.ry) / Math.min(rawEllipse.rx, rawEllipse.ry);
               if (aspectRatio < 5) detected.push(rawEllipse);
           }
        }
      }
    }
  }

  detected.sort((a, b) => a.cy - b.cy);
  if (detected.length > 0) {
      const sorted: EllipseData[] = [];
      let currentRow: EllipseData[] = [detected[0]];
      const rowTolerance = Math.max(detected[0].ry, 10);
      for (let i = 1; i < detected.length; i++) {
          const curr = detected[i];
          const avgY = currentRow.reduce((sum, e) => sum + e.cy, 0) / currentRow.length;
          if (Math.abs(curr.cy - avgY) < rowTolerance * 1.5) {
              currentRow.push(curr);
          } else {
              currentRow.sort((a, b) => a.cx - b.cx);
              sorted.push(...currentRow);
              currentRow = [curr];
          }
      }
      currentRow.sort((a, b) => a.cx - b.cx);
      sorted.push(...currentRow);
      detected.length = 0;
      detected.push(...sorted);
  }

  const finalSource = enableFiltering ? filterEllipsesByTrend(detected) : detected;
  
  const finalEllipses: EllipseData[] = [];
  const finalRois: ROI[] = [];
  finalSource.forEach((d, idx) => {
      const newId = Date.now() + idx; 
      finalEllipses.push({ ...d, id: newId });
      finalRois.push({ id: newId, cx: d.cx, cy: d.cy, rx: d.rx * 1.2, ry: d.ry * 1.2, rotation: d.angle });
  });

  return { ellipses: finalEllipses, rois: finalRois };
};