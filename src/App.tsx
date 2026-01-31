import { useState, useEffect, useCallback } from 'react'
import { AtpAgent } from '@atproto/api'
import { Client, type Signer, IdentifierKind } from '@xmtp/browser-sdk'
import { ethers } from 'ethers'
import './App.css'

// Encryption utilities for key backup
async function encryptPrivateKey(privateKey: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(privateKey)
  );
  const result = {
    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv))
  };
  return JSON.stringify(result);
}

async function decryptPrivateKey(encryptedData: string, password: string): Promise<string> {
  const { encryptedKey, salt, iv } = JSON.parse(encryptedData);
  const saltBytes = new Uint8Array(atob(salt).split('').map(c => c.charCodeAt(0)));
  const ivBytes = new Uint8Array(atob(iv).split('').map(c => c.charCodeAt(0)));
  const encryptedBytes = new Uint8Array(atob(encryptedKey).split('').map(c => c.charCodeAt(0)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    encryptedBytes
  );
  return new TextDecoder().decode(decrypted);
}

// Create an EOA signer using ethers.js
const createEOASigner = (): { signer: Signer; isNew: boolean } => {
  // Get or create a wallet
  const getOrCreateWallet = () => {
    let privateKey = localStorage.getItem('skychat_wallet_private_key');
    let isNew = false;
    if (!privateKey) {
      const wallet = ethers.Wallet.createRandom();
      privateKey = wallet.privateKey;
      localStorage.setItem('skychat_wallet_private_key', privateKey);
      isNew = true;
    }
    return { wallet: new ethers.Wallet(privateKey), isNew };
  };

  const { wallet, isNew } = getOrCreateWallet();

  const signer: Signer = {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: wallet.address,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await wallet.signMessage(message);
      return ethers.getBytes(signature);
    },
  };

  return { signer, isNew };
};

function App() {
  const [blueskyHandle, setBlueskyHandle] = useState('')
  const [blueskyPassword, setBlueskyPassword] = useState('')
  const [agent, setAgent] = useState<AtpAgent | null>(null)
  const [xmtpClient, setXmtpClient] = useState<Client | null>(null)
  const [status, setStatus] = useState('')
  const [isLinked, setIsLinked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [restorePassword, setRestorePassword] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [hasExistingAccount, setHasExistingAccount] = useState(false)

  const restoreBlueskySession = useCallback(async (sessionData: string, hasAccount: boolean) => {
    try {
      setIsLoading(true)
      setStatus('Restoring Bluesky session...')

      const session = JSON.parse(sessionData)
      const agent = new AtpAgent({ service: 'https://bsky.social' })

      // Try to resume the session
      await agent.resumeSession(session)

      setAgent(agent)
      setStatus('Bluesky session restored!')

      // If we have an existing account, check for identity link
      if (hasAccount) {
        await checkExistingIdentityLink(agent)
      }
    } catch {
      // Session expired or invalid, clear it
      localStorage.removeItem('skychat_bluesky_session')
      if (hasAccount) {
        setStatus('Welcome back! Your Bluesky session expired. Please reconnect.')
      } else {
        setStatus('')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Check for existing account and session on mount
  useEffect(() => {
    const existingKey = localStorage.getItem('skychat_wallet_private_key')
    const storedSession = localStorage.getItem('skychat_bluesky_session')

    if (existingKey) {
      setHasExistingAccount(true)
    }

    if (storedSession) {
      restoreBlueskySession(storedSession, !!existingKey)
    } else if (existingKey) {
      setStatus('Welcome back! Connect your Bluesky account to continue.')
    }
  }, [restoreBlueskySession])

  const loginToBluesky = async () => {
    if (!blueskyHandle || !blueskyPassword) {
      setStatus('Please fill in all fields')
      return
    }

    try {
      setIsLoading(true)
      setStatus('Connecting to Bluesky...')
      const newAgent = new AtpAgent({ service: 'https://bsky.social' })
      await newAgent.login({
        identifier: blueskyHandle,
        password: blueskyPassword,
      })
      setAgent(newAgent)

      // Store the session for persistence
      localStorage.setItem('skychat_bluesky_session', JSON.stringify(newAgent.session))

      if (hasExistingAccount) {
        // Check if identity is already linked
        await checkExistingIdentityLink(newAgent)
      } else {
        setStatus('Successfully connected to Bluesky!')
      }
    } catch (error) {
      setStatus(`Connection failed: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    setAgent(null)
    setXmtpClient(null)
    setIsLinked(false)
    setBlueskyHandle('')
    setBlueskyPassword('')
    localStorage.removeItem('skychat_bluesky_session')
    setStatus('')
  }

  const checkExistingIdentityLink = async (agent: AtpAgent) => {
    try {
      setStatus('Checking for existing identity link...')
      
      // Try to fetch the existing identity record
      const record = await agent.com.atproto.repo.getRecord({
        repo: agent.session!.did,
        collection: 'org.xmtp.inbox',
        rkey: 'self',
      })

      if (record.data?.value) {
        // Identity is already linked, initialize XMTP client
        const { signer } = createEOASigner()
        const client = await Client.create(signer, { env: 'dev' })
        setXmtpClient(client)
        setIsLinked(true)
        setStatus('Welcome back! Your identities are already linked.')
      } else {
        setStatus('Successfully connected to Bluesky! Ready to link identities.')
      }
    } catch {
      // No existing record found, proceed normally
      setStatus('Successfully connected to Bluesky! Ready to link identities.')
    }
  }

  const linkIdentities = async () => {
    if (!agent) return

    try {
      setIsLoading(true)
      setStatus('Creating XMTP account and client...')

      const { signer, isNew } = createEOASigner()
      setStatus('Initializing XMTP client...')
      const client = await Client.create(signer, { env: 'dev' })
      setXmtpClient(client)

      setStatus('Signing identity link...')

      // Sign the DID with XMTP installation key
      const signatureBytes = await client.signWithInstallationKey(agent.session!.did)
      const signatureString = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

      setStatus('Publishing to Bluesky...')

      // Publish the record to ATProto
      await agent.com.atproto.repo.putRecord({
        repo: agent.session!.did,
        collection: 'org.xmtp.inbox',
        rkey: 'self',
        record: {
          id: client.inboxId,
          verificationSignature: signatureString,
          createdAt: new Date().toISOString(),
        },
      })

      setStatus('Verifying link...')

      // Verify the signature
      const inboxStates = await Client.fetchInboxStates([client.inboxId!], 'dev')
      const inboxState = inboxStates[0]

      let isValid = false
      for (const installation of inboxState.installations) {
        if (await client.verifySignedWithPublicKey(
          agent.session!.did,
          signatureBytes,
          installation.bytes
        )) {
          isValid = true
          break
        }
      }

      if (isValid) {
        setIsLinked(true)
        setStatus('Identities successfully linked!')

        if (isNew) {
          setShowBackupModal(true)
        }
      } else {
        setStatus('Link verification failed')
      }
    } catch (error) {
      setStatus(`Identity linking failed: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleBackup = async () => {
    if (!backupPassword) {
      setStatus('Please enter a password')
      return
    }
    const privateKey = localStorage.getItem('skychat_wallet_private_key')
    if (!privateKey) {
      setStatus('No key to backup')
      return
    }
    try {
      const encrypted = await encryptPrivateKey(privateKey, backupPassword)
      const blob = new Blob([encrypted], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'skychat-key-backup.json'
      a.click()
      URL.revokeObjectURL(url)
      setShowBackupModal(false)
      setBackupPassword('')
      setStatus('Key backed up successfully!')
    } catch (error) {
      setStatus('Backup failed: ' + error)
    }
  }

  const handleRestore = async () => {
    if (!restoreFile || !restorePassword) {
      setStatus('Please select a file and enter password')
      return
    }
    try {
      const text = await restoreFile.text()
      const privateKey = await decryptPrivateKey(text, restorePassword)
      localStorage.setItem('skychat_wallet_private_key', privateKey)
      setHasExistingAccount(true)
      setShowRestoreModal(false)
      setRestorePassword('')
      setRestoreFile(null)
      setStatus('Key restored successfully! You can now connect your Bluesky account.')
    } catch (error) {
      setStatus('Restore failed: ' + error)
    }
  }

  return (
    <div className="app">
      <h1>🔗 SkyChat</h1>

      {!agent && (
        <div className="login-section">
          <h2>{hasExistingAccount ? 'Welcome Back' : 'Connect Bluesky Account'}</h2>
          <p>{hasExistingAccount 
            ? 'Connect your Bluesky account to access your existing SkyChat identity' 
            : 'Link your Bluesky identity to enable secure messaging'}</p>
          
          <div className="restore-section">
            <p>Already have a backup? <button onClick={() => setShowRestoreModal(true)} className="link-button">Restore from backup</button></p>
          </div>

          <input
            type="text"
            placeholder="Bluesky handle (e.g., user.bsky.social)"
            value={blueskyHandle}
            onChange={(e) => setBlueskyHandle(e.target.value)}
          />
          <input
            type="password"
            placeholder="App password"
            value={blueskyPassword}
            onChange={(e) => setBlueskyPassword(e.target.value)}
          />
          <button onClick={loginToBluesky} disabled={isLoading}>
            {isLoading ? 'Connecting...' : hasExistingAccount ? 'Continue with Account' : 'Connect Account'}
          </button>
        </div>
      )}

      {agent && !isLinked && (
        <div className="link-section">
          <h2>Create XMTP Identity</h2>
          <div className="info-box">
            <p>✅ Connected as: <strong>{agent.session?.handle}</strong></p>
            <button onClick={logout} className="logout-button">Logout</button>
          </div>
          <p>This will create a passkey for secure XMTP messaging that links to your Bluesky identity.</p>
          <button onClick={linkIdentities} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create Passkey & Link Identity'}
          </button>
        </div>
      )}

      {isLinked && (
        <div className="chat-section">
          <h2>🎉 Identity Linked!</h2>
          <div className="info-box">
            <p><span className="success-icon"></span>Bluesky and XMTP identities are now connected</p>
          </div>
          <div className="identity-info">
            <p><strong>Bluesky DID:</strong> {agent?.session?.did}</p>
            <p><strong>XMTP Inbox:</strong> {xmtpClient?.inboxId}</p>
            <button onClick={logout} className="logout-button">Logout</button>
          </div>
          <p>Chat functionality coming soon! 🚀</p>
        </div>
      )}

      {showBackupModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Backup Your Key</h3>
            <p>Enter a password to encrypt your key for backup. Keep this password safe!</p>
            <input
              type="password"
              placeholder="Backup password"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={handleBackup}>Download Backup</button>
              <button onClick={() => setShowBackupModal(false)}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {showRestoreModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Restore from Backup</h3>
            <p>Select your backup file and enter the password used for encryption.</p>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
            />
            <input
              type="password"
              placeholder="Backup password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={handleRestore}>Restore Key</button>
              <button onClick={() => setShowRestoreModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className={`status ${status.includes('successfully') || status.includes('Successfully') ? 'success' : status.includes('failed') || status.includes('Failed') ? 'error' : isLoading ? 'loading' : ''}`}>
        {status}
      </div>
    </div>
  )
}

export default App
