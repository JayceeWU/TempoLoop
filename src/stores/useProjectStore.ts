import { create } from 'zustand';

import type { DanceProject } from '@/domain/project';
import { projectRepository } from '@/repositories/ProjectRepository';

interface ProjectStoreState {
  projects: DanceProject[];
  isLoading: boolean;
  isInitialized: boolean;
  pendingProjectId: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  getProject: (projectId: string) => DanceProject | null;
  renameProject: (projectId: string, name: string) => Promise<void>;
  updateSegments: (projectId: string, segments: DanceProject['segments']) => Promise<void>;
  updatePreferences: (
    projectId: string,
    preferredRate: DanceProject['preferredRate'],
    lastSelectedSegment: DanceProject['lastSelectedSegment'],
  ) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  clearError: () => void;
}

let initializationPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown project error occurred.';
}

function repositoryProjects(): DanceProject[] {
  return projectRepository.list();
}

async function runProjectMutation(
  projectId: string,
  operation: () => Promise<void>,
  set: (
    partial:
      | Partial<ProjectStoreState>
      | ((state: ProjectStoreState) => Partial<ProjectStoreState> | ProjectStoreState),
  ) => void,
): Promise<void> {
  set({ pendingProjectId: projectId, error: null });

  try {
    await operation();
    set({
      projects: repositoryProjects(),
      pendingProjectId: null,
    });
  } catch (error) {
    set({
      pendingProjectId: null,
      error: errorMessage(error),
    });
    throw error;
  }
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  isLoading: false,
  isInitialized: false,
  pendingProjectId: null,
  error: null,

  initialize: async () => {
    if (get().isInitialized) {
      return;
    }

    if (initializationPromise) {
      return initializationPromise;
    }

    set({ isLoading: true, error: null });
    initializationPromise = (async () => {
      try {
        await projectRepository.initialize();
        set({
          projects: repositoryProjects(),
          isInitialized: true,
          isLoading: false,
        });
      } catch (error) {
        set({
          error: errorMessage(error),
          isLoading: false,
        });
        throw error;
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  },

  refresh: async () => {
    try {
      await projectRepository.initialize();
      set({
        projects: repositoryProjects(),
        isInitialized: true,
        error: null,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  getProject: (projectId) => get().projects.find((project) => project.id === projectId) ?? null,

  renameProject: async (projectId, name) =>
    runProjectMutation(projectId, () => projectRepository.rename(projectId, name), set),

  updateSegments: async (projectId, segments) =>
    runProjectMutation(projectId, () => projectRepository.updateSegments(projectId, segments), set),

  updatePreferences: async (projectId, preferredRate, lastSelectedSegment) =>
    runProjectMutation(
      projectId,
      () => projectRepository.updatePreferences(projectId, preferredRate, lastSelectedSegment),
      set,
    ),

  deleteProject: async (projectId) =>
    runProjectMutation(projectId, () => projectRepository.delete(projectId), set),

  clearError: () => set({ error: null }),
}));
