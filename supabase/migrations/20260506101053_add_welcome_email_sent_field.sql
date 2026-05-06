-- Add welcome_email_sent field to profiles
ALTER TABLE public.profiles ADD COLUMN welcome_email_sent BOOLEAN NOT NULL DEFAULT false;