'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/lib/api-client'
import { FiBell, FiCheck, FiCheckCircle, FiAlertTriangle, FiAlertCircle, FiInfo, FiClock } from 'react-icons/fi'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

interface SystemNotification {
  id: string
  type: string
  title: string
  message: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS'
  isRead: boolean
  createdAt: string
  metadata?: any
}

export function NotificationCenter() {
  const token = useAuthStore((s) => s.accessToken)
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = async () => {
    if (!token) return
    try {
      const res = await api.get<{ notifications: SystemNotification[]; unreadCount: number }>('/notifications', token)
      setNotifications(res.notifications || [])
      setUnreadCount(res.unreadCount || 0)
    } catch {
      // Non-blocking
    }
  }

  useEffect(() => {
    fetchNotifications()
    const timer = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(timer)
  }, [token])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAsRead = async (id: string) => {
    if (!token) return
    try {
      await api.patch(`/notifications/${id}/read`, {}, token)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch {
      // Ignored
    }
  }

  const markAllRead = async () => {
    if (!token) return
    try {
      setLoading(true)
      await api.post('/notifications/read-all', {}, token)
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch {
      // Ignored
    } finally {
      setLoading(false)
    }
  }

  const getSeverityIcon = (sev: string) => {
    switch (sev) {
      case 'SUCCESS':
        return <FiCheckCircle style={{ color: '#10b981', fontSize: '1.1rem', flexShrink: 0 }} />
      case 'WARNING':
        return <FiAlertTriangle style={{ color: '#f59e0b', fontSize: '1.1rem', flexShrink: 0 }} />
      case 'CRITICAL':
        return <FiAlertCircle style={{ color: '#ef4444', fontSize: '1.1rem', flexShrink: 0 }} />
      default:
        return <FiInfo style={{ color: '#3b82f6', fontSize: '1.1rem', flexShrink: 0 }} />
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-ghost"
        style={{
          position: 'relative',
          padding: '8px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)',
        }}
        title="System Notifications"
        aria-label="System Notifications"
      >
        <FiBell style={{ fontSize: '1.25rem' }} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: '18px',
            height: '18px',
            borderRadius: '9px',
            background: '#ef4444',
            color: '#ffffff',
            fontSize: '0.65rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            boxShadow: '0 0 0 2px var(--surface-primary, #ffffff)',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '360px',
          maxWidth: '90vw',
          maxHeight: '480px',
          background: 'var(--bg-card, #ffffff)',
          border: '1px solid var(--border, #d7dee8)',
          borderRadius: '14px',
          boxShadow: '0 20px 48px rgba(15, 23, 42, 0.22)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border, #d7dee8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-elevated, #f7f9fc)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                🔔 Notifications
              </span>
              {unreadCount > 0 && (
                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary, #2f7ab8)',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <FiCheckCircle style={{ fontSize: '2rem', marginBottom: '8px', color: 'var(--success, #2ea86f)', display: 'inline-block' }} /><br />
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  All caught up!
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: 4 }}>
                  No unread notifications at this time.
                </div>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.isRead && markAsRead(n.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border, #f1f5f9)',
                    display: 'flex',
                    gap: '12px',
                    background: n.isRead ? 'transparent' : 'rgba(2, 132, 199, 0.05)',
                    cursor: n.isRead ? 'default' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ marginTop: '2px' }}>{getSeverityIcon(n.severity)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ fontWeight: n.isRead ? 600 : 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {n.title}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <FiClock style={{ fontSize: '0.65rem' }} />
                        {dayjs(n.createdAt).fromNow(true)}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #64748b)', lineHeight: 1.4 }}>
                      {n.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
