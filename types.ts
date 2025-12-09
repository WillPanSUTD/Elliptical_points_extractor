export interface CircleROI {
  id: number;
  x: number; // Center X in original image coordinates
  y: number; // Center Y in original image coordinates
  radius: number; // Radius in pixels
}

export interface EllipseData {
  id: number;
  cx: number;
  cy: number;
  rx: number; // Semi-major axis
  ry: number; // Semi-minor axis
  angle: number; // Rotation in radians
}

export type ProcessingMode = 'dark' | 'light';
