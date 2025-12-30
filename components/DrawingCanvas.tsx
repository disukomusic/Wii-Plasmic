import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { DataProvider } from '@plasmicapp/loader-nextjs';

interface DrawingCanvasProps {
    onDrawingSubmit?: (imageBlob: Blob) => void;
    onDrawingChange?: (imageBlob: Blob) => void;
    className?: string;
    canvasWidth?: number;
    canvasHeight?: number;
    brushSize?: number;
    brushSizeLarge?: number;
    colors?: string[];
    toolbar?: React.ReactNode;
    colorPalette?: React.ReactNode;
    children?: React.ReactNode;
}

export interface DrawingCanvasRef {
    submit: () => void;
    clear: () => void;
    setTool: (tool: 'pen' | 'eraser') => void;
    setBrushSize: (size: 'small' | 'large') => void;
    setColor: (color: string) => void;
}

export const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(({
                                                                                   onDrawingSubmit,
                                                                                   onDrawingChange,
                                                                                   className,
                                                                                   canvasWidth = 320,
                                                                                   canvasHeight = 120,
                                                                                   brushSize = 2,
                                                                                   brushSizeLarge = 6,
                                                                                   colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'],
                                                                                   toolbar,
                                                                                   colorPalette,
                                                                                   children,
                                                                               }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#000000');
    const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
    const [currentBrushSize, setCurrentBrushSize] = useState<'small' | 'large'>('small');
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

    const initCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }, [canvasWidth, canvasHeight]);

    useEffect(() => { initCanvas(); }, [initCanvas]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new IntersectionObserver(
            (entries) => entries.forEach((entry) => {
                if (entry.isIntersecting) requestAnimationFrame(initCanvas);
            }),
            { threshold: 0.1 }
        );
        observer.observe(container);
        return () => observer.disconnect();
    }, [initCanvas]);

    const getCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvasWidth / rect.width),
            y: (e.clientY - rect.top) * (canvasHeight / rect.height),
        };
    }, [canvasWidth, canvasHeight]);

    const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;
        setIsDrawing(true);
        const { x, y } = getCoords(e, canvas);
        ctx.beginPath();
        ctx.moveTo(x, y);
    }, [getCoords]);

    const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;
        const { x, y } = getCoords(e, canvas);
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.lineWidth = currentBrushSize === 'large' ? brushSizeLarge : brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineTo(x, y);
        ctx.stroke();
    }, [isDrawing, color, tool, currentBrushSize, brushSize, brushSizeLarge, getCoords]);

    const capturePreview = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setPreviewDataUrl(canvas.toDataURL('image/png'));
        canvas.toBlob((blob) => {
            if (blob) {
                setPreviewBlob(blob);
                onDrawingChange?.(blob);
            }
        }, 'image/png');
    }, [onDrawingChange]);

    const stopDrawing = useCallback(() => {
        setIsDrawing(false);
        capturePreview();
    }, [capturePreview]);

    const clearCanvas = useCallback(() => {
        initCanvas();
        setPreviewDataUrl(null);
        setPreviewBlob(null);
    }, [initCanvas]);

    const submitDrawing = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !onDrawingSubmit) return;
        canvas.toBlob((blob) => { if (blob) onDrawingSubmit(blob); }, 'image/png');
    }, [onDrawingSubmit]);

    useImperativeHandle(ref, () => ({
        submit: submitDrawing,
        clear: clearCanvas,
        setTool,
        setBrushSize: setCurrentBrushSize,
        setColor,
    }), [submitDrawing, clearCanvas]);

    const contextData = {
        previewUrl: previewDataUrl,
        previewBlob,
        currentTool: tool,
        currentColor: color,
        currentBrushSize,
        colors,
    };

    return (
        <DataProvider name="drawingCanvas" data={contextData}>
            <div ref={containerRef} className={className}>
                {toolbar}
                <canvas
                    ref={canvasRef}
                    width={canvasWidth}
                    height={canvasHeight}
                    style={{ cursor: 'crosshair', imageRendering: 'pixelated', width: '100%', height: 'auto' }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                />
                {colorPalette}
                {children}
            </div>
        </DataProvider>
    );
});
