const fs = jest.requireActual('fs') as {
  readFileSync(filePath: string, encoding: 'utf8'): string;
};
const path = jest.requireActual('path') as {
  join(...parts: string[]): string;
};

describe('Media3 Gradle verification gate', () => {
  const buildScript = fs.readFileSync(
    path.join('.', 'modules', 'tempoloop-media', 'android', 'build.gradle'),
    'utf8',
  );

  it('resolves each dependency graph from a task owned by that project', () => {
    expect(buildScript).toContain('candidateProject.tasks.register(verifierTaskName)');
    expect(buildScript).toContain('dependsOn(applicationMedia3Verifier)');
    expect(buildScript).not.toContain('targetProjects.each');
  });

  it('excludes instrumentation classpaths without swallowing resolution failures', () => {
    expect(buildScript).toContain("!name.contains('androidtest')");
    expect(buildScript).toContain('TempoLoopMedia could not resolve ${configurationLabel}');
    expect(buildScript).not.toContain('logger.warn("Skipping ${configurationLabel}');
  });
});
