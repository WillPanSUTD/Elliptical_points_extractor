import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CircleROI, EllipseData } from '../types';

interface RoiCanvasProps {
  imageSrc: string | null;
  rois: CircleROI[];
  setRois: React.Dispatch<React.SetStateAction<CircleROI[]>>;
  ellipses: EllipseData[];
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  activeRoiId: number | null;
  setActiveRoiId: (id: number | null) => void;
  onDeleteRoi: (id: number) => void;
}

export const RoiCanvas: React.FC<RoiCanvasProps> = ({
  imageSrc,
  rois,
  setRois,
  ellipses,
  onCanvasReady,
  activeRoiId,
  setActiveRoiId,
  onDeleteRoi,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDraggingRoi, setIsDraggingRoi] = useState<number | null>(null);
  const [isResizingRoi, setIsResizingRoi] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

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

    // Set canvas actual size to image size for high res processing
    canvas.width = img.width;
    canvas.height = img.height;
    
    // But style it to fit
    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
    
    // Initial draw
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
      
      // Define colors
      // Active: Orange (#f97316), Inactive: Blue (#3b82f6)
      const color = isActive ? '#f97316' : '#3b82f6'; 
      
      ctx.beginPath();
      ctx.arc(roi.x, roi.y, roi.radius, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale; // Keep line width consistent visually
      ctx.strokeStyle = color;
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw ID
      ctx.fillStyle = color;
      ctx.font = `bold ${14 / scale}px sans-serif`;
      ctx.fillText(`#${index + 1}`, roi.x - roi.radius, roi.y - roi.radius - (5/scale));

      // Draw resize handle
      if (isActive) {
        ctx.beginPath();
        // Increased handle size for better usability (6 instead of 4)
        ctx.arc(roi.x + roi.radius, roi.y, 6 / scale, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }
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

        // Draw center cross
        const size = Math.min(ell.rx, ell.ry) / 2;
        ctx.beginPath();
        ctx.moveTo(ell.cx - size, ell.cy);
        ctx.lineTo(ell.cx + size, ell.cy);
        ctx.moveTo(ell.cx, ell.cy - size);
        ctx.lineTo(ell.cx, ell.cy + size);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
    });

  }, [rois, ellipses, scale, activeRoiId]);

  // Keyboard Delete Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeRoiId !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        onDeleteRoi(activeRoiId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRoiId, onDeleteRoi]);

  // Interaction Handlers
  const getMousePos = (e: { clientX: number; clientY: number }) => {
    if (!canvasRef.current || !containerRef.current) return { x: 0, y: 0 };
    
    // Mouse relative to container
    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseXInContainer = e.clientX - containerRect.left;
    const mouseYInContainer = e.clientY - containerRect.top;

    // Convert to Image Coords
    const x = (mouseXInContainer - offset.x) / scale;
    const y = (mouseYInContainer - offset.y) / scale;
    
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageRef.current) return;
    const { x, y } = getMousePos(e);
    
    // Check if clicking resize handle of active ROI
    if (activeRoiId !== null) {
      const activeRoi = rois.find(r => r.id === activeRoiId);
      if (activeRoi) {
        const distToHandle = Math.sqrt(Math.pow(x - (activeRoi.x + activeRoi.radius), 2) + Math.pow(y - activeRoi.y, 2));
        // Threshold for handle click (increased for better usability)
        if (distToHandle < 15 / scale) {
          setIsResizingRoi(activeRoiId);
          setDragStart({ x, y });
          return;
        }
      }
    }

    // Check if clicking inside an existing ROI
    // Check in reverse order (topmost first)
    for (let i = rois.length - 1; i >= 0; i--) {
      const roi = rois[i];
      const dist = Math.sqrt(Math.pow(x - roi.x, 2) + Math.pow(y - roi.y, 2));
      if (dist <= roi.radius) {
        setActiveRoiId(roi.id);
        setIsDraggingRoi(roi.id);
        setDragStart({ x, y });
        return;
      }
    }

    // If not creating handle or dragging, and we have < 9 ROIs, create one
    if (rois.length < 9) {
      const newId = Date.now();
      const defaultRadius = Math.min(imageRef.current.width, imageRef.current.height) * 0.05; // 5% of image size
      const newRoi: CircleROI = {
        id: newId,
        x,
        y,
        radius: defaultRadius
      };
      setRois([...rois, newRoi]);
      setActiveRoiId(newId);
      // Immediately start dragging this new one for fine tuning if they hold down
      setIsDraggingRoi(newId); 
      setDragStart({ x, y });
    } else {
        setActiveRoiId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);

    if (isResizingRoi !== null) {
      setRois(prev => prev.map(r => {
        if (r.id === isResizingRoi) {
          // New radius is distance from center to mouse
          const newRadius = Math.sqrt(Math.pow(x - r.x, 2) + Math.pow(y - r.y, 2));
          return { ...r, radius: Math.max(5, newRadius) };
        }
        return r;
      }));
    } else if (isDraggingRoi !== null && dragStart) {
      setRois(prev => prev.map(r => {
        if (r.id === isDraggingRoi) {
          const dx = x - dragStart.x;
          const dy = y - dragStart.y;
          return { ...r, x: r.x + dx, y: r.y + dy };
        }
        return r;
      }));
      setDragStart({ x, y });
    } else {
        // Cursor management
        let hover = false;
        // Check handle
        if (activeRoiId) {
             const activeRoi = rois.find(r => r.id === activeRoiId);
             if (activeRoi) {
                const distToHandle = Math.sqrt(Math.pow(x - (activeRoi.x + activeRoi.radius), 2) + Math.pow(y - activeRoi.y, 2));
                if (distToHandle < 15 / scale) {
                    document.body.style.cursor = 'ew-resize';
                    hover = true;
                }
             }
        }
        if(!hover) {
            // Check body
            for (let i = rois.length - 1; i >= 0; i--) {
                const roi = rois[i];
                const dist = Math.sqrt(Math.pow(x - roi.x, 2) + Math.pow(y - roi.y, 2));
                if (dist <= roi.radius) {
                  document.body.style.cursor = 'move';
                  hover = true;
                  break;
                }
            }
        }
        if (!hover) document.body.style.cursor = rois.length < 9 ? 'crosshair' : 'default';
    }
  };

  const handleMouseUp = () => {
    setIsDraggingRoi(null);
    setIsResizingRoi(null);
    setDragStart(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!imageRef.current) return;
    
    // Find if we are over an ROI
    const { x, y } = getMousePos(e);
    
    let targetRoiId: number | null = null;
    
    // Check if over active first (priority)
    if (activeRoiId !== null) {
        const activeRoi = rois.find(r => r.id === activeRoiId);
        if (activeRoi) {
             const dist = Math.sqrt(Math.pow(x - activeRoi.x, 2) + Math.pow(y - activeRoi.y, 2));
             if (dist <= activeRoi.radius) {
                 targetRoiId = activeRoiId;
             }
        }
    }
    
    // If not over active, checking others
    if (targetRoiId === null) {
        for (let i = rois.length - 1; i >= 0; i--) {
            const roi = rois[i];
            const dist = Math.sqrt(Math.pow(x - roi.x, 2) + Math.pow(y - roi.y, 2));
            if (dist <= roi.radius) {
                targetRoiId = roi.id;
                break;
            }
        }
    }

    if (targetRoiId !== null) {
        // Adjust radius
        const direction = Math.sign(e.deltaY); // -1 is up (grow), 1 is down (shrink) typically
        // Typically wheel UP (negative delta) means zoom in / grow
        const multiplier = direction < 0 ? 1.05 : 0.95;
        
        setRois(prev => prev.map(r => {
            if (r.id === targetRoiId) {
                // Limit min radius to 5px
                return { ...r, radius: Math.max(5, r.radius * multiplier) };
            }
            return r;
        }));
        
        // Optionally set active
        if (activeRoiId !== targetRoiId) setActiveRoiId(targetRoiId);
    }
  };

  // Styles for the container ensuring it takes space and centers content
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#020617', // Very dark slate
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