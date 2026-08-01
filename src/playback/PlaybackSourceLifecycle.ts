export type ProjectPlaybackSourceClearer = (projectId: string) => Promise<void>;

let registeredClearer: ProjectPlaybackSourceClearer | null = null;

/**
 * Registers the single app-level audio owner. Phase 6's AudioPlayerProvider
 * owns the registration; the project list only knows that a matching source
 * must be released before its private directory is deleted.
 */
export function registerProjectPlaybackSourceClearer(
  clearer: ProjectPlaybackSourceClearer,
): () => void {
  registeredClearer = clearer;

  return () => {
    if (registeredClearer === clearer) {
      registeredClearer = null;
    }
  };
}

export async function clearProjectPlaybackSource(projectId: string): Promise<void> {
  if (registeredClearer !== null) {
    await registeredClearer(projectId);
  }
}
