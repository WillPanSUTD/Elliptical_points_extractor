import { CircleROI, EllipseData, ProcessingMode } from '../types';

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

  // 2-sigma radius (captures ~95% of mass if gaussian)
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
    angle: angle
  };
};

export const extractEllipseFromROI = (
  ctx: CanvasRenderingContext2D,
  roi: CircleROI,
  mode: ProcessingMode
): EllipseData => {
  const { x, y, radius } = roi;
  const startX = Math.floor(Math.max(0, x - radius));
  const startY = Math.floor(Math.max(0, y - radius));
  const endX = Math.ceil(Math.min(ctx.canvas.width, x + radius));
  const endY = Math.ceil(Math.min(ctx.canvas.height, y + radius));
  
  const width = endX - startX;
  const height = endY - startY;

  if (width <= 0 || height <= 0) {
    return { id: roi.id, cx: x, cy: y, rx: radius, ry: radius, angle: 0 };
  }

  const imageData = ctx.getImageData(startX, startY, width, height);
  const data = imageData.data;

  let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4;
      
      // Coordinates relative to the ROI box
      const px = col; 
      const py = row;

      // Circular mask check
      const dx = px - (x - startX);
      const dy = py - (y - startY);
      if (dx*dx + dy*dy > radius*radius) continue;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      let val = getLuminance(r, g, b);

      if (mode === 'dark') {
        val = 255 - val;
      }
      
      // Soft threshold power weighting
      const weight = Math.pow(val / 255, 4); 

      m00 += weight;
      m10 += weight * px;
      m01 += weight * py;
      m11 += weight * px * py;
      m20 += weight * px * px;
      m02 += weight * py * py;
    }
  }

  if (m00 === 0) {
     return { id: roi.id, cx: x, cy: y, rx: radius, ry: radius, angle: 0 };
  }

  return calculateEllipseFromMoments(roi.id, m00, m10, m01, m11, m20, m02, startX, startY);
};

// --- AUTO DETECTION LOGIC ---

export const autoDetectEllipses = (
  ctx: CanvasRenderingContext2D,
  mode: ProcessingMode,
  threshold: number,
  minRadius: number,
  maxRadius: number
): { ellipses: EllipseData[], rois: CircleROI[] } => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const visited = new Uint8Array(width * height);
  const detected: EllipseData[] = [];
  
  // Helper to check if pixel is "active"
  const isTarget = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = getLuminance(r, g, b);
    return mode === 'dark' ? lum < threshold : lum > threshold;
  };

  // Stack-based flood fill (recursion is too risky for large images)
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      
      if (visited[pos]) continue;
      
      if (isTarget(pos * 4)) {
        // Start new blob
        stack.push(pos);
        visited[pos] = 1;

        let m00 = 0, m10 = 0, m01 = 0, m11 = 0, m20 = 0, m02 = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        let count = 0;

        while (stack.length > 0) {
          const curr = stack.pop()!;
          const cy = Math.floor(curr / width);
          const cx = curr % width;

          // Update bounds
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // Simple binary weight (1) for shape detection or use grey value
          // Using 1 makes it purely geometric based on threshold mask
          // Using intensity makes it weighted. Let's use simple binary for stable blob finding.
          const weight = 1; 

          m00 += weight;
          m10 += weight * cx;
          m01 += weight * cy;
          m11 += weight * cx * cy;
          m20 += weight * cx * cx;
          m02 += weight * cy * cy;
          count++;

          // Check neighbors (4-connectivity)
          const neighbors = [
            curr - 1,       // Left
            curr + 1,       // Right
            curr - width,   // Up
            curr + width    // Down
          ];

          for (const n of neighbors) {
            if (n >= 0 && n < width * height && !visited[n]) {
              // Ensure we don't wrap around image edges for Left/Right
              if ((curr % width === 0 && n === curr - 1) || (curr % width === width - 1 && n === curr + 1)) {
                  continue;
              }

              if (isTarget(n * 4)) {
                visited[n] = 1;
                stack.push(n);
              }
            }
          }
        }

        // Filter noise: Minimum area (e.g., 20 pixels) and max area (e.g., 1/4 of screen)
        // Also aspect ratio check to avoid lines
        const blobW = maxX - minX;
        const blobH = maxY - minY;
        
        if (count > 10 && count < (width * height * 0.4)) {
           // Calculate ellipse
           const rawEllipse = calculateEllipseFromMoments(0, m00, m10, m01, m11, m20, m02, 0, 0);

           // FILTER: Check Radius Constraints
           // Check if semi-axes are within the min/max range provided by user
           if (rawEllipse.rx < minRadius || rawEllipse.rx > maxRadius || 
               rawEllipse.ry < minRadius || rawEllipse.ry > maxRadius) {
               continue;
           }
           
           // Extra sanity check on shape
           const aspectRatio = Math.max(rawEllipse.rx, rawEllipse.ry) / Math.min(rawEllipse.rx, rawEllipse.ry);
           if (aspectRatio < 5) { // Reject extremely thin lines
               detected.push(rawEllipse);
           }
        }
      }
    }
  }

  // SORTING: Top-Left to Bottom-Right (Reading Order)
  // Simple Y-sort fails if rows are slightly tilted.
  // We perform a "Row Grouping" sort.
  
  // 1. Sort primarily by Y
  detected.sort((a, b) => a.cy - b.cy);

  // 2. Group into rows
  if (detected.length > 0) {
      const sorted: EllipseData[] = [];
      let currentRow: EllipseData[] = [detected[0]];
      const rowTolerance = Math.max(detected[0].ry, 10); // Use height of first item as tolerance

      for (let i = 1; i < detected.length; i++) {
          const prev = currentRow[currentRow.length - 1];
          const curr = detected[i];

          // If current is within tolerance of the *average* Y of the current row, add to row
          const avgY = currentRow.reduce((sum, e) => sum + e.cy, 0) / currentRow.length;
          
          if (Math.abs(curr.cy - avgY) < rowTolerance * 1.5) {
              currentRow.push(curr);
          } else {
              // Finish this row: sort by X
              currentRow.sort((a, b) => a.cx - b.cx);
              sorted.push(...currentRow);
              // Start new row
              currentRow = [curr];
          }
      }
      // Push last row
      currentRow.sort((a, b) => a.cx - b.cx);
      sorted.push(...currentRow);
      
      // Replace extracted list with sorted list
      detected.length = 0;
      detected.push(...sorted);
  }

  // Generate ROIs based on detected ellipses
  const finalEllipses: EllipseData[] = [];
  const finalRois: CircleROI[] = [];

  detected.forEach((d, idx) => {
      // Re-assign IDs based on sorted order
      const newId = Date.now() + idx; 
      
      finalEllipses.push({
          ...d,
          id: newId
      });

      finalRois.push({
          id: newId,
          x: d.cx,
          y: d.cy,
          // ROI radius slightly larger than the detected ellipse major axis
          radius: Math.max(d.rx, d.ry) * 1.5
      });
  });

  return { ellipses: finalEllipses, rois: finalRois };
};