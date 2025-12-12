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
  status?: 'active' | 'outlier'; // New field for filtering
}

export type ProcessingMode = 'dark' | 'light';

export type CalibrationMethod = 'linear' | 'ransac' | 'iterative';

export interface CalibrationResult {
  rotationCenterX: number; // The X coordinate of the sector origin (usually negative)
  slope: number; // The rate of change of Aspect Ratio vs X
  intercept: number;
  angularResolution?: number; // degrees per pixel
  rSquared: number; // Quality of fit (0-1)
  isValid: boolean;
}