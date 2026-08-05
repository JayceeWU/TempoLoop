import { create } from 'zustand';

interface WaveformGenerationState {
  activeProjectId: string | null;
  queuedProjectIds: string[];
  progressByProjectId: Record<string, number>;
}

export const useWaveformStore = create<WaveformGenerationState>(() => ({
  activeProjectId: null,
  queuedProjectIds: [],
  progressByProjectId: {},
}));

export const waveformStateController = {
  setQueue(queuedProjectIds: readonly string[]): void {
    useWaveformStore.setState({ queuedProjectIds: [...queuedProjectIds] });
  },
  start(projectId: string): void {
    useWaveformStore.setState((state) => ({
      activeProjectId: projectId,
      progressByProjectId: { ...state.progressByProjectId, [projectId]: 0 },
    }));
  },
  progress(projectId: string, progress: number): void {
    useWaveformStore.setState((state) => ({
      progressByProjectId: {
        ...state.progressByProjectId,
        [projectId]: Math.min(1, Math.max(0, progress)),
      },
    }));
  },
  finish(projectId: string): void {
    useWaveformStore.setState((state) => {
      const progressByProjectId = { ...state.progressByProjectId };
      delete progressByProjectId[projectId];
      return {
        activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
        progressByProjectId,
      };
    });
  },
};
