"use client";

import { useEffect, useRef, useState } from "react";
import { parseVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

interface ProductVideoInlineProps {
  videoUrl: string;
  initialVideo?: ParsedVideoInfo | null;
}

export function ProductVideoInline({ videoUrl, initialVideo }: ProductVideoInlineProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [video, setVideo] = useState<ParsedVideoInfo | null>(
    () => initialVideo ?? parseVideoUrl(videoUrl),
  );
  const sectionRef = useRef<HTMLDivElement>(null);

  // If video link needs resolution to direct MP4 (e.g. Instagram Reel)
  useEffect(() => {
    if (!isOpen) return;

    if (!video || video.type === "instagram") {
      fetch(`/api/video/resolve?url=${encodeURIComponent(videoUrl)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success && res.data) {
            setVideo(res.data);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, video, videoUrl]);

  // Listen for trigger from gallery button "Watch Product Video"
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    };

    window.addEventListener("open-product-video", handleOpen);
    return () => window.removeEventListener("open-product-video", handleOpen);
  }, []);

  if (!videoUrl) return null;

  return (
    <div id="product-video-section" ref={sectionRef} className="w-full">
      {!isOpen ? (
        <div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/90 px-4 py-2 text-caption font-medium text-ink shadow-sm hover:border-ink/30 hover:bg-surface transition-all active:scale-95"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-white">
              <svg className="size-2.5 translate-x-0.5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span>Watch Product Video</span>
            <svg
              className="size-3.5 text-muted transition-transform group-hover:translate-y-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex flex-col animate-in fade-in duration-200">
          <div className="flex justify-end mb-2 max-w-[340px] sm:max-w-md">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption text-muted hover:text-ink hover:bg-surface transition-all"
            >
              <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
              <span>Hide Video</span>
            </button>
          </div>

          {/* Pure Clean Video Player - Zero extra text/badges */}
          {video?.type === "direct" && video.isVertical ? (
            <div className="relative w-full max-w-[340px] aspect-[9/16] overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <video
                src={video.embedUrl}
                controls
                autoPlay
                playsInline
                loop
                className="size-full object-cover"
              />
            </div>
          ) : video?.type === "direct" ? (
            <div className="relative w-full max-w-2xl aspect-video overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <video
                src={video.embedUrl}
                controls
                autoPlay
                playsInline
                loop
                className="size-full object-contain"
              />
            </div>
          ) : video?.isVertical ? (
            <div className="relative w-full max-w-[340px] aspect-[9/16] overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <iframe
                src={video.embedUrl}
                title="Product Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
          ) : (
            <div className="relative w-full max-w-2xl aspect-video overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <iframe
                src={video?.embedUrl}
                title="Product Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
