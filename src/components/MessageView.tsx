import { useState, useEffect, useRef } from 'react'
import { Conversation, Client } from '@xmtp/browser-sdk'

interface MessageViewProps {
  conversation: Conversation | null
  xmtpClient: Client
  onBack?: () => void
  isMobile: boolean
}

interface MessageItem {
  id: string
  content: string
  sentAt: Date
  senderInboxId: string
  isFromMe: boolean
}

export function MessageView({ conversation, xmtpClient, onBack, isMobile }: MessageViewProps) {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (conversation) {
      loadMessages()
    } else {
      setMessages([])
    }
  }, [conversation])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const loadMessages = async () => {
    if (!conversation) return

    try {
      setIsLoading(true)
      setError(null)

      const msgs = await conversation.messages({ limit: 50n })
      const messageItems: MessageItem[] = msgs
        .map((msg) => ({
          id: msg.id,
          content: msg.contentType?.typeId === 'text' ? (msg.content as string) : '[Media message]',
          sentAt: msg.sentAt,
          senderInboxId: msg.senderInboxId,
          isFromMe: msg.senderInboxId === xmtpClient.inboxId,
        }))
        .reverse() // Show oldest first

      setMessages(messageItems)
    } catch (err) {
      console.error('Error loading messages:', err)
      setError('Failed to load messages')
    } finally {
      setIsLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!conversation || !newMessage.trim() || isSending) return

    try {
      setIsSending(true)
      await conversation.sendText(newMessage.trim())
      setNewMessage('')

      // Reload messages to include the new one
      await loadMessages()
    } catch (err) {
      console.error('Error sending message:', err)
      setError('Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (!conversation) {
    return (
      <div className="message-view-empty">
        <p>Select a conversation to start messaging</p>
      </div>
    )
  }

  return (
    <div className="message-view">
      {isMobile && onBack && (
        <div className="message-header">
          <button onClick={onBack} className="back-button">
            ← Back
          </button>
          <div className="peer-info">
            <span className="peer-name">Chat</span>
          </div>
        </div>
      )}

      <div className="messages-container">
        {isLoading ? (
          <div className="loading-messages">
            <div className="loading-spinner"></div>
            <p>Loading messages...</p>
          </div>
        ) : error ? (
          <div className="messages-error">
            <p>{error}</p>
            <button onClick={loadMessages} className="retry-button">
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-messages">
            <p>No messages yet</p>
            <p>Send the first message to start the conversation!</p>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message-item ${message.isFromMe ? 'message-from-me' : 'message-from-peer'}`}
              >
                <div className="message-content">
                  {message.content}
                </div>
                <div className="message-timestamp">
                  {formatTimestamp(message.sentAt)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="message-input-container">
        <div className="message-input-wrapper">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="message-input"
            rows={1}
            disabled={isSending}
          />
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim() || isSending}
            className="send-button"
          >
            {isSending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}