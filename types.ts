export interface ROI {
  id: number;
  cx: number; // Center X
  cy: number; // Center Y
  rx: number; // Semi-major axis
  ry: number; // Semi-minor axis
  rotation: number; // Rotation in radians
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

export interface CorrectionMetrics {
  meanRoundness: number; // 0-1
  
  // Consistency
  radiusMean: number;
  radiusStdDev: number;
  radiusCV: number; // Coefficient of Variation (Size)
  
  // Spacing (New)
  spacingMean: number;
  spacingStdDev: number;
  spacingCV: number; // Coefficient of Variation (Spacing)

  // Linearity
  linearityRMS: number;
  linearityRelative: number; 
  
  // Sub-Scores (0-100)
  scoreRoundness: number;
  scoreLinearity: number;
  scoreConsistency: number; // Combination of Size & Spacing consistency
  
  finalScore: number; // Weighted average
  sampleCount: number;
}

export interface CorrectionAnalysisResult {
    metrics: CorrectionMetrics;
    ellipses: EllipseData[];
    bestFitLine?: {
        x1: number; y1: number; x2: number; y2: number;
    };
}

export interface CalibrationResult {
  rotationCenterX: number; // The X coordinate of the sector origin (usually negative)
  slope: number; // The rate of change of Aspect Ratio vs X
  intercept: number;
  angularResolution?: number; // degrees per pixel
  rSquared: number; // Quality of fit (0-1)
  reprojectionError: number; // RMSE of the fit
  isValid: boolean;
  metrics?: CorrectionMetrics;
}