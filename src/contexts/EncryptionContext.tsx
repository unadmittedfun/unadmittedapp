import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { securityUtils, KeyPair, SecurityMiddleware } from "@/lib/security";

type EncryptionKeys = {
  keyPair: KeyPair | null;
  userKeys: Map<string, string>; // userId -> publicKey
  isLoading: boolean;
  generateKeys: () => Promise<void>;
  getUserPublicKey: (userId: string) => Promise<string | null>;
  encryptMessage: (message: string, recipientId: string) => Promise<string>;
  decryptMessage: (encryptedMessage: string, senderId: string) => Promise<string>;
};

const EncryptionContext = createContext<EncryptionKeys | undefined>(undefined);

export const EncryptionProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [userKeys, setUserKeys] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  // Load user's encryption keys
  const loadKeys = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      // Check if user has keys in database
      const { data: keyData, error } = await supabase
        .from('user_keys')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading keys:', error);
        SecurityMiddleware.getInstance().logSecurityEvent('key_load_error', user.id, { error: error.message });
      }

      if (keyData) {
        // Keys exist, load them
        setKeyPair({
          publicKey: keyData.public_key,
          privateKey: keyData.private_key, // In production, this should be encrypted with user's password
          keyId: keyData.key_id,
        });
      } else {
        // Generate new keys for user
        await generateKeys();
      }
    } catch (error) {
      console.error('Failed to load encryption keys:', error);
      SecurityMiddleware.getInstance().logSecurityEvent('key_load_failed', user.id, error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate new encryption keys for user
  const generateKeys = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const newKeyPair = await securityUtils.generateKeyPair(user.id);

      // Store keys in database (private key should be encrypted in production)
      const { error } = await supabase
        .from('user_keys')
        .insert({
          user_id: user.id,
          key_id: newKeyPair.keyId,
          public_key: newKeyPair.publicKey,
          private_key: newKeyPair.privateKey, // TODO: Encrypt this with user's master key
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('Failed to store keys:', error);
        SecurityMiddleware.getInstance().logSecurityEvent('key_storage_error', user.id, { error: error.message });
        throw error;
      }

      setKeyPair(newKeyPair);
      SecurityMiddleware.getInstance().logSecurityEvent('keys_generated', user.id);
    } catch (error) {
      console.error('Failed to generate keys:', error);
      SecurityMiddleware.getInstance().logSecurityEvent('key_generation_failed', user.id, error);
    } finally {
      setIsLoading(false);
    }
  };

  // Get public key for a user
  const getUserPublicKey = async (userId: string): Promise<string | null> => {
    // Check cache first
    if (userKeys.has(userId)) {
      return userKeys.get(userId)!;
    }

    try {
      const { data, error } = await supabase
        .from('user_keys')
        .select('public_key')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Failed to get user public key:', error);
        return null;
      }

      if (data) {
        // Cache the key
        setUserKeys(prev => new Map(prev.set(userId, data.public_key)));
        return data.public_key;
      }

      return null;
    } catch (error) {
      console.error('Error fetching user public key:', error);
      return null;
    }
  };

  // Encrypt a message for a recipient
  const encryptMessage = async (message: string, recipientId: string): Promise<string> => {
    if (!keyPair) {
      throw new Error('No encryption keys available');
    }

    const recipientPublicKey = await getUserPublicKey(recipientId);
    if (!recipientPublicKey) {
      throw new Error('Recipient public key not found');
    }

    try {
      const encrypted = await securityUtils.encryptMessage(
        message,
        keyPair.privateKey,
        recipientPublicKey,
        keyPair.keyId
      );

      return JSON.stringify(encrypted);
    } catch (error) {
      console.error('Failed to encrypt message:', error);
      SecurityMiddleware.getInstance().logSecurityEvent('message_encryption_failed', user?.id, { recipientId });
      throw error;
    }
  };

  // Decrypt a message from a sender
  const decryptMessage = async (encryptedMessage: string, senderId: string): Promise<string> => {
    if (!keyPair) {
      throw new Error('No decryption keys available');
    }

    const senderPublicKey = await getUserPublicKey(senderId);
    if (!senderPublicKey) {
      throw new Error('Sender public key not found');
    }

    try {
      const encrypted = JSON.parse(encryptedMessage);
      const decrypted = await securityUtils.decryptMessage(
        encrypted,
        senderPublicKey,
        keyPair.privateKey
      );

      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt message:', error);
      SecurityMiddleware.getInstance().logSecurityEvent('message_decryption_failed', user?.id, { senderId });
      throw error;
    }
  };

  useEffect(() => {
    loadKeys();
  }, [user]);

  const value: EncryptionKeys = {
    keyPair,
    userKeys,
    isLoading,
    generateKeys,
    getUserPublicKey,
    encryptMessage,
    decryptMessage,
  };

  return (
    <EncryptionContext.Provider value={value}>
      {children}
    </EncryptionContext.Provider>
  );
};

export const useEncryption = () => {
  const context = useContext(EncryptionContext);
  if (context === undefined) {
    throw new Error('useEncryption must be used within an EncryptionProvider');
  }
  return context;
};