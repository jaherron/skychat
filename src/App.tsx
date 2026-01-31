import { useState } from 'react'
import { AtpAgent } from '@atproto/api'
import { Client, type Signer, IdentifierKind } from '@xmtp/browser-sdk'
import './App.css'

// Create a passkey-based signer
const createPasskeySigner = async (): Promise<Signer> => {
  // Check if WebAuthn is supported
  if (!navigator.credentials || !navigator.credentials.create) {
    throw new Error('WebAuthn is not supported in this browser')
  }

  // For development/testing: create a mock signer if passkeys fail
  try {
    // Create the passkey credential immediately
    const credential = await Promise.race([
      navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'SkyChat', id: window.location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(32)),
            name: 'SkyChat User',
            displayName: 'SkyChat User',
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
        },
      }) as Promise<PublicKeyCredential>,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Passkey creation timed out')), 30000)
      )
    ])

    const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))

    const getIdentifier = () => {
      // For passkeys, use the credential ID as the identifier
      return {
        identifierKind: IdentifierKind.Passkey,
        identifier: credentialId,
      }
    }

    const signMessage = async (message: string): Promise<Uint8Array> => {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: new TextEncoder().encode(message),
          allowCredentials: [{
            id: credential.rawId,
            type: 'public-key',
          }],
          userVerification: 'required',
        },
      }) as PublicKeyCredential

      const response = assertion.response as AuthenticatorAssertionResponse
      return new Uint8Array(response.signature)
    }

    return {
      type: 'EOA',
      getIdentifier,
      signMessage,
    }
  } catch (passkeyError) {
    console.warn('Passkey creation failed, falling back to mock signer:', passkeyError)
    
    // Fallback: create a mock signer for development
    const mockCredentialId = 'mock-credential-' + Date.now()
    
    const getIdentifier = () => ({
      identifierKind: IdentifierKind.Passkey,
      identifier: mockCredentialId,
    })

    const signMessage = async (message: string): Promise<Uint8Array> => {
      // Mock signature: just hash the message
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
      return new Uint8Array(hash)
    }

    return {
      type: 'EOA',
      getIdentifier,
      signMessage,
    }
  }
}

function App() {
  const [blueskyHandle, setBlueskyHandle] = useState('')
  const [blueskyPassword, setBlueskyPassword] = useState('')
  const [agent, setAgent] = useState<AtpAgent | null>(null)
  const [xmtpClient, setXmtpClient] = useState<Client | null>(null)
  const [status, setStatus] = useState('')
  const [isLinked, setIsLinked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

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
      setStatus('Successfully connected to Bluesky!')
    } catch (error) {
      setStatus(`Connection failed: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  const linkIdentities = async () => {
    if (!agent) return

    try {
      setIsLoading(true)
      setStatus('Creating passkey and XMTP client...')

      const signer = await createPasskeySigner()
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
      } else {
        setStatus('Link verification failed')
      }
    } catch (error) {
      setStatus(`Identity linking failed: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <h1>🔗 SkyChat</h1>

      {!agent && (
        <div className="login-section">
          <h2>Connect Bluesky Account</h2>
          <p>Link your Bluesky identity to enable secure messaging</p>
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
            {isLoading ? 'Connecting...' : 'Connect Account'}
          </button>
        </div>
      )}

      {agent && !isLinked && (
        <div className="link-section">
          <h2>Create XMTP Identity</h2>
          <div className="info-box">
            <p>✅ Connected as: <strong>{agent.session?.handle}</strong></p>
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
          </div>
          <p>Chat functionality coming soon! 🚀</p>
        </div>
      )}

      <div className={`status ${status.includes('successfully') || status.includes('Successfully') ? 'success' : status.includes('failed') || status.includes('Failed') ? 'error' : isLoading ? 'loading' : ''}`}>
        {status}
      </div>
    </div>
  )
}

export default App
