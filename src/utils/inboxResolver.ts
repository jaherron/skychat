import { AtpAgent } from '@atproto/api'

interface XmtpInboxRecord {
  id: string
  verificationSignature: string
  createdAt: string
}

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

    // Create an unauthenticated agent for reading public records
    const publicAgent = new AtpAgent({ service: 'https://bsky.social' })

    // List all records in the XMTP inbox collection
    const records = await publicAgent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'org.xmtp.inbox',
    })

    if (records.data.records.length > 0) {
      const inboxRecord = records.data.records[0].value as unknown as XmtpInboxRecord
      if (inboxRecord.id) {
        return inboxRecord.id
      }
    }

    return null
  } catch (error: any) {
    // If the repo doesn't exist, it's expected - the user hasn't linked their identity
    if (error.message?.includes('Could not find repo')) {
      return null
    }
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