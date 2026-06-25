import type { useWorkspace } from './useWorkspace';

/** The reactive store object returned by useWorkspace — passed down to the compact
 * widget components so they share one instance (one SSE connection, one clock). */
export type WorkspaceStore = ReturnType<typeof useWorkspace>;
