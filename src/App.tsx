import { useState, useEffect } from 'react'
import { Agent } from '@atproto/api'
import { Client, type Signer, IdentifierKind } from '@xmtp/browser-sdk'
import { BrowserOAuthClient, buildAtprotoLoopbackClientMetadata } from '@atproto/oauth-client-browser'
import { ethers } from 'ethers'
import './App.css'

// OAuth utilities
async function createOAuthClient() {
  // For development with localhost, use loopback client metadata
  const clientMetadata = buildAtprotoLoopbackClientMetadata({
    scope: 'atproto transition:generic',
    redirect_uris: [`${window.location.origin}/oauth/callback`],
  })

  const client = new BrowserOAuthClient({
    allowHttp: true, // Allow HTTP for localhost development
    clientMetadata: {
      ...clientMetadata,
      client_name: 'SkyChat',
      client_uri: window.location.origin,
    },
    handleResolver: 'https://bsky.social',
  })

  return client
}

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
  const [agent, setAgent] = useState<Agent | null>(null)
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
  const [oauthClient, setOauthClient] = useState<BrowserOAuthClient | null>(null)
  const [oauthClientLoading, setOauthClientLoading] = useState(true)

  // Check for existing account and initialize OAuth client
  useEffect(() => {
    const initOAuth = async () => {
      setOauthClientLoading(true)
      const existingKey = localStorage.getItem('skychat_wallet_private_key')

      if (existingKey) {
        setHasExistingAccount(true)
      }

      try {
        console.log('Creating OAuth client...')
        const client = await createOAuthClient()
        console.log('OAuth client created successfully')
        setOauthClient(client)

        console.log('Initializing OAuth client...')
        // Initialize the client - this handles callbacks and restores sessions
        const result = await client.init()
        console.log('OAuth client initialized:', result)

        if (result) {
          const { session } = result
          // Create agent with OAuth session
          const newAgent = new Agent(session)
          setAgent(newAgent)
          setStatus('Bluesky session restored!')
          
          // If we have an existing account, check for identity link
          if (existingKey) {
            await checkExistingIdentityLink(newAgent)
          }
        } else if (existingKey) {
          setStatus('Welcome back! Connect your Bluesky account to continue.')
        }
      } catch (error) {
        console.error('OAuth initialization failed:', error)
        setStatus(`Failed to initialize OAuth: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setOauthClientLoading(false)
      }
    }

    initOAuth()
  }, [])

  const loginToBluesky = async () => {
    if (oauthClientLoading) {
      setStatus('OAuth client is still initializing...')
      return
    }

    if (!oauthClient) {
      setStatus('OAuth client failed to initialize')
      return
    }

    try {
      setIsLoading(true)
      setStatus('Starting OAuth flow...')

      // Start OAuth flow with Bluesky
      await oauthClient.signIn('bsky.social')
    } catch (error) {
      setStatus(`OAuth flow failed: ${error}`)
      setIsLoading(false)
    }
  }

  const logout = () => {
    setAgent(null)
    setXmtpClient(null)
    setIsLinked(false)
    localStorage.removeItem('skychat_bluesky_session')
    setStatus('')
  }

  const checkExistingIdentityLink = async (agent: Agent) => {
    try {
      setStatus('Checking for existing identity link...')
      
      // Try to fetch the existing identity record
      const record = await agent.com.atproto.repo.getRecord({
        repo: agent.did!,
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
      const signatureBytes = await client.signWithInstallationKey(agent.did!)
      const signatureString = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

      setStatus('Publishing to Bluesky...')

      // Publish the record to ATProto
      await agent.com.atproto.repo.putRecord({
        repo: agent.did!,
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
          agent.did!,
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

          <button onClick={loginToBluesky} disabled={isLoading || oauthClientLoading} className="oauth-button">
            {oauthClientLoading ? 'Initializing...' : isLoading ? 'Connecting...' : '🔵 Sign in with Bluesky'}
          </button>
        </div>
      )}

      {agent && !isLinked && (
        <div className="link-section">
          <h2>Create XMTP Identity</h2>
          <div className="info-box">
            <p>✅ Connected as: <strong>{agent.did!}</strong></p>
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
            <p><strong>Bluesky DID:</strong> {agent?.did}</p>
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
