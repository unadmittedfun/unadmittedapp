import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface SecurityEvent {
  event: string
  userId?: string
  details: any
}

Deno.serve(async (req) => {
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Create Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    const { event, userId, details }: SecurityEvent = await req.json()

    // Validate input
    if (!event) {
      return new Response('Event type is required', { status: 400 })
    }

    // Get client IP and user agent
    const clientIP = req.headers.get('CF-Connecting-IP') ||
                    req.headers.get('X-Forwarded-For') ||
                    req.headers.get('X-Real-IP') ||
                    'unknown'

    const userAgent = req.headers.get('User-Agent') || 'unknown'

    // Log the security event
    const { error } = await supabase.rpc('log_security_event', {
      p_user_id: userId || null,
      p_event_type: event,
      p_details: details || {},
      p_ip_address: clientIP,
      p_user_agent: userAgent,
      p_session_id: details?.sessionId || null
    })

    if (error) {
      console.error('Failed to log security event:', error)
      return new Response('Internal server error', { status: 500 })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error) {
    console.error('Security logging error:', error)
    return new Response('Internal server error', { status: 500 })
  }
})