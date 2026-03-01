-- Add avatar_url column mirroring profile_photo_url for chathead compatibility
ALTER TABLE users ADD COLUMN avatar_url TEXT;
UPDATE users SET avatar_url = profile_photo_url WHERE profile_photo_url IS NOT NULL;
