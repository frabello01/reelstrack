-- ============================================================
-- Video Studio — 2026-06-07
-- Tracks AI-generated videos from xai/grok-imagine-video on Replicate.
-- Applied via Supabase MCP. Reference images live in the existing
-- `studio-reference-photos` bucket (under prefix video-refs/). Output
-- videos go to a new `generated-videos` public bucket.
-- ============================================================

create table if not exists video_studio_generations (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  image_url text,                       -- optional input ref image (image-to-video)
  aspect_ratio text not null default 'auto',
  resolution text not null default '720p',
  duration integer not null default 5,
  status text not null default 'pending', -- pending | completed | failed | nsfw
  video_url text,                       -- mirrored output URL (our Supabase bucket)
  original_replicate_url text,          -- the raw replicate.delivery URL
  thumbnail_url text,                   -- optional poster image
  replicate_prediction_id text,
  elapsed_seconds numeric,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_video_studio_gens_created_at
  on video_studio_generations (created_at desc);
create index if not exists idx_video_studio_gens_status
  on video_studio_generations (status);

-- Output bucket — public read, 200MB cap.
insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-videos', 'generated-videos', true, 209715200)
on conflict (id) do nothing;
