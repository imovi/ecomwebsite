"use client";

import { useEffect, useState } from "react";
import { parseVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

interface ProductVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
}

export function ProductVideoModal({ isOpen, onClose, videoUrl }: ProductVideoModalProps) {
  const [video, setVideo] = useState<ParsedVideoInfo | null>(() => parseVideoUrl(videoUrl));

  useEffect(() => {
    if (!isOpen) return;

    const basic = parseVideoUrl(videoUrl);
    setVideo(basic);

    // If it is an Instagram Reel or supported platform, resolve to clean direct MP4 stream
    if (basic && basic.type === "instagram") {
      fetch(`/api/video/resolve?url=${encodeURIComponent(videoUrl)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success && res.data) {
            setVideo(res.data);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, videoUrl]);

  // Lock body scroll and listen for Escape key when open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !video) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-20 flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-transform hover:scale-105 hover:bg-white/25 active:scale-95"
        aria-label="Close video"
      >
        <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Pure Clean Video Container - Completely Minimal, No Text */}
      <div
        className="relative flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {video.type === "direct" && video.isVertical ? (
          /* Pure Direct Vertical Reel */
          <div className="relative w-[85vw] max-w-[360px] aspect-[9/16] max-h-[80vh] overflow-hidden rounded-2xl bg-black shadow-2xl border border-white/15">
            <video
              src={video.embedUrl}
              controls
              autoPlay
              playsInline
              loop
              className="size-full object-cover"
            />
          </div>
        ) : video.type === "direct" ? (
          /* Pure Direct Landscape Video */
          <div className="relative w-[90vw] max-w-3xl aspect-video max-h-[80vh] overflow-hidden rounded-2xl bg-black shadow-2xl border border-white/15">
            <video
              src={video.embedUrl}
              controls
              autoPlay
              playsInline
              loop
              className="size-full object-contain"
            />
          </div>
        ) : video.isVertical ? (
          /* Vertical Iframe (Shorts / Fallback) */
          <div className="relative w-[85vw] max-w-[360px] aspect-[9/16] max-h-[80vh] overflow-hidden rounded-2xl bg-black shadow-2xl border border-white/15">
            <iframe
              src={video.embedUrl}
              title="Product Video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="size-full border-0"
            />
          </div>
        ) : (
          /* Landscape Iframe (YouTube 16:9) */
          <div className="relative w-[90vw] max-w-3xl aspect-video max-h-[80vh] overflow-hidden rounded-2xl bg-black shadow-2xl border border-white/15">
            <iframe
              src={video.embedUrl}
              title="Product Video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="size-full border-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}
