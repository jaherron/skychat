import { AtpAgent } from '@atproto/api'

/**
 * Resolves an AT handle or DID to an XMTP inbox ID using the org.xmtp.inbox record
 */
export async function resolveInboxId(
  identifier: string,
  agent: AtpAgent
): Promise<string | null> {
  try {
    // First, resolve the handle to a DID if it's not already a DID
    let did: string
    if (identifier.startsWith('did:')) {
      did = identifier
    } else {
      // Resolve handle to DID
      const response = await agent.com.atproto.identity.resolveHandle({
        handle: identifier,
      })
      did = response.data.did
    }

    // Fetch the XMTP inbox record
    const record = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: 'org.xmtp.inbox',
      rkey: 'self',
    })

    if (record.data?.value && typeof record.data.value === 'object') {
      const inboxRecord = record.data.value as any
      if (inboxRecord.id) {
        return inboxRecord.id
      }
    }

    return null
  } catch (error) {
    console.error('Failed to resolve inbox ID:', error)
    return null
  }
}

/**
 * Validates if a string is a valid AT handle or DID
 */
export function isValidIdentifier(identifier: string): boolean {
  // Check if it's a DID
  if (identifier.startsWith('did:')) {
    return true
  }

  // Check if it's a valid handle format (basic validation)
  const handleRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return handleRegex.test(identifier)
}