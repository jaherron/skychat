import { useState, useEffect } from 'react'
import { Client, Conversation, ConsentState } from '@xmtp/browser-sdk'

interface InboxViewProps {
  xmtpClient: Client
  onSelectConversation: (conversation: Conversation) => void
}

interface ConversationItem {
  conversation: Conversation
  lastMessage?: any
  peerInboxId: string
  consentState: ConsentState
}

export function InboxView({ xmtpClient, onSelectConversation }: InboxViewProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conversationStream, setConversationStream] = useState<any>(null)

  useEffect(() => {
    loadConversations()
    startConversationStream()

    return () => {
      stopConversationStream()
    }
  }, [xmtpClient])

  const loadConversations = async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Get all conversations
      const convs = await xmtpClient.conversations.list()
      const conversationItems: ConversationItem[] = []

      for (const conv of convs) {
        try {
          // Get the last message for preview
          const messages = await conv.messages({ limit: 1n })
          const lastMessage = messages.length > 0 ? messages[0] : undefined

          // Get consent state for this conversation
          const consentState = await conv.consentState()

          // For now, use a placeholder peerInboxId - we'll need to determine this based on conversation type
          const peerInboxId = 'unknown' // TODO: Get actual peer inbox ID

          conversationItems.push({
            conversation: conv,
            lastMessage,
            peerInboxId,
            consentState,
          })
        } catch (err) {
          console.error('Error loading conversation:', err)
          // Still add the conversation even if we can't get the last message
          conversationItems.push({
            conversation: conv,
            peerInboxId: 'unknown', // TODO: Get actual peer inbox ID
            consentState: ConsentState.Unknown, // Default to unknown if we can't get it
          })
        }
      }

      setConversations(conversationItems)
    } catch (err) {
      console.error('Error loading conversations:', err)
      setError('Failed to load conversations')
    } finally {
      setIsLoading(false)
    }
  }

  const startConversationStream = async () => {
    try {
      stopConversationStream() // Clean up any existing stream

      const stream = await xmtpClient.conversations.stream()
      setConversationStream(stream)

      for await (const conversation of stream) {
        // Add new conversation to the list
        const consentState = await conversation.consentState()
        const newConversationItem: ConversationItem = {
          conversation,
          peerInboxId: conversation.id, // Use conversation ID as peer ID for now
          consentState,
        }

        setConversations(prevConversations => [newConversationItem, ...prevConversations])
      }
    } catch (err) {
      console.error('Error streaming conversations:', err)
    }
  }

  const stopConversationStream = () => {
    if (conversationStream) {
      setConversationStream(null)
    }
  }

  const handleApproveRequest = async (conversation: Conversation) => {
    try {
      await conversation.updateConsentState(ConsentState.Allowed)
      // Refresh conversations to update the UI
      await loadConversations()
    } catch (err) {
      console.error('Error approving message request:', err)
    }
  }

  const handleDenyRequest = async (conversation: Conversation) => {
    try {
      await conversation.updateConsentState(ConsentState.Denied)
      // Refresh conversations to update the UI
      await loadConversations()
    } catch (err) {
      console.error('Error denying message request:', err)
    }
  }

  const formatMessagePreview = (message: any): string => {
    if (!message) return 'No messages yet'

    if (message.contentType?.typeId === 'text') {
      return message.content
    }

    return 'Media message'
  }

  const formatTimestamp = (timestamp?: Date): string => {
    if (!timestamp) return ''

    const now = new Date()
    const diff = now.getTime() - timestamp.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`

    return timestamp.toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className="inbox-loading">
        <div className="loading-spinner"></div>
        <p>Loading conversations...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="inbox-error">
        <p>{error}</p>
        <button onClick={loadConversations} className="retry-button">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="inbox-view">
      <div className="inbox-header">
        <h2>Messages</h2>
        <div className="inbox-actions">
          <button className="new-chat-button" title="New conversation">
            ✏️
          </button>
        </div>
      </div>

      <div className="conversations-list">
        {conversations.length === 0 ? (
          <div className="empty-inbox">
            <p>No conversations yet</p>
            <p>Start a new chat to get started!</p>
          </div>
        ) : (
          conversations.map((item) => (
            <div
              key={item.peerInboxId}
              className={`conversation-item ${item.consentState === ConsentState.Unknown ? 'message-request' : ''}`}
              onClick={() => item.consentState === ConsentState.Allowed && onSelectConversation(item.conversation)}
            >
              <div className="conversation-avatar">
                <div className="avatar-placeholder">
                  {item.peerInboxId.slice(0, 2).toUpperCase()}
                </div>
              </div>
              <div className="conversation-content">
                <div className="conversation-header">
                  <span className="peer-name">
                    {item.peerInboxId.slice(0, 8)}...
                    {item.consentState === ConsentState.Unknown && (
                      <span className="request-badge">Message Request</span>
                    )}
                  </span>
                  <span className="timestamp">
                    {formatTimestamp(item.lastMessage?.sentAt)}
                  </span>
                </div>
                <div className="last-message">
                  {formatMessagePreview(item.lastMessage)}
                </div>
                {item.consentState === ConsentState.Unknown && (
                  <div className="consent-actions">
                    <button
                      className="approve-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleApproveRequest(item.conversation)
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="deny-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDenyRequest(item.conversation)
                      }}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}