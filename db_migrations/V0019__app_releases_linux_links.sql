ALTER TABLE app_releases ADD COLUMN IF NOT EXISTS download_url_deb TEXT DEFAULT '';
ALTER TABLE app_releases ADD COLUMN IF NOT EXISTS download_url_rpm TEXT DEFAULT '';