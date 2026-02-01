import { useState } from 'react'
import { Client } from '@xmtp/browser-sdk'
import { AtpAgent } from '@atproto/api'
import { resolveInboxId, isValidIdentifier } from '../utils/inboxResolver'

interface NewChatModalProps {
  isOpen: boolean
  onClose: () => void
  xmtpClient: Client
  agent: AtpAgent
  onConversationCreated: (conversation: any) => void
}

export function NewChatModal({
  isOpen,
  onClose,
  xmtpClient,
  agent,
  onConversationCreated
}: NewChatModalProps) {
  const [identifier, setIdentifier] = useState('')
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier.trim()) return

    try {
      setIsResolving(true)
      setError(null)

      // Validate the identifier format
      if (!isValidIdentifier(identifier.trim())) {
        setError('Please enter a valid AT handle (e.g., user.bsky.social) or DID')
        return
      }

      // Resolve the identifier to an inbox ID
      const inboxId = await resolveInboxId(identifier.trim(), agent)
      if (!inboxId) {
        setError('Could not find XMTP inbox for this identifier. Make sure they have linked their identity.')
        return
      }

      // Check if we already have a conversation with this inbox
      const existingConversations = await xmtpClient.conversations.list()
      const existingConv = existingConversations.find(() => {
        // TODO: Check if this conversation is with the target inbox ID
        return false // For now, always create new
      })

      if (existingConv) {
        onConversationCreated(existingConv)
        onClose()
        setIdentifier('')
        return
      }

      // Create new DM conversation
      const conversation = await xmtpClient.conversations.createDm(inboxId)
      onConversationCreated(conversation)
      onClose()
      setIdentifier('')
    } catch (err) {
      console.error('Error creating conversation:', err)
      setError('Failed to create conversation. Please try again.')
    } finally {
      setIsResolving(false)
    }
  }

  const handleClose = () => {
    setIdentifier('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal">
      <div className="modal-content new-chat-modal">
        <h3>Start New Conversation</h3>
        <p>Enter an AT handle or DID to start chatting</p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="e.g., user.bsky.social or did:plc:..."
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={isResolving}
            autoFocus
          />

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="modal-buttons">
            <button
              type="submit"
              disabled={!identifier.trim() || isResolving}
            >
              {isResolving ? 'Creating...' : 'Start Chat'}
            </button>
            <button type="button" onClick={handleClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}