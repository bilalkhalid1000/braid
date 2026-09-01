/** Toolbar glyphs. Line icons at a single weight so the bar reads as one set
 *  rather than a pile of borrowed art. */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconCommit = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v6M12 16v6" />
  </svg>
);

export const IconPull = () => (
  <svg {...base}>
    <path d="M12 3v13M7 11l5 5 5-5M4 21h16" />
  </svg>
);

export const IconPush = () => (
  <svg {...base}>
    <path d="M12 21V8M7 13l5-5 5 5M4 3h16" />
  </svg>
);

export const IconFetch = () => (
  <svg {...base}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 4v5h-5" />
  </svg>
);

export const IconBranch = () => (
  <svg {...base}>
    <circle cx="7" cy="5" r="2.2" />
    <circle cx="7" cy="19" r="2.2" />
    <circle cx="17" cy="9" r="2.2" />
    <path d="M7 7.2v9.6M17 11.2c0 3-4 2.8-6 4.4" />
  </svg>
);

export const IconMerge = () => (
  <svg {...base}>
    <circle cx="7" cy="19" r="2.2" />
    <circle cx="7" cy="5" r="2.2" />
    <circle cx="17" cy="12" r="2.2" />
    <path d="M7 7.2v9.6M7 8c0 3 3.5 4 7.8 4" />
  </svg>
);

export const IconStash = () => (
  <svg {...base}>
    <path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
    <path d="M3 8l2-5h14l2 5M10 13h4" />
  </svg>
);

export const IconDiscard = () => (
  <svg {...base}>
    <path d="M3 7h18M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
  </svg>
);

export const IconFolder = () => (
  <svg {...base}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

export const IconTerminal = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </svg>
);

export const IconWorktree = () => (
  <svg {...base}>
    <rect x="2.5" y="4" width="8.5" height="7" rx="1.5" />
    <rect x="13" y="13" width="8.5" height="7" rx="1.5" />
    <path d="M6.75 11v4.5a1 1 0 0 0 1 1H13" />
  </svg>
);

export const IconSubmodule = () => (
  <svg {...base}>
    <path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" />
    <path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
  </svg>
);

export const IconFlow = () => (
  <svg {...base}>
    <path d="M5 3v18" />
    <circle cx="5" cy="8" r="1.6" />
    <circle cx="5" cy="16" r="1.6" />
    <path d="M5 8h6a3 3 0 0 1 3 3v2a3 3 0 0 0 3 3h2" />
    <path d="M5 16h4a3 3 0 0 0 3-3V9" />
    <circle cx="19.5" cy="16" r="1.8" />
  </svg>
);

/** A gear. The standard six-lobe outline rather than a circle with spokes
 *  around it, which reads as a sun at any size worth using. */
export const IconSettings = () => (
  <svg {...base}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 90ms" }}
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
);
