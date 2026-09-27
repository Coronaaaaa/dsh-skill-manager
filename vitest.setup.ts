// Standalone vitest setup for the skill-manager package. React 18's act()
// requires the act-environment flag; without it every act call warns and the
// warning pollutes CI output.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export {}