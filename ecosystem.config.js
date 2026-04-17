module.exports = {
  apps: [
    {
      name: 'tankono-watcher',
      script: 'src/index.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
