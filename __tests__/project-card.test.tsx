import { render } from '@testing-library/react-native';

import { ProjectCard } from '@/components/ProjectCard';
import type { DanceProject } from '@/domain/project';
import { createEmptySegments } from '@/domain/segment';

const PROJECT: DanceProject = {
  schemaVersion: 1,
  id: 'c733c86b-6877-4986-bd4d-a26392f7dc82',
  name: 'Practice Track',
  createdAtIso: '2026-07-31T12:00:00.000Z',
  updatedAtIso: '2026-08-04T12:00:00.000Z',
  audioFileName: 'audio.m4a',
  waveformFileName: 'waveform.json',
  waveformStatus: 'ready',
  durationMs: 90_000,
  sourceDisplayName: null,
  sourceSizeBytes: null,
  selectedRate: 1,
  leadInMs: 6_000,
  segments: createEmptySegments(),
};

const noop = () => undefined;

describe('ProjectCard', () => {
  it('hides ready waveform and updated-time rows from the audio list', async () => {
    const screen = await render(
      <ProjectCard
        isPending={false}
        mediaStatus={null}
        onDelete={noop}
        onOpen={noop}
        onShowActions={noop}
        project={PROJECT}
      />,
    );

    expect(screen.getByText('Practice Track')).toBeTruthy();
    expect(screen.getByText('1:30 · 0 of 9 segments')).toBeTruthy();
    expect(screen.queryByText('Waveform ready')).toBeNull();
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(
      screen.getByRole('button', { name: /Practice Track.*1:30/ }).props.accessibilityLabel,
    ).not.toMatch(/Updated|Waveform ready/);
  });

  it('keeps unfinished waveform status visible', async () => {
    const screen = await render(
      <ProjectCard
        isPending={false}
        mediaStatus={null}
        onDelete={noop}
        onOpen={noop}
        onShowActions={noop}
        project={{ ...PROJECT, waveformStatus: 'pending' }}
      />,
    );

    expect(screen.getByText('Building waveform')).toBeTruthy();
  });
});
