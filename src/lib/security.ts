import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

// Security configuration
export const SECURITY_CONFIG = {
  KEY_SIZE: 256,
  IV_SIZE: 128,
  SALT_ROUNDS: 10000,
  ENCRYPTION_ALGORITHM: 'AES-256-GCM',
  HASH_ALGORITHM: 'SHA-256',
  PBKDF2_ITERATIONS: 100000,
};

// Key management interface
export interface KeyPair {
  publicKey: string;
  privateKey: string;
  keyId: string;
}

export interface EncryptedMessage {
  ciphertext: string;
  nonce: string;
  keyId: string;
  timestamp: number;
  signature?: string;
}

// Security utilities class
export class SecurityUtils {
  private static instance: SecurityUtils;

  private constructor() {}

  static getInstance(): SecurityUtils {
    if (!SecurityUtils.instance) {
      SecurityUtils.instance = new SecurityUtils();
    }
    return SecurityUtils.instance;
  }

  // Generate a new key pair for a user
  async generateKeyPair(userId: string): Promise<KeyPair> {
    try {
      const keyPair = nacl.box.keyPair();
      const keyId = this.generateKeyId(userId);

      return {
        publicKey: naclUtil.encodeBase64(keyPair.publicKey),
        privateKey: naclUtil.encodeBase64(keyPair.secretKey),
        keyId,
      };
    } catch (error) {
      console.error('Failed to generate key pair:', error);
      throw new Error('Key generation failed');
    }
  }

  // Generate a unique key ID
  private generateKeyId(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.getRandomValues(new Uint8Array(8));
    const data = `${userId}-${timestamp}-${Array.from(random).join('')}`;
    return CryptoJS.SHA256(data).toString();
  }

  // Encrypt a message using recipient's public key
  async encryptMessage(
    message: string,
    senderPrivateKey: string,
    recipientPublicKey: string,
    keyId: string
  ): Promise<EncryptedMessage> {
    try {
      const messageBytes = naclUtil.decodeUTF8(message);
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const senderSecretKey = naclUtil.decodeBase64(senderPrivateKey);
      const recipientPublicKeyBytes = naclUtil.decodeBase64(recipientPublicKey);

      const encrypted = nacl.box(
        messageBytes,
        nonce,
        recipientPublicKeyBytes,
        senderSecretKey
      );

      // Sign the message for authenticity
      const signature = await this.signMessage(message, senderPrivateKey);

      return {
        ciphertext: naclUtil.encodeBase64(encrypted),
        nonce: naclUtil.encodeBase64(nonce),
        keyId,
        timestamp: Date.now(),
        signature,
      };
    } catch (error) {
      console.error('Failed to encrypt message:', error);
      throw new Error('Message encryption failed');
    }
  }

  // Decrypt a message using sender's public key and recipient's private key
  async decryptMessage(
    encryptedMessage: EncryptedMessage,
    senderPublicKey: string,
    recipientPrivateKey: string
  ): Promise<string> {
    try {
      const ciphertext = naclUtil.decodeBase64(encryptedMessage.ciphertext);
      const nonce = naclUtil.decodeBase64(encryptedMessage.nonce);
      const senderPublicKeyBytes = naclUtil.decodeBase64(senderPublicKey);
      const recipientSecretKey = naclUtil.decodeBase64(recipientPrivateKey);

      const decrypted = nacl.box.open(
        ciphertext,
        nonce,
        senderPublicKeyBytes,
        recipientSecretKey
      );

      if (!decrypted) {
        throw new Error('Decryption failed - invalid key or corrupted message');
      }

      const message = naclUtil.encodeUTF8(decrypted);

      // Verify signature if present
      if (encryptedMessage.signature) {
        const isValid = await this.verifySignature(message, encryptedMessage.signature, senderPublicKey);
        if (!isValid) {
          throw new Error('Message signature verification failed');
        }
      }

      return message;
    } catch (error) {
      console.error('Failed to decrypt message:', error);
      throw new Error('Message decryption failed');
    }
  }

  // Sign a message for authenticity
  async signMessage(message: string, privateKey: string): Promise<string> {
    try {
      const messageBytes = naclUtil.decodeUTF8(message);
      const secretKey = naclUtil.decodeBase64(privateKey);
      const signature = nacl.sign.detached(messageBytes, secretKey);
      return naclUtil.encodeBase64(signature);
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw new Error('Message signing failed');
    }
  }

  // Verify a message signature
  async verifySignature(message: string, signature: string, publicKey: string): Promise<boolean> {
    try {
      const messageBytes = naclUtil.decodeUTF8(message);
      const signatureBytes = naclUtil.decodeBase64(signature);
      const publicKeyBytes = naclUtil.decodeBase64(publicKey);
      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (error) {
      console.error('Failed to verify signature:', error);
      return false;
    }
  }

  // Hash sensitive data (for storage, not for passwords)
  hashData(data: string): string {
    return CryptoJS.SHA256(data).toString();
  }

  // Generate a secure random string
  generateSecureToken(length: number = 32): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // Sanitize input to prevent XSS and injection attacks
  sanitizeInput(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .trim();
  }

  // Validate email format and prevent common attacks
  validateEmail(email: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) return false;

    // Additional security checks
    if (email.length > 254) return false;
    if (email.includes('..')) return false;
    if (email.startsWith('.') || email.endsWith('.')) return false;

    return true;
  }

  // Rate limiting helper
  private rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  checkRateLimit(identifier: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
    const now = Date.now();
    const existing = this.rateLimitMap.get(identifier);

    if (!existing || now > existing.resetTime) {
      this.rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (existing.count >= maxRequests) {
      return false;
    }

    existing.count++;
    return true;
  }

  // Encrypt data for storage (not for messages)
  encryptForStorage(data: string, key: string): string {
    try {
      return CryptoJS.AES.encrypt(data, key).toString();
    } catch (error) {
      console.error('Failed to encrypt data for storage:', error);
      throw new Error('Storage encryption failed');
    }
  }

  // Decrypt data from storage
  decryptFromStorage(encryptedData: string, key: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, key);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Failed to decrypt data from storage:', error);
      throw new Error('Storage decryption failed');
    }
  }

  // Generate a master key for the user (derived from password)
  async deriveMasterKey(password: string, salt?: string): Promise<string> {
    const saltValue = salt || this.generateSecureToken(16);
    return CryptoJS.PBKDF2(password, saltValue, {
      keySize: SECURITY_CONFIG.KEY_SIZE / 32,
      iterations: SECURITY_CONFIG.PBKDF2_ITERATIONS,
    }).toString();
  }

  // Secure local storage with encryption
  secureLocalStorage = {
    set: (key: string, value: any, masterKey: string) => {
      try {
        const encrypted = this.encryptForStorage(JSON.stringify(value), masterKey);
        localStorage.setItem(key, encrypted);
      } catch (error) {
        console.error('Failed to securely store data:', error);
      }
    },

    get: (key: string, masterKey: string): any => {
      try {
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return null;
        const decrypted = this.decryptFromStorage(encrypted, masterKey);
        return JSON.parse(decrypted);
      } catch (error) {
        console.error('Failed to securely retrieve data:', error);
        return null;
      }
    },

    remove: (key: string) => {
      localStorage.removeItem(key);
    }
  };
}

// Export singleton instance
export const securityUtils = SecurityUtils.getInstance();

// Security middleware for API calls
export class SecurityMiddleware {
  private static instance: SecurityMiddleware;

  private constructor() {}

  static getInstance(): SecurityMiddleware {
    if (!SecurityMiddleware.instance) {
      SecurityMiddleware.instance = new SecurityMiddleware();
    }
    return SecurityMiddleware.instance;
  }

  // Validate and sanitize request data
  validateRequest(data: any): { isValid: boolean; sanitized: any; errors: string[] } {
    const errors: string[] = [];
    const sanitized: any = {};

    // Validate email if present
    if (data.email) {
      if (!securityUtils.validateEmail(data.email)) {
        errors.push('Invalid email format');
      } else {
        sanitized.email = securityUtils.sanitizeInput(data.email);
      }
    }

    // Sanitize text fields
    ['handle', 'body', 'message', 'content'].forEach(field => {
      if (data[field]) {
        sanitized[field] = securityUtils.sanitizeInput(data[field]);
        if (sanitized[field].length > 10000) {
          errors.push(`${field} is too long (max 10000 characters)`);
        }
      }
    });

    // Validate user ID format
    if (data.userId || data.user_id) {
      const userId = data.userId || data.user_id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89abAB][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        errors.push('Invalid user ID format');
      } else {
        sanitized.userId = userId;
      }
    }

    return {
      isValid: errors.length === 0,
      sanitized,
      errors,
    };
  }

  // Check rate limit for user actions
  checkUserRateLimit(userId: string, action: string, maxRequests: number = 10): boolean {
    const identifier = `${userId}:${action}`;
    return securityUtils.checkRateLimit(identifier, maxRequests);
  }

  // Log security events
  async logSecurityEvent(event: string, userId?: string, details?: any) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      userId: userId || 'anonymous',
      details: details || {},
      userAgent: navigator.userAgent,
      sessionId: this.generateSecureToken(16), // Generate session ID for tracking
    };

    console.warn('Security Event:', logEntry);

    // In production, send to security service
    try {
      // Send to Supabase function for server-side logging
      const { supabase } = await import('@/integrations/supabase/client');
      await supabase.functions.invoke('log-security-event', {
        body: {
          event,
          userId,
          details: logEntry,
        }
      });
    } catch (error) {
      console.error('Failed to log security event to server:', error);
    }
  }
}

export const securityMiddleware = SecurityMiddleware.getInstance();