import type { SVGProps } from 'react'

type IconName =
  | 'cursor'
  | 'trend'
  | 'horizontal'
  | 'brush'
  | 'rectangle'
  | 'text'
  | 'measure'
  | 'eraser'
  | 'undo'
  | 'redo'
  | 'camera'
  | 'settings'
  | 'layers'
  | 'journal'
  | 'chevron'
  | 'search'
  | 'calendar'
  | 'save'
  | 'more'
  | 'collapse'
  | 'fullscreen'
  | 'refresh'
  | 'play'
  | 'chart'
  | 'bell'

type Props = SVGProps<SVGSVGElement> & { name: IconName }

export function Icon({ name, ...props }: Props) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  const paths: Record<IconName, React.ReactNode> = {
    cursor: <><path d="m7 4 10 8-5 .7-2.2 4.7L7 4Z" /><path d="m13 14 3 4" /></>,
    trend: <><path d="M4 17 10 9l4 3 6-8" /><circle cx="4" cy="17" r="1.4" /><circle cx="20" cy="4" r="1.4" /></>,
    horizontal: <><path d="M3 12h18" /><circle cx="7" cy="12" r="1.6" /><circle cx="17" cy="12" r="1.6" /></>,
    brush: <><path d="m14 5 5 5" /><path d="m4 20 4.8-1.2L19.5 8.1a2.1 2.1 0 0 0-3-3L5.8 15.8 4 20Z" /></>,
    rectangle: <rect x="4" y="5" width="16" height="14" rx="1" />,
    text: <><path d="M5 6h14" /><path d="M12 6v13" /><path d="M8.5 19h7" /></>,
    measure: <><path d="M4 18 18 4l2 2L6 20l-2-2Z" /><path d="m10 12 2 2M13 9l2 2M7 15l2 2" /></>,
    eraser: <><path d="m4 15 9-10 7 6-8 9H7l-3-5Z" /><path d="M12 20h8" /></>,
    undo: <><path d="M9 8 4 12l5 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
    redo: <><path d="m15 8 5 4-5 4" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
    camera: <><path d="M5 8h3l1.5-2h5L16 8h3a2 2 0 0 1 2 2v8H3v-8a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
    layers: <><path d="m4 9 8-5 8 5-8 5-8-5Z" /><path d="m4 13 8 5 8-5" /><path d="m4 17 8 4 8-4" /></>,
    journal: <><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" /><path d="M8 4v16M11 9h5M11 13h5" /></>,
    chevron: <path d="m9 7 5 5-5 5" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    save: <><path d="M5 4h12l3 3v13H4V4h1Z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    collapse: <><path d="m14 7-5 5 5 5" /><path d="M19 4v16" /></>,
    fullscreen: <><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M18.2 9A7 7 0 0 0 6.1 6.4L4 9M5.8 15A7 7 0 0 0 17.9 17.6L20 15" /></>,
    play: <path d="m8 5 11 7-11 7Z" />,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>,
    bell: <><path d="M6 16h12l-1.5-2V9a4.5 4.5 0 0 0-9 0v5L6 16Z" /><path d="M10 19h4" /></>,
  }

  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...common} {...props}>
      {paths[name]}
    </svg>
  )
}
