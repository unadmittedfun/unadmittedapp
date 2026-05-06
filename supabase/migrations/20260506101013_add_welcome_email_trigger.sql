-- Modify the handle_new_user function to send welcome email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_handle TEXT;
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  IF NEW.email !~* '@acg\.edu$' THEN
    RAISE EXCEPTION 'Only @acg.edu email addresses are allowed';
  END IF;
  new_handle := 'anon_' || substr(replace(NEW.id::text,'-',''),1,8);
  INSERT INTO public.profiles (id, handle, email) VALUES (NEW.id, new_handle, NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');

  -- Send welcome email
  supabase_url := 'https://ziraecezcbmawornqdpw.supabase.co';
  service_key := (SELECT value FROM vault.secrets WHERE name = 'service_role');

  PERFORM
    net.http_post(
      url := supabase_url || '/functions/v1/send-welcome-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object('userId', NEW.id)
    );

  RETURN NEW;
END;
$$;