import { fireEvent, render } from '@testing-library/react-native';

import { ImportProgressSheet } from '@/components/ImportProgressSheet';
import { ProjectNameSheet } from '@/components/ProjectNameSheet';

describe('import sheets', () => {
  it('requires a non-empty project name before confirmation', async () => {
    const onConfirm = jest.fn();
    const screen = await render(
      <ProjectNameSheet
        cancelLabel="Cancel"
        confirmLabel="Import"
        initialName=""
        inputLabel="Project name"
        message="Choose a name."
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        title="Name This Project"
        visible
      />,
    );

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Project name'), 'Warmup');
    await fireEvent.press(screen.getByRole('button', { name: 'Import' }));

    expect(onConfirm).toHaveBeenCalledWith('Warmup');
  });

  it('clamps native progress before exposing it to accessibility', async () => {
    const screen = await render(
      <ImportProgressSheet
        cancelLabel="Cancel Import"
        keepOpenMessage="Keep TempoLoop open."
        onCancel={jest.fn()}
        phaseLabel="Extracting audio..."
        progress={1.5}
        title="Importing Project"
        visible
      />,
    );

    expect(screen.getByLabelText('Extracting audio... 100 percent')).toHaveAccessibilityValue({
      min: 0,
      max: 100,
      now: 100,
    });
  });
});
