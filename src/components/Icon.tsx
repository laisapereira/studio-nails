import { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  color?: string
  sw?: number
  fill?: boolean
  style?: CSSProperties
}

export function Icon({ name, size = 22, color = 'currentColor', sw = 1.6, fill = false, style = {} }: IconProps) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style,
  }

  const paths: Record<string, React.ReactNode> = {
    polish: (
      <>
        <rect x="8" y="9.5" width="8" height="11" rx="2.2" />
        <rect x="10" y="3.2" width="4" height="3" rx="1" />
        <path d="M12 6.2v3.3" />
        <path d="M9.6 13.6h4.8" opacity="0.5" />
      </>
    ),
    foot: (
      <>
        <path d="M8.4 19.5c-1.7-.6-2.4-2.4-2.2-4.6.2-2.3 1.1-4.2 1.5-6.3.3-1.6 1.3-2.6 2.6-2.5 1.4.1 2 1.3 2 3 0 2.5-.4 4.6.3 6.6.7 2-.6 4.2-2.6 4.2-.6 0-1.1-.1-1.6-.4Z" />
        <circle cx="16.1" cy="7.4" r="1" />
        <circle cx="17.6" cy="9.6" r=".9" />
        <circle cx="17.8" cy="12" r=".8" />
      </>
    ),
    hand: (
      <>
        <path d="M8 13V6.5a1.3 1.3 0 0 1 2.6 0V12" />
        <path d="M10.6 11.5V5.4a1.3 1.3 0 0 1 2.6 0V12" />
        <path d="M13.2 12V6.2a1.3 1.3 0 0 1 2.6 0V13" />
        <path d="M15.8 13V8.4a1.3 1.3 0 0 1 2.5 0c0 5.2.2 6.2-1 8.3-1 1.8-2 2.8-4.6 2.8-2.2 0-3.3-.6-4.6-2.2L6 14.4a1.3 1.3 0 0 1 2-1.7l1.2 1.2" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3.5c.5 3.6 1.4 4.5 5 5-3.6.5-4.5 1.4-5 5-.5-3.6-1.4-4.5-5-5 3.6-.5 4.5-1.4 5-5Z" fill={fill ? color : 'none'} />
        <path d="M18.5 14c.2 1.7.6 2.1 2.3 2.3-1.7.2-2.1.6-2.3 2.3-.2-1.7-.6-2.1-2.3-2.3 1.7-.2 2.1-.6 2.3-2.3Z" fill={fill ? color : 'none'} />
      </>
    ),
    nail: (
      <>
        <path d="M12 3c3 2.2 4 6.4 4 10.5 0 4-1.6 7-4 7s-4-3-4-7C8 9.4 9 5.2 12 3Z" fill={fill ? color : 'none'} />
        <path d="M8.6 9.5h6.8" opacity="0.45" />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.3" />
        <path d="M12 7.5V12l3 1.8" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8.4" r="3.6" />
        <path d="M5.5 19.5c.7-3.4 3.3-5.2 6.5-5.2s5.8 1.8 6.5 5.2" />
      </>
    ),
    phone: (
      <path d="M6.5 4.2 9 4l1.6 4-1.9 1.4a11 11 0 0 0 5 5l1.4-1.9 4 1.6-.2 2.5c-.1.9-.8 1.5-1.7 1.4C10.6 17.7 6.3 13.4 5.1 6c-.1-.9.5-1.7 1.4-1.8Z" />
    ),
    whatsapp: (
      <>
        <path d="M4 20l1.3-4A8 8 0 1 1 8 18.6L4 20Z" />
        <path d="M9 9.2c.2-.6.5-.6.8-.6h.5c.2 0 .4 0 .6.5l.7 1.6c0 .2 0 .4-.1.5l-.5.6c-.1.2-.2.3 0 .6a6 6 0 0 0 2.7 2.3c.3.1.4 0 .6-.1l.6-.7c.2-.2.3-.1.5 0l1.5.8c.2.1.3.2.3.4 0 .5-.3 1.3-.7 1.5-.4.3-1.6.6-3-.1a8 8 0 0 1-4.3-4.6c-.3-1 0-2 .3-2.4Z" fill={color} stroke="none" />
      </>
    ),
    plus:         <path d="M12 5v14M5 12h14" />,
    close:        <path d="M6 6l12 12M18 6L6 18" />,
    check:        <path d="M4.5 12.5l5 5 10-11" />,
    arrowRight:   <path d="M5 12h14M13 6l6 6-6 6" />,
    chevronRight: <path d="M9 5l7 7-7 7" />,
    chevronLeft:  <path d="M15 5l-7 7 7 7" />,
    chevronDown:  <path d="M5 9l7 7 7-7" />,
    moon:         <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
    coffee: (
      <>
        <path d="M5 9h11v4.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z" />
        <path d="M16 10.5h1.6a2 2 0 0 1 0 4H16" />
        <path d="M8 3.2c-.4.7-.4 1.3 0 2M11 3.2c-.4.7-.4 1.3 0 2" opacity="0.6" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21c4-4 6.5-7 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 14 8 17 12 21Z" />
        <circle cx="12" cy="10.5" r="2.3" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.5l6.5 2.3v5c0 4.3-2.8 7.4-6.5 8.7-3.7-1.3-6.5-4.4-6.5-8.7v-5L12 3.5Z" />
        <path d="M9.3 12l1.8 1.8 3.6-3.8" />
      </>
    ),
    bell: (
      <>
        <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5l1.5-2Z" />
        <path d="M10 19.5a2 2 0 0 0 4 0" />
      </>
    ),
    list:    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    grid: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      </>
    ),
    scissors: (
      <>
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="6.5" cy="17.5" r="2.5" />
        <path d="M8.7 8.2 20 17M8.7 15.8 20 7" />
      </>
    ),
  }

  return <svg {...common}>{paths[name] ?? null}</svg>
}
