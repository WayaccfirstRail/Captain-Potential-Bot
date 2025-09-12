-- Cinema Bot Database Schema
-- Comprehensive schema for Arabic Telegram cinema content distribution bot

-- Users table with role management and security features
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'premium', 'user')),
    is_banned BOOLEAN DEFAULT FALSE,
    banned_reason TEXT,
    banned_at TIMESTAMP,
    banned_by INTEGER REFERENCES users(id),
    subscription_status VARCHAR(50) DEFAULT 'free' CHECK (subscription_status IN ('free', 'premium', 'vip')),
    subscription_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin permissions for granular control
CREATE TABLE IF NOT EXISTS admin_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(100) NOT NULL,
    granted_by INTEGER REFERENCES users(id),
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, permission)
);

-- Content sections (movies, series, anime, etc.)
CREATE TABLE IF NOT EXISTS content_sections (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_arabic VARCHAR(255) NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Main content table for movies, series, anime
CREATE TABLE IF NOT EXISTS content (
    id SERIAL PRIMARY KEY,
    section_id INTEGER REFERENCES content_sections(id),
    title VARCHAR(500) NOT NULL,
    title_arabic VARCHAR(500),
    description TEXT,
    description_arabic TEXT,
    genre VARCHAR(255),
    release_date DATE,
    year INTEGER,
    poster_url TEXT,
    file_url TEXT,
    file_size BIGINT,
    quality VARCHAR(50), -- HD, FHD, 4K
    language VARCHAR(100),
    subtitle_languages TEXT[], -- Array of subtitle languages
    rating DECIMAL(3,1),
    duration_minutes INTEGER,
    display_order INTEGER DEFAULT 0,
    is_premium BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_trending BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot commands management
CREATE TABLE IF NOT EXISTS bot_commands (
    id SERIAL PRIMARY KEY,
    command_name VARCHAR(100) NOT NULL UNIQUE,
    command_name_arabic VARCHAR(100),
    description TEXT,
    description_arabic TEXT,
    response_message TEXT,
    response_message_arabic TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_visible_to_users BOOLEAN DEFAULT TRUE,
    required_role VARCHAR(50) DEFAULT 'user',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Channel configurations
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) UNIQUE NOT NULL,
    channel_name VARCHAR(255),
    channel_type VARCHAR(50) CHECK (channel_type IN ('free', 'premium', 'admin', 'notification')),
    auto_forward BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment verification system
CREATE TABLE IF NOT EXISTS payment_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    amount DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    payment_method VARCHAR(100),
    payment_proof_url TEXT,
    payment_reference VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    notes TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teasers for content promotion
CREATE TABLE IF NOT EXISTS teasers (
    id SERIAL PRIMARY KEY,
    content_id INTEGER REFERENCES content(id),
    title VARCHAR(500),
    title_arabic VARCHAR(500),
    description TEXT,
    description_arabic TEXT,
    media_url TEXT,
    media_type VARCHAR(50) CHECK (media_type IN ('image', 'video', 'gif')),
    is_active BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teaser distribution tracking
CREATE TABLE IF NOT EXISTS teaser_distributions (
    id SERIAL PRIMARY KEY,
    teaser_id INTEGER REFERENCES teasers(id),
    channel_id VARCHAR(255),
    message_id VARCHAR(255),
    distributed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    distributed_by INTEGER REFERENCES users(id)
);

-- Admin activity logs for security monitoring
CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id),
    action_type VARCHAR(100) NOT NULL,
    action_description TEXT,
    target_user_id INTEGER REFERENCES users(id),
    target_content_id INTEGER REFERENCES content(id),
    metadata JSONB,
    is_suspicious BOOLEAN DEFAULT FALSE,
    flagged_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User behavior monitoring
CREATE TABLE IF NOT EXISTS user_behavior_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action_type VARCHAR(100),
    content_type VARCHAR(100),
    flagged_content TEXT,
    severity VARCHAR(50) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    is_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot settings and configurations
CREATE TABLE IF NOT EXISTS bot_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(255) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(50) DEFAULT 'string',
    description TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trending section configuration
CREATE TABLE IF NOT EXISTS trending_config (
    id SERIAL PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT TRUE,
    display_message TEXT,
    display_message_arabic TEXT,
    max_items INTEGER DEFAULT 5,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Content forwarding schedules
CREATE TABLE IF NOT EXISTS content_schedules (
    id SERIAL PRIMARY KEY,
    content_id INTEGER REFERENCES content(id),
    source_channel_id VARCHAR(255),
    target_channels TEXT[], -- Array of target channel IDs
    scheduled_time TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_content_section_id ON content(section_id);
CREATE INDEX IF NOT EXISTS idx_content_is_active ON content(is_active);
CREATE INDEX IF NOT EXISTS idx_content_is_trending ON content(is_trending);
CREATE INDEX IF NOT EXISTS idx_content_is_premium ON content(is_premium);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created_at ON admin_activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);

-- Insert default data
INSERT INTO content_sections (name, name_arabic, display_order) VALUES 
('Movies', 'أفلام', 1),
('Series', 'مسلسلات', 2),
('Anime', 'أنمي', 3),
('Documentaries', 'وثائقيات', 4)
ON CONFLICT DO NOTHING;

INSERT INTO bot_settings (setting_key, setting_value, description) VALUES 
('auto_forward_enabled', 'true', 'Enable automatic content forwarding'),
('premium_channel_id', '', 'Premium channel ID for paid content'),
('notification_channel_id', '', 'Channel ID for admin notifications'),
('owner_notification_type', 'dm', 'Notification type: dm or channel'),
('trending_enabled', 'true', 'Enable trending section display'),
('max_admin_actions_per_hour', '50', 'Maximum admin actions per hour before flagging')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO trending_config (display_message_arabic, max_items) VALUES 
('🔥 المحتوى الأكثر شعبية', 5)
ON CONFLICT DO NOTHING;