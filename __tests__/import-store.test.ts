import { useImportStore } from '@/stores/useImportStore';

const selection = {
  selectionId: 'selection-1',
  sourceKindHint: 'video' as const,
  sourceUri: 'content://provider/video/42',
  displayName: 'practice.mov',
  sizeBytes: null,
  mimeType: 'video/quicktime',
  suggestedName: 'practice',
};

beforeEach(() => {
  useImportStore.getState().reset();
});

describe('useImportStore', () => {
  it('enforces a single selection/import lock', () => {
    expect(useImportStore.getState().tryBeginSelection()).toBe(true);
    expect(useImportStore.getState().tryBeginSelection()).toBe(false);
    useImportStore.getState().finishSelection(selection);
    expect(useImportStore.getState().tryBeginSelection()).toBe(false);

    expect(
      useImportStore.getState().tryBeginImport({
        operationId: 'operation-1',
        projectId: 'project-1',
        selection,
        projectName: 'Practice',
      }),
    ).toBe(true);
    expect(useImportStore.getState().tryBeginSelection()).toBe(false);
  });

  it('keeps overall progress monotonic and ignores stale operations', () => {
    useImportStore.getState().tryBeginSelection();
    useImportStore.getState().finishSelection(selection);
    useImportStore.getState().tryBeginImport({
      operationId: 'operation-1',
      projectId: 'project-1',
      selection,
      projectName: 'Practice',
    });

    useImportStore.getState().updateProgress('operation-1', {
      stage: 'exporting',
      stageProgress: 0.6,
      overallProgress: 0.5,
    });
    useImportStore.getState().updateProgress('operation-1', {
      stage: 'exporting',
      stageProgress: 0.2,
      overallProgress: 0.3,
    });
    useImportStore.getState().updateProgress('stale', {
      stage: 'finalizing',
      stageProgress: 1,
      overallProgress: 1,
    });

    expect(useImportStore.getState()).toMatchObject({
      stage: 'exporting',
      stageProgress: 0.2,
      overallProgress: 0.5,
    });
  });

  it.each(['complete', 'fail'] as const)('clears sensitive source state on %s', (terminal) => {
    useImportStore.getState().tryBeginSelection();
    useImportStore.getState().finishSelection(selection);
    useImportStore.getState().tryBeginImport({
      operationId: 'operation-1',
      projectId: 'project-1',
      selection,
      projectName: 'Secret project name',
    });

    if (terminal === 'complete') {
      useImportStore.getState().completeImport('operation-1', 'project-1');
    } else {
      useImportStore
        .getState()
        .failImport('operation-1', { code: 'E_EXPORT_EMPTY', userMessage: 'Import failed.' });
    }

    expect(useImportStore.getState()).toMatchObject({
      sourceUri: null,
      sourceMetadata: null,
      selectionId: null,
      suggestedName: null,
      projectName: null,
    });
  });
});
