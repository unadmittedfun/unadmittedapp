-- Create security audit log table
CREATE TABLE IF NOT EXISTS public.security_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    session_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Indexes for performance
    INDEX idx_security_logs_user_id (user_id),
    INDEX idx_security_logs_event_type (event_type),
    INDEX idx_security_logs_created_at (created_at DESC)
);

-- Enable RLS
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Only admins can view security logs
CREATE POLICY "Admins can view security logs" ON public.security_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role = 'admin'
        )
    );

-- Only the system can insert security logs (via service role)
CREATE POLICY "System can insert security logs" ON public.security_logs
    FOR INSERT WITH CHECK (true);

-- Function to automatically clean up old logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_security_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM public.security_logs
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Create a function to log security events (callable from edge functions)
CREATE OR REPLACE FUNCTION log_security_event(
    p_user_id UUID DEFAULT NULL,
    p_event_type TEXT DEFAULT '',
    p_details JSONB DEFAULT '{}',
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT '',
    p_session_id TEXT DEFAULT ''
)
RETURNS void AS $$
BEGIN
    INSERT INTO public.security_logs (
        user_id,
        event_type,
        details,
        ip_address,
        user_agent,
        session_id
    ) VALUES (
        p_user_id,
        p_event_type,
        p_details,
        p_ip_address,
        p_user_agent,
        p_session_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;