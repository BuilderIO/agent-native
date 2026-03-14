import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
  }
}

export function trackEvent(action: string, params: Record<string, string>) {
  window.gtag?.('event', action, params)
}

export const templates = [
  {
    name: 'Analytics',
    slug: 'analytics',
    replaces: 'Replaces or augments Amplitude, Mixpanel',
    cliCommand: 'npx @agent-native/core create my-app --template analytics',
    description:
      'Connect any data source, prompt for any chart. Build reusable dashboards — not throwaway Q&A. No SQL required.',
    color: 'var(--accent)',
    screenshot: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800',
  },
  {
    name: 'Content',
    slug: 'content',
    replaces: 'Replaces or augments Notion, Google Docs',
    cliCommand: 'npx @agent-native/core create my-app --template content',
    description:
      'Write and organize content with an agent that knows your brand, connects to your CMS, and follows your publishing workflow.',
    color: '#7928ca',
    screenshot: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800',
  },
  {
    name: 'Slides',
    slug: 'slides',
    replaces: 'Replaces or augments Google Slides, Pitch',
    cliCommand: 'npx @agent-native/core create my-app --template slides',
    description:
      'Generate and edit React-based presentations via prompt or point-and-click. Describe what you want, refine as you go.',
    color: '#f59e0b',
    screenshot: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800',
  },
  {
    name: 'Video',
    slug: 'video',
    replaces: 'Replaces or augments video editing',
    cliCommand: 'npx @agent-native/core create my-app --template video',
    description:
      'Create and edit Remotion video compositions with agent assistance — from storyboard to render, all in code you own.',
    color: '#ec4899',
    screenshot: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b8bfcc18a1d4c47a491da3b2d4148a4?format=webp&width=800',
  },
  {
    name: 'Calendar',
    slug: 'calendar',
    replaces: 'Replaces or augments Google Calendar, Calendly',
    cliCommand: 'npx @agent-native/core create my-app --template calendar',
    description:
      'Manage events, sync with Google Calendar, and share a public booking page — all with an AI agent that handles scheduling.',
    color: '#10b981',
    screenshot: 'https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F7f5a10a8029b4895ad02276da0f5071b?format=webp&width=800',
  },
]

export type Template = (typeof templates)[number]

function CliPopover({ template, buttonRef, onClose }: { template: Template; buttonRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand)
    setCopied(true)
    trackEvent('copy_cli_command', { template: template.slug, location: 'card' })
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, buttonRef])

  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    function update() {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [buttonRef])

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] p-2 shadow-lg"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="flex items-center gap-2 rounded-md bg-[var(--bg)] px-2 py-1.5">
        <code className="block whitespace-nowrap overflow-x-auto text-[10px] leading-relaxed text-[var(--fg)]">
          {template.cliCommand}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1 text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          aria-label="Copy command"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>,
    document.body
  )
}

function TemplateLaunchButton({ template }: { template: Template }) {
  const [showCli, setShowCli] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="mt-auto flex flex-col gap-2 pt-3">
      <a
        href="https://builder.io"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent('launch_template_cloud', { template: template.slug, location: 'card' })}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
        Launch
      </a>
      <button
        ref={buttonRef}
        onClick={() => {
          if (!showCli) trackEvent('click_run_locally', { template: template.slug, location: 'card' })
          setShowCli(!showCli)
        }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2 text-sm text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        Run locally
      </button>
      {showCli && <CliPopover template={template} buttonRef={buttonRef} onClose={() => setShowCli(false)} />}
    </div>
  )
}

export function TemplateCard({ template }: { template: Template }) {
  return (
    <div className="feature-card flex flex-col gap-3 overflow-hidden">
      <Link to={`/templates/${template.slug}`} className="-mx-[24px] -mt-[24px] mb-1 flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-[var(--border)] bg-[var(--bg-secondary)] transition hover:opacity-90">
        <img src={template.screenshot} alt={`${template.name} template screenshot`} className="h-full w-full object-cover object-top" />
      </Link>
      <h3 className="text-base font-semibold"><Link to={`/templates/${template.slug}`} className="text-[var(--fg)] no-underline hover:text-[var(--accent)]">{template.name}</Link></h3>
      <p className="m-0 text-xs text-[var(--accent)]">{template.replaces}</p>
      <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {template.description}
      </p>
      <TemplateLaunchButton template={template} />
    </div>
  )
}
