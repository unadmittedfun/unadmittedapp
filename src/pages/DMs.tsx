import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEncryption } from "@/contexts/EncryptionContext";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { containsSurname } from "@/lib/validation";
import { securityMiddleware } from "@/lib/security";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Send, ArrowLeft, Shield, ShieldCheck } from "lucide-react";

type Conv = { id: string; user_a: string; user_b: string; is_marketing_bot: boolean; other_handle: string; other_avatar?: string | null; last_message?: string; last_timestamp?: string };
type Msg = { id: string; body: string; sender_id: string | null; is_bot: boolean; created_at: string; is_encrypted?: boolean };

const DMs = () => {
  const { user, profile } = useAuth();
  const { encryptMessage, decryptMessage, isLoading: encryptionLoading } = useEncryption();
  const [searchParams, setSearchParams] = useSearchParams();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [active, setActive] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [decryptedMessages, setDecryptedMessages] = useState<Map<string, string>>(new Map());
  const [body, setBody] = useState("");
  const [otherUserProfile, setOtherUserProfile] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);

  const loadConvs = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("conversations").select("*").or(`user_a.eq.${user.id},user_b.eq.${user.id}`).eq("is_marketing_bot", false);
    if (!data || error) {
      console.error("Failed to load conversations:", error);
      return;
    }
    const mapped: Conv[] = [];
    for (const c of data) {
      const otherId = c.user_a === user.id ? c.user_b : c.user_a;
      const { data: otherProfile } = await supabase.from("profiles").select("handle, avatar_url").eq("id", otherId).maybeSingle();
      const { data: lastMsg } = await supabase.from("messages").select("body, created_at").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      mapped.push({
        id: c.id,
        user_a: c.user_a,
        user_b: c.user_b,
        is_marketing_bot: c.is_marketing_bot,
        other_handle: c.is_marketing_bot ? "marketing bot 🤖" : (otherProfile?.handle ?? "anonymous"),
        other_avatar: otherProfile?.avatar_url,
        last_message: lastMsg?.body,
        last_timestamp: lastMsg?.created_at,
      });
    }
    // Sort by last timestamp (newest first)
    mapped.sort((a, b) => new Date(b.last_timestamp || 0).getTime() - new Date(a.last_timestamp || 0).getTime());
    setConvs(mapped);
    const cid = searchParams.get("c");
    if (cid && !active) {
      const found = mapped.find((c) => c.id === cid);
      if (found) setActive(found);
    }
  };

  const loadMessages = async (cid: string) => {
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", cid).order("created_at");
    const msgs = (data ?? []) as Msg[];

    // Decrypt messages that aren't from bots
    const decryptionPromises = msgs
      .filter(msg => !msg.is_bot && msg.sender_id !== user?.id)
      .map(async (msg) => {
        try {
          const decrypted = await decryptMessage(msg.body, msg.sender_id!);
          return { id: msg.id, content: decrypted };
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          return { id: msg.id, content: '[Encrypted message - decryption failed]' };
        }
      });

    const decryptedResults = await Promise.all(decryptionPromises);
    const newDecryptedMessages = new Map(decryptedMessages);

    decryptedResults.forEach(({ id, content }) => {
      newDecryptedMessages.set(id, content);
    });

    setDecryptedMessages(newDecryptedMessages);
    setMessages(msgs);
  };

  useEffect(() => { loadConvs(); }, [user, searchParams]);

  // Realtime: load conversations once on user change
  useEffect(() => {
    if (!user) return;
    loadConvs();
  }, [user]);

  useEffect(() => {
    if (!active) return;
    loadMessages(active.id);
    setOtherUserProfile(null);
    const ch = supabase.channel(`msg-${active.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${active.id}` },
        (payload) => setMessages((m) => [...m, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active]);

  // Listen for profile updates to keep avatar fresh
  useEffect(() => {
    if (!active || !user) return;
    const otherId = active.user_a === user.id ? active.user_b : active.user_a;
    const ch = supabase.channel(`profile-${otherId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${otherId}` },
        () => {
          const updated = convs.find((c) => c.id === active.id);
          if (updated) setOtherUserProfile(updated);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active, user, convs]);

  const send = async () => {
    if (!user || !profile || !active || !body.trim() || isSending) return;

    // Security validation
    const validation = securityMiddleware.validateRequest({ body: body.trim() });
    if (!validation.isValid) {
      toast.error(validation.errors.join(', '));
      return;
    }

    // Rate limiting
    if (!securityMiddleware.checkUserRateLimit(user.id, 'send_message', 30)) {
      toast.error('Too many messages. Please wait before sending another.');
      return;
    }

    if (containsSurname(body)) return toast.error("1st amendment: no surnames.");

    setIsSending(true);
    try {
      let messageBody = validation.sanitized.body;

      // Encrypt message for the recipient (if not a bot conversation)
      if (!active.is_marketing_bot) {
        const recipientId = active.user_a === user.id ? active.user_b : active.user_a;
        messageBody = await encryptMessage(messageBody, recipientId);
      }

      const { error } = await supabase.from("messages").insert({
        conversation_id: active.id,
        sender_id: user.id,
        body: messageBody,
        community_id: profile.community_id,
        is_encrypted: !active.is_marketing_bot,
      });

      if (error) {
        console.error('Failed to send message:', error);
        securityMiddleware.logSecurityEvent('message_send_failed', user.id, { error: error.message });
        return toast.error('Failed to send message');
      }

      setBody("");
      securityMiddleware.logSecurityEvent('message_sent', user.id, { conversationId: active.id });
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  if (active) {
    return (
      <AppShell>
        <button onClick={() => { setActive(null); setSearchParams({}); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-3 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> all chats
        </button>
        <Card className="p-3 mb-3 shadow-card flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage key={active.other_avatar} src={active.other_avatar ?? undefined} />
            <AvatarFallback>AN</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-semibold">{active.other_handle}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Shield className="h-3 w-3" />
              <span>{active.is_marketing_bot ? 'Unencrypted' : 'End-to-end encrypted'}</span>
            </div>
          </div>
        </Card>
        <div className="space-y-2 mb-4 min-h-[40vh]">
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            const displayBody = mine
              ? (m.is_encrypted ? '[Encrypted message sent]' : m.body)
              : (m.is_encrypted ? (decryptedMessages.get(m.id) || '[Decrypting...]') : m.body);

            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  <div className="flex items-center gap-1 mb-1">
                    {m.is_encrypted && (
                      <ShieldCheck className="h-3 w-3 text-green-500" />
                    )}
                    <p className="whitespace-pre-wrap">{displayBody}</p>
                  </div>
                  <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="sticky bottom-2 flex gap-2">
          <div className="flex-1">
            <Input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={encryptionLoading ? "Setting up encryption..." : "message…"}
              onKeyDown={(e) => e.key === "Enter" && !isSending && send()}
              disabled={encryptionLoading || isSending}
            />
            {!active?.is_marketing_bot && (
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-green-500" />
                <span>Messages are encrypted</span>
              </div>
            )}
          </div>
          <Button
            onClick={send}
            size="icon"
            disabled={encryptionLoading || isSending || !body.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center gap-2 mb-2 lg:mb-4">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h1 className="text-xl lg:text-2xl font-bold">direct messages</h1>
      </div>
      <div className="space-y-2">
        {convs.length === 0 && <p className="text-center text-muted-foreground py-10 text-sm">no conversations yet.</p>}
        {convs.map((c) => (
          <Card key={c.id} className="p-3 shadow-card cursor-pointer hover:border-primary/40 flex items-start gap-3" onClick={() => setActive(c)}>
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={c.other_avatar ?? undefined} />
              <AvatarFallback>AN</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{c.other_handle}</p>
              {c.last_message && <p className="text-xs text-muted-foreground truncate">{c.last_message}</p>}
              {c.last_timestamp && <p className="text-xs text-muted-foreground/50">{formatDistanceToNow(new Date(c.last_timestamp), { addSuffix: true })}</p>}
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
};

export default DMs;
