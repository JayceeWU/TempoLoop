import { create } from 'zustand';

import type { LeadInMs, PlaybackRate } from '@/domain/playback';
import type { DanceProject } from '@/domain/project';
import { projectRepository } from '@/repositories/ProjectRepository';
import type { ProjectMediaStatus, RecoveryDiagnostic } from '@/services/RecoveryService';

interface ProjectStoreState {
  projects: DanceProject[];
  mediaStatusByProjectId: Record<string, ProjectMediaStatus>;
  corruptProjectIds: string[];
  repositoryDiagnostics: readonly RecoveryDiagnostic[];
  isLoading: boolean;
  isInitialized: boolean;
  pendingProjectId: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  getProject: (projectId: string) => DanceProject | null;
  getMediaStatus: (projectId: string) => ProjectMediaStatus | null;
  renameProject: (projectId: string, name: string) => Promise<void>;
  updateSegments: (projectId: string, segments: DanceProject['segments']) => Promise<void>;
  updateSelectedRate: (projectId: string, selectedRate: PlaybackRate) => Promise<void>;
  updateLeadInMs: (projectId: string, leadInMs: LeadInMs) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  clearError: () => void;
}

let initializationPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown project error occurred.';
}

function repositorySnapshot(): Pick<
  ProjectStoreState,
  'projects' | 'mediaStatusByProjectId' | 'corruptProjectIds' | 'repositoryDiagnostics'
> {
  const projects = projectRepository.list();
  const mediaStatusByProjectId = Object.fromEntries(
    projects.flatMap((project) => {
      const status = projectRepository.getMediaStatus(project.id);
      return status === null ? [] : [[project.id, status] as const];
    }),
  );
  const recovery = projectRepository.getLastRecoveryReport();
  return {
    projects,
    mediaStatusByProjectId,
    corruptProjectIds: [...(recovery?.corruptProjectIds ?? [])],
    repositoryDiagnostics: [...(recovery?.diagnostics ?? [])],
  };
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
      ...repositorySnapshot(),
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
  mediaStatusByProjectId: {},
  corruptProjectIds: [],
  repositoryDiagnostics: [],
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
          ...repositorySnapshot(),
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
      await projectRepository.discover();
      set({
        ...repositorySnapshot(),
        isInitialized: true,
        error: null,
      });
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  getProject: (projectId) => get().projects.find((project) => project.id === projectId) ?? null,

  getMediaStatus: (projectId) => get().mediaStatusByProjectId[projectId] ?? null,

  renameProject: async (projectId, name) =>
    runProjectMutation(projectId, () => projectRepository.rename(projectId, name), set),

  updateSegments: async (projectId, segments) =>
    runProjectMutation(projectId, () => projectRepository.updateSegments(projectId, segments), set),

  updateSelectedRate: async (projectId, selectedRate) =>
    runProjectMutation(
      projectId,
      () => projectRepository.updateSelectedRate(projectId, selectedRate),
      set,
    ),

  updateLeadInMs: async (projectId, leadInMs) =>
    runProjectMutation(projectId, () => projectRepository.updateLeadInMs(projectId, leadInMs), set),

  deleteProject: async (projectId) =>
    runProjectMutation(projectId, () => projectRepository.delete(projectId), set),

  clearError: () => set({ error: null }),
}));
