import React, { useRef, useState, useCallback } from 'react';
import * as Icons from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraViewfinderProps {
  onCapture: (base64DataUrl: string) => void;
  onClose: () => void;
}

export function CameraViewfinder({ onCapture, onClose }: CameraViewfinderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>('');

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setError('Could not access camera. Please check permissions.');
    }
  }, []);

  React.useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Compress somewhat to save bandwidth
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(dataUrl);
      }
    }
  };

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 bg-black/50 text-white absolute top-0 left-0 right-0 z-10">
        <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
          <Icons.X size={24} />
        </button>
        <span className="font-semibold tracking-wide">Scan Notes</span>
        <div className="w-10"></div> {/* Placeholder for balance */}
      </div>

      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {error ? (
          <div className="text-white bg-red-500/20 p-4 rounded-xl text-center border border-red-500">
            <Icons.CameraOff size={48} className="mx-auto mb-4 text-red-400" />
            <p>{error}</p>
          </div>
        ) : (
          <video 
             ref={videoRef} 
             autoPlay 
             playsInline 
             muted 
             className="min-w-full min-h-full object-cover"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="bg-black/80 pb-12 pt-6 px-4 absolute bottom-0 left-0 right-0 z-10 flex justify-center">
        <button 
          onClick={handleCapture}
          className="w-20 h-20 bg-white rounded-full flex items-center justify-center p-1"
          disabled={!!error}
        >
           <div className="w-full h-full border-2 border-black rounded-full shadow-inner bg-white active:bg-slate-200 transition-colors"></div>
        </button>
      </div>
    </div>
  );
}
