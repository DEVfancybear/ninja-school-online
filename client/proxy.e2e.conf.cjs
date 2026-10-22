const port = Number(process.env.NINJA_E2E_SERVER_PORT ?? 3000);
const target = `http://127.0.0.1:${port}`;

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'warn',
  },
  '/ws': {
    target,
    secure: false,
    changeOrigin: true,
    ws: true,
    logLevel: 'warn',
  },
};
