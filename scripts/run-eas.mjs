import { spawn } from 'node:child_process';

const npmCliPath = process.env.npm_execpath;

if (npmCliPath === undefined || npmCliPath.length === 0) {
  console.error('Run this EAS wrapper through `npm run eas -- ...`.');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    npmCliPath,
    'exec',
    '--yes',
    '--package=typescript@5.9.3',
    '--package=eas-cli@21.4.0',
    '--',
    'eas',
    ...process.argv.slice(2),
  ],
  {
    env: {
      ...process.env,
      EAS_NO_VCS: '1',
    },
    stdio: 'inherit',
  },
);

child.once('error', (error) => {
  console.error(`Unable to start EAS CLI: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`EAS CLI exited after receiving ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
