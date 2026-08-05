import { navigateBackOrHomeUsing, type BackNavigation } from '@/utils/navigation';

function navigation(canGoBack: boolean): BackNavigation & {
  back: jest.Mock;
  replace: jest.Mock;
} {
  return {
    canGoBack: () => canGoBack,
    back: jest.fn(),
    replace: jest.fn(),
  };
}

describe('navigateBackOrHome', () => {
  it('uses navigation history when a previous route exists', () => {
    const target = navigation(true);

    navigateBackOrHomeUsing(target);

    expect(target.back).toHaveBeenCalledTimes(1);
    expect(target.replace).not.toHaveBeenCalled();
  });

  it('replaces a root or deep-linked route with the project list', () => {
    const target = navigation(false);

    navigateBackOrHomeUsing(target);

    expect(target.back).not.toHaveBeenCalled();
    expect(target.replace).toHaveBeenCalledWith('/');
  });
});
