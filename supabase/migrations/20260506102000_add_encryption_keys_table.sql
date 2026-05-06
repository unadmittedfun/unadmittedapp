-- Create user_keys table for storing encryption keys
CREATE TABLE IF NOT EXISTS public.user_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL, -- In production, this should be encrypted with user's master key
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure one key pair per user
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own keys" ON public.user_keys
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own keys" ON public.user_keys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own keys" ON public.user_keys
    FOR UPDATE USING (auth.uid() = user_id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_keys_user_id ON public.user_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_keys_key_id ON public.user_keys(key_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
CREATE TRIGGER update_user_keys_updated_at
    BEFORE UPDATE ON public.user_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();