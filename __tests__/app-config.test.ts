import config from '../app.config';

describe('TempoLoop app configuration', () => {
  it('is an offline, iPhone-only application', () => {
    expect(config.name).toBe('TempoLoop');
    expect(config.slug).toBe('tempo-loop');
    expect(config.scheme).toBe('tempoloop');
    expect(config.platforms).toEqual(['ios']);
    expect(config.orientation).toBe('portrait');
    expect(config.icon).toBe('./assets/images/tempoloop-icon-v2.png');
    expect(config.updates?.enabled).toBe(false);
    expect(config.ios?.supportsTablet).toBe(false);
    expect(config.ios?.bundleIdentifier).toBe('com.jipeng.tempoloop');

    const splashPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );
    expect(splashPlugin).toEqual([
      'expo-splash-screen',
      expect.objectContaining({
        image: './assets/images/tempoloop-icon-v2.png',
        backgroundColor: '#F7F6F2',
      }),
    ]);
  });
});
