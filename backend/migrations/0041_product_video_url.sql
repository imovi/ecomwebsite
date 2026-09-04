-- Product Video / Reel URL
--
-- Allows attaching a video URL (YouTube standard, YouTube Shorts, Facebook Video/Reel,
-- TikTok, Instagram Reel, or direct MP4/WebM video) to any product.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "video_url" text;
