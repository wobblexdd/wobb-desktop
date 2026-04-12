const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { defineConfig } = require('vite');

module.exports = defineConfig(async ({ mode }) => {
  const { default: react } = await import('@vitejs/plugin-react');
  const configsDir = path.resolve(__dirname, '../../configs');
  const envFiles = [
    path.join(configsDir, '.env'),
    path.join(configsDir, `.env.${mode}`),
  ];
  const clientEnv = {};

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) {
      continue;
    }

    const parsed = dotenv.parse(fs.readFileSync(envFile));
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('VITE_')) {
        clientEnv[key] = value;
      }
    }
  }

  return {
    root: __dirname,
    base: './',
    plugins: [react()],
    define: Object.fromEntries(
      Object.entries(clientEnv).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
    ),
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: path.resolve(__dirname, '../../dist/apps/web'),
      emptyOutDir: true,
    },
  };
});
