// Centralised SVG icon set — pure inline SVG, no external dep.
// Stroke-based, sized by parent via `className="w-4 h-4"` etc.
import * as React from "react"

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

const make = (path: React.ReactNode, viewBox = "0 0 24 24"): React.FC<IconProps> => {
  const Cmp: React.FC<IconProps> = ({ size, className, strokeWidth = 1.6, ...rest }) => (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth as number}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {path}
    </svg>
  )
  return Cmp
}

export const IconMarket = make(<><path d="M3 7l9-4 9 4M5 9.5V19a1 1 0 001 1h12a1 1 0 001-1V9.5" /><path d="M9 21V12h6v9" /></>)
export const IconCheck = make(<path d="M5 13l4 4L19 7" />)
export const IconServer = make(<><rect x="3" y="4" width="18" height="8" rx="2" /><rect x="3" y="12" width="18" height="8" rx="2" /><path d="M7 8h.01M7 16h.01" /></>)
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>)
export const IconKey = make(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9 3 3-3 3 2 2-3 3-2-2-2 2" /></>)
export const IconChart = make(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>)
export const IconInvoice = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>)
export const IconCog = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const IconShield = make(<path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />)
export const IconDoc = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>)
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>)
export const IconChevronRight = make(<path d="M9 6l6 6-6 6" />)
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />)
export const IconChevronUp = make(<path d="M6 15l6-6 6 6" />)
export const IconLogout = make(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>)
export const IconCopy = make(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>)
export const IconPlus = make(<path d="M12 5v14M5 12h14" />)
export const IconArrowUp = make(<path d="M12 19V5M5 12l7-7 7 7" />)
export const IconArrowDown = make(<path d="M12 5v14M5 12l7 7 7-7" />)
export const IconCircle = make(<circle cx="12" cy="12" r="10" />)
export const IconMail = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>)
export const IconMore = make(<><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>)
export const IconExternal = make(<><path d="M14 3h7v7" /><path d="M21 3l-9 9" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>)
export const IconTrash = make(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" /></>)
export const IconHelp = make(<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4" /><path d="M12 17h.01" /></>)
export const IconLayers = make(<><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></>)
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>)
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)
export const IconMonitor = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>)
export const IconLanguages = make(<><path d="M5 8h12" /><path d="M9 4v4" /><path d="M5 14c2.5 4 6 5.5 9 6" /><path d="M14 12c-1 4-4 7-9 8" /><path d="M14 14h7l-3.5 7L14 14z" /></>)
