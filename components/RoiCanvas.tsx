import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ROI, EllipseData } from '../types';

interface RoiCanvasProps {
  imageSrc: string | null;
  rois: ROI[];
  setRois: React.Dispatch<React.SetStateAction<ROI[]>>;
  ellipses: EllipseData[];
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  activeRoiId: number | null;
  setActiveRoiId: (id: number | null) => void;
  onDeleteRoi: (id: number) => void;
  onRoiChangeEnd?: () => void;
}

type DragMode = 'move' | 'resize-x' | 'resize-y' | 'rotate';

export const RoiCanvas: React.FC<RoiCanvasProps> = ({
  imageSrc,
  rois,
  setRois,
  ellipses,
  onCanvasReady,
  activeRoiId,
  setActiveRoiId,
  onDeleteRoi,
  onRoiChangeEnd
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  
  const [interactionState, setInteractionState] = useState<{
    mode: DragMode;
    roiId: number;
    startMouse: { x: number, y: number };
    initialRoi: ROI;
  } | null>(null);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imageRef.current = img;
      fitImageToContainer();
    };
  }, [imageSrc]);

  // Fit image helper
  const fitImageToContainer = useCallback(() => {
    if (!containerRef.current || !imageRef.current || !canvasRef.current) return;
    const container = containerRef.current;
    const img = imageRef.current;
    const canvas = canvasRef.current;

    const containerAspect = container.clientWidth / container.clientHeight;
    const imgAspect = img.width / img.height;

    let newScale = 1;
    let newOffsetX = 0;
    let newOffsetY = 0;

    if (imgAspect > containerAspect) {
      newScale = container.clientWidth / img.width;
      newOffsetY = (container.clientHeight - img.height * newScale) / 2;
    } else {
      newScale = container.clientHeight / img.height;
      newOffsetX = (container.clientWidth - img.width * newScale) / 2;
    }

    canvas.width = img.width;
    canvas.height = img.height;
    
    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.drawImage(img, 0, 0);
        onCanvasReady(canvas);
    }
  }, [onCanvasReady]);

  // Resize observer
  useEffect(() => {
    const handleResize = () => fitImageToContainer();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitImageToContainer]);


  // Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and redraw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);

    // 1. Draw ROIs (User inputs)
    rois.forEach((roi, index) => {
      const isActive = roi.id === activeRoiId;
      const color = isActive ? '#f97316' : '#3b82f6'; 
      
      ctx.save();
      ctx.translate(roi.cx, roi.cy);
      ctx.rotate(roi.rotation);

      // Main Ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, roi.rx, roi.ry, 0, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = color;
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw ID
      ctx.fillStyle = color;
      ctx.font = `bold ${14 / scale}px sans-serif`;
      ctx.save();
      // Un-rotate text for readability
      ctx.rotate(-roi.rotation);
      ctx.fillText(`#${index + 1}`, -roi.rx, -roi.ry - (10/scale));
      ctx.restore();

      // Draw Handles (if active)
      if (isActive) {
        const handleSize = 6 / scale;
        
        // 1. Resize X (Right)
        ctx.beginPath();
        ctx.arc(roi.rx, 0, handleSize, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1/scale;
        ctx.stroke();

        // 2. Resize Y (Bottom)
        ctx.beginPath();
        ctx.arc(0, roi.ry, handleSize, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();

        // 3. Rotate (Stick top-ish relative to width)
        // Let's put a rotation handle offset from the X axis for better usability
        // or just a separate stick. Standard is usually a stick extending out.
        // Let's use a stick extending from the X handle
        const stickLength = 20 / scale;
        ctx.beginPath();
        ctx.moveTo(roi.rx, 0);
        ctx.lineTo(roi.rx + stickLength, 0);
        ctx.strokeStyle = color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(roi.rx + stickLength, 0, handleSize, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444'; // Red for rotation
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    });

    // 2. Draw Extracted Ellipses
    ellipses.forEach(ell => {
        const isOutlier = ell.status === 'outlier';
        const strokeColor = isOutlier ? '#ef4444' : '#10b981'; // Red for outlier, Emerald for active
        
        ctx.beginPath();
        ctx.ellipse(ell.cx, ell.cy, ell.rx, ell.ry, ell.angle, 0, Math.PI * 2);
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = strokeColor;
        
        if (isOutlier) {
           ctx.setLineDash([4 / scale, 4 / scale]);
        } else {
           ctx.setLineDash([]);
        }
        
        ctx.stroke();
        ctx.setLineDash([]);

        // Center Cross
        const size = Math.min(ell.rx, ell.ry) / 2;
        ctx.beginPath();
        // We need to rotate the cross too
        ctx.save();
        ctx.translate(ell.cx, ell.cy);
        ctx.rotate(ell.angle);
        ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
        ctx.moveTo(0, -size); ctx.lineTo(0, size);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        ctx.restore();
    });

  }, [rois, ellipses, scale, activeRoiId]);

  // Keyboard Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeRoiId !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        onDeleteRoi(activeRoiId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRoiId, onDeleteRoi]);

  // Helper: Get mouse pos in image coordinates
  const getMousePos = (e: { clientX: number; clientY: number }) => {
    if (!canvasRef.current || !containerRef.current) return { x: 0, y: 0 };
    const containerRect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - containerRect.left - offset.x) / scale;
    const y = (e.clientY - containerRect.top - offset.y) / scale;
    return { x, y };
  };

  // Helper: Hit test for handles in rotated space
  const isOverHandle = (mx: number, my: number, roi: ROI, type: DragMode): boolean => {
      // Transform mouse to ROI local space
      const tx = mx - roi.cx;
      const ty = my - roi.cy;
      const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
      const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);

      const handleRadius = 10 / scale; // Interaction radius slightly larger

      if (type === 'resize-x') {
          const dx = rx - roi.rx;
          const dy = ry - 0;
          return (dx*dx + dy*dy) < handleRadius*handleRadius;
      }
      if (type === 'resize-y') {
          const dx = rx - 0;
          const dy = ry - roi.ry;
          return (dx*dx + dy*dy) < handleRadius*handleRadius;
      }
      if (type === 'rotate') {
          const stickLength = 20 / scale;
          const dx = rx - (roi.rx + stickLength);
          const dy = ry - 0;
          return (dx*dx + dy*dy) < handleRadius*handleRadius;
      }
      return false;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageRef.current) return;
    const { x, y } = getMousePos(e);
    
    // 1. Check handles of Active ROI
    if (activeRoiId !== null) {
        const roi = rois.find(r => r.id === activeRoiId);
        if (roi) {
            if (isOverHandle(x, y, roi, 'rotate')) {
                setInteractionState({ mode: 'rotate', roiId: roi.id, startMouse: { x, y }, initialRoi: {...roi} });
                return;
            }
            if (isOverHandle(x, y, roi, 'resize-x')) {
                setInteractionState({ mode: 'resize-x', roiId: roi.id, startMouse: { x, y }, initialRoi: {...roi} });
                return;
            }
            if (isOverHandle(x, y, roi, 'resize-y')) {
                setInteractionState({ mode: 'resize-y', roiId: roi.id, startMouse: { x, y }, initialRoi: {...roi} });
                return;
            }
        }
    }

    // 2. Check for body clicks
    // Iterate reverse to select top-most
    for (let i = rois.length - 1; i >= 0; i--) {
        const roi = rois[i];
        
        // Check if point inside rotated ellipse
        const tx = x - roi.cx;
        const ty = y - roi.cy;
        const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
        const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);
        
        if ((rx*rx)/(roi.rx*roi.rx) + (ry*ry)/(roi.ry*roi.ry) <= 1) {
            setActiveRoiId(roi.id);
            setInteractionState({ mode: 'move', roiId: roi.id, startMouse: { x, y }, initialRoi: {...roi} });
            return;
        }
    }

    // 3. Create New ROI (Unlimited)
    const newId = Date.now();
    const defaultRadius = Math.min(imageRef.current.width, imageRef.current.height) * 0.05;
    const newRoi: ROI = {
        id: newId,
        cx: x,
        cy: y,
        rx: defaultRadius,
        ry: defaultRadius,
        rotation: 0
    };
    setRois([...rois, newRoi]);
    setActiveRoiId(newId);
    // Start moving immediately
    setInteractionState({ mode: 'move', roiId: newId, startMouse: { x, y }, initialRoi: {...newRoi} });
    
    if (onRoiChangeEnd) onRoiChangeEnd();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);

    // Update cursor
    if (!interactionState) {
        let cursor = 'default';
        // Check handles if active
        if (activeRoiId) {
            const roi = rois.find(r => r.id === activeRoiId);
            if (roi) {
                if (isOverHandle(x, y, roi, 'rotate')) cursor = 'crosshair';
                else if (isOverHandle(x, y, roi, 'resize-x')) cursor = 'ew-resize';
                else if (isOverHandle(x, y, roi, 'resize-y')) cursor = 'ns-resize';
                else {
                     // Check inside
                    const tx = x - roi.cx;
                    const ty = y - roi.cy;
                    const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
                    const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);
                    if ((rx*rx)/(roi.rx*roi.rx) + (ry*ry)/(roi.ry*roi.ry) <= 1) cursor = 'move';
                }
            }
        }
        // Check other bodies
        if (cursor === 'default') {
            for (let i = rois.length - 1; i >= 0; i--) {
                const roi = rois[i];
                const tx = x - roi.cx;
                const ty = y - roi.cy;
                const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
                const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);
                if ((rx*rx)/(roi.rx*roi.rx) + (ry*ry)/(roi.ry*roi.ry) <= 1) {
                    cursor = 'move';
                    break;
                }
            }
        }
        if (cursor === 'default') cursor = 'crosshair';
        document.body.style.cursor = cursor;
    }

    if (!interactionState) return;

    const { mode, roiId, startMouse, initialRoi } = interactionState;
    const dx = x - startMouse.x;
    const dy = y - startMouse.y;

    setRois(prev => prev.map(r => {
        if (r.id !== roiId) return r;

        if (mode === 'move') {
            return { ...r, cx: initialRoi.cx + dx, cy: initialRoi.cy + dy };
        } 
        else if (mode === 'resize-x') {
            // Project delta onto rotated X axis
            const cos = Math.cos(initialRoi.rotation);
            const sin = Math.sin(initialRoi.rotation);
            const proj = dx * cos + dy * sin;
            return { ...r, rx: Math.max(5, initialRoi.rx + proj) };
        }
        else if (mode === 'resize-y') {
            // Project delta onto rotated Y axis
            const cos = Math.cos(initialRoi.rotation);
            const sin = Math.sin(initialRoi.rotation);
            // Y axis is (-sin, cos)
            const proj = dx * (-sin) + dy * cos;
            return { ...r, ry: Math.max(5, initialRoi.ry + proj) };
        }
        else if (mode === 'rotate') {
            const angle = Math.atan2(y - initialRoi.cy, x - initialRoi.cx);
            // We want the X-axis of the ellipse to point to mouse
            return { ...r, rotation: angle };
        }
        return r;
    }));
  };

  const handleMouseUp = () => {
    if (interactionState && onRoiChangeEnd) {
        onRoiChangeEnd();
    }
    setInteractionState(null);
  };

  // Keep wheel for simple scaling of both dimensions
  const handleWheel = (e: React.WheelEvent) => {
    if (!imageRef.current) return;
    const { x, y } = getMousePos(e);
    
    let targetRoiId: number | null = null;
    
    // Priority to active
    if (activeRoiId !== null) {
        const roi = rois.find(r => r.id === activeRoiId);
        if (roi) {
            const tx = x - roi.cx;
            const ty = y - roi.cy;
            const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
            const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);
            if ((rx*rx)/(roi.rx*roi.rx) + (ry*ry)/(roi.ry*roi.ry) <= 1) targetRoiId = activeRoiId;
        }
    }
    
    if (targetRoiId === null) {
        for (let i = rois.length - 1; i >= 0; i--) {
            const roi = rois[i];
            const tx = x - roi.cx;
            const ty = y - roi.cy;
            const rx = tx * Math.cos(-roi.rotation) - ty * Math.sin(-roi.rotation);
            const ry = tx * Math.sin(-roi.rotation) + ty * Math.cos(-roi.rotation);
            if ((rx*rx)/(roi.rx*roi.rx) + (ry*ry)/(roi.ry*roi.ry) <= 1) {
                targetRoiId = roi.id;
                break;
            }
        }
    }

    if (targetRoiId !== null) {
        const direction = Math.sign(e.deltaY);
        const multiplier = direction < 0 ? 1.05 : 0.95;
        
        setRois(prev => prev.map(r => {
            if (r.id === targetRoiId) {
                return { 
                    ...r, 
                    rx: Math.max(5, r.rx * multiplier), 
                    ry: Math.max(5, r.ry * multiplier) 
                };
            }
            return r;
        }));
        
        if (activeRoiId !== targetRoiId) setActiveRoiId(targetRoiId);

        if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
        if (onRoiChangeEnd) {
            wheelTimeoutRef.current = setTimeout(() => {
                onRoiChangeEnd();
            }, 200);
        }
    }
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#020617',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    top: offset.y,
    left: offset.x,
    width: imageRef.current ? imageRef.current.width * scale : 0,
    height: imageRef.current ? imageRef.current.height * scale : 0,
    boxShadow: '0 0 20px rgba(0,0,0,0.5)',
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      {!imageSrc && (
        <div className="text-slate-500 flex flex-col items-center">
            <p className="mb-2 text-lg">No image loaded</p>
            <p className="text-sm">Upload an image from the sidebar to begin.</p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
};