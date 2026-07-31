import { fireEvent, render } from '@testing-library/react-native';

import ProjectListScreen from '../app';
import { COPY } from '@/constants/copy';
import { DEVELOPMENT_DIAGNOSTICS_ENABLED } from '@/services/DiagnosticsService';
import { useProjectStore } from '@/stores/useProjectStore';

const mockRouterPush = jest.fn();
const mockImportCoordinator = {
  isImportActive: jest.fn(() => false),
  selectVideo: jest.fn(),
  discardSelection: jest.fn(),
  importProject: jest.fn(),
  cancelActiveImport: jest.fn(),
};

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockRouterPush(href),
    replace: jest.fn(),
  },
}));

jest.mock('@/services/ImportCoordinator', () => {
  const actual = jest.requireActual<typeof import('@/services/ImportCoordinator')>(
    '@/services/ImportCoordinator',
  );
  return {
    ...actual,
    importCoordinator: mockImportCoordinator,
  };
});

describe('development diagnostics entry', () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
    useProjectStore.setState({
      projects: [],
      isLoading: false,
      isInitialized: true,
      pendingProjectId: null,
      error: null,
      initialize: jest.fn(async () => undefined),
      refresh: jest.fn(async () => undefined),
    });
  });

  test('long-pressing the TempoLoop heading opens diagnostics in development', async () => {
    expect(DEVELOPMENT_DIAGNOSTICS_ENABLED).toBe(__DEV__);
    const screen = await render(<ProjectListScreen />);
    const heading = screen.getByRole('header', {
      name: COPY.projectList.headingAccessibilityLabel,
    });

    expect(heading.props.accessibilityHint).toBe(COPY.diagnostics.entryAccessibilityHint);
    await fireEvent(heading, 'longPress');

    expect(mockRouterPush).toHaveBeenCalledWith('/diagnostics');
  });
});
