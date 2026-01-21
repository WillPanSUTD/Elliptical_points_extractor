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
  if (m00 === 0) {
      return { id, cx: offsetX, cy: offsetY, rx: 1, ry: 1, angle: 0, status: 'active' };
  }
  const xc = m10 / m00;
  const yc = m01 / m00;
  const mu20 = m20 / m00 - xc * xc;
  const mu02 = m02 / m00 - yc * yc;
  const mu11 = m11 / m00 - xc * yc;
  const common = Math.sqrt(4 * mu11 * mu11 + (mu20 - mu02) * (mu20 - mu02));
  const lambda1 = Math.max(0, (mu20 + mu02 + common) / 2);
  const lambda2 = Math.max(0, (mu20 + mu02 - common) / 2);
  const rx = 2 * Math.sqrt(lambda1);
  const ry = 2 * Math.sqrt(lambda2);
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
  mode: ProcessingMode,
  thresholdOverride?: number
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
  let minVal = 255, maxVal = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const px = startX + col; const py = startY + row;
      const tx = px - roi.cx; const ty = py - roi.cy;
      const rx_coord = tx * cosT - ty * sinT;
      const ry_coord = tx * sinT + ty * cosT;
      
      if ((rx_coord*rx_coord)/(roi.rx*roi.rx) + (ry_coord*ry_coord)/(roi.ry*roi.ry) > 1.1) continue;
      
      const idx = (row * width + col) * 4;
      let val = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
      if (mode === 'dark') val = 255 - val;
      pixels.push({ x: col, y: row, val });
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
  }

  if (pixels.length < 3) return { id: roi.id, cx: roi.cx, cy: roi.cy, rx: roi.rx, ry: roi.ry, angle: roi.rotation, status: 'active' };

  const range = maxVal - minVal;
  const threshold = (thresholdOverride !== undefined && thresholdOverride > 0) 
    ? thresholdOverride 
    : (range > 10 ? (minVal + range * 0.5) : minVal);

  let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;
  for (const p of pixels) {
      if (p.val >= threshold) {
          const weight = p.val - threshold + 1;
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
    inputEllipses?: EllipseData[];
    forcedOrientation?: number;
    gridBasis?: { origin: EllipseData, xRef: EllipseData, yRef: EllipseData };
}

/**
 * Finds grid based on 3 user-selected points defining Origin, X-Axis, and Y-Axis.
 * Uses inverse lattice basis transformation to assign (i, j) coordinates to points.
 */
const findGridFromBasis = (ellipses: EllipseData[], basis: { origin: EllipseData, xRef: EllipseData, yRef: EllipseData }) => {
    const { origin, xRef, yRef } = basis;
    
    // Basis Vectors
    const ux = xRef.cx - origin.cx;
    const uy = xRef.cy - origin.cy;
    const vx = yRef.cx - origin.cx;
    const vy = yRef.cy - origin.cy;
    
    // Determinant for 2x2 Inverse
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-6) return null; // Collinear basis

    const rowsMap = new Map<number, EllipseData[]>();
    const colsMap = new Map<number, EllipseData[]>();
    
    // Orientation is determined by the X-axis vector
    const orientation = Math.atan2(uy, ux);
    const cosT = Math.cos(orientation);
    const sinT = Math.sin(orientation);
    
    // Grid Spacing scale for error tolerance
    const spacingScale = (Math.sqrt(ux*ux + uy*uy) + Math.sqrt(vx*vx + vy*vy)) / 2;

    ellipses.forEach(e => {
        const dx = e.cx - origin.cx;
        const dy = e.cy - origin.cy;
        
        // Solve linear system: P = i*u + j*v  =>  [i, j]^T = M^-1 * P
        const iVal = (vy * dx - vx * dy) / det;
        const jVal = (-uy * dx + ux * dy) / det;
        
        const I = Math.round(iVal);
        const J = Math.round(jVal);
        
        // Calculate error (distance from ideal lattice point)
        const idealX = I * ux + J * vx;
        const idealY = I * uy + J * vy;
        const distErr = Math.sqrt((dx - idealX)**2 + (dy - idealY)**2);
        
        // If point is close enough to a virtual grid node (tolerance 40% of spacing)
        if (distErr < spacingScale * 0.4) {
             if (!rowsMap.has(J)) rowsMap.set(J, []);
             rowsMap.get(J)!.push(e);
             
             if (!colsMap.has(I)) colsMap.set(I, []);
             colsMap.get(I)!.push(e);
        }
    });

    // Format output for analysis (Need 'avg' which is V-coord for rows, U-coord for cols in rotated frame)
    const rows = Array.from(rowsMap.values()).map(points => {
        // Calculate average V coordinate in the rotated frame
        const sumV = points.reduce((acc, p) => acc + (-p.cx * sinT + p.cy * cosT), 0);
        return { points, avg: sumV / points.length };
    }).filter(r => r.points.length > 1);

    const cols = Array.from(colsMap.values()).map(points => {
        // Calculate average U coordinate in the rotated frame
        const sumU = points.reduce((acc, p) => acc + (p.cx * cosT + p.cy * sinT), 0);
        return { points, avg: sumU / points.length };
    }).filter(c => c.points.length > 1);

    return { orientation, rows, cols };
};

/**
 * Finds the optimal grid orientation by scoring candidate angles.
 */
const findOptimalGrid = (ellipses: EllipseData[], radiusMean: number, forcedOrientation?: number) => {
    if (ellipses.length < 2) return null;

    let candidates: number[] = [];

    if (forcedOrientation !== undefined) {
        candidates = [forcedOrientation];
    } else {
        const angles = new Set<number>();
        angles.add(0); 
        angles.add(Math.PI / 2);

        for(let i=0; i<ellipses.length; i++) {
            for(let j=i+1; j<ellipses.length; j++) {
                const dx = ellipses[j].cx - ellipses[i].cx;
                const dy = ellipses[j].cy - ellipses[i].cy;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > radiusMean * 1.5) { 
                    let angle = Math.atan2(dy, dx);
                    if (angle < -Math.PI/2) angle += Math.PI;
                    if (angle >= Math.PI/2) angle -= Math.PI;
                    angles.add(angle);
                    let perp = angle + Math.PI/2;
                    if (perp >= Math.PI/2) perp -= Math.PI;
                    angles.add(perp);
                }
            }
        }
        candidates = Array.from(angles);
    }
    
    let bestScore = -1;
    let bestOrientation = 0;
    let bestRows: { points: EllipseData[], avg: number }[] = [];
    let bestCols: { points: EllipseData[], avg: number }[] = [];

    const cluster1D = (vals: { val: number, item: EllipseData }[], gap: number) => {
        if (vals.length === 0) return [];
        vals.sort((a,b) => a.val - b.val);
        const clusters: { points: EllipseData[], avg: number }[] = [];
        let curPoints = [vals[0].item];
        let curSum = vals[0].val;

        for(let i=1; i<vals.length; i++) {
            if (vals[i].val - vals[i-1].val < gap) {
                curPoints.push(vals[i].item);
                curSum += vals[i].val;
            } else {
                clusters.push({ points: curPoints, avg: curSum/curPoints.length });
                curPoints = [vals[i].item];
                curSum = vals[i].val;
            }
        }
        clusters.push({ points: curPoints, avg: curSum/curPoints.length });
        return clusters;
    };

    const gapThreshold = Math.max(radiusMean * 1.2, 10);

    candidates.forEach(theta => {
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const projected = ellipses.map(e => ({
            item: e,
            u: e.cx * cos + e.cy * sin,
            v: -e.cx * sin + e.cy * cos
        }));

        const rows = cluster1D(projected.map(p => ({ val: p.v, item: p.item })), gapThreshold);
        const cols = cluster1D(projected.map(p => ({ val: p.u, item: p.item })), gapThreshold);

        let score = 0;
        rows.forEach(r => { if(r.points.length > 1) score += Math.pow(r.points.length, 2); });
        cols.forEach(c => { if(c.points.length > 1) score += Math.pow(c.points.length, 2); });

        if (score > bestScore) {
            bestScore = score;
            bestOrientation = theta;
            bestRows = rows.filter(r => r.points.length > 1);
            bestCols = cols.filter(c => c.points.length > 1);
        }
    });

    return { orientation: bestOrientation, rows: bestRows, cols: bestCols };
};

export const analyzeTransformedSpots = (
  ctx: CanvasRenderingContext2D,
  mode: ProcessingMode,
  optionsOrThreshold?: number | AnalysisOptions
): CorrectionAnalysisResult => {
  let options: AnalysisOptions = {};
  if (typeof optionsOrThreshold === 'number') {
    options = { threshold: optionsOrThreshold };
  } else if (optionsOrThreshold) {
    options = optionsOrThreshold;
  }

  let ellipses: EllipseData[] = [];
  if (options.inputEllipses && options.inputEllipses.length > 0) {
      ellipses = options.inputEllipses;
  } else {
      const { ellipses: detected } = autoDetectEllipses(ctx, mode, options.threshold || 128, options.minRadius || 2, options.maxRadius || 100, false);
      ellipses = detected;
  }

  const emptyMetrics: CorrectionMetrics = { meanRoundness: 0, radiusMean: 0, radiusStdDev: 0, radiusCV: 1, spacingMean: 0, spacingStdDev: 0, spacingCV: 1, linearityRMS: 0, linearityRelative: 1, scoreRoundness: 0, scoreLinearity: 0, scoreConsistency: 0, finalScore: 0, sampleCount: ellipses.length };
  if (ellipses.length < 2) return { metrics: emptyMetrics, ellipses };

  // Basic Metrics
  let totalRoundness = 0; const radii: number[] = [];
  ellipses.forEach(e => {
    totalRoundness += Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry);
    radii.push((e.rx + e.ry) / 2);
  });
  const meanRoundness = totalRoundness / ellipses.length;
  const radiusMean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const radiusCV = radiusMean > 0 ? Math.sqrt(radii.reduce((a, b) => a + Math.pow(b-radiusMean, 2), 0)/radii.length)/radiusMean : 1;

  // Grid Detection (Try basis first, then auto/forced-orientation)
  let gridInfo;
  if (options.gridBasis) {
      gridInfo = findGridFromBasis(ellipses, options.gridBasis);
  } else {
      gridInfo = findOptimalGrid(ellipses, radiusMean, options.forcedOrientation);
  }

  let linearityRMS = 0;
  let grid = undefined;
  let bestFitLine = undefined;
  let vx = 1, vy = 0;

  if (gridInfo && (gridInfo.rows.length > 0 || gridInfo.cols.length > 0)) {
      const { orientation, rows, cols } = gridInfo;
      const cosT = Math.cos(orientation);
      const sinT = Math.sin(orientation);
      vx = cosT; vy = sinT;

      let sumSq = 0, totalP = 0;
      rows.forEach(r => {
          r.points.forEach(p => {
               const v = -p.cx * sinT + p.cy * cosT;
               sumSq += Math.pow(v - r.avg, 2);
          });
          totalP += r.points.length;
      });
      if (totalP > 0) linearityRMS = Math.sqrt(sumSq / totalP);

      const rowLines = rows.map(r => {
          const us = r.points.map(p => p.cx * cosT + p.cy * sinT);
          const minU = Math.min(...us) - radiusMean * 2;
          const maxU = Math.max(...us) + radiusMean * 2;
          return { 
              x1: minU * cosT - r.avg * sinT,
              y1: minU * sinT + r.avg * cosT,
              x2: maxU * cosT - r.avg * sinT,
              y2: maxU * sinT + r.avg * cosT
          };
      });

      const colLines = cols.map(c => {
          const vs = c.points.map(p => -p.cx * sinT + p.cy * cosT);
          const minV = Math.min(...vs) - radiusMean * 2;
          const maxV = Math.max(...vs) + radiusMean * 2;
          return { 
              x1: c.avg * cosT - minV * sinT,
              y1: c.avg * sinT + minV * cosT,
              x2: c.avg * cosT - maxV * sinT,
              y2: c.avg * sinT + maxV * cosT
          };
      });

      grid = { rows: rowLines, cols: colLines };
      if (rowLines.length > 0) {
          const bestRowIdx = rows.reduce((maxI, r, i) => r.points.length > rows[maxI].points.length ? i : maxI, 0);
          bestFitLine = rowLines[bestRowIdx];
      }
  }

  const spacings: number[] = [];
  const sorted = [...ellipses].map(e => ({ ...e, t: e.cx*vx + e.cy*vy })).sort((a,b)=>a.t-b.t);
  for (let i = 0; i < sorted.length-1; i++) {
      const dist = Math.sqrt(Math.pow(sorted[i+1].cx-sorted[i].cx, 2)+Math.pow(sorted[i+1].cy-sorted[i].cy, 2));
      if (dist < radiusMean * 5) spacings.push(dist);
  }
  const spacingMean = spacings.length ? spacings.reduce((a,b)=>a+b,0)/spacings.length : 0;
  const spacingCV = spacingMean > 0 ? Math.sqrt(spacings.reduce((a,b)=>a+Math.pow(b-spacingMean,2),0)/spacings.length)/spacingMean : 1;

  const sR = Math.round(100 * Math.exp(-3 * (1 - meanRoundness)));
  const sL = Math.round(100 * Math.exp(-5 * (radiusMean > 0 ? linearityRMS/radiusMean : 1)));
  const sC = Math.round(100 * Math.exp(-3 * (radiusCV + spacingCV)/2));
  const finalScore = Math.round(0.4 * sR + 0.35 * sL + 0.25 * sC);

  return { metrics: { meanRoundness, radiusMean, radiusStdDev: radiusMean*radiusCV, radiusCV, spacingMean, spacingStdDev: spacingMean*spacingCV, spacingCV, linearityRMS, linearityRelative: radiusMean>0?linearityRMS/radiusMean:1, scoreRoundness: sR, scoreLinearity: sL, scoreConsistency: sC, finalScore, sampleCount: ellipses.length }, ellipses: sorted, bestFitLine, grid };
};

export const autoDetectEllipses = (
  ctx: CanvasRenderingContext2D,
  mode: ProcessingMode,
  threshold: number,
  minRadius: number,
  maxRadius: number,
  enableFiltering: boolean = true
): { ellipses: EllipseData[], rois: ROI[] } => {
  const width = ctx.canvas.width, height = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const detected: EllipseData[] = [];
  const isTarget = (idx: number) => {
    const l = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
    return mode === 'dark' ? l < threshold : l > threshold;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (visited[pos] || !isTarget(pos * 4)) continue;
      const stack = [pos]; visited[pos] = 1;
      let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0, count = 0;
      while (stack.length > 0) {
        const curr = stack.pop()!;
        const cy = Math.floor(curr / width), cx = curr % width;
        m00++; m10 += cx; m01 += cy; m11 += cx*cy; m20 += cx*cx; m02 += cy*cy; count++;
        [curr-1, curr+1, curr-width, curr+width].forEach(n => {
          if (n >= 0 && n < width*height && !visited[n] && isTarget(n*4)) {
            if (!((curr%width===0 && n===curr-1) || (curr%width===width-1 && n===curr+1))) {
                visited[n] = 1; stack.push(n);
            }
          }
        });
      }
      if (count > 5) {
         const e = calculateEllipseFromMoments(0, m00, m10, m01, m11, m20, m02, 0, 0);
         if (e.rx >= minRadius && e.rx <= maxRadius && e.ry >= minRadius && e.ry <= maxRadius) detected.push(e);
      }
    }
  }
  const finalSource = enableFiltering ? filterEllipsesByTrend(detected) : detected;
  const finalEllipses: EllipseData[] = [];
  const finalRois: ROI[] = [];
  finalSource.forEach((d, idx) => {
      const id = Date.now() + idx;
      finalEllipses.push({ ...d, id });
      finalRois.push({ id, cx: d.cx, cy: d.cy, rx: d.rx * 1.5, ry: d.ry * 1.5, rotation: d.angle });
  });
  return { ellipses: finalEllipses, rois: finalRois };
};