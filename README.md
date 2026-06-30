# Elliptical Points Extractor

Interactive browser tool for extracting elliptical calibration points from
rotating line-scan images and estimating the sector-scan geometry used for
image unwarping.

This repository is the code companion for:

> Ling Cao, Wenxin Zhang, Daquan Feng, and Wei Pan.
> **Automatic geometric calibration and unwarping of rotating line-scan imaging systems using elliptical distortion of circular patterns**.
> *Optics and Lasers in Engineering*, 203:109793, 2026.
> DOI: [10.1016/j.optlaseng.2026.109793](https://doi.org/10.1016/j.optlaseng.2026.109793)

## What It Does

Rotating line-scan cameras and laser profilers acquire the scene line by line
while the object or platform rotates. A circular-hole calibration plate is
therefore observed as a set of ellipses in the raw sector-scan image. This app
uses those ellipses as geometric cues to estimate the rotation center and
angular sampling rate, then applies a polar-to-Cartesian unwarping transform.

Main features:

- Load a raw line-scan calibration image in the browser.
- Detect dark or bright elliptical spots automatically.
- Refine regions of interest manually when auto detection is imperfect.
- Fit ellipse centers, axes, and orientations from image moments.
- Estimate sector calibration with direct linear fit, RANSAC, or iterative
  outlier removal.
- Export extracted points and calibration models as JSON.
- Preview the unwarped sector image and evaluate roundness, spacing, and grid
  linearity.

The app runs entirely in the browser. No server, cloud API, or image upload is
required after the static page is loaded.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build a static release:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Basic Workflow

1. Upload a raw sector-scan image.
2. Choose `Dark Spots` or `Light Spots` according to the calibration plate
   appearance.
3. Use `Auto Detect All` to find candidate ellipses, or click on the image to
   create manual ROIs.
4. Adjust threshold and radius range until the detected ellipses match the
   circular-hole pattern.
5. Select a fitting method:
   - `Direct Linear (LS)` for clean data.
   - `RANSAC` when several detections are wrong.
   - `Iterative Removal` when outliers are moderate but systematic.
6. Inspect the fitted rotation center, angular rate, RMSE, and calibration plot.
7. Export:
   - `elliptical_points_calibrated.json` for extracted points.
   - `calibration_model.json` for the fitted sector geometry.
8. Open `Evaluation Lab` to unwarp the image and score spot roundness,
   spacing consistency, and grid linearity.

## Algorithm Summary

The implementation follows the paper's geometric observation that sector-scan
distortion changes circular calibration holes into ellipses.

1. **Ellipse extraction**
   Pixels inside each ROI are thresholded according to the selected spot mode.
   Raw image moments are accumulated to estimate the ellipse center, axes, and
   orientation.

2. **Calibration fitting**
   For each detected ellipse, the bounding-box aspect ratio is computed. The
   app fits a line between ellipse center `x` and aspect ratio. The horizontal
   intercept gives the rotation center, and the slope estimates the angular
   sampling rate.

3. **Outlier handling**
   The calibration can use direct least squares with residual filtering, RANSAC,
   or iterative residual-based point removal. Points excluded by the robust fit
   are shown as outliers.

4. **Sector unwarping**
   With the fitted rotation center and angular rate, raw image coordinates are
   mapped from line-scan sector coordinates to Cartesian coordinates for visual
   inspection and downstream measurement.

## Project Layout

```text
.
|-- App.tsx                         # Main application state and workflow
|-- components/
|   |-- RoiCanvas.tsx               # Image canvas, ROI editing, overlays
|   |-- Sidebar.tsx                 # Detection, fitting, import/export controls
|   |-- EvaluationLab.tsx           # Unwarping preview and quality metrics
|   |-- DataModal.tsx               # Extracted ellipse table
|   |-- CalibrationChartModal.tsx   # Calibration fit visualization
|   `-- SectorViewModal.tsx         # Sector view helper
|-- utils/
|   |-- imageProcessing.ts          # Thresholding, moments, grid metrics
|   `-- calibration.ts              # Sector calibration and unwarping
|-- types.ts                        # Shared TypeScript types
|-- index.tsx                       # React entry point
|-- index.html                      # Vite HTML shell
|-- vite.config.ts                  # Vite configuration
`-- package.json                    # Scripts and dependencies
```

## Output Formats

`elliptical_points_calibrated.json` contains fitted ellipse geometry:

```json
[
  {
    "id": 1,
    "cx": 123.4,
    "cy": 567.8,
    "rx": 12.3,
    "ry": 9.8,
    "angle": 0.12,
    "physicalRadius": 456.7,
    "physicalArc": 12345.6,
    "rotationCenterX": -333.3
  }
]
```

`calibration_model.json` contains the fitted sector model:

```json
{
  "rotationCenterX": -333.3,
  "slope": 0.00042,
  "intercept": 0.14,
  "angularResolution": 0.024,
  "rSquared": 0.98,
  "reprojectionError": 0.012,
  "isValid": true
}
```

## Notes

- The tool is designed for calibration images where circular holes form a
  detectable grid-like pattern after sector-scan distortion.
- The quality of the calibration depends on clean spot extraction. If the raw
  image has reflections, partial holes, or strong background texture, manual
  ROIs and robust fitting are recommended.
- The current implementation is an interactive research/demo tool rather than a
  batch-processing command-line pipeline.

## Citation

If this tool or the accompanying method is useful in your work, please cite:

```bibtex
@article{cao2026automatic,
  title={Automatic geometric calibration and unwarping of rotating line-scan imaging systems using elliptical distortion of circular patterns},
  author={Cao, Ling and Zhang, Wenxin and Feng, Daquan and Pan, Wei},
  journal={Optics and Lasers in Engineering},
  volume={203},
  pages={109793},
  year={2026},
  publisher={Elsevier},
  doi={10.1016/j.optlaseng.2026.109793}
}
```
