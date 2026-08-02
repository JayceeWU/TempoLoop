import { router } from 'expo-router';

export interface BackNavigation {
  canGoBack(): boolean;
  back(): void;
  replace(href: '/'): void;
}

export function navigateBackOrHomeUsing(navigation: BackNavigation): void {
  if (navigation.canGoBack()) {
    navigation.back();
    return;
  }

  navigation.replace('/');
}

/** Returns to navigation history, or restores the project list for a root/deep-linked route. */
export function navigateBackOrHome(): void {
  navigateBackOrHomeUsing(router);
}
