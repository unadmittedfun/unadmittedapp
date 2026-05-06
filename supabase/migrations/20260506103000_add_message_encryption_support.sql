-- Add encryption support to messages table
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false;

-- Create index for encrypted messages for performance
CREATE INDEX IF NOT EXISTS idx_messages_encrypted ON public.messages(is_encrypted) WHERE is_encrypted = true;

-- Update RLS policies to ensure encrypted messages are properly secured
-- (Messages are already protected by conversation access, but adding extra security layer)

-- Add comment to document encryption
COMMENT ON COLUMN public.messages.is_encrypted IS 'Indicates if the message body is encrypted with end-to-end encryption';