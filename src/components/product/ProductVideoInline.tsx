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
  const videoRef = useRef<HTMLVideoElement>(null);
  const volMatch = videoUrl ? videoUrl.match(/vol=(\d+)/) : null;
  const initialConfiguredVol = volMatch ? parseInt(volMatch[1], 10) / 100 : 1;
  const isInitiallyMuted = volMatch ? parseInt(volMatch[1], 10) === 0 : false;

  const [isMuted, setIsMuted] = useState(isInitiallyMuted);
  const [volume, setVolume] = useState(initialConfiguredVol);


  const handleMuteToggle = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (videoRef.current) {
        videoRef.current.muted = next;
        if (!next) {
          videoRef.current.volume = volume > 0 ? volume : 1;
        }
      }
      if (!next && volume === 0) setVolume(1);
      return next;
    });
  };

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
    <div id="product-video-section" ref={sectionRef} className="w-full flex flex-col items-center sm:items-start">
      {!isOpen ? (
        <div className="w-full flex justify-center sm:justify-start">
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
        <div className="w-full flex flex-col items-center sm:items-start animate-in fade-in duration-200">
          <div className="w-full max-w-[340px] sm:max-w-md flex justify-end mb-2">
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

          {/* Pure Clean Video Player - Centered on mobile */}
          {video?.type === "direct" && video.isVertical ? (
            <div className="relative w-full max-w-[340px] aspect-[9/16] overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <video
                ref={videoRef}
                src={video.embedUrl}
                controls
                autoPlay
                playsInline
                loop
                muted={isMuted}
                onLoadedMetadata={(e) => {
                  e.currentTarget.muted = isMuted;
                  e.currentTarget.volume = isMuted ? 0 : volume;
                }}
                className="size-full object-cover"
              />
              {/* Mute / Unmute Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMuteToggle();
                }}
                title={isMuted ? "Unmute sound" : "Mute sound"}
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-white backdrop-blur-xs hover:bg-black/90 active:scale-95 transition-all shadow-md"
              >
                {isMuted ? (
                  <>
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                    <span className="text-micro font-medium tracking-tight">Unmute</span>
                  </>
                ) : (
                  <>
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <span className="text-micro font-medium tracking-tight">Mute</span>
                  </>
                )}
              </button>
            </div>
          ) : video?.type === "direct" ? (
            <div className="relative w-full max-w-2xl aspect-video overflow-hidden rounded-2xl bg-black shadow-md border border-line">
              <video
                ref={videoRef}
                src={video.embedUrl}
                controls
                autoPlay
                playsInline
                loop
                muted={isMuted}
                onLoadedMetadata={(e) => {
                  e.currentTarget.muted = isMuted;
                  e.currentTarget.volume = isMuted ? 0 : volume;
                }}
                className="size-full object-contain"
              />
              {/* Mute / Unmute Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMuteToggle();
                }}
                title={isMuted ? "Unmute sound" : "Mute sound"}
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-white backdrop-blur-xs hover:bg-black/90 active:scale-95 transition-all shadow-md"
              >
                {isMuted ? (
                  <>
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                    <span className="text-micro font-medium tracking-tight">Unmute</span>
                  </>
                ) : (
                  <>
                    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    <span className="text-micro font-medium tracking-tight">Mute</span>
                  </>
                )}
              </button>
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
